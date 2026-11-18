/**
 * Markdown for the chat transcript.
 *
 * The engine itself lives in assets/vendor/pocket-md.mjs, generated from
 * tools/render/engine.js by `npm run vendor` (see docs/THIRD-PARTY.md for the
 * libraries inside it). This module is the thin part that belongs to the app:
 * a render cache, so re-rendering a transcript while one answer streams does
 * not re-highlight and re-typeset every other message, plus the plain-text
 * helpers the sidebar and search use.
 */
import { createRenderer, escapeHtml as escape } from "./vendor/pocket-md.mjs";

export const escapeHtml = escape;

const renderer = createRenderer();

/* The transcript is rebuilt while an answer streams. Everything except the part
 * being written is identical to the previous build, so cache by source text:
 * highlight.js and KaTeX then run once per distinct block, not once per frame. */
const CACHE_MAX = 120;
const cache = new Map();

export function renderMarkdown(source) {
  const src = String(source ?? "");
  const hit = cache.get(src);
  if (hit !== undefined) {
    // touch: Map preserves insertion order, so re-inserting marks it as recent
    cache.delete(src);
    cache.set(src, hit);
    return hit;
  }
  const html = renderer.render(src);
  cache.set(src, html);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return html;
}

/**
 * The same document for export: MathML math instead of KaTeX's HTML, so a saved
 * file looks right without a font pack beside it. Built on first use — most
 * sessions never export anything.
 */
let docRenderer = null;
export function renderDocument(source) {
  if (!docRenderer) docRenderer = createRenderer({ mathOutput: "mathml" });
  return docRenderer.render(String(source ?? ""));
}

/** Plain text for previews and search. */
export function plainPreview(src, max = 120) {
  const text = String(src ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[*_`>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1) + "..." : text;
}

/** Headings in a markdown document, for a table of contents. */
export function headingsOf(src) {
  return String(src ?? "")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/))
    .filter(Boolean)
    .map((m) => ({ level: m[1].length, text: m[2], id: m[2].toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") }));
}
