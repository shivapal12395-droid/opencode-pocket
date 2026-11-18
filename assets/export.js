/**
 * Export a conversation answer / artifact as something you can keep.
 *
 * Two outputs, both built from the same rendered document:
 *
 *  - **HTML** — one self-contained file, no network, dark AMOLED reading view
 *    on screen and a light, ink-friendly sheet when printed. KaTeX math is
 *    rendered as MathML here, so the file needs no font pack to look right.
 *  - **PDF** — the same document handed to the system print dialog. On Android
 *    that dialog's "Save as PDF" is the PDF writer; in a browser it is the
 *    browser's own print-to-PDF. Nothing is faked: if the platform has no print
 *    surface, the caller saves the HTML and says so.
 *
 * The markup is sanitised by the markdown engine before it reaches either
 * output, so an exported file cannot carry a script out of the model reply.
 */
import { renderDocument, escapeHtml, headingsOf } from "./markdown.js";

const BASE_CSS = `
:root {
  --accent: #7c5cff;
  --bg: #000; --elev: #0d0d11; --soft: #15151b;
  --text: #e8e8ee; --muted: #9aa0ad; --line: #22222b; --line-strong: #32323d;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --sans: "Noto Sans", "Segoe UI", Roboto, system-ui, -apple-system, sans-serif;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; padding: 32px 18px 64px;
  background: var(--bg); color: var(--text);
  font: 16px/1.68 var(--sans);
}
.doc { max-width: 74ch; margin: 0 auto; }
.doc-head { border-bottom: 1px solid var(--line); padding-bottom: 14px; margin-bottom: 22px; }
.doc-title { margin: 0 0 6px; font-size: 26px; line-height: 1.24; letter-spacing: -0.02em; }
.doc-meta { margin: 0; color: var(--muted); font-size: 12.5px; }
.toc { margin: 0 0 24px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--soft); }
.toc-title { margin: 0 0 6px; font-size: 10.5px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); }
.toc ol { margin: 0; padding-left: 18px; font-size: 13.5px; }
.toc li.l3 { margin-left: 14px; list-style: circle; }
.toc a { color: var(--text); text-decoration: none; }
.md { font-size: 15.5px; }
.md h1, .md h2, .md h3, .md h4 { line-height: 1.3; letter-spacing: -0.015em; margin: 26px 0 10px; font-weight: 650; }
.md h1 { font-size: 22px; } .md h2 { font-size: 19px; } .md h3 { font-size: 17px; } .md h4 { font-size: 15.5px; }
.md p { margin: 0 0 12px; }
.md ul, .md ol { margin: 0 0 12px; padding-left: 22px; }
.md li + li { margin-top: 4px; }
.md a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.md blockquote { margin: 0 0 12px; padding: 2px 0 2px 13px; border-left: 2px solid var(--line-strong); color: var(--muted); }
.md hr { border: 0; border-top: 1px solid var(--line); margin: 22px 0; }
.md code { font-family: var(--mono); font-size: .9em; background: var(--soft); border: 1px solid var(--line); border-radius: 5px; padding: 1px 4px; }
.md img { max-width: 100%; border-radius: 8px; }
.md .table-wrap { overflow-x: auto; margin: 0 0 14px; }
.md table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.md th, .md td { text-align: left; padding: 7px 9px; border: 1px solid var(--line); }
.md th { background: var(--soft); font-weight: 650; }
.md .code-block { margin: 0 0 14px; border: 1px solid var(--line); border-radius: 11px; overflow: hidden; background: var(--elev); }
.md .code-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--line); background: var(--soft); }
.md .code-lang { font: 700 10.5px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.md .code-tools { display: none; } /* controls belong to the app, not to a saved file */
.md .code-block pre { margin: 0; padding: 11px 12px; overflow-x: auto; }
.md .code-block code { background: none; border: 0; padding: 0; font-size: 12.8px; line-height: 1.58; }
.md pre.numbered code { display: block; }
.md pre.numbered .cl { display: block; }
.md pre.numbered .cl::before { content: attr(data-n); display: inline-block; width: 2.6em; margin-right: 10px; text-align: right; color: var(--muted); opacity: .55; }
.md .mermaid { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--soft); font: 12.5px/1.5 var(--mono); overflow-x: auto; }
.md .mermaid::before { content: "diagram source"; display: block; margin-bottom: 6px; font: 700 10px/1 var(--sans); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.md .markdown-alert { margin: 0 0 14px; padding: 10px 12px; border: 1px solid var(--line); border-left: 3px solid var(--muted); border-radius: 10px; background: var(--soft); }
.md .markdown-alert-title { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; font-size: 11.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.md .markdown-alert-title svg { width: 14px; height: 14px; fill: currentColor; }
.md .markdown-alert-note { border-left-color: var(--accent); }
.md .markdown-alert-tip { border-left-color: #16a34a; }
.md .markdown-alert-important { border-left-color: var(--accent); }
.md .markdown-alert-warning { border-left-color: #d97706; }
.md .markdown-alert-caution { border-left-color: #dc2626; }
.md .katex { font-size: 1.02em; }
.md .katex-display { margin: 0 0 14px; padding: 8px 2px; overflow-x: auto; }
.md .footnotes { margin-top: 22px; font-size: 13px; color: var(--muted); }
.md .footnotes-sep { border: 0; border-top: 1px solid var(--line); margin: 20px 0 12px; }
.md .frontmatter { margin: 0 0 16px; padding: 11px 13px; border: 1px solid var(--line); border-radius: 11px; background: var(--soft); }
.md .fm-title { font-weight: 650; }
.md .fm-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 5px; }
.md .fm-field { font-size: 12px; color: var(--muted); }
.md .task { display: inline-block; width: 12px; height: 12px; margin-right: 6px; border: 1px solid var(--line-strong); border-radius: 3px; vertical-align: -1px; }
.md .task.done { background: var(--accent); border-color: var(--accent); }
.md .task-list-item { list-style: none; }
.doc-foot { margin-top: 34px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11.5px; }
/* highlight.js tokens, same palette as the app */
.hljs { color: #e6e8ec; background: transparent; }
.hljs-comment, .hljs-quote { color: #7a8394; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-doctag { color: #c792ea; }
.hljs-string, .hljs-regexp, .hljs-addition { color: #9ece6a; }
.hljs-number, .hljs-symbol, .hljs-bullet { color: #ffb86c; }
.hljs-title, .hljs-title.function_, .hljs-function .hljs-title { color: #82aaff; }
.hljs-title.class_, .hljs-type, .hljs-class .hljs-title { color: #ffcb6b; }
.hljs-built_in, .hljs-builtin-name { color: #f78c6c; }
.hljs-attr, .hljs-attribute, .hljs-property { color: #ffcb6b; }
.hljs-tag, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: #f07178; }
.hljs-meta, .hljs-meta .hljs-keyword { color: #82aaff; }
.hljs-deletion { color: #f07178; }

@media print {
  :root { --bg: #fff; --elev: #fff; --soft: #f6f6f7; --text: #111; --muted: #555; --line: #d8d8de; --line-strong: #b8b8c2; }
  @page { margin: 16mm 14mm; }
  body { padding: 0; background: #fff; color: #111; font-size: 10.5pt; }
  .doc { max-width: none; }
  .toc { break-inside: avoid; }
  .md .code-block, .md .markdown-alert, .md .frontmatter, .md table { break-inside: avoid; }
  .md .code-tools { display: none; }
  .md a { color: #111; }
  .doc-foot { color: #555; }
}
`;

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

function tableOfContents(markdown) {
  const heads = headingsOf(markdown).filter((h) => h.level <= 3);
  if (heads.length < 3) return "";
  return (
    '<nav class="toc"><p class="toc-title">Contents</p><ol>' +
    heads
      .map((h) => `<li class="l${h.level}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`)
      .join("") +
    "</ol></nav>"
  );
}

/**
 * One self-contained HTML document. `markdown` is the source, so the export is
 * a readable document rather than a screenshot of a phone screen.
 */
export function buildStandaloneHtml({ title = "OpenCode answer", markdown = "", meta = "", origin = "" } = {}) {
  const body = renderDocument(markdown);
  const safeTitle = escapeHtml(title || "OpenCode answer");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="OpenCode Pocket">
<title>${safeTitle}</title>
<style>${BASE_CSS}</style>
</head>
<body>
<main class="doc">
  <header class="doc-head">
    <h1 class="doc-title">${safeTitle}</h1>
    <p class="doc-meta">${escapeHtml(meta || new Date().toLocaleString())}${origin ? " · " + escapeHtml(origin) : ""}</p>
  </header>
  ${tableOfContents(markdown)}
  <article class="md">${body}</article>
  <footer class="doc-foot">Exported from OpenCode Pocket.</footer>
</main>
</body>
</html>`;
}

export function exportName(title, ext) {
  const clean = String(title || "opencode-answer")
    .replace(/[^\w\u0900-\u097F.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${clean || "opencode-answer"}-${stamp()}.${ext}`;
}

/**
 * Print (and therefore save as PDF) through whichever surface exists.
 * Returns an honest verdict instead of pretending: `native`, `browser`, or
 * `none` with a reason the caller can show.
 */
export async function printDocument({ title, markdown, meta, origin }) {
  const html = buildStandaloneHtml({ title, markdown, meta, origin });
  let native = false;
  try {
    native = !!window.PocketNative?.isNative?.();
  } catch {}
  if (native) {
    // Inside the app there is exactly one honest surface: the Android print
    // service. A WebView that predates the bridge cannot print, and saying so
    // beats a button that appears to work and does nothing.
    if (!window.PocketNative?.printHtml) {
      return { via: "none", html, reason: "this build of the app has no print bridge" };
    }
    try {
      const ok = window.PocketNative.printHtml(html, title || "OpenCode answer");
      return { via: ok ? "native" : "none", html, reason: ok ? "" : "the print service refused the job" };
    } catch (err) {
      return { via: "none", html, reason: err?.message || "the print bridge failed" };
    }
  }
  // Browser path: an offscreen iframe keeps the app's own DOM untouched.
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.srcdoc = html;
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        resolve({ via: "browser", html });
        setTimeout(() => frame.remove(), 60000);
      } catch (err) {
        frame.remove();
        resolve({ via: "none", html, reason: err?.message || "this browser has no print surface" });
      }
    };
    document.body.appendChild(frame);
  });
}
