/**
 * The markdown engine behind the chat transcript.
 *
 * Adapted from Aurora Preview's renderer (MIT - see docs/THIRD-PARTY.md). Three
 * deliberate differences, because this runs on a phone against model output:
 *
 *  1. Raw HTML is *disabled* (`html: false`) instead of allowed, so a reply can
 *     never inject markup; everything is escaped by markdown-it.
 *  2. Fenced code keeps this app's own code-block markup (language chip, wrap,
 *     open, copy) with highlight.js inside it, and long plain blocks keep their
 *     line numbers.
 *  3. The result is sanitised with DOMPurify before it reaches the DOM.
 *
 * Typographer stays off: this is a coding client, and turning `--flag` into an
 * en dash or straight quotes into curly ones mangles what the user pastes back.
 */
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import frontMatter from "markdown-it-front-matter";
import githubAlerts from "markdown-it-github-alerts";
import texmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js/lib/core";
import DOMPurify from "dompurify";

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGS = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, less,
  lua, makefile, markdown, nginx, objectivec, perl, php, plaintext, powershell, python, ruby,
  rust, scss, shell, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);
// the aliases a model actually writes
for (const [alias, target] of Object.entries({
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", sh: "bash",
  zsh: "bash", console: "shell", html: "xml", svg: "xml", yml: "yaml", py: "python",
  rb: "ruby", kt: "kotlin", "c++": "cpp", "c#": "csharp", md: "markdown", make: "makefile",
  ps1: "powershell", objc: "objectivec", text: "plaintext", txt: "plaintext",
})) {
  if (LANGS[target]) hljs.registerAliases(alias, { languageName: target });
}

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "section";

/** http(s), mailto and inline images only: never javascript: or a data: page. */
function validateLink(url) {
  const u = String(url || "").trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) || /^#/.test(u)) return true;
  return /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(u);
}

/** Fenced code: mermaid passes through, everything else is highlighted. */
function installFence(md) {
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info ? token.info.trim().split(/\s+/g)[0] : "";
    const code = token.content;

    if (/^mermaid$/i.test(info)) {
      // Left as source for the viewer to draw once the turn settles. The class
      // is what the lazy loader looks for; it reads the text, not an attribute,
      // because DOMPurify drops unknown data-* on <pre>.
      return `<pre class="mermaid">${escapeHtml(code)}</pre>\n`;
    }

    const language = info || "code";
    const known = info && hljs.getLanguage(info);
    let body;
    let lined = false;
    if (known) {
      try {
        body = hljs.highlight(code, { language: info, ignoreIllegals: true }).value;
      } catch {
        body = escapeHtml(code);
      }
    } else {
      // No language to highlight with: keep the plain block, with line numbers
      // for anything long enough to be worth counting.
      const lines = code.replace(/\n$/, "").split("\n");
      lined = lines.length >= 8 && lines.length <= 500;
      body = lined
        ? lines.map((l) => `<span class="cl">${escapeHtml(l) || " "}</span>`).join("\n")
        : escapeHtml(code);
    }

    return `<div class="code-block${lined ? " lined" : ""}" data-lang="${escapeHtml(language)}">
    <div class="code-head">
      <span class="code-lang">${escapeHtml(language)}</span>
      <span class="code-tools">
        <button class="code-btn" type="button" data-code-wrap title="Toggle line wrap" aria-label="Toggle line wrap">wrap</button>
        <button class="code-btn" type="button" data-code-open title="Open larger" aria-label="Open larger">open</button>
        <button class="copy" type="button" data-copy>Copy</button>
      </span>
    </div>
    <pre${lined ? ' class="numbered"' : ""}><code class="hljs${known ? " language-" + escapeHtml(info) : ""}">${body}</code></pre>
  </div>`;
  };
}

/** Tables scroll sideways instead of squeezing, like the old renderer's wrapper. */
function installTable(md) {
  const open = md.renderer.rules.table_open ?? ((t, i, o, e, s) => s.renderToken(t, i, o));
  const close = md.renderer.rules.table_close ?? ((t, i, o, e, s) => s.renderToken(t, i, o));
  md.renderer.rules.table_open = (...args) => '<div class="table-wrap">' + open(...args);
  md.renderer.rules.table_close = (...args) => close(...args) + "</div>";
}

/** Links open outside the app and carry the rel that keeps them from steering it. */
function installLink(md) {
  const open = md.renderer.rules.link_open ?? ((t, i, o, e, s) => s.renderToken(t, i, o));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet("href") ?? "";
    if (/^https?:/i.test(href)) {
      tokens[idx].attrSet("target", "_blank");
      tokens[idx].attrSet("rel", "noreferrer noopener");
    }
    return open(tokens, idx, options, env, self);
  };
}

/** Leading YAML frontmatter renders as a metadata card, like Aurora's. */
function frontmatterCard(raw) {
  if (!raw || !raw.trim()) return "";
  let title = "";
  const fields = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!value) continue;
    if (m[1].toLowerCase() === "title") title = value;
    else fields.push([m[1], value]);
  }
  if (!title && !fields.length) return "";
  let html = '<div class="frontmatter">';
  if (title) html += `<div class="fm-title">${escapeHtml(title)}</div>`;
  if (fields.length) {
    html += '<div class="fm-meta">';
    for (const [k, v] of fields) {
      html += `<span class="fm-field"><span class="fm-key">${escapeHtml(k)}</span>${escapeHtml(v)}</span>`;
    }
    html += "</div>";
  }
  return html + "</div>\n";
}

export function createRenderer(options = {}) {
  const md = new MarkdownIt({
    html: false, // model output is text, never markup
    linkify: true,
    typographer: false,
    breaks: true, // a single newline is a line break, as GFM does in comments
  });
  md.validateLink = validateLink;

  let captured = "";
  md.use(frontMatter, (fm) => { captured = fm; });
  md.use(anchor, { slugify: (s) => slug(s), level: [1, 2, 3, 4, 5, 6] });
  md.use(taskLists, { enabled: true, label: true });
  md.use(footnote);
  md.use(githubAlerts);
  md.use(texmath, {
    engine: katex,
    delimiters: "dollars",
    // MathML for exported files: a saved HTML document must not depend on a
    // font pack shipped next to it. The chat itself uses KaTeX's HTML output,
    // which measures better on a phone.
    katexOptions: { output: options.mathOutput ?? "html", throwOnError: false, strict: false },
  });
  installFence(md);
  installTable(md);
  installLink(md);

  return {
    render(source) {
      captured = "";
      const body = md.render(String(source ?? ""));
      // Task lists come out as disabled checkbox inputs; the transcript uses a
      // drawn mark instead, which is what the app's own task styling expects.
      const tasks = body.replace(
        /<input class="task-list-item-checkbox"([^>]*)>/g,
        (_m, attrs) => `<span class="task${/\bchecked\b/.test(attrs) ? " done" : ""}" aria-hidden="true"></span>`
      );
      return DOMPurify.sanitize(frontmatterCard(captured) + tasks, {
        // KaTeX renders into these two wrappers; everything else is standard.
        ADD_TAGS: ["eq", "eqn", "math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot", "mtext", "mspace", "mtable", "mtr", "mtd", "munder", "mover", "munderover", "mstyle", "mpadded", "mphantom", "menclose", "mglyph"],
        ADD_ATTR: ["data-lang", "data-code-wrap", "data-code-open", "data-copy", "loading", "target", "rel", "xmlns", "display", "mathvariant", "stretchy", "fence", "separator", "accent", "accentunder", "lspace", "rspace", "scriptlevel", "linethickness", "columnalign", "rowspacing", "columnspacing", "displaystyle"],
        FORBID_TAGS: ["style", "script", "iframe", "form", "input", "object", "embed"],
        ALLOW_DATA_ATTR: true,
      });
    },
  };
}

export { hljs, katex, DOMPurify };
