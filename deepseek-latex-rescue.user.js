// ==UserScript==
// @name         DeepSeek LaTeX 补渲染（公式救援）
// @name:en      DeepSeek LaTeX Rescue
// @namespace    https://github.com/HugoOu/deepseek-latex-rescue
// @version      1.0.0
// @description  把 DeepSeek 网页回复里「没被渲染出来的 LaTeX 源码」自动用 KaTeX 补渲染成正常公式（支持公式与中文混在同一段落）
// @description:en  Re-render LaTeX source that DeepSeek web fails to typeset, using KaTeX.
// @author       HugoOu
// @license      MIT
// @homepageURL  https://github.com/HugoOu/deepseek-latex-rescue
// @supportURL   https://github.com/HugoOu/deepseek-latex-rescue/issues
// @match        https://chat.deepseek.com/*
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js
// @resource     katexCss https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css
// @grant        GM_getResourceText
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

/*
 * 安装：Tampermonkey → 添加新脚本 → 全选删除 → 粘贴本文件全部内容 → Ctrl+S
 * 卸载：Tampermonkey 面板里关掉这个脚本即可，不会改动网页任何数据。
 *
 * 如果控制台报 KaTeX 没加载（jsdelivr 被墙），把上面两行换成 bootcdn：
 *   @require  https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.22/katex.min.js
 *   @resource katexCss https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.22/katex.min.css
 * 并把下方 KATEX_CSS_BASE 改成 https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.22/
 *
 * 排查：F12 控制台看 [latex-rescue] 开头的日志（Tampermonkey 菜单可开调试日志）；
 *       Tampermonkey 图标 → 「立即扫描公式」可手动重扫当前页面。
 */

(function () {
  'use strict';

  const VERSION = '1.0.0';
  let DEBUG = false;                        // Tampermonkey 菜单可切换
  const SETTLE_MS = 1200;                   // 页面停止变化多久后才动手（避免打断流式输出）
  const KATEX_CSS_BASE = 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/';
  const log = (...a) => { if (DEBUG) console.log('[latex-rescue]', ...a); };

  if (typeof katex === 'undefined') {
    console.warn('[latex-rescue] KaTeX 没有加载成功（多半是 CDN 被拦截）。脚本已停止；请按文件头注释换成 bootcdn 地址后重装。');
    return;
  }

  /* ---------- 选择器 ---------- */

  const CONTAINER_PRIMARY = '.ds-markdown';
  const CONTAINER_FALLBACK = '[class*="markdown"]';
  const LEAF_SEL = 'p, li, td, th, dt, dd, div, blockquote';
  // 命中这些的元素一律当作「不可碰的边界」：已渲染公式、代码块、输入框
  const BOUNDARY_SEL = 'pre, code, .katex, .katex-display, mjx-container, textarea, [contenteditable="true"], script, style';
  const BLOCK_TAGS = new Set(['P', 'LI', 'DIV', 'BLOCKQUOTE', 'TABLE', 'UL', 'OL', 'PRE', 'CODE', 'SECTION', 'ARTICLE']);

  /* ---------- 文本判断 ---------- */

  const CJK_RE = /[\u3000-\u303F\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;
  const CMD_RE = /\\[a-zA-Z]+/g;

  /** 一小段文本像不像 LaTeX 片段（不含中文、至少有一个 \命令） */
  function isMathPiece(text) {
    const t = (text || '').trim();
    if (t.length < 2) return false;
    if (CJK_RE.test(t)) return false;
    if (/https?:\/\//.test(t)) return false;
    return /\\[a-zA-Z]+/.test(t);
  }

  /** 残留的半个定界符，例如单独的 "]"、"\\]"、"$$" */
  function isResidual(text) {
    const t = (text || '').trim();
    return /^(?:\\?[\]\)\}]|\$\$?|\\\[|\\\]|\\\(|\\\))$/.test(t);
  }

  /** 整段（拼好的）文本是否够格当公式：至少 2 个命令、2 个花括号、不含中文、不像正文 */
  function looksLikeBareLatex(text) {
    if (!text) return false;
    const t = text.trim();
    if (t.length < 6) return false;
    if (CJK_RE.test(t)) return false;
    if (/https?:\/\//.test(t)) return false;
    const cmds = t.match(CMD_RE) || [];
    if (cmds.length < 2) return false;               // 至少两个 LaTeX 命令
    const braces = (t.match(/[{}]/g) || []).length;
    if (braces < 2) return false;
    // 去掉命令名之后还剩下 3 个以上英文单词 → 更像在讨论 LaTeX 的正文，别动它
    const stripped = t.replace(/\\[a-zA-Z]+/g, ' ');
    const proseWords = stripped.match(/[A-Za-z]{3,}/g) || [];
    if (proseWords.length >= 3) return false;
    return true;
  }

  /** 去掉残留定界符、拼回一行，得到可直接交给 KaTeX 的源码 */
  function normalizeLatex(raw) {
    let t = String(raw).replace(/\r/g, '');
    t = t.replace(/^\s*(?:\\\[|\$\$|\\\()\s*/, '');
    t = t.replace(/\s*(?:\\\]|\$\$|\\\))\s*$/, '');
    const lines = t.split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .filter((s) => !/^(?:\[|\]|\\\[|\\\]|\$\$?)$/.test(s));
    return lines.join(' ').trim();
  }

  /* ---------- 渲染 ---------- */

  function renderMath(src, displayMode) {
    const holder = document.createElement('span');
    try {
      katex.render(src, holder, {
        displayMode: !!displayMode,
        throwOnError: false,
        strict: false,
        trust: false
      });
    } catch (e) {
      log('KaTeX 抛异常：', e && e.message, '｜源码：', src.slice(0, 80));
      return null;
    }
    if (holder.querySelector('.katex-error')) {
      log('KaTeX 解析失败，保持原文：', src.slice(0, 80));
      return null;
    }
    return holder;
  }

  /* ---------- 把块元素拆成「片段」，再找出连续的公式片段 ---------- */

  function childDescriptors(el) {
    const out = [];
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        out.push({ node: n, br: false, skip: false, text: n.nodeValue || '' });
      } else if (n.nodeType === 1) {
        if (n.tagName === 'BR') {
          out.push({ node: n, br: true, skip: false, text: '\n' });
        } else if (n.matches(BOUNDARY_SEL) || n.querySelector(BOUNDARY_SEL)) {
          out.push({ node: n, br: false, skip: true, text: '' });
        } else {
          out.push({ node: n, br: false, skip: false, text: n.innerText || n.textContent || '' });
        }
      }
    }
    return out;
  }

  /** 纯函数：把片段列表切成若干「公式候选段」 */
  function runsFromDescriptors(descs) {
    const runs = [];
    let cur = [];
    const flush = () => { if (cur.length) { runs.push(cur); cur = []; } };
    for (const d of descs) {
      if (d.skip) { flush(); continue; }
      if (d.br) { if (cur.length) cur.push(d); continue; }
      const t = d.text || '';
      if (!t.trim()) { continue; }                       // 空 span 直接忽略
      if (isMathPiece(t) || (cur.length && isResidual(t))) cur.push(d);
      else flush();
    }
    flush();
    return runs;
  }

  /** 尝试把一段公式候选渲染并替换掉；成功返回 true */
  function renderRun(run) {
    const text = run.map((d) => d.text).join('');
    if (!looksLikeBareLatex(text)) return false;
    const src = normalizeLatex(text);
    if (!src || src.length < 4) return false;
    const node = renderMath(src, true);
    if (!node) return false;

    const first = run[0].node;
    const parent = first.parentNode;
    if (!parent) return false;

    const block = document.createElement('span');
    block.className = 'ds-latex-rescue';
    block.style.cssText = 'display:block;text-align:center;overflow-x:auto;overflow-y:hidden;padding:2px 0;';
    block.appendChild(node);
    parent.insertBefore(block, first);
    for (const d of run) {
      if (d.node.parentNode === parent) parent.removeChild(d.node);
    }
    log('已补渲染：', src.slice(0, 60));
    return true;
  }

  /* ---------- KaTeX 样式（页面自己已加载时复用，不重复注入） ---------- */

  function ensureKatexCss() {
    if (document.querySelector('.katex')) return;                    // 页面本来就有 KaTeX 样式
    if (document.querySelector('style[data-latex-rescue-css]')) return;
    let css = '';
    try {
      css = (typeof GM_getResourceText === 'function' && GM_getResourceText('katexCss')) || '';
    } catch (e) {
      log('读取 KaTeX CSS 资源失败：', e && e.message);
    }
    if (!css) return;
    // 把相对字体路径改写成 CDN 绝对路径（资源被注入到本页后相对路径会 404）
    css = css.replace(/url\((['"]?)fonts\//g, (m, q) => 'url(' + (q || '') + KATEX_CSS_BASE + 'fonts/');
    const style = document.createElement('style');
    style.setAttribute('data-latex-rescue-css', '1');
    style.textContent = css;
    document.head.appendChild(style);
    log('已注入 KaTeX CSS');
  }

  /* ---------- 容器查找 ---------- */

  let containersCache = [];
  let lastMutationAt = 0;
  const lastChange = new WeakMap();

  function getContainers() {
    let els = Array.from(document.querySelectorAll(CONTAINER_PRIMARY));
    if (!els.length) els = Array.from(document.querySelectorAll(CONTAINER_FALLBACK));
    if (!els.length) {
      const set = new Set();
      document.querySelectorAll('.katex').forEach((k) => {
        let p = k.parentElement;
        let up = 0;
        while (p && up < 6 && (p.textContent || '').length < 60) { p = p.parentElement; up++; }
        if (p) set.add(p);
      });
      els = Array.from(set);
    }
    if (!els.length) els = [document.body];
    return els.filter((el) => !els.some((other) => other !== el && other.contains(el)));
  }

  function containerFor(node) {
    let c = node.closest(CONTAINER_PRIMARY) || node.closest(CONTAINER_FALLBACK);
    if (!c && node.closest) c = containersCache.find((x) => x.contains(node)) || null;
    return c;
  }

  function isLeafBlock(el) {
    for (const child of el.children) {
      if (BLOCK_TAGS.has(child.tagName)) return false;
    }
    return true;
  }

  /* ---------- 扫描 ---------- */

  function scan() {
    const list = getContainers();
    containersCache = list;
    let fixed = 0;
    for (const container of list) {
      const t = container === document.body ? lastMutationAt : (lastChange.get(container) || lastMutationAt || 0);
      if (Date.now() - t < SETTLE_MS) continue;          // 还在输出就先别动

      for (const el of container.querySelectorAll(LEAF_SEL)) {
        if (el.classList && el.classList.contains('ds-latex-rescue')) continue;
        if (el.closest(BOUNDARY_SEL)) continue;
        if (!isLeafBlock(el)) continue;
        const descs = childDescriptors(el);
        for (const run of runsFromDescriptors(descs)) {
          if (renderRun(run)) fixed++;
        }
      }
    }
    if (fixed) log('本轮补渲染 ' + fixed + ' 段');
    return fixed;
  }

  /* ---------- 观察页面变化 + 定时兜底 ---------- */

  const mo = new MutationObserver((muts) => {
    lastMutationAt = Date.now();
    for (const m of muts) {
      let n = m.target;
      if (n && n.nodeType !== 1) n = n.parentElement;
      if (!n || !n.closest) continue;
      const c = containerFor(n);
      if (c) lastChange.set(c, Date.now());
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  ensureKatexCss();
  scan();
  setInterval(scan, 1000);

  try {
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('立即扫描公式', () => {
        const n = scan();
        console.info('[latex-rescue] 手动扫描完成，补渲染 ' + n + ' 段');
      });
      GM_registerMenuCommand('切换调试日志', () => {
        DEBUG = !DEBUG;
        console.info('[latex-rescue] 调试日志 ' + (DEBUG ? '已开启' : '已关闭'));
      });
    }
  } catch (e) { /* 忽略 */ }

  setTimeout(() => {
    const n = document.querySelectorAll(CONTAINER_PRIMARY).length;
    log('v' + VERSION + ' 已启动；找到 ' + n + ' 个 ' + CONTAINER_PRIMARY + ' 容器');
    if (n === 0) {
      console.warn('[latex-rescue] 没找到 .ds-markdown 容器：DeepSeek 可能改了前端类名，脚本会退回通用容器。若页面上公式仍没恢复，请在 issue 里附上这段日志。');
    }
  }, 6000);

  // 留给控制台手动调试用（Tampermonkey 沙箱里要挂到 unsafeWindow 才能从页面控制台访问）
  try {
    const uw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    uw.__latexRescue = { scan, runsFromDescriptors, looksLikeBareLatex, normalizeLatex, version: VERSION };
  } catch (e) { /* 忽略 */ }
})();
