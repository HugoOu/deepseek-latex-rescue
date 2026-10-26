# deepseek-latex-rescue

**A Tampermonkey userscript that re-typesets LaTeX that DeepSeek's web chat leaves as plain text — the formula was always there, the parser just dropped it.**

English · [简体中文](README.zh-CN.md)

## Why

DeepSeek's web chat occasionally prints a block formula as raw source instead of typesetting it:

```
\frac{\partial f_\alpha(x)}{\partial \alpha} = f_\alpha(x) \cdot \frac{\partial}{\partial \alpha}
\big[\alpha t(x) - \psi(\alpha)\big] = f_\alpha(x) \big[t(x) - \psi'(\alpha)\big]
]
```

The conversation is not corrupted — reloading, clearing the cache, disabling extensions or switching browsers changes nothing. Inspecting the DOM shows what actually happened: the frontend emitted an **empty display-math node** (`<span class="katex-display ds-markdown-math">` whose `<annotation>` is empty) and then dumped the real source into an ordinary `<p>`, split across `<span>`/`<br>` nodes. The trailing `]` is the remains of the closing delimiter, so generic LaTeX renderers cannot help either: the delimiters are already gone.

Everything below the first paragraph of that reply is a DeepSeek frontend issue, not a browser one. This script is a local workaround.

## What it does

Once per second it walks assistant messages under `.ds-markdown` and repairs the affected paragraphs in place:

- splits a paragraph into child pieces (`<span>`, text, `<br>`, already-rendered KaTeX, code fences);
- groups consecutive LaTeX-looking pieces into a run — a formula sharing a paragraph with Chinese prose or with rendered inline math is still handled;
- drops residual delimiters (a lone `]`), joins the run and typesets it with **KaTeX 0.16.22**, the same version DeepSeek uses, so the result matches the surrounding formulas;
- leaves the text untouched when KaTeX cannot parse it, so nothing is ever worse than before.

It sends no request, reads no conversation data and changes no stored state.

## Features

- **Local only** — no API key, no network traffic, no telemetry.
- **In-place repair** — old conversations are fixed as soon as you open them; no need to re-ask.
- **Mixing-safe** — formulas next to prose, lists or rendered inline math are repaired without touching the prose.
- **Stream-safe** — waits until the page has been quiet for 1.2 s, so it never interferes with generation.
- **Conservative** — CJK text, code blocks, inputs and existing formulas are hard boundaries; a failed parse keeps the original text.
- **Manual control** — Tampermonkey menu: *立即扫描公式* (rescan now) and *切换调试日志* (verbose logging).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Install the script — Greasyfork (link added with the first public release) or [the raw GitHub file](https://raw.githubusercontent.com/HugoOu/deepseek-latex-rescue/main/deepseek-latex-rescue.user.js).
3. Reload any `chat.deepseek.com` tab (`Ctrl+F5` if the page keeps a cached copy).

Verification: `F12 → Console` should show

```
[latex-rescue] v1.0.0 已启动；找到 N 个 .ds-markdown 容器
```

then `已补渲染` lines for the repaired paragraphs. *立即扫描公式* in the Tampermonkey menu forces a rescan.

If the console says `KaTeX 没有加载成功`, jsdelivr is blocked on your network — switch the two `@require`/`@resource` lines and `KATEX_CSS_BASE` to the bootcdn mirror documented in the script header.

## How it works

| Step | Behaviour |
| --- | --- |
| Containers | `.ds-markdown`, falling back to `[class*="markdown"]`, then to containers derived from already-rendered `.katex` |
| Piece splitting | direct text nodes, `<br>` and inline elements; `pre`, `code`, `.katex`, `.katex-display`, `textarea` and `contenteditable` are hard boundaries |
| Run detection | consecutive pieces that look like LaTeX (no CJK, at least one `\command`) plus residual-delimiter pieces (`]`, `\]`, `$$`) |
| Validation | at least 2 commands, at least 2 braces, no CJK or URL, and fewer than 3 English words once command names are removed |
| Rendering | KaTeX `displayMode`, `throwOnError: false`, `strict: false`; a `.katex-error` result keeps the original text |
| Scheduling | `MutationObserver` plus a 1 s tick; a container is only touched once it has settled for 1.2 s |

## Limitations

- Only block-level leftovers are repaired. Inline formulas are rendered correctly by DeepSeek already; the script does not touch them.
- Commands KaTeX does not support (e.g. the MicroTeX/WASM-only `\ovalbox`, `\tabular`) are left as text: DeepSeek's own fallback draws those as SVG, and this script deliberately does not guess.
- The script depends on DeepSeek's DOM. If the frontend renames `.ds-markdown` the generic fallback still runs, but a fix may be needed — open an issue with the console log.
- Scoped to `chat.deepseek.com` only. Other AI sites are out of scope.

## Development

```
node test/detection.test.mjs
```

The test extracts the pure detection helpers from the userscript and runs nine cases, including the real-world paragraph shape (formula + `<br>` + residual `]` + Chinese note) and several must-not-match cases.

## Privacy

The script is entirely client-side. It does not read, store or transmit your conversations, does not call any API and does not modify DeepSeek's stored data. The only network requests are the ones Tampermonkey makes to download KaTeX from the CDN when the script is installed and first run.

## Disclaimer

Unofficial community project, not affiliated with DeepSeek. It works around a frontend bug and will be retired once the upstream renderer handles these formulas correctly.

## License

MIT © 2026 HugoOu
