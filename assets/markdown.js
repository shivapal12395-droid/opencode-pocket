/**
 * Dependency-free markdown renderer tuned for chat answers.
 *
 * Deliberate scope: headings, paragraphs, nested and task lists, tables with
 * alignment, fenced code with a language tag, blockquotes, rules, images,
 * emphasis, links, inline code — plus a graceful, non-executable treatment of
 * math, because shipping a TeX engine to a phone is not worth 300 KB and a
 * silent "it did nothing" is worse than plain, readable notation.
 *
 * Everything user- or model-supplied is escaped before any tag is introduced.
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

function safeUrl(url) {
  const u = String(url || "").trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(u)) return u;
  return null;
}

/* ------------------------------------------------------------------ inline */

function inline(src) {
  let text = String(src ?? "");
  const stash = [];
  const keep = (html) => {
    const token = `\u0000${stash.length}\u0000`;
    stash.push(html);
    return token;
  };

  // Images first: ![alt](url) would otherwise be eaten by the link rule.
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const src = safeUrl(url);
    if (!src) return m;
    return keep(`<img class="md-img" src="${src}" alt="${alt}" loading="lazy">`);
  });

  // code spans (1..3 backticks)
  text = text.replace(/(`{1,3})([\s\S]*?)\1/g, (_m, _ticks, code) => keep(`<code>${code.trim()}</code>`));

  // links [label](url)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, label, url) => {
    const href = safeUrl(url);
    if (!href) return m;
    return keep(`<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`);
  });

  // bare urls
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre, url) => {
    const clean = url.replace(/[.,;:!?]+$/, "");
    return `${pre}${keep(`<a href="${clean}" target="_blank" rel="noreferrer noopener">${clean}</a>`)}`;
  });

  // inline math stays as readable notation rather than pretending to typeset
  text = text.replace(/\$([^$\n]{2,120})\$/g, (_m, expr) => keep(`<span class="math-inline">${expr}</span>`));

  // emphasis
  text = text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return text.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)] ?? "");
}

/* ------------------------------------------------------------------ blocks */

const isBlockStart = (line) =>
  /^\s*(```|#{1,6}\s|>\s?|([-*+]|\d+\.)\s+|\||---+\s*$|\$\$)/.test(line);

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "section";

/** Fenced code with a language tag, line numbers and per-block controls. */
function codeBlock(lang, codeLines) {
  const raw = codeLines.join("\n");
  const language = (lang || "").trim() || "code";
  const numbered = codeLines.length >= 8 && codeLines.length <= 300;
  const body = numbered
    ? codeLines.map((l) => `<span class="cl">${l || " "}</span>`).join("")
    : codeLines.join("\n");
  return `<div class="code-block${numbered ? " lined" : ""}" data-lang="${escapeHtml(language)}">
    <div class="code-head">
      <span class="code-lang">${escapeHtml(language)}</span>
      <span class="code-tools">
        <button class="code-btn" type="button" data-code-wrap title="Toggle line wrap" aria-label="Toggle line wrap">wrap</button>
        <button class="code-btn" type="button" data-code-open title="Open larger" aria-label="Open larger">open</button>
        <button class="copy" type="button" data-copy>Copy</button>
      </span>
    </div>
    <pre${numbered ? ' class="numbered"' : ""}><code>${body}</code></pre>
  </div>`;
}

/** Lists, including nesting by indentation, and task items. */
function listBlock(lines, start) {
  const baseIndent = (lines[start].match(/^\s*/) ?? [""])[0].length;
  const ordered = /^\s*\d+\.\s+/.test(lines[start]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!m) break;
    const indent = m[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) break; // nested lists are consumed by the item below

    let content = m[3];
    i += 1;

    const nested = [];
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) {
        // a blank line ends the item unless an indented block follows
        if (i + 1 < lines.length && /^\s+/.test(lines[i + 1]) && lines[i + 1].trim()) {
          i += 1;
          continue;
        }
        break;
      }
      const nestedMatch = next.match(/^(\s*)([-*+]|\d+\.)\s+/);
      if (nestedMatch && nestedMatch[1].length > baseIndent) {
        const sub = listBlock(lines, i);
        nested.push(sub.html);
        i = sub.next;
        continue;
      }
      if (nestedMatch) break;
      if (/^\s{2,}/.test(next) || !isBlockStart(next)) {
        // continuation of the same item
        content += " " + next.trim();
        i += 1;
        continue;
      }
      break;
    }

    const task = content.match(/^\[( |x|X)\]\s+(.*)$/);
    if (task) {
      const done = task[1].toLowerCase() === "x";
      content = `<span class="task ${done ? "done" : ""}" aria-hidden="true">${done ? "✓" : ""}</span>${inline(task[2])}`;
    } else {
      content = inline(content);
    }

    items.push(`<li${nested.length ? ' class="has-sub"' : ""}>${content}${nested.join("")}</li>`);
  }

  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>${items.join("")}</${tag}>`, next: i };
}

function tableBlock(lines, start) {
  const split = (row) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const head = split(lines[start]);
  let i = start + 1;
  const align = split(lines[i]).map((c) =>
    /^:?-{2,}/.test(c) ? (/^:/.test(c) ? "left" : /:$/.test(c) ? "right" : "center") : null
  );
  i += 1;

  const rows = [];
  while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
    rows.push(split(lines[i]));
    i += 1;
  }

  const cell = (tagName, c, n) =>
    `<${tagName}${align[n] ? ` style="text-align:${align[n]}"` : ""}>${inline(c)}</${tagName}>`;

  return {
    html: `<div class="table-wrap"><table>
      <thead><tr>${head.map((c, n) => cell("th", c, n)).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, n) => cell("td", c, n)).join("")}</tr>`).join("")}</tbody>
    </table></div>`,
    next: i,
  };
}

export function renderMarkdown(src) {
  const escaped = escapeHtml(src ?? "").replace(/\r\n?/g, "\n");
  const lines = escaped.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // fenced code — an unclosed fence keeps streaming as code, which is what
    // makes a half-arrived block look stable instead of flickering
    const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      i += 1;
      const code = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(codeBlock(lang, code));
      continue;
    }

    // display math
    if (/^\s*\$\$\s*$/.test(line) || /^\s*\$\$.*\$\$\s*$/.test(line)) {
      const oneLine = line.match(/^\s*\$\$(.*)\$\$\s*$/);
      if (oneLine) {
        out.push(`<div class="math-block">${oneLine[1].trim()}</div>`);
        i += 1;
        continue;
      }
      i += 1;
      const body = [];
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`<div class="math-block">${body.join("\n")}</div>`);
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      const text = heading[2].replace(/\s+#+\s*$/, "");
      out.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      const inner = quote
        .join("\n")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
      out.push(`<blockquote>${renderMarkdown(inner)}</blockquote>`);
      continue;
    }

    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const { html, next } = listBlock(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const { html, next } = tableBlock(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    else i += 1;
  }

  return out.join("");
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
    .map((m) => ({ level: m[1].length, text: m[2], id: slug(m[2]) }));
}