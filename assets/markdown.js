/** Tiny, dependency-free markdown renderer tuned for chat answers. */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

function safeUrl(url) {
  const u = String(url || "").trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  return null;
}

function inline(src) {
  let text = String(src ?? "");
  const stash = [];
  const keep = (html) => {
    const token = `\u0000${stash.length}\u0000`;
    stash.push(html);
    return token;
  };

  // code spans
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

  // bold / italic / strike
  text = text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return text.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)] ?? "");
}

const isBlockStart = (line) =>
  /^\s*(```|#{1,6}\s|>\s?|([-*+])\s+|\d+\.\s+|---+\s*$|\|)/.test(line);

function listBlock(lines, start) {
  const first = lines[start];
  const ordered = /^\s*\d+\.\s+/.test(first);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (!m) break;
    let content = m[1];
    const check = content.match(/^\[( |x|X)\]\s+(.*)$/);
    if (check) {
      const done = check[1].toLowerCase() === "x";
      content = `<span class="task ${done ? "done" : ""}">${done ? "✓" : "○"}</span> ${inline(check[2])}`;
    } else {
      content = inline(content);
    }
    i += 1;
    // continuation lines
    while (i < lines.length && lines[i].trim() && !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i]) && !isBlockStart(lines[i])) {
      content += "<br>" + inline(lines[i].trim());
      i += 1;
    }
    items.push(`<li>${content}</li>`);
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
  const align = split(lines[i]).map((c) => (/^:?-{2,}/.test(c) ? (/^:/.test(c) ? "left" : /:$/.test(c) ? "right" : "center") : null));
  i += 1;
  const rows = [];
  while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
    rows.push(split(lines[i]));
    i += 1;
  }
  const th = head.map((c, n) => `<th${align[n] ? ` style="text-align:${align[n]}"` : ""}>${inline(c)}</th>`).join("");
  const tr = rows
    .map((r) => `<tr>${r.map((c, n) => `<td${align[n] ? ` style="text-align:${align[n]}"` : ""}>${inline(c)}</td>`).join("")}</tr>`)
    .join("");
  return { html: `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`, next: i };
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
      out.push(
        `<div class="code-block"><div class="code-head"><span>${lang || "code"}</span><button class="copy" type="button" data-copy>Copy</button></div><pre><code>${code.join("\n")}</code></pre></div>`
      );
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
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
      out.push(`<blockquote>${renderMarkdown(quote.join("\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))}</blockquote>`);
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

export function plainPreview(src, max = 120) {
  const text = String(src ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
