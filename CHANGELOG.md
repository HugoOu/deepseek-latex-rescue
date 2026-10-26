# Changelog

## 1.0.0 — 2026-10-26

First public release.

- Re-typesets LaTeX that DeepSeek web leaves as plain text, in place, on already-open conversations.
- Piece-level run detection: a formula sharing a paragraph with Chinese prose, a `<br>` sequence, or a residual `]` is still recognised.
- KaTeX pinned to **0.16.22**, the version the site itself uses, so repaired formulas match the surrounding ones.
- Conservative boundaries: code blocks, inputs, existing formulas and CJK prose are never touched; a failed KaTeX parse keeps the original text.
- MutationObserver + 1 s tick, with a 1.2 s settle delay so streaming messages are not modified mid-generation.
- Tampermonkey menu: *立即扫描公式* (rescan now) and *切换调试日志* (toggle verbose logging).
- jsdelivr CDN by default; bootcdn fallback documented in the script header.

### Pre-release history

- 0.4.0 — piece-level detection; handled the real-world DOM (formula + residual `]` + Chinese italic note in one paragraph).
- 0.3.0 — first working version; paragraph-level detection, which missed mixed paragraphs.
