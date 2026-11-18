/* Suite 12 - failure modes and long-task handling.
 *
 * Seven defects, tested where they actually show up:
 *   1. a real finish reason (output token limit) instead of a fake "partial"
 *   2. a lost connection during a turn: banner, finite retries, manual Retry,
 *      no automatic resend of an ambiguous prompt, recovery from the server
 *   3. the transcript is authoritative history, paged; the local copy is only a
 *      fallback (checked in suite 4/5, referenced here through pagination)
 *   4. Thinking vs Working are distinct, and the activity panel is one
 *   5. the stop button really stops a turn
 *   6. the transport retries reads only, and never a write
 *   7. a very long session can be walked back page by page
 *
 * Demo fixtures: "token limit", "cut off", "go offline", "unreachable" and
 * ses_demo_long exist for these paths.
 */
const { chromium } = require("playwright-core");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const API_URL = () => pathToFileURL(path.join(__dirname, "..", "assets", "api.js")).href;

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
      report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 120) });
    }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  const openSession = async (id) => {
    await page.evaluate(() => document.querySelector("#sheet-close")?.click());
    await sleep(250);
    const inChat = await page.evaluate(() => !document.querySelector("#screen-chat")?.hidden);
    if (inChat) { await page.evaluate(() => document.querySelector("#chat-back")?.click()); await sleep(400); }
    await page.click(`.session-row [data-open="${id}"]`);
    await page.waitForSelector(".msg", { timeout: 8000 });
    await sleep(600);
  };

  const send = async (text) => {
    await page.fill("#input", text);
    await page.click("#btn-send");
  };

  const waitIdle = async (max = 16000) => {
    for (let i = 0; i < max / 300; i++) {
      await sleep(300);
      const mode = await page.evaluate(() => document.querySelector("#btn-send")?.dataset?.mode ?? "");
      if (mode === "send") return true;
    }
    return false;
  };

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  /* ---- 1. output token limit ------------------------------------------- */

  await test("A length stop mid-turn is continued, not called partial", async () => {
    await openSession("ses_demo1");
    await send("token limit test");
    assert(await waitIdle(), "the turn never finished");
    await sleep(500);
    const st = await page.evaluate(() => ({
      note: [...document.querySelectorAll("#messages .sys-limit")].map((n) => n.innerText.trim()),
      cards: document.querySelectorAll("#messages .limit-card[data-limit-for]").length,
      text: document.querySelector("#messages")?.innerText ?? "",
    }));
    assert(st.note.length === 1, "limit notes=" + JSON.stringify(st.note));
    assert(st.cards === 0, "a partial-answer card appeared for a continued turn");
    assert(/Part two, continuing in smaller steps/.test(st.text), "the continuation is missing: " + st.text.slice(-160));
    return "1 continuation note, no partial card, second step rendered";
  });

  await test("A run that ended cut off offers Continue and Retry", async () => {
    await openSession("ses_demo1");
    await send("cut off here");
    assert(await waitIdle(), "the turn never finished");
    await sleep(400);
    const card = await page.evaluate(() => {
      const el = document.querySelector("#messages .limit-card[data-limit-for]");
      return el
        ? { head: el.querySelector(".limit-head")?.innerText.trim() ?? "", buttons: [...el.querySelectorAll("[data-limit]")].map((b) => b.dataset.limit) }
        : null;
    });
    assert(card, "no partial-answer card");
    assert(card.buttons.includes("continue") && card.buttons.includes("retry"), "buttons=" + JSON.stringify(card.buttons));
    return `${card.head} | ${card.buttons.join(" + ")}`;
  });

  await test("Continue sends exactly one prompt and is labelled, not faked", async () => {
    const before = await page.evaluate(() => ({
      users: document.querySelectorAll("#messages .msg-user").length,
      answers: document.querySelectorAll("#messages .msg-assistant").length,
    }));
    await page.click('#messages .limit-card [data-limit="continue"]');
    assert(await waitIdle(), "the continuation never finished");
    await sleep(600);
    const after = await page.evaluate(() => ({
      users: document.querySelectorAll("#messages .msg-user").length,
      answers: document.querySelectorAll("#messages .msg-assistant").length,
      fake: [...document.querySelectorAll("#messages .msg-user")].some((n) => /Continue from exactly where/.test(n.innerText)),
      sys: [...document.querySelectorAll("#messages .sys")].map((n) => n.innerText.trim()),
      cards: document.querySelectorAll("#messages .limit-card[data-limit-for]").length,
    }));
    assert(!after.fake, "the continuation prompt was rendered as a user bubble");
    assert(after.sys.some((s) => /Continued after the output limit/.test(s)), "no continuation system row: " + JSON.stringify(after.sys.slice(-4)));
    // Once a continuation exists the card is withdrawn: the run is no longer
    // incomplete, so nothing should claim it is.
    assert(after.cards === 0, `${after.cards} partial card(s) survived a continuation`);
    assert(after.users === before.users, `user bubbles changed ${before.users} -> ${after.users}`);
    assert(after.answers > before.answers, `no continuation answer: ${before.answers} -> ${after.answers}`);
    return "1 note, 0 fake bubbles, card withdrawn, one new answer";
  });

  /* ---- 2. connection loss --------------------------------------------- */

  await test("A lost connection shows a finite retry notice, then a manual Retry", async () => {
    await openSession("ses_demo1");
    await send("go offline now");
    await sleep(1200);
    const first = await page.evaluate(() => ({
      hidden: document.querySelector("#net-banner").hidden,
      text: document.querySelector("#net-text").textContent,
      retry: !document.querySelector("#net-retry").hidden,
      mode: document.querySelector("#btn-send").dataset.mode,
    }));
    assert(!first.hidden, "no connection banner");
    assert(/Connection lost/.test(first.text), "banner text=" + first.text);
    assert(first.retry, "the Retry button is hidden after the budget is spent");
    return `"${first.text}", Retry visible, composer=${first.mode}`;
  });

  await test("Retry recovers the session the server actually finished", async () => {
    // Wait past the point where the server finished the turn unseen, so the
    // client cannot recover from its own state and must ask the server.
    await sleep(2600);
    await page.click("#net-retry");
    assert(await waitIdle(10000), "the composer never returned to Send after Retry");
    await sleep(600);
    const after = await page.evaluate(() => ({
      hidden: document.querySelector("#net-banner").hidden,
      text: document.querySelector("#messages").innerText,
      mode: document.querySelector("#btn-send").dataset.mode,
    }));
    assert(after.hidden, "the connection banner never cleared");
    assert(/Finished while the socket was down/.test(after.text), "the finished turn was not recovered: " + after.text.slice(-200));
    return "banner cleared, missed turn recovered from the server";
  });

  await test("An ambiguous prompt is not resent automatically", async () => {
    await openSession("ses_demo1");
    await send("unreachable prompt");
    await sleep(1500);
    const st = await page.evaluate(() => ({
      card: !!document.querySelector("#messages .pending-card"),
      actions: [...document.querySelectorAll("#messages .pending-card [data-pending]")].map((b) => b.dataset.pending),
      copies: [...document.querySelectorAll("#messages .msg-user")].filter((n) => /unreachable prompt/.test(n.innerText)).length,
      mode: document.querySelector("#btn-send").dataset.mode,
    }));
    assert(st.card, "no unconfirmed-message card");
    assert(st.actions.includes("check") && st.actions.includes("resend"), "actions=" + JSON.stringify(st.actions));
    assert(st.copies === 1, `the prompt appears ${st.copies} times`);
    assert(st.mode === "send", "the composer is stuck busy=" + st.mode);
    return `${st.actions.join(" / ")} | 1 copy, composer idle`;
  });

  await test("Discarding the unconfirmed prompt removes it", async () => {
    await page.click('#messages .pending-card [data-pending="discard"]');
    await sleep(500);
    const left = await page.evaluate(() => ({
      card: !!document.querySelector("#messages .pending-card"),
      copies: [...document.querySelectorAll("#messages .msg-user")].filter((n) => /unreachable prompt/.test(n.innerText)).length,
    }));
    assert(!left.card && left.copies === 0, JSON.stringify(left));
    return "card and bubble removed";
  });

  /* ---- 4. Thinking vs Working ----------------------------------------- */

  await test("Thinking and Working are separate states, one panel per turn", async () => {
    await openSession("ses_demo1");
    await send("multi-step change please");
    const statuses = new Set();
    const mismatches = [];
    for (let i = 0; i < 40; i++) {
      await sleep(200);
      const s = await page.evaluate(() => {
        const el = document.querySelector("#chat-status");
        const panels = [...document.querySelectorAll("#messages .activity-head .act-title")]
          .map((n) => n.textContent.trim())
          .filter((t) => /^(Thinking|Working)/.test(t));
        return {
          hidden: el.hidden,
          text: el.hidden ? "" : el.querySelector("span").textContent,
          panel: panels[panels.length - 1] ?? "",
          panels: document.querySelectorAll("#messages .activity").length,
        };
      });
      if (!s.hidden) {
        statuses.add(s.text);
        // The panel and the header describe the same phase, so they can never
        // disagree: "Thinking" with a "Working…" panel was the old bug.
        if (s.panel && !s.panel.startsWith(s.text)) mismatches.push(`${s.text} vs "${s.panel}"`);
      }
      if (await page.evaluate(() => document.querySelector("#btn-send").dataset.mode === "send")) break;
    }
    assert(statuses.has("Thinking"), "never showed Thinking: " + JSON.stringify([...statuses]));
    assert(statuses.has("Working"), "never showed Working: " + JSON.stringify([...statuses]));
    assert(mismatches.length === 0, "header and panel disagreed: " + mismatches.slice(0, 3).join(" | "));
    const panels = await page.evaluate(() => document.querySelectorAll("#messages .activity").length);
    assert(panels >= 1, "no activity panel");
    return `states ${[...statuses].join(" -> ")}, ${panels} panel(s) after`;
  });

  /* ---- 5. stop ------------------------------------------------------- */

  await test("Stop interrupts a running turn and hands control back", async () => {
    await openSession("ses_demo1");
    await send("multi-step change please");
    await sleep(900);
    await page.fill("#input", "");
    await page.click("#btn-send"); // no text + busy == stop
    assert(await waitIdle(8000), "Stop did not end the turn");
    const mode = await page.evaluate(() => document.querySelector("#btn-send").dataset.mode);
    assert(mode === "send", "composer mode=" + mode);
    return "interrupted, composer back to Send";
  });

  /* ---- 7. pagination -------------------------------------------------- */

  await test("A long session is paged, not truncated", async () => {
    await openSession("ses_demo_long");
    const first = await page.evaluate(() => ({
      rows: document.querySelectorAll("#messages [data-msg]").length,
      older: !!document.querySelector("#messages [data-load-older]"),
      oldest: document.querySelector('#messages [data-msg]')?.dataset.msg ?? "",
      top: Math.round(document.querySelector("#messages").scrollTop),
    }));
    assert(first.older, "no way back to earlier messages");
    // A reader reaches the button by scrolling up, so scroll it into view
    // first. The message under the top edge must then stay put when a page of
    // older messages is inserted above it.
    await page.evaluate(() => document.querySelector("#messages [data-load-older]").scrollIntoView({ block: "start" }));
    await sleep(300);
    const anchor = await page.evaluate(() => {
      const node = [...document.querySelectorAll("#messages [data-msg]")].find((n) => n.getBoundingClientRect().bottom > 0);
      return node ? { id: node.dataset.msg, top: Math.round(node.getBoundingClientRect().top) } : null;
    });
    assert(anchor, "nothing visible to anchor to");
    await page.click("#messages [data-load-older]");
    await sleep(800);
    const second = await page.evaluate((id) => {
      const node = [...document.querySelectorAll(`#messages [data-msg="${id}"]`)][0];
      return {
        rows: document.querySelectorAll("#messages [data-msg]").length,
        oldest: document.querySelector('#messages [data-msg]')?.dataset.msg ?? "",
        top: node ? Math.round(node.getBoundingClientRect().top) : null,
      };
    }, anchor.id);
    assert(second.rows > first.rows, `rows ${first.rows} -> ${second.rows}`);
    assert(second.oldest !== first.oldest, "the oldest message did not change");
    assert(second.top !== null && Math.abs(second.top - anchor.top) < 60, `anchor ${anchor.id} moved ${anchor.top} -> ${second.top}px`);
    return `${first.rows} -> ${second.rows} rows; ${anchor.id} held at ${anchor.top} -> ${second.top}px`;
  });

  /* ---- 3b. the demo must never pollute the real recovery copy ------- */

  await test("Demo transcripts stay out of the real history database", async () => {
    await openSession("ses_demo1");
    await sleep(700);
    const counts = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open("opencode-pocket-history");
          req.onerror = () => resolve({ error: "cannot open" });
          req.onsuccess = () => {
            const db = req.result;
            const names = [...db.objectStoreNames];
            if (!names.includes("sessions")) return resolve({ sessions: 0, messages: 0, stores: names });
            const tx = db.transaction(["sessions", "messages"], "readonly");
            const s = tx.objectStore("sessions").count();
            const m = tx.objectStore("messages").count();
            tx.oncomplete = () => resolve({ sessions: s.result, messages: m.result, stores: names });
          };
        })
    );
    assert(!counts.error, counts.error);
    assert(counts.sessions === 0 && counts.messages === 0, "the real cache holds demo data: " + JSON.stringify(counts));
    return `${counts.sessions} sessions / ${counts.messages} messages in the real cache after opening demo chats`;
  });

  /* ---- diagrams (the renderer adopted from Aurora) -------------------- */

  await test("A finished diagram draws while a later turn streams", async () => {
    await openSession("ses_demo10");
    await send("rich markdown answer please");
    // While the new turn is writing, an older answer's diagram must not be
    // stuck as source just because the page is busy.
    await sleep(1200);
    await page.$eval("pre.mermaid", (n) => n.scrollIntoView({ block: "center" }));
    let busy = "";
    let drawn = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      busy = await page.evaluate(() => document.querySelector("#btn-send").dataset.mode);
      drawn = await page.evaluate(() => document.querySelectorAll("pre.mermaid.drawn svg").length > 0);
      if (drawn) break;
    }
    const during = { busy, drawn };
    assert(drawn, "the diagram never drew");
    assert(busy === "stop", "the turn had already finished; the busy path was not exercised (mode=" + busy + ")");
    await waitIdle();
    return `drawn while mode=stop (${during.busy}), no source left behind`;
  });

  await test("A diagram that uses the reserved word 'end' still draws", async () => {
    await openSession("ses_demo11");
    await page.$eval("pre.mermaid", (n) => n.scrollIntoView({ block: "center" }));
    let state2 = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      state2 = await page.evaluate(() => ({
        drawn: document.querySelectorAll("pre.mermaid.drawn svg").length,
        failed: document.querySelectorAll("pre.mermaid.failed").length,
        note: document.querySelector("#messages .mermaid-error")?.textContent ?? "",
        nodes: document.querySelectorAll("pre.mermaid.drawn svg g.node").length,
      }));
      if (state2.drawn || state2.failed) break;
    }
    assert(state2.drawn >= 1, "the diagram did not draw: " + JSON.stringify(state2));
    assert(state2.failed === 0, "still marked failed: " + state2.note);
    assert(state2.nodes >= 4, "drawn but empty: nodes=" + state2.nodes);
    return `drawn with ${state2.nodes} nodes, 0 parse failures (classDef end renamed)`;
  });

  await test("A flowchart with diagram notes draws, and says what it skipped", async () => {
    await openSession("ses_demo12");
    await page.$eval("pre.mermaid", (n) => n.scrollIntoView({ block: "center" }));
    let st = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      st = await page.evaluate(() => ({
        drawn: document.querySelectorAll("pre.mermaid.drawn svg").length,
        failed: document.querySelectorAll("pre.mermaid.failed").length,
        note: document.querySelector("#messages .mermaid-error")?.textContent ?? "",
        nodes: document.querySelectorAll("pre.mermaid.drawn svg g.node").length,
      }));
      if (st.drawn || st.failed) break;
    }
    assert(st.drawn === 1 && st.failed === 0, "diagram did not draw: " + JSON.stringify(st));
    assert(/note/i.test(st.note) && /source/i.test(st.note), "no honest note about the skipped notes: " + st.note);
    assert(st.nodes >= 5, "drawn but incomplete: nodes=" + st.nodes);
    return `${st.nodes} nodes drawn, note kept in the source ("${st.note.slice(0, 52)}…")`;
  });

  /* ---- 6. transport -------------------------------------------------- */

  await test("Reads retry, writes never do", async () => {
    const { Api } = await import(API_URL());
    let gets = 0;
    const getter = new Api("http://unit.test", "s", async () => {
      gets += 1;
      if (gets === 1) throw Object.assign(new TypeError("fetch failed"), { name: "TypeError" });
      return new Response(JSON.stringify({ version: "2.3.0" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await getter.info();
    assert(gets === 2, `GET attempts=${gets}`);
    let posts = 0;
    const poster = new Api("http://unit.test", "s", async () => {
      posts += 1;
      throw Object.assign(new TypeError("fetch failed"), { name: "TypeError" });
    });
    let threw = false;
    try {
      await poster.prompt("ses_x", { text: "hi" });
    } catch {
      threw = true;
    }
    assert(threw && posts === 1, `POST attempts=${posts} threw=${threw}`);
    return `GET retried once, POST attempted once and surfaced the error`;
  });

  await test("A cursor request is sent without order", async () => {
    const { Api } = await import(API_URL());
    const seen = [];
    const api = new Api("http://unit.test", "s", async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ data: [], cursor: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await api.messages("ses_x", { limit: 5, order: "desc" });
    await api.messages("ses_x", { limit: 5, cursor: "abc" });
    assert(/order=desc/.test(seen[0]) && !/cursor=/.test(seen[0]), "first page=" + seen[0]);
    assert(/cursor=abc/.test(seen[1]) && !/order=/.test(seen[1]), "paged request=" + seen[1]);
    return "page 1 order=desc, page 2 cursor only";
  });

  await test("A stream that gives up reports failed, and Retry restarts it", async () => {
    const { Api } = await import(API_URL());
    const statuses = [];
    const api = new Api("http://unit.test", "s", async () => {
      throw Object.assign(new TypeError("fetch failed"), { name: "TypeError" });
    });
    const stop = api.streamEvents(() => {}, (status, info) => statuses.push(`${status}:${info.attempt}/${info.maxAttempts}`), { maxAttempts: 3 });
    await sleep(4500);
    const gaveUp = statuses.some((s) => s.startsWith("failed:"));
    assert(gaveUp, "never gave up: " + JSON.stringify(statuses));
    const before = statuses.length;
    stop.retryNow();
    await sleep(600);
    assert(statuses.length > before, "Retry did not restart the stream");
    stop();
    return `${statuses.slice(0, 4).join(" ")} ... retry resumed`;
  });

  console.log("\n================ FAILURE TEST REPORT 12 ================");
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(54)} ${r.detail}`);
    r.status === "PASS" ? pass++ : fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
