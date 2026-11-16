import { escapeHtml, renderMarkdown, headingsOf } from "./markdown.js";

/**
 * Artifacts are the parts of an answer that deserve their own workspace: a real
 * file, a page, a document, a diagram, a diff, an image. Everything here is
 * derived from what the server actually sent — no invented content, and a short
 * explanation never becomes an artifact.
 */

const CODE_LANGS = new Set([
  "ts","tsx","js","jsx","mjs","cjs","json","jsonc","css","scss","html","xml","svg","md","mdx",
  "py","rb","go","rs","java","kt","kts","swift","c","h","cpp","hpp","cs","php","sh","bash","zsh",
  "sql","yml","yaml","toml","ini","dockerfile","make","graphql","proto","lua","ex","exs","dart",
]);

const HTML_LANGS = new Set(["html", "htm", "xhtml"]);
const DIFF_LANGS = new Set(["diff", "patch"]);
const DIAGRAM_LANGS = new Set(["mermaid", "mmd", "plantuml", "dot"]);

const lines = (s) => (s ? s.split("\n").length : 0);

const titleFromCode = (code, lang) => {
  const head = code.split("\n").slice(0, 4).join("\n");

  // 1. a filename mentioned in a leading comment or path is the best title
  const file = head.match(/([\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|html|py|go|rs|json|md|sql|sh|yml|yaml))\b/);
  if (file) return file[1];

  // 2. otherwise the thing being defined: a function or class reads better than
  //    a constant, and a SCREAMING_CASE constant reads like a typo
  const fn = code.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|def)\s+(\w+)/m);
  if (fn) return fn[1];
  const named = code.match(/^\s*(?:export\s+)?const\s+([a-z][\w]*)\s*=/m);
  if (named) return named[1];

  return `${lang || ""} file`.trim();
};

const titleFromHtml = (html) => {
  const t = html.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
  if (t) return t[1].trim();
  const h1 = html.match(/<h1[^>]*>([^<]{1,80})<\/h1>/i);
  if (h1) return h1[1].trim();
  return "HTML page";
};

const titleFromDoc = (text) => {
  const heads = headingsOf(text);
  return heads[0]?.text ?? "Document";
};

/** Cache so a re-render does not re-scan every answer. */
const cache = new Map();

function scanMessage(m) {
  if (cache.has(m.id)) return cache.get(m.id);
  const found = [];
  const textParts = (m.content ?? []).filter((p) => p.type === "text");

  for (const part of textParts) {
    const text = part.text ?? "";
    const fence = /```([\w+#.-]*)[ \t]*\n([\s\S]*?)```/g;
    let match;
    let index = 0;
    while ((match = fence.exec(text))) {
      const lang = (match[1] || "").toLowerCase();
      const code = match[2].replace(/\n$/, "");
      index += 1;
      const lineCount = lines(code);

      if (DIFF_LANGS.has(lang)) {
        found.push({
          kind: "diff",
          title: "Diff",
          language: lang,
          code,
          lines: lineCount,
          messageID: m.id,
        });
        continue;
      }
      if (DIAGRAM_LANGS.has(lang)) {
        found.push({
          kind: "diagram",
          title: `${lang} diagram`,
          language: lang,
          code,
          lines: lineCount,
          messageID: m.id,
        });
        continue;
      }
      if (HTML_LANGS.has(lang)) {
        found.push({
          kind: "html",
          title: titleFromHtml(code),
          language: "html",
          code,
          lines: lineCount,
          messageID: m.id,
        });
        continue;
      }
      // A short snippet inside an explanation stays inline; a file does not.
      if (CODE_LANGS.has(lang) && (lineCount >= 12 || /^\s*(?:import|export|package|class|function|def|#include)/m.test(code))) {
        found.push({
          kind: "code",
          title: titleFromCode(code, lang),
          language: lang,
          code,
          lines: lineCount,
          messageID: m.id,
        });
      }
    }

    // A long, structured answer is a document worth reading full screen.
    if (text.length >= 700) {
      const heads = headingsOf(text);
      if (heads.length >= 2 && !/```/.test(text.slice(0, 200))) {
        found.push({
          kind: "doc",
          title: titleFromDoc(text),
          doc: text,
          lines: lines(text),
          messageID: m.id,
        });
      }
    }
  }
  cache.set(m.id, found);
  return found;
}

export function detectArtifacts(messages) {
  const list = [];
  const versions = new Map();
  for (const m of messages ?? []) {
    if (m.type !== "assistant") continue;
    for (const a of scanMessage(m)) {
      const key = `${a.kind}:${a.title}:${a.language ?? ""}`;
      const version = (versions.get(key) ?? 0) + 1;
      versions.set(key, version);
      list.push({ ...a, id: `${m.id}:${key}:${version}`, key, version });
    }
  }
  return list;
}

export function artifactsOf(messages) {
  return detectArtifacts(messages);
}

const KIND_ICON = { code: "code", html: "spark", doc: "book", diagram: "branch", diff: "diff", image: "image" };

export function artifactCardHtml(a) {
  const sub = [
    a.kind === "doc" ? "Document" : a.kind === "html" ? "Live page" : a.kind === "diagram" ? "Diagram" : a.kind === "diff" ? "Diff" : a.language || "Code",
    a.lines ? `${a.lines} lines` : "",
    a.version > 1 ? `v${a.version}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `<button class="artifact-card" data-artifact="${escapeHtml(a.id)}" type="button">
    <span class="ac-icon">${`<svg><use href="#i-${KIND_ICON[a.kind] ?? "file"}"/></svg>`}</span>
    <span class="ac-main">
      <span class="ac-title">${escapeHtml(a.title)}</span>
      <span class="ac-sub">${escapeHtml(sub)}</span>
    </span>
    <span class="ac-open">Open</span>
  </button>`;
}

/** Everything inside the artifact workspace body, for the chosen tab. */
export function artifactBodyHtml(a, { tab = "preview", wrap = false, numbers = true } = {}) {
  if (tab === "code" || a.kind === "diff") {
    if (a.kind === "diff") return diffHtml(a.code, numbers);
    return codeHtml(a.code ?? "", a.language, { wrap, numbers });
  }

  if (a.kind === "html") {
    // sandbox without allow-same-origin: the frame is a unique origin, so it
    // cannot read this app's storage, cookies or Authorization header
    return `<iframe class="artifact-frame" sandbox="allow-scripts allow-forms allow-popups" srcdoc="${escapeHtml(
      a.code ?? ""
    )}" title="${escapeHtml(a.title)}"></iframe>`;
  }

  if (a.kind === "doc") {
    return `<div class="artifact-doc md">${renderMarkdown(a.doc ?? "")}</div>`;
  }

  if (a.kind === "diagram") {
    return `<div class="artifact-note">Diagram source. A Mermaid engine is not bundled with Pocket, so this is the
      diagram's text rather than a rendered image.</div>${codeHtml(a.code ?? "", a.language, {
      wrap,
      numbers,
    })}`;
  }

  if (a.kind === "image" && a.src) {
    return `<img class="artifact-img" src="${escapeHtml(a.src)}" alt="${escapeHtml(a.title)}">`;
  }

  return codeHtml(a.code ?? "", a.language, { wrap, numbers });
}

const codeHtml = (code, lang, { wrap, numbers }) => {
  const list = code.split("\n");
  const body = numbers
    ? list.map((l) => `<span class="cl">${escapeHtml(l) || " "}</span>`).join("")
    : escapeHtml(code);
  return `<div class="artifact-code${wrap ? " wrap" : ""}">
    <div class="artifact-code-head"><span>${escapeHtml(lang || "code")}</span><span>${list.length} lines</span></div>
    <pre${numbers ? ' class="numbered"' : ""}><code>${body}</code></pre>
  </div>`;
};

const diffHtml = (patch, numbers) => {
  const list = String(patch ?? "").split("\n");
  return `<pre class="artifact-diff${numbers ? " numbered" : ""}"><code>${list
    .map((line) => {
      const cls = line.startsWith("+") && !line.startsWith("+++")
        ? "add"
        : line.startsWith("-") && !line.startsWith("---")
          ? "del"
          : line.startsWith("@@")
            ? "hunk"
            : "";
      return `<span class="cl ${cls}">${escapeHtml(line) || " "}</span>`;
    })
    .join("")}</code></pre>`;
};