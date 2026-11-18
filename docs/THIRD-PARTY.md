# Third-party code

Pocket ships one hand-written markdown renderer's worth of behaviour, plus a
small, deliberately chosen set of libraries. This file is the attribution those
licences require and the map of what is actually inside the shipped bundles.

The app itself remains **MIT** (see `LICENSE`).

## What ships in the app

`npm run vendor` builds these into `assets/vendor/`. Both bundles are committed,
because the app is served as plain static files with no runtime bundler.

| Bundle | Size | Contains | Licence |
| --- | --- | --- | --- |
| `assets/vendor/pocket-md.mjs` | ~838 KB | markdown-it, its plugins, KaTeX, highlight.js, DOMPurify | see table below |
| `assets/vendor/pocket-mermaid.mjs` | ~5.2 MB | Mermaid | MIT |
| `assets/vendor/katex.css` + `fonts/*.woff2` (20) | ~24 KB + fonts | KaTeX stylesheet and fonts | MIT |

`pocket-md.mjs` is loaded with the chat. `pocket-mermaid.mjs` is imported
lazily, and only when a reply actually contains a diagram.

| Package | Version | Licence | Used for |
| --- | --- | --- | --- |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 15.0.3 | MIT | Markdown parsing |
| [markdown-it-anchor](https://github.com/valeriangalliat/markdown-it-anchor) | 10.1.0 | Unlicense | Heading ids (table of contents) |
| [markdown-it-task-lists](https://github.com/revin/markdown-it-task-lists) | 2.1.1 | ISC | `- [x]` lists |
| [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote) | 4.0.0 | MIT | Footnotes |
| [markdown-it-attrs](https://github.com/arve0/markdown-it-attrs) | 5.0.1 | MIT | Attribute syntax (renderer parity) |
| [markdown-it-front-matter](https://github.com/nickg/.../markdown-it-front-matter) | 0.2.4 | MIT | YAML frontmatter card |
| [markdown-it-github-alerts](https://github.com/antfu/markdown-it-github-alerts) | 1.0.1 | MIT | `> [!NOTE]` callouts |
| [markdown-it-texmath](https://github.com/goessner/markdown-it-texmath) | 1.0.0 | MIT | `$...$` / `$$...$$` delimiters |
| [KaTeX](https://katex.org) | 0.19.1 | MIT | Math rendering |
| [highlight.js](https://highlightjs.org) | 11.12.0 | BSD-3-Clause | Syntax highlighting |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.18 | MPL-2.0 OR Apache-2.0 | Sanitising rendered HTML |
| [Mermaid](https://mermaid.js.org) | 12.3.0 | MIT | Diagrams |

Build-time only (not shipped): [esbuild](https://esbuild.github.io) 0.28.2, MIT.

## What was adapted from Aurora Preview

[Aurora Preview](https://github.com/Abhishekkumar2021/aurora-preview) (MIT) was
the reference for the renderer's shape: the markdown-it plugin set, the
DOMPurify pass, the frontmatter card, the code-block toolbar, the lightbox, and
the idea of a self-contained HTML export. Its VS Code integration (editor scroll
sync, theme inheritance, commands, print-to-editor flow) was not copied.

`tools/render/engine.js` and `assets/export.js` are Pocket's own code, written
against that reference:

- raw HTML is **disabled** (`html: false`) rather than allowed;
- fenced code keeps Pocket's existing code-block markup and controls;
- math is KaTeX HTML output in the chat, MathML in exported files (a saved file
  must not depend on a font pack);
- the renderer is wrapped in a cache keyed by source text, so a streaming answer
  does not re-highlight every other message on each frame.

## Licence texts

The full texts are in each package under `node_modules/` after `npm install`,
and are redistributed in the generated bundles' copyright notices:

- **MIT / ISC / Unlicense / BSD-3-Clause**: attribution and the licence text are
  preserved in this file and in the source map-free bundle banners.
- **MPL-2.0 (DOMPurify)**: the library is used unmodified, from npm, and bundled
  by esbuild. MPL-2.0 permits this; the source is available at the link above.

If you redistribute Pocket, keep this file and the `LICENSE` with it.
