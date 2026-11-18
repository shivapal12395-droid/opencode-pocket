/* Suite 11 - the rich markdown transcript.
 *
 * Everything here is checked in a real page against the demo transcript
 * ses_demo10: callouts, KaTeX, highlighted code, a lazily drawn Mermaid
 * diagram, the image/diagram viewer, wrap-state across a live rebuild, and both
 * exports. The streaming test sends a prompt that streams the same rich answer
 * in 13-character chunks, so broken fences and half-written math are on screen
 * for most of the turn.
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark", serviceWorkers: "block", acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

  const report = [];
  const test = async (name, fn) => {
    try {
      const d = await fn();
      report.push({ name, status: "PASS", detail: d || "" });
    } catch (e) {
      report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 110) });
    }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const closeSheet = async () => {
    const open = await page.evaluate(() => !document.querySelector("#sheet").hidden);
    if (open) await page.click("#sheet-close");
    await sleep(320);
  };
  const closeLightbox = async () => {
    if (await page.evaluate(() => document.querySelector("#lightbox").classList.contains("open"))) {
      await page.click("#lightbox-close");
      await sleep(260);
    }
  };

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });
  // Nothing on the sessions screen should have paid for the diagram engine.
  const mermaidOnBoot = await page.evaluate(() =>
    performance.getEntriesByType("resource").filter((r) => r.name.includes("pocket-mermaid")).length
  );
  await page.click('.session-row [data-open="ses_demo10"]');
  await page.waitForSelector(".msg .md", { timeout: 15000 });
  await sleep(700);

  /* ---------------- phase 1: the reading surface ---------------- */

  await test("Tables, tasks, footnote, Hindi", async () => {
    const info = await page.evaluate(() => ({
      tables: document.querySelectorAll(".md .table-wrap table").length,
      tasks: document.querySelectorAll(".md .task").length,
      done: document.querySelectorAll(".md .task.done").length,
      footnote: document.querySelectorAll(".md .footnote-ref").length,
      notes: document.querySelectorAll(".md .footnotes li").length,
      hindi: document.querySelector(".md").innerText.includes("नमस्ते"),
    }));
    assert(info.tables >= 1, "tables=" + info.tables);
    assert(info.tasks === 3 && info.done === 1, `tasks=${info.tasks} done=${info.done}`);
    assert(info.footnote >= 1 && info.notes >= 1, `ref=${info.footnote} notes=${info.notes}`);
    assert(info.hindi, "Hindi text missing or mangled");
    return `${info.tables} table, ${info.tasks} tasks, ${info.notes} footnote`;
  });

  await test("GitHub callout", async () => {
    const info = await page.evaluate(() => ({
      box: document.querySelectorAll(".md .markdown-alert-warning").length,
      title: document.querySelector(".md .markdown-alert-title")?.innerText.trim(),
      icon: document.querySelectorAll(".md .markdown-alert .octicon").length,
    }));
    assert(info.box === 1, "warning boxes=" + info.box);
    assert(/^WARNING$/i.test(info.title || ""), "title=" + info.title);
    assert(info.icon >= 1, "no callout icon");
    return info.title.toLowerCase() + " callout";
  });

  await test("KaTeX inline + display", async () => {
    const info = await page.evaluate(() => ({
      inline: document.querySelectorAll(".md eq .katex").length,
      display: document.querySelectorAll(".md eqn .katex-display").length,
      raw: /\\frac|\\cdot|T_\{exp\}/.test(document.querySelector(".md").innerText),
    }));
    assert(info.inline >= 1, "inline math=" + info.inline);
    assert(info.display >= 1, "display math=" + info.display);
    assert(!info.raw, "TeX source leaked into the text");
    return `${info.inline} inline, ${info.display} display`;
  });

  await test("Highlighted code block", async () => {
    const info = await page.evaluate(() => {
      const block = document.querySelector('.md .code-block[data-lang="ts"]');
      if (!block) return { missing: true };
      return {
        lang: block.querySelector(".code-lang")?.textContent,
        tokens: block.querySelectorAll(".hljs-keyword, .hljs-string, .hljs-attr").length,
        copy: !!block.querySelector("[data-copy]"),
        wrap: !!block.querySelector("[data-code-wrap]"),
        open: !!block.querySelector("[data-code-open]"),
      };
    });
    assert(!info.missing, "ts block missing");
    assert(info.lang === "ts", "label=" + info.lang);
    assert(info.tokens >= 3, "tokens=" + info.tokens);
    assert(info.copy && info.wrap && info.open, "controls missing");
    return `${info.tokens} tokens, ${info.lang}`;
  });

  await test("Mermaid loads only when a diagram appears", async () => {
    await page.$eval("pre.mermaid", (n) => n.scrollIntoView({ block: "center" }));
    await page.waitForFunction(() => document.querySelectorAll("pre.mermaid.drawn svg").length >= 1, { timeout: 20000 });
    const info = await page.evaluate(() => {
      const svg = document.querySelector("pre.mermaid.drawn svg");
      const box = svg.getBoundingClientRect();
      const after = performance.getEntriesByType("resource").filter((r) => r.name.includes("pocket-mermaid")).length;
      return { w: Math.round(box.width), h: Math.round(box.height), after, mermaid: !!svg.querySelector(".flowchart, .cluster, g.node") };
    });
    assert(mermaidOnBoot === 0, "mermaid fetched before any chat was open");
    assert(info.after >= 1, "mermaid bundle never loaded");
    assert(info.mermaid, "svg has no diagram content");
    assert(info.w > 80 && info.h > 40, `svg size ${info.w}x${info.h}`);
    return `${info.w}x${info.h}px after scroll`;
  });

  /* ---------------- phase 2: viewers ---------------- */

  await test("Diagram viewer with source toggle", async () => {
    await page.click("pre.mermaid.drawn");
    await sleep(400);
    const open = await page.evaluate(() => ({
      on: document.querySelector("#lightbox").classList.contains("open"),
      svg: document.querySelectorAll("#lightbox-body svg").length,
      source: !document.querySelector("#lightbox-source").hidden,
    }));
    assert(open.on && open.svg === 1 && open.source, JSON.stringify(open));
    await page.click("#lightbox-source");
    await sleep(250);
    const src = await page.evaluate(() => ({
      code: document.querySelector("#lightbox-body .lightbox-code")?.textContent || "",
      label: document.querySelector("#lightbox-source").textContent,
    }));
    assert(src.code.includes("flowchart"), "source toggle shows no source");
    assert(src.label === "Diagram", "toggle label=" + src.label);
    await page.click("#lightbox-close");
    await sleep(250);
    const closed = await page.evaluate(() => document.querySelector("#lightbox").classList.contains("open"));
    assert(!closed, "viewer did not close");
    return "svg + source";
  });

  await test("Image lightbox + Escape", async () => {
    await page.$eval(".md img", (n) => n.scrollIntoView({ block: "center" }));
    await sleep(200);
    await page.click(".md img");
    await sleep(350);
    const info = await page.evaluate(() => {
      const img = document.querySelector("#lightbox-body img");
      return { on: document.querySelector("#lightbox").classList.contains("open"), src: img?.getAttribute("src")?.slice(0, 22) };
    });
    assert(info.on, "lightbox closed");
    assert((info.src || "").startsWith("data:image/png"), "src=" + info.src);
    await page.keyboard.press("Escape");
    await sleep(250);
    assert(!(await page.evaluate(() => document.querySelector("#lightbox").classList.contains("open"))), "Escape did not close");
    return "png opened + escaped";
  });

  /* ---------------- phase 3: streaming ---------------- */

  await test("Wrap state survives a live rebuild", async () => {
    await page.$eval('.md .code-block[data-lang="ts"]', (n) => n.scrollIntoView({ block: "center" }));
    await page.click('.md .code-block[data-lang="ts"] [data-code-wrap]');
    await sleep(150);
    const on = await page.$eval('.md .code-block[data-lang="ts"]', (n) => n.classList.contains("wrap"));
    assert(on, "wrap did not toggle");
    await page.fill("#input", "render the rich markdown answer again");
    await page.click("#btn-send");
    await sleep(900);
    const kept = await page.evaluate(() =>
      [...document.querySelectorAll('.md .code-block[data-lang="ts"]')].filter((n) => n.classList.contains("wrap")).length
    );
    assert(kept >= 1, "wrap state was lost on rebuild");
    return `${kept} block still wrapped mid-stream`;
  });

  await test("Streaming settles without duplicates", async () => {
    await page.waitForFunction(() => document.querySelectorAll("pre.mermaid.drawn svg").length >= 2, { timeout: 30000 });
    await sleep(500);
    const info = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[data-msg]")].map((n) => n.dataset.msg);
      return {
        ids: ids.length,
        unique: new Set(ids).size,
        alerts: document.querySelectorAll(".md .markdown-alert-warning").length,
        blocks: document.querySelectorAll('.md .code-block[data-lang="ts"]').length,
        headings: (document.querySelector("#messages").innerText.match(/Session refresh/g) || []).length,
        busy: !document.querySelector("#chat-status").hidden,
        working: document.querySelector("#messages").innerText.includes("Working"),
      };
    });
    assert(info.ids === info.unique, `${info.ids} rows, ${info.unique} unique`);
    assert(info.alerts === 2 && info.blocks === 2, `alerts=${info.alerts} blocks=${info.blocks}`);
    assert(info.headings >= 2, "second answer missing");
    assert(!info.busy && !info.working, "turn still marked live");
    return `${info.ids} rows, ${info.alerts} callouts`;
  });

  /* ---------------- phase 4: export ---------------- */

  await test("Export HTML is self-contained", async () => {
    const sheet = await page.$$('.msg-actions button[data-act="more-msg"]');
    await sheet[sheet.length - 1].click();
    await sleep(400);
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click('[data-mact="export-html"]')]);
    const file = await download.path();
    const html = file ? fs.readFileSync(file, "utf8") : "";
    const name = download.suggestedFilename();
    assert(/\.html$/.test(name), "name=" + name);
    assert(/^<!doctype html>/i.test(html), "not a document");
    assert(html.includes("<math"), "no MathML math");
    assert(html.includes("markdown-alert"), "no callout styling");
    assert(html.includes('class="code-block"'), "no code block");
    assert(html.includes("@media print"), "no print sheet");
    assert(html.includes("नमस्ते"), "Hindi lost in export");
    assert(!/<script/i.test(html), "script tag in export");
    assert(html.length > 8000, "document suspiciously small: " + html.length);
    return `${name} · ${Math.round(html.length / 1024)} KB`;
  });

  await test("Print builds a print document", async () => {
    const sheet = await page.$$('.msg-actions button[data-act="more-msg"]');
    await sheet[sheet.length - 1].click();
    await sleep(400);
    await page.click('[data-mact="print"]');
    await sleep(1800);
    const info = await page.evaluate(() => {
      const frame = [...document.querySelectorAll("iframe")].find((f) => (f.getAttribute("srcdoc") || "").includes('class="doc"'));
      const doc = frame?.getAttribute("srcdoc") || "";
      return { found: !!frame, article: doc.includes('<article class="md">'), math: doc.includes("<math") };
    });
    assert(info.found && info.article && info.math, JSON.stringify(info));
    return "iframe print sheet";
  });

  /* ---------------- phase 5: budget + security ---------------- */

  await test("Large answer render budget", async () => {
    const info = await page.evaluate(async () => {
      const md = await import("./assets/markdown.js");
      const src = Array.from({ length: 2500 }, (_, i) => `- item ${i} with **bold**, \`code\` and a [link](https://x.dev/${i})`).join("\n");
      const t0 = performance.now();
      md.renderMarkdown(src);
      const first = Math.round(performance.now() - t0);
      const t1 = performance.now();
      md.renderMarkdown(src);
      const cached = Math.round(performance.now() - t1);
      return { first, cached, bytes: src.length };
    });
    assert(info.first < 900, `first render ${info.first}ms`);
    assert(info.cached < 6, `cache hit ${info.cached}ms`);
    return `${info.bytes}B in ${info.first}ms, cache ${info.cached}ms`;
  });

  await test("Sanitizer blocks scripts and handlers", async () => {
    const info = await page.evaluate(async () => {
      const md = await import("./assets/markdown.js");
      const html = md.renderMarkdown('<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>\n\n[bad](javascript:alert(3))\n\n<iframe src="https://evil.example"></iframe>');
      const box = document.createElement("div");
      box.innerHTML = html;
      return {
        elements: box.querySelectorAll("script, iframe, img[onerror]").length,
        links: box.querySelectorAll('a[href^="javascript"]').length,
        escaped: box.textContent.includes("<script>"),
      };
    });
    assert(info.elements === 0, "dangerous elements=" + info.elements);
    assert(info.links === 0, "javascript: link survived");
    assert(info.escaped, "raw HTML was not neutralised");
    return "0 dangerous nodes";
  });

  /* ---------------- report ---------------- */
  console.log("");
  for (const r of report) console.log(`${r.status.padEnd(5)} ${r.name.padEnd(38)} ${r.detail}`);
  const failed = report.filter((r) => r.status === "FAIL").length;
  console.log(`\nTOTAL: ${report.length - failed} passed, ${failed} failed`);
  console.log("ERRORS:", errors.length ? errors : "none");
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
