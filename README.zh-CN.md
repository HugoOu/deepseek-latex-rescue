# deepseek-latex-rescue

**一个 Tampermonkey 用户脚本：把 DeepSeek 网页版里「没渲染出来、变成纯文本的 LaTeX」就地重新排版成公式 —— 公式一直都在，是解析环节把它丢掉了。**

[English](README.md) · 简体中文

## 为什么需要它

DeepSeek 网页版偶尔会把一段块级公式原样打印成源码：

```
\frac{\partial f_\alpha(x)}{\partial \alpha} = f_\alpha(x) \cdot \frac{\partial}{\partial \alpha}
\big[\alpha t(x) - \psi(\alpha)\big] = f_\alpha(x) \big[t(x) - \psi'(\alpha)\big]
]
```

对话内容并没有坏：刷新、清缓存、关扩展、换浏览器都没用。看 DOM 才知道真正发生了什么——前端生成了一个**空的块级公式节点**（`<span class="katex-display ds-markdown-math">`，`<annotation>` 为空），然后把真正的源码丢进了一个普通 `<p>`，拆成若干 `<span>` 和 `<br>`。末尾那个孤零零的 `]` 是被吃掉一半的结束定界符，所以通用 LaTeX 渲染器也救不了：定界符已经不在了。

这是 DeepSeek 前端的解析问题，不是浏览器的问题。本脚本是一个本地兜底。

## 它做什么

每秒遍历一次 `.ds-markdown` 里的助手消息，就地修复受影响的段落：

- 把段落拆成一个个子片段（`<span>`、文本、`<br>`、已渲染的 KaTeX、代码块）；
- 把连续的「像 LaTeX 的片段」聚成一段——公式与中文说明、已渲染行内公式混在同一段落里也能处理；
- 丢掉残留定界符（孤立的 `]`），拼成一行，用 **KaTeX 0.16.22**（与站点同版本）排版，观感与页面原生公式一致；
- KaTeX 解析失败时保持原文不动，所以最坏情况也不会比原来更糟。

不发送请求、不读取对话内容、不修改任何存储的数据。

## 特性

- **纯本地**：不需要 API Key，不联网传输，无遥测。
- **就地修复**：旧对话打开即恢复，不必重新提问。
- **混排安全**：公式旁边的中文、列表、已渲染行内公式都不会被误伤。
- **流式安全**：页面停止变化 1.2 秒后才动手，不干扰生成过程。
- **保守边界**：中文正文、代码块、输入框、已有公式都是硬边界；解析失败保留原文。
- **手动控制**：Tampermonkey 菜单可「立即扫描公式」「切换调试日志」。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)；
2. 安装本脚本：Greasyfork（首个公开版本发布后补链接）或 [GitHub 原始文件](https://raw.githubusercontent.com/HugoOu/deepseek-latex-rescue/main/deepseek-latex-rescue.user.js)；
3. 刷新任意 `chat.deepseek.com` 标签页（若仍用旧缓存，`Ctrl+F5`）。

验证：`F12 → Console` 应出现

```
[latex-rescue] v1.0.0 已启动；找到 N 个 .ds-markdown 容器
```

以及修复时的 `已补渲染` 日志。Tampermonkey 菜单里的「立即扫描公式」可强制重扫。

如果控制台提示 `KaTeX 没有加载成功`，说明你所在网络访问不了 jsdelivr，把脚本头部的 `@require` / `@resource` 两行和 `KATEX_CSS_BASE` 换成文件头注释里的 bootcdn 镜像即可。

## 工作原理

| 步骤 | 行为 |
| --- | --- |
| 容器 | `.ds-markdown`，失败时退回 `[class*="markdown"]`，再失败则从已渲染的 `.katex` 反推 |
| 片段拆分 | 直接文本节点、`<br>`、行内元素；`pre`、`code`、`.katex`、`.katex-display`、`textarea`、`contenteditable` 是硬边界 |
| 公式段识别 | 连续「不含中文、至少含一个 `\命令`」的片段，加上残留定界符片段（`]`、`\]`、`$$`） |
| 有效性校验 | 至少 2 个命令、2 个花括号、不含中文和 URL；去掉命令名后英文实词少于 3 个 |
| 渲染 | KaTeX `displayMode`、`throwOnError: false`、`strict: false`；出现 `.katex-error` 则保留原文 |
| 调度 | `MutationObserver` + 每秒一次兜底扫描；容器稳定 1.2 秒后才处理 |

## 已知限制

- 只修复块级残留。行内公式 DeepSeek 本来就能渲染，脚本不碰。
- KaTeX 不支持的命令（如 MicroTeX/WASM 专属的 `\ovalbox`、`\tabular`）会保持原文：站点自己会用 SVG 兜底，脚本刻意不去猜。
- 依赖 DeepSeek 的 DOM。若前端改了 `.ds-markdown` 类名，通用兜底仍会运行，但可能需要适配——请带控制台日志开 issue。
- 仅限 `chat.deepseek.com`，其他 AI 站点不在范围内。

## 开发

```
node test/detection.test.mjs
```

测试会从用户脚本中抽出纯函数，跑 9 个用例，包含真实段落结构（公式 + `<br>` + 残留 `]` + 中文注记）以及若干必须不命中的反例。

## 隐私

脚本完全在客户端运行：不读取、不存储、不传输对话内容，不调用任何 API，也不改动 DeepSeek 存储的数据。唯一的网络请求是 Tampermonkey 安装/首次运行时从 CDN 下载 KaTeX。

## 免责声明

非官方社区项目，与 DeepSeek 官方无关。它只是绕过一个前端 bug 的临时方案；等上游渲染器修好，本项目即可退役。

## License

MIT © 2026 HugoOu
