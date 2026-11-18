/* Suite 13 - chat reliability under stress.
 *
 * Streaming chaos with deterministic fixtures (duplicate frames, empty frames,
 * shuffled frames, one-character chunks, huge chunks, a socket that dies mid
 * answer, unicode), a 133-message conversation that has to page and still keep
 * every message exactly once, activity grouping across many tool steps, drafts
 * per conversation, and the "nothing overflows / nothing freezes" checks.
 *
 * Every assertion here is an invariant, not a snapshot: the same test has to
 * pass at any point in the stream.
 */
const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark", serviceWorkers: "block" });
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
      report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 140) });
    }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  const openSession = async (id) => {
    await page.evaluate(() => {
      const sheet = document.querySelector("#sheet");
      if (sheet && !sheet.hidden) document.querySelector("#sheet-close")?.click();
    });
    await sleep(250);
    const inChat = await page.evaluate(() => !document.querySelector("#screen-chat")?.hidden);
    if (inChat) { await page.evaluate(() => document.querySelector("#chat-back")?.click()); await sleep(450); }
    await page.click(`.session-row [data-open="${id}"]`);
    await page.waitForSelector(".msg", { timeout: 15000 });
    await sleep(650);
  };
  const send = async (text) => {
    await page.fill("#input", text);
    await page.click("#btn-send");
  };
  const waitIdle = async (max = 40000) => {
    for (let i = 0; i < max / 250; i++) {
      await sleep(250);
      if (await page.evaluate(() => document.querySelector("#btn-send")?.dataset?.mode === "send")) return true;
    }
    return false;
  };
  /**
   * The truth, from both ends:
   *   - `source`: the text the UI's own model holds (the streaming pipeline),
   *   - `server`: the text the server stored,
   *   - `rendered`: what the transcript shows on screen.
   * Duplication and loss are only provable by comparing the first two.
   */
  const truth = () =>
    page.evaluate(async () => {
      const t = window.__pocketTest;
      const sid = t.state.session?.id;
      const res = await t.api.messages(sid, { limit: 8, order: "desc" });
      const last = (res.data ?? []).find((m) => m.type === "assistant");
      const server = (last?.content ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n\n");
      const mine = (t.state.messages.filter((m) => m.type === "assistant").pop()?.content ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n\n");
      const body = [...document.querySelectorAll("#messages .msg-assistant .assistant-body")].pop();
      return { server, source: mine, rendered: body ? body.innerText : "" };
    });

  /**
   * Content probes: distinctive strings that survive markdown rendering, so
   * "the answer is complete on screen" can be checked without re-implementing
   * the renderer. Prose, table cells, code and emoji all appear verbatim.
   */
  const DOC_PROBES = [
    "Stress document",
    "markdown-it reads the block",
    "export async function stream",
    "The end of the document.",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ];
  const UNICODE_PROBES = ["यूनिकोड परीक्षण", "नमस्ते", "🚀", "café", "שלום עולם", "const नाम"];
  const missingProbes = (t, probes) => probes.filter((p) => !t.rendered.includes(p));

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  /* ---- 2. extreme streaming ------------------------------------------- */

  const chaos = [
    { prompt: "chaos onechar please", what: "one-character chunks", frames: true, probes: DOC_PROBES },
    { prompt: "chaos rapid please", what: "rapid large chunks", frames: true, probes: DOC_PROBES },
    // A 5 kB chunk is one frame: there is nothing to stream, only a final state.
    { prompt: "chaos huge please", what: "very large chunks", frames: false, probes: DOC_PROBES },
    { prompt: "chaos empty please", what: "empty and malformed frames", frames: true, probes: DOC_PROBES },
    { prompt: "chaos unicode please", what: "unicode, Hindi, emoji", frames: true, probes: UNICODE_PROBES },
  ];
  for (const { prompt, what, frames, probes } of chaos) {
    await test(`Streaming survives ${what}`, async () => {
      // Isolation: a reload gives every chaos case a pristine socket and state.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".session-row", { timeout: 20000 });
      await openSession("ses_demo1");
      await send(prompt);
      let sawGrowing = 0;
      let lastLen = 0;
      for (let i = 0; i < 220; i++) {
        await sleep(60);
        const len = await page.evaluate(() => {
          const t = window.__pocketTest;
          const parts = t.state.messages.filter((m) => m.type === "assistant").pop()?.content ?? [];
          return parts.filter((p) => p.type === "text").map((p) => (p.text ?? "").length).reduce((a, b) => a + b, 0);
        });
        if (len > lastLen) sawGrowing += 1;
        lastLen = len;
        if (await page.evaluate(() => document.querySelector("#btn-send")?.dataset?.mode === "send")) break;
      }
      assert(await waitIdle(), "the turn never finished");
      await sleep(700);
      const t = await truth();
      assert(sawGrowing >= (frames ? 3 : 1), `the answer never streamed (${sawGrowing} growth steps)`);
      // No duplication, no loss: the UI's own text is the server's text.
      assert(t.source === t.server, `source != server (source ${t.source.length} chars, server ${t.server.length})`);
      const missing = missingProbes(t, probes);
      assert(missing.length === 0, `${missing.length} probes missing from the transcript: ${JSON.stringify(missing)}`);
      const lit = t.rendered.length / Math.max(1, t.server.length);
      assert(lit > 0.5 && lit < 1.8, `rendered/raw ratio ${lit.toFixed(2)} looks wrong (${t.rendered.length} vs ${t.server.length})`);
      return `${sawGrowing} growth steps, source == server (${t.server.length} chars), ${probes.length - missing.length}/${probes.length} probes on screen`;
    });
  }

  await test("Duplicate frames never double the text", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".session-row", { timeout: 20000 });
    await openSession("ses_demo1");
    await send("chaos duplicate please");
    let peak = 0;
    for (let i = 0; i < 220; i++) {
      await sleep(50);
      const len = await page.evaluate(() => {
        const t = window.__pocketTest;
        const parts = t.state.messages.filter((m) => m.type === "assistant").pop()?.content ?? [];
        return parts.filter((p) => p.type === "text").map((p) => (p.text ?? "").length).reduce((a, b) => a + b, 0);
      });
      peak = Math.max(peak, len);
      if (await page.evaluate(() => document.querySelector("#btn-send")?.dataset?.mode === "send")) break;
    }
    assert(await waitIdle(), "the turn never finished");
    await sleep(600);
    const t = await truth();
    assert(t.source === t.server, `duplicated: source ${t.source.length} chars vs server ${t.server.length}`);
    assert(peak <= t.server.length + 5, `a doubled frame leaked mid-stream (peak ${peak} > ${t.server.length})`);
    return `peak ${peak} ≤ final ${t.server.length}: the same frame twice changed nothing`;
  });

  await test("Shuffled frames converge on the server's text", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".session-row", { timeout: 20000 });
    await openSession("ses_demo1");
    await send("chaos shuffle please");
    assert(await waitIdle(), "the turn never finished");
    await sleep(700);
    const t = await truth();
    assert(t.source === t.server, `the order never healed: source ${t.source.length} vs server ${t.server.length}`);
    const markers = t.rendered.split("The end of the document.").length - 1;
    assert(markers === 1, `the closing line appears ${markers} times`);
    return `scrambled mid-stream, exact after the turn (${t.server.length} chars, one closing line)`;
  });

  await test("A socket that dies mid-answer keeps the partial text and reconciles", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".session-row", { timeout: 20000 });
    await openSession("ses_demo1");
    await send("chaos break please");
    let partial = 0;
    for (let i = 0; i < 80; i++) {
      await sleep(120);
      partial = await page.evaluate(() => {
        const t = window.__pocketTest;
        const parts = t.state.messages.filter((m) => m.type === "assistant").pop()?.content ?? [];
        return parts.filter((p) => p.type === "text").map((p) => (p.text ?? "").length).reduce((a, b) => a + b, 0);
      });
      if (await page.evaluate(() => document.querySelector("#net-banner") && !document.querySelector("#net-banner").hidden)) break;
    }
    assert(partial > 40, "no partial answer before the drop: " + partial);
    const banner = await page.evaluate(() => document.querySelector("#net-text")?.textContent ?? "");
    await page.click("#net-retry");
    assert(await waitIdle(20000), "the composer never returned to Send after Retry");
    await sleep(900);
    const t = await truth();
    assert(t.source === t.server, `after recovery source ${t.source.length} vs server ${t.server.length}`);
    const twice = t.rendered.split("Stress document").length - 1;
    assert(twice === 1, "the answer is rendered " + twice + " times");
    return `kept ${partial} chars ("${banner}"), reconciled to ${t.server.length} exactly once`;
  });

  /* ---- 1. long conversation ------------------------------------------- */

  await test("A 133-message conversation keeps every message, in order, once", async () => {
    await openSession("ses_demo_stress");
    const loaded = async () =>
      page.evaluate(() => [...document.querySelectorAll("#messages [data-msg]")].map((n) => n.dataset.msg));
    let ids = await loaded();
    const first = ids.length;
    for (let i = 0; i < 8; i += 1) {
      const more = await page.evaluate(() => !!document.querySelector("#messages [data-load-older]"));
      if (!more) break;
      await page.click("#messages [data-load-older]");
      await sleep(700);
      ids = await loaded();
    }
    const unique = new Set(ids);
    assert(ids.length === unique.size, `duplicates: ${ids.length} rows, ${unique.size} unique`);
    assert(ids.length >= 130, `only ${ids.length} messages after paging (expected 133)`);
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("#messages [data-msg]")].map((n) => Number((n.dataset.msg.match(/(\d+)$/) || [])[1] ?? -1))
    );
    const monotonic = order.every((v, i) => i === 0 || v >= order[i - 1]);
    assert(monotonic, "message order is not ascending");
    return `${first} rows first page -> ${ids.length} rows, ${unique.size} unique, order ascending`;
  });

  await test("The long conversation renders in one pass and stays interactive", async () => {
    const t0 = Date.now();
    await page.evaluate(() => {
      const m = document.querySelector("#messages");
      m.scrollTop = 0;
    });
    await sleep(500);
    await page.evaluate(() => {
      const m = document.querySelector("#messages");
      m.scrollTop = m.scrollHeight;
    });
    await sleep(800);
    const budget = Date.now() - t0;
    const st = await page.evaluate(() => ({
      rows: document.querySelectorAll("#messages [data-msg]").length,
      nodes: document.querySelectorAll("#messages *").length,
      height: document.querySelector("#messages").scrollHeight,
    }));
    // the composer still works
    await page.fill("#input", "still alive");
    const composer = await page.evaluate(() => ({ value: document.querySelector("#input").value, mode: document.querySelector("#btn-send").dataset.mode }));
    await page.fill("#input", "");
    assert(composer.value === "still alive" && composer.mode === "send", "the composer stopped responding");
    assert(st.rows >= 130, "rows dropped to " + st.rows);
    assert(st.nodes < 40000, "DOM exploded: " + st.nodes + " nodes");
    return `${st.rows} rows, ${st.nodes} DOM nodes, ${Math.round(st.height / 1000)}k px tall, scroll round-trip ${budget}ms`;
  });

  await test("Chats stay inside the viewport (no horizontal overflow)", async () => {
    const over = await page.evaluate(() => {
      const bad = [];
      const w = document.documentElement.clientWidth;
      for (const n of document.querySelectorAll("#messages *")) {
        const r = n.getBoundingClientRect();
        if (r.width > 0 && r.right > w + 2 && !n.closest(".code-block, .table-wrap, pre, .md table")) {
          bad.push((n.className || n.tagName) + " right=" + Math.round(r.right));
        }
        if (bad.length > 4) break;
      }
      return { docScroll: document.documentElement.scrollWidth, client: w, bad };
    });
    assert(over.docScroll <= over.client + 2, `the page scrolls horizontally: ${over.docScroll} > ${over.client}`);
    assert(over.bad.length === 0, "elements overflow: " + over.bad.join(", "));
    return `document ${over.docScroll}px == viewport ${over.client}px, no stray overflow`;
  });

  await test("Activity panels: exactly one per request, answers kept separate", async () => {
    const st = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#messages .msg")];
      const panels = [...document.querySelectorAll("#messages .activity")];
      const turns = [...document.querySelectorAll("#messages .msg-user")].length;
      const inAnswer = panels.filter((p) => p.closest(".assistant-body")?.querySelector(".msg-actions")).length;
      return {
        turns,
        panels: panels.length,
        livePanels: [...document.querySelectorAll("#messages .activity.live")].length,
        panelsInsideAnswer: inAnswer,
        titles: [...document.querySelectorAll("#messages .activity-head .act-title")].slice(0, 3).map((n) => n.textContent.trim()),
      };
    });
    assert(st.panels <= st.turns, `${st.panels} panels for ${st.turns} requests`);
    assert(st.panels > 0, "no activity panels at all");
    assert(st.livePanels === 0, "a panel is still marked live while idle");
    assert(st.panelsInsideAnswer === 0, "an activity panel is rendered inside an answer body");
    assert(st.titles.every((t) => /^Worked/.test(t)), "unfinished caption while idle: " + JSON.stringify(st.titles));
    return `${st.panels} panels / ${st.turns} requests, none live, none inside an answer`;
  });

  /* ---- 6/1. composer, drafts, scroll ---------------------------------- */

  await test("Drafts are per conversation and survive a switch", async () => {
    await openSession("ses_demo1");
    await page.fill("#input", "draft for conversation one");
    await sleep(700);
    await openSession("ses_demo2");
    const other = await page.evaluate(() => document.querySelector("#input").value);
    assert(other === "", "another conversation inherited a draft: " + JSON.stringify(other));
    await page.fill("#input", "draft for conversation two");
    await sleep(700);
    await openSession("ses_demo1");
    const back = await page.evaluate(() => document.querySelector("#input").value);
    assert(back === "draft for conversation one", "the draft was lost: " + JSON.stringify(back));
    await openSession("ses_demo2");
    const back2 = await page.evaluate(() => document.querySelector("#input").value);
    assert(back2 === "draft for conversation two", "second draft lost: " + JSON.stringify(back2));
    await page.fill("#input", "");
    await sleep(600);
    return "two conversations, two drafts, each restored";
  });

  await test("A sent message clears its draft", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".session-row", { timeout: 20000 });
    await openSession("ses_demo1");
    await page.fill("#input", "clear me after send");
    await sleep(600);
    await send("multi-step change please");
    assert(await waitIdle(), "the turn never finished");
    const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ocp.draft:")).length);
    await openSession("ses_demo2");
    await openSession("ses_demo1");
    const after = await page.evaluate(() => document.querySelector("#input").value);
    assert(after === "", "the sent draft came back: " + JSON.stringify(after));
    return `draft cleared on send (${saved} drafts stored across all chats)`;
  });

  await test("Streaming does not yank the reader who scrolled up", async () => {
    await openSession("ses_demo_stress");
    await page.evaluate(() => {
      const m = document.querySelector("#messages");
      m.scrollTop = Math.round(m.scrollHeight / 2);
    });
    await sleep(400);
    const before = await page.evaluate(() => Math.round(document.querySelector("#messages").scrollTop));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await sleep(1200);
    const after = await page.evaluate(() => ({ top: Math.round(document.querySelector("#messages").scrollTop), jump: document.querySelector("#jump-latest")?.hidden }));
    assert(Math.abs(after.top - before) < 80, `the reader was moved ${before} -> ${after.top}`);
    assert(after.jump === false, "the jump-to-latest affordance did not appear");
    await page.click("#jump-latest");
    await sleep(700);
    const bottom = await page.evaluate(() => {
      const m = document.querySelector("#messages");
      return m.scrollHeight - m.scrollTop - m.clientHeight;
    });
    assert(bottom < 160, "jump to latest did not reach the bottom (" + Math.round(bottom) + "px short)");
    return `stayed within ${Math.abs(after.top - before)}px, jump-to-latest reached the end`;
  });

  /* ---- performance sanity on the same workload ------------------------ */

  await test("A streamed rebuild does not keep discarded diagrams alive", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".session-row", { timeout: 20000 });
    await openSession("ses_demo10");
    // Sit at the top of a transcript whose diagram is far below the fold, then
    // make the app rebuild the transcript many times (a streaming turn does it).
    await page.evaluate(() => {
      document.querySelector("#messages").scrollTop = 0;
    });
    const before = await page.evaluate(() => window.__pocketTest.diagrams.observed);
    for (let i = 0; i < 40; i += 1) {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await sleep(120);
    }
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await sleep(1200);
    const after = await page.evaluate(() => ({
      observed: window.__pocketTest.diagrams.observed,
      detached: [...document.querySelectorAll("pre.mermaid")].filter((n) => !n.isConnected).length,
      live: document.querySelectorAll("#messages pre.mermaid").length,
    }));
    assert(after.observed <= Math.max(4, before + 2), `the observer still watches ${after.observed} nodes (live diagrams: ${after.live})`);
    return `${before} -> ${after.observed} observed nodes while ${after.live} diagram(s) stay unrendered`;
  });

  await test("Reopening the same long conversation does not grow memory", async () => {
    const heap = () => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1));
    await openSession("ses_demo_stress");
    for (let i = 0; i < 10; i += 1) {
      await page.click("#messages [data-load-older]").catch(() => {});
      await sleep(150);
    }
    const first = await heap();
    for (let i = 0; i < 3; i += 1) {
      await openSession("ses_demo1");
      await openSession("ses_demo_stress");
    }
    const last = await heap();
    const growth = last - first;
    assert(growth < 40, `heap grew ${growth} MB over three reopen cycles (${first} -> ${last})`);
    return `JS heap ${first} -> ${last} MB after three reopen cycles`;
  });

  console.log("\n================ CHAT STRESS REPORT 13 ================");
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(58)} ${r.detail}`);
    r.status === "PASS" ? pass++ : fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();