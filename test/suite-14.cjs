/* Suite 14 - the named stop / reconcile / activity / question / scroll bugs.
 *
 * One test per scenario from the bug report, each written so it FAILS on the
 * old behaviour rather than describing it:
 *
 *   1  long response -> Stop -> server interruption confirmed
 *   2  tool running -> Stop -> tool lifecycle finalized
 *   3  a new prompt immediately after Stop
 *   4  answer complete, terminal event delayed
 *   5  text ended, idle event lost
 *   6  multiple assistant steps (reasoning + tools)
 *   7  Worked panel placement across 10 consecutive turns
 *   8  Ask Question -> answer -> form cleanup
 *   9  Ask Question -> answer -> the reader has scrolled up
 *   10 reading old messages while an answer streams
 *   11 network loss during Stop -> reconnect -> authoritative recovery
 *   12 background/foreground during an active response
 *
 * The mock's interrupt matches the daemon measured in probe-interrupt.cjs:
 * `session.step.failed {type:"aborted"}`, `session.execution.interrupted`, no
 * `session.idle` event, an `idle` message row with outcome "interrupted", the
 * partial answer kept, and a queued prompt left queued.
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
      report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 150) });
    }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  const fresh = async () => {
    await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".session-row", { timeout: 20000 });
  };
  const openSession = async (id) => {
    await page.evaluate(() => {
      const sheet = document.querySelector("#sheet");
      if (sheet && !sheet.hidden) document.querySelector("#sheet-close")?.click();
    });
    await sleep(200);
    if (await page.evaluate(() => !document.querySelector("#screen-chat")?.hidden)) {
      await page.evaluate(() => document.querySelector("#chat-back")?.click());
      await sleep(400);
    }
    await page.click(`.session-row [data-open="${id}"]`);
    await page.waitForSelector("#messages .msg", { timeout: 15000 });
    await sleep(500);
  };
  const mode = () => page.evaluate(() => document.querySelector("#btn-send")?.dataset?.mode ?? "");
  const waitMode = async (want, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if ((await mode()) === want) return true;
      await sleep(120);
    }
    return false;
  };
  const send = async (text) => {
    await page.fill("#input", text);
    await page.click("#btn-send");
  };
  /** Wait for the composer to be in Stop mode (a turn was accepted). */
  const waitBusy = async (ms = 12000) => waitMode("stop", ms);
  /**
   * Wait until *this* turn's live message has text. Using the newest assistant
   * message alone could read the previous answer and stop before anything of
   * the new turn had streamed.
   */
  const waitText = async (min = 60, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const n = await page.evaluate(() => {
        const t = window.__pocketTest;
        const id = t.state.lastAssistantId;
        if (!id) return 0;
        const m = t.state.messages.find((x) => x.id === id);
        return (m?.content ?? []).filter((p) => p.type === "text").reduce((a, p) => a + (p.text ?? "").length, 0);
      });
      if (n >= min) return n;
      await sleep(120);
    }
    return 0;
  };
  const dom = () =>
    page.evaluate(() => ({
      mode: document.querySelector("#btn-send")?.dataset?.mode ?? "",
      status: document.querySelector("#chat-status")?.hidden ? "" : document.querySelector("#chat-status")?.innerText?.trim() ?? "",
      panels: document.querySelectorAll("#messages .activity").length,
      livePanels: document.querySelectorAll("#messages .activity.live").length,
      failures: document.querySelectorAll("#messages .failure").length,
      interrupted: [...document.querySelectorAll("#messages .sys")].filter((n) => /Interrupted|Stopped/.test(n.textContent)).length,
      forms: document.querySelectorAll("#messages .form-card").length,
      answers: document.querySelectorAll("#messages .form-card.answered").length,
      toolCards: document.querySelectorAll("#messages .tool-card").length,
      runningTools: document.querySelectorAll('#messages .tool-state[data-status="running"]').length,
      interruptedTools: document.querySelectorAll('#messages .tool-state[data-status="interrupted"]').length,
      jump: document.querySelector("#jump-latest")?.hidden === false,
      scrollTop: document.querySelector("#messages")?.scrollTop ?? 0,
    }));
  /** The server's copy of the newest assistant message, and the UI's own copy. */
  const truth = () =>
    page.evaluate(async () => {
      const t = window.__pocketTest;
      const sid = t.state.session?.id;
      const res = await t.api.messages(sid, { limit: 12 });
      const list = res.data ?? [];
      // The API returns the newest page first.
      const a = list.find((m) => m.type === "assistant");
      const text = (a?.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n\n");
      const mine = (t.state.messages.filter((m) => m.type === "assistant").pop()?.content ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n\n");
      return {
        server: text,
        source: mine,
        error: a?.error ?? null,
        interruptedFlag: !!a?.interrupted,
        idleInterrupted: list.filter((m) => m.type === "idle" && m.outcome === "interrupted").length,
        users: list.filter((m) => m.type === "user").length,
        tools: (a?.content ?? []).filter((p) => p.type === "tool").map((p) => ({ name: p.name, status: p.state?.status })),
      };
    });

  await fresh();

  /* ---- 1 --------------------------------------------------------------- */
  await test("1. Stop a streaming answer: the server confirms, the partial answer stays", async () => {
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    const streamed = await waitText(120);
    assert(streamed >= 100, "no text streamed before the stop: " + streamed);
    // A double tap must send one interrupt, not two.
    await page.evaluate(() => {
      const b = document.querySelector("#btn-send");
      b.click();
      b.click();
    });
    // The UI must say "Stopping…", never "Stopped", until the server confirms.
    const during = await dom();
    assert(/Stopping/i.test(during.status), `status while stopping = "${during.status}"`);
    assert(await waitMode("send", 10000), "the composer never returned to Send after the stop");
    const calls = await page.evaluate(() => window.__pocketTest.api.interruptCalls);
    assert(calls === 1, `double tap sent ${calls} interrupt requests`);
    const after = await dom();
    const t = await truth();
    // The transcript row for an interrupted turn comes from the server's idle
    // marker, so allow one reconcile round trip.
    let interruptedRows = after.interrupted;
    for (let i = 0; i < 20 && interruptedRows === 0; i += 1) {
      await sleep(100);
      interruptedRows = (await dom()).interrupted;
    }
    assert(t.interruptedFlag, "the server-side step was not marked interrupted");
    assert(t.error?.type === "aborted", "not an abort: " + JSON.stringify(t.error));
    assert(after.failures === 0, "the stop rendered as a red failure (" + after.failures + ")");
    assert(interruptedRows >= 1, "no Interrupted row in the transcript");
    assert(after.livePanels === 0, "a panel is still live after the stop");
    assert((await mode()) === "send", "composer is not in Send mode");
    assert(t.server.length > 120, "the partial answer was discarded (" + t.server.length + " chars)");
    assert(t.source === t.server, `UI text ${t.source.length} != server ${t.server.length}`);
    return `streamed ${streamed} chars, "${during.status}" -> Send, server aborted, ${t.server.length} chars kept, 0 red failures`;
  });

  /* ---- 2 --------------------------------------------------------------- */
  await test("2. Stop while a tool runs: the tool is finalized as stopped, not a spinner", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop a tool please");
    assert(await waitBusy(), "the turn never started");
    // The shell tool is running and never finishes on its own.
    let running = 0;
    for (let i = 0; i < 60; i += 1) {
      running = (await dom()).runningTools;
      if (running > 0) break;
      await sleep(150);
    }
    assert(running > 0, "the running tool never appeared");
    await page.click("#btn-send");
    assert(await waitMode("send", 10000), "the composer never returned to Send");
    await sleep(700);
    const after = await dom();
    const t = await truth();
    assert(after.runningTools === 0, "a tool spinner survived the stop (" + after.runningTools + ")");
    assert(after.interruptedTools >= 1, "the tool was not shown as stopped");
    assert(t.interruptedFlag, "the step was not aborted on the server");
    assert(after.livePanels === 0, "the activity panel is still live");
    return `tool was running, stopped -> ${after.interruptedTools} tool(s) marked stopped, 0 spinners`;
  });

  /* ---- 2b -------------------------------------------------------------- */
  await test("2b. A tool that ignores the interrupt is reported, never faked as stopped", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stubborn tool please");
    assert(await waitBusy(), "the turn never started");
    await waitText(60);
    await page.click("#btn-send");
    // The server accepts the stop but the tool keeps running for a while.
    let toastText = "";
    for (let i = 0; i < 60; i += 1) {
      await sleep(150);
      toastText = await page.evaluate(() => document.querySelector("#toast")?.textContent?.trim() ?? "");
      if (/still running/i.test(toastText)) break;
    }
    assert(/still running/i.test(toastText), "no honest message for a non-interruptible tool: " + JSON.stringify(toastText));
    assert((await mode()) === "stop", "the composer claimed the turn stopped while it was still running");
    assert(await waitMode("send", 15000), "the turn never ended after the tool returned");
    const t = await truth();
    assert(t.interruptedFlag, "the turn did not end as interrupted");
    return `"${toastText}" while it kept running, then Send`;
  });

  /* ---- 3 --------------------------------------------------------------- */
  await test("3. A new prompt immediately after Stop runs, once", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the first turn never started");
    await waitText(80);
    await page.click("#btn-send");
    assert(await waitMode("send", 10000), "the stop never completed");
    // Immediately send a different prompt.
    await send("quick tool please");
    assert(await waitMode("send", 25000), "the prompt after the stop never finished");
    await sleep(600);
    const t = await truth();
    const domNow = await dom();
    const stopRows = await page.evaluate(() => [...document.querySelectorAll("#messages .msg-user")].filter((n) => /stop me now/.test(n.innerText)).length);
    const afterRows = await page.evaluate(() => [...document.querySelectorAll("#messages .msg-user")].filter((n) => /quick tool/.test(n.innerText)).length);
    assert(stopRows === 1, "the stopped prompt appears " + stopRows + " times");
    assert(afterRows === 1, "the new prompt appears " + afterRows + " times");
    assert(t.idleInterrupted >= 1, "the earlier turn's interrupt was overwritten");
    assert(domNow.panels >= 2, "the new turn has no activity panel");
    assert(domNow.livePanels === 0, "a panel is still live");
    return `stop confirmed, next prompt ran in ${stopRows === 1 ? "one" : "?"} copy, ${domNow.panels} panels`;
  });

  /* ---- 3b -------------------------------------------------------------- */
  await test("3b. A prompt queued behind a stopped turn stays queued, never runs by itself", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the first turn never started");
    await waitText(80);
    // Queue a second prompt while the first runs.
    await page.click("#delivery-toggle");
    const delivery = await page.evaluate(() => document.querySelector("#delivery-toggle span")?.textContent?.trim());
    assert(delivery === "Queue", "delivery chip = " + delivery);
    await send("QUEUED AFTER STOP please");
    await page.waitForSelector("#inbox-bar:not([hidden]) .inbox-chip", { timeout: 5000 });
    await page.click("#btn-send"); // stop the first turn
    assert(await waitMode("send", 10000), "the stop never completed");
    await sleep(900);
    const runBefore = await page.evaluate(() => window.__pocketTest.api.interruptCalls);
    const stillQueued = await page.evaluate(() => !document.querySelector("#inbox-bar")?.hidden);
    assert(stillQueued, "the queued prompt vanished from the inbox after the stop");
    const ran = await page.evaluate(() => [...document.querySelectorAll("#messages .msg-user")].some((n) => /QUEUED AFTER STOP/.test(n.innerText)));
    assert(!ran, "the queued prompt ran after the stop");
    const busy = await page.evaluate(() => window.__pocketTest.state.busy);
    assert(busy === false, "the session is busy after the stop");
    // Clean up: cancel it, and confirm the inbox empties.
    await page.click("#inbox-bar [data-inbox-cancel]");
    await sleep(500);
    const empty = await page.evaluate(() => document.querySelector("#inbox-bar")?.hidden === true);
    assert(empty, "the queued prompt could not be cancelled");
    return `queued prompt shown, did not run after stop (${runBefore} interrupt), cancelled cleanly`;
  });

  /* ---- 4 --------------------------------------------------------------- */
  await test("4. Answer complete, terminal event delayed: the answer appears at once", async () => {
    await openSession("ses_demo1");
    await send("delayed completion please");
    assert(await waitBusy(), "the turn never started");
    // Wait for the text to be complete while the composer is still in Stop:
    // the server has finished writing but has not announced the end yet.
    let full = 0;
    for (let i = 0; i < 100; i += 1) {
      full = await page.evaluate(() => {
        const t = window.__pocketTest;
        return (t.state.messages.filter((m) => m.type === "assistant").pop()?.content ?? [])
          .filter((p) => p.type === "text")
          .reduce((a, p) => a + (p.text ?? "").length, 0);
      });
      if (full > 150) break;
      await sleep(150);
    }
    assert(full > 150, "the answer never completed: " + full);
    const early = await page.evaluate(() => {
      const body = [...document.querySelectorAll("#messages .msg-assistant .assistant-body")].pop();
      return { len: body?.innerText?.length ?? 0, mode: document.querySelector("#btn-send")?.dataset?.mode };
    });
    assert(early.mode === "stop", "the test never caught the delayed window (mode " + early.mode + ")");
    assert(early.len > 150, "the completed response was not on screen yet: " + early.len);
    assert(await waitMode("send", 12000), "the delayed terminal event never released the composer");
    const t = await truth();
    assert(t.source === t.server, "the reconciled text differs from the server's");
    return `${full} chars on screen while the turn was still open, then Send`;
  });

  /* ---- 5 --------------------------------------------------------------- */
  await test("5. Text ended but the terminal event is lost: verifyTurn recovers", async () => {
    await openSession("ses_demo1");
    await send("missed idle please");
    assert(await waitBusy(), "the turn never started");
    // No execution/idle event will arrive. The client has to ask the server.
    assert(await waitMode("send", 9000), "the composer stayed in Stop after the answer ended");
    await sleep(500);
    const t = await truth();
    const d = await dom();
    assert(t.server.length > 150, "server answer missing: " + t.server.length);
    assert(t.source === t.server, `UI ${t.source.length} != server ${t.server.length}`);
    assert(d.livePanels === 0, "a panel is still live");
    return `released without a terminal event, ${t.server.length} chars reconciled`;
  });

  /* ---- 6 --------------------------------------------------------------- */
  await test("6. Multiple assistant steps: one panel, both tools, answer last", async () => {
    await openSession("ses_demo1");
    await send("multi-step change please");
    assert(await waitMode("send", 20000), "the turn never finished");
    await sleep(600);
    const shape = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#messages > *")];
      const lastUser = rows.map((n, i) => ({ n, i })).filter(({ n }) => n.classList.contains("msg-user")).pop()?.i ?? 0;
      const turnRows = rows.slice(lastUser);
      const panelNode = turnRows.find((n) => n.classList.contains("activity"));
      const answer = turnRows.findIndex((n) => n.classList.contains("msg-assistant") && n.querySelector(".assistant-body .md"));
      return {
        panel: turnRows.findIndex((n) => n.classList.contains("activity")),
        answer,
        tools: panelNode ? panelNode.querySelectorAll(".tool-card").length : 0,
        heads: turnRows.filter((n) => n.classList.contains("activity")).map((n) => n.querySelector(".activity-head")?.innerText.replace(/\s+/g, " ").trim()),
        panels: turnRows.filter((n) => n.classList.contains("activity")).length,
      };
    });
    assert(shape.panels === 1, "panels in the turn = " + shape.panels);
    assert(shape.panel === 1, `panel at ${shape.panel}, user at 0`);
    assert(shape.answer > shape.panel, `answer at ${shape.answer}, panel at ${shape.panel}`);
    assert(shape.tools === 2, "both tools live in the panel: " + shape.tools);
    assert(/^Worked for/.test(shape.heads[0]), "finished caption = " + shape.heads[0]);
    return `user -> panel (2 tools, "${shape.heads[0]}") -> answer, exactly one panel`;
  });

  /* ---- 7 --------------------------------------------------------------- */
  await test("7. Worked panel placement is identical across 10 consecutive turns", async () => {
    await fresh();
    await openSession("ses_demo1");
    for (let i = 0; i < 10; i += 1) {
      await send(`quick tool please ${i}`);
      assert(await waitMode("send", 15000), `turn ${i} never finished`);
      await sleep(120);
    }
    const st = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#messages > *")];
      const bad = [];
      let turns = 0;
      rows.forEach((n, i) => {
        if (!n.classList.contains("msg-user") || !/quick tool/.test(n.innerText)) return;
        turns += 1;
        const panel = rows[i + 1];
        const answer = rows.slice(i + 2).find((x) => x.classList.contains("msg-assistant") && x.querySelector(".assistant-body .md"));
        if (!panel?.classList.contains("activity")) bad.push(`turn ${turns}: next row is ${panel?.className || "none"}`);
        else if (!panel.querySelector(".tool-card")) bad.push(`turn ${turns}: panel has no tool`);
        else if (!answer) bad.push(`turn ${turns}: no answer after the panel`);
      });
      const panels = rows.filter((n) => n.classList.contains("activity"));
      // Only the ten turns this test created: the fixture's own turn may carry
      // more than one tool.
      const quickPanels = [];
      rows.forEach((n, i) => {
        if (n.classList.contains("msg-user") && /quick tool/.test(n.innerText) && rows[i + 1]?.classList.contains("activity")) {
          quickPanels.push(rows[i + 1]);
        }
      });
      return {
        turns,
        panels: panels.length,
        bad,
        toolsPerPanel: quickPanels.map((p) => p.querySelectorAll(".tool-card").length),
      };
    });
    assert(st.turns === 10, "turns found = " + st.turns);
    assert(st.bad.length === 0, st.bad.slice(0, 2).join(" | "));
    assert(st.toolsPerPanel.length === 10, "panels for the 10 turns = " + st.toolsPerPanel.length);
    assert(st.toolsPerPanel.every((n) => n === 1), "a panel merged another turn's tools: " + JSON.stringify(st.toolsPerPanel));
    return `10 turns: user -> panel -> answer every time, one tool per panel`;
  });

  /* ---- 8 --------------------------------------------------------------- */
  await test("8. Ask Question -> answer -> the pending card is gone for good", async () => {
    await openSession("ses_demo1");
    await send("ask me which approach");
    assert(await page.waitForSelector("#messages .form-card", { timeout: 10000 }), "the form never appeared");
    await sleep(400);
    const before = await dom();
    assert(before.forms === 1, "forms on screen = " + before.forms);
    const formId = await page.evaluate(() => document.querySelector("#messages .form-card")?.dataset.form);
    await page.evaluate(() => document.querySelector('#messages .form-field[data-key="approach"] .opt[data-value="patch"]')?.click());
    await sleep(200);
    await page.evaluate(() => document.querySelector("#messages [data-form-submit]")?.click());
    // The card must leave at once, not stay as an interactive form.
    let after = null;
    for (let i = 0; i < 20; i += 1) {
      await sleep(100);
      after = await dom();
      if (after.forms === 0) break;
    }
    assert(after && after.forms === 0, "the answered card is still on screen: " + (after?.forms ?? "?"));
    assert(await waitMode("send", 12000), "the follow-up answer never finished");
    // A duplicate delivery of the same event must be a no-op.
    await page.evaluate((id) => window.__pocketTest.api.emit("form.replied", { id, sessionID: window.__pocketTest.state.session.id, answer: { approach: "patch" } }), formId);
    await sleep(400);
    const later = await dom();
    assert(later.forms === 0 && later.answers === 0, "a settled form came back: " + JSON.stringify({ forms: later.forms, answers: later.answers }));
    // A reload must not resurrect it either.
    await openSession("ses_demo1");
    const reloaded = await dom();
    assert(reloaded.forms === 0, "the form returned after reopening the session");
    return "1 pending card -> 0 within 100ms of the answer, 0 after reopen";
  });

  /* ---- 8b -------------------------------------------------------------- */
  await test("8b. Dismissing a question clears the pending card and the turn continues", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("ask me which approach");
    await page.waitForSelector("#messages .form-card", { timeout: 10000 });
    await sleep(300);
    await page.evaluate(() => document.querySelector("#messages [data-form-cancel]")?.click());
    let gone = null;
    for (let i = 0; i < 20; i += 1) {
      await sleep(100);
      gone = await dom();
      if (gone.forms === 0) break;
    }
    assert(gone && gone.forms === 0, "the cancelled card is still on screen");
    assert(await waitMode("send", 12000), "the turn never finished after dismissing");
    const text = await page.evaluate(() => document.querySelector("#messages")?.innerText ?? "");
    assert(/Dismissed the question/i.test(text), "the follow-up after a dismissal is missing");
    return "card gone within 100ms, turn closed with the dismissal answer";
  });

  /* ---- 9 --------------------------------------------------------------- */
  await test("9. Answering a question does not move a reader who scrolled up", async () => {
    await fresh();
    await openSession("ses_demo_stress");
    await send("ask me which approach");
    assert(await page.waitForSelector("#messages .form-card", { timeout: 10000 }), "the form never appeared");
    await sleep(500);
    await page.evaluate(() => {
      const m = document.querySelector("#messages");
      m.scrollTop = Math.max(0, m.scrollHeight - m.clientHeight - 1200);
    });
    await sleep(400);
    // The reading position is "which message is at the top edge", not a raw
    // scrollTop: closing the card removes height below the reader, which
    // legitimately clamps scrollTop.
    const anchor = () =>
      page.evaluate(() => {
        const node = [...document.querySelectorAll("#messages [data-msg]")].find((n) => n.getBoundingClientRect().bottom > 0);
        return { id: node?.dataset.msg ?? null, top: node ? Math.round(node.getBoundingClientRect().top) : null };
      });
    const before = await anchor();
    assert(before.id, "no message under the top edge to anchor on");
    await page.evaluate(() => document.querySelector('#messages .form-field[data-key="approach"] .opt[data-value="patch"]')?.click());
    await sleep(150);
    await page.evaluate(() => document.querySelector("#messages [data-form-submit]")?.click());
    assert(await waitMode("send", 12000), "the follow-up answer never finished");
    await sleep(700);
    const after = await page.evaluate((id) => {
      const node = document.querySelector(`#messages [data-msg="${CSS.escape(id)}"]`);
      return { found: !!node, top: node ? Math.round(node.getBoundingClientRect().top) : null };
    }, before.id);
    const d = await dom();
    assert(after.found, "the anchored message disappeared");
    assert(Math.abs(after.top - before.top) < 6, `the anchored message moved ${before.top} -> ${after.top}`);
    assert(d.forms === 0, "the card is still there");
    return `${before.id} stayed at the top edge (${before.top} -> ${after.top}px) while the card settled`;
  });

  /* ---- 10 -------------------------------------------------------------- */
  await test("10. Reading old messages during streaming: no yank, jump-to-latest offered", async () => {
    await fresh();
    await openSession("ses_demo_stress");
    await send("rich markdown answer please");
    assert(await waitBusy(), "the turn never started");
    await page.evaluate(() => {
      const m = document.querySelector("#messages");
      m.scrollTop = Math.max(0, m.scrollHeight - m.clientHeight - 1500);
    });
    await sleep(300);
    const before = await page.evaluate(() => {
      const node = [...document.querySelectorAll("#messages [data-msg]")].find((n) => n.getBoundingClientRect().bottom > 0);
      return { id: node?.dataset.msg ?? null, top: node ? Math.round(node.getBoundingClientRect().top) : null };
    });
    // Let several frames arrive while the reader is up there.
    await sleep(1600);
    const after = await page.evaluate((id) => {
      const node = document.querySelector(`#messages [data-msg="${CSS.escape(id)}"]`);
      return {
        top: node ? Math.round(node.getBoundingClientRect().top) : null,
        jump: document.querySelector("#jump-latest")?.hidden === false,
        forms: document.querySelectorAll("#messages .form-card").length,
      };
    }, before.id);
    assert(after.top != null, "the anchor message disappeared");
    assert(Math.abs(after.top - before.top) < 8, `the reader moved ${before.top} -> ${after.top}`);
    assert(after.jump, "jump-to-latest was not offered");
    await page.click("#jump-latest");
    await sleep(600);
    const bottom = await page.evaluate(() => {
      const m = document.querySelector("#messages");
      return m.scrollHeight - m.scrollTop - m.clientHeight;
    });
    assert(bottom < 160, "jump-to-latest did not reach the end (" + Math.round(bottom) + "px)");
    return `stayed within ${Math.abs(after.top - before.top)}px while streaming, jump pill worked`;
  });

  /* ---- 11 -------------------------------------------------------------- */
  await test("11. Network loss during Stop: pending stop, retried on reconnect, confirmed", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    await waitText(80);
    // The socket dies, then the user taps Stop.
    await page.evaluate(() => window.__pocketTest.api.dropStream());
    await sleep(500);
    const offline = await page.evaluate(() => document.querySelector("#net-banner")?.hidden === false);
    assert(offline, "no connection banner after the socket died");
    await page.click("#btn-send");
    await sleep(400);
    const pending = await dom();
    assert(/Stop pending|Stopping/i.test(pending.status), `status = "${pending.status}"`);
    assert(pending.mode === "stop", "the composer was released before the server confirmed");
    // Reconnect: the pending stop must go out by itself.
    await page.click("#net-retry");
    assert(await waitMode("send", 15000), "the pending stop was never confirmed after reconnecting");
    await sleep(600);
    const t = await truth();
    const after = await dom();
    assert(t.interruptedFlag, "the server never interrupted the turn");
    assert(after.failures === 0, "the stop rendered as a failure");
    return `offline -> "${pending.status}" -> reconnect -> server aborted, composer Send`;
  });

  /* ---- 12 -------------------------------------------------------------- */
  await test("12. Background/foreground during a response keeps state consistent", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    await waitText(100);
    const before = await truth();
    // Hidden, then visible, exactly as Android reports it.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(500);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(1200);
    const mid = await dom();
    const t = await truth();
    assert(mid.mode === "stop", "the running turn was lost across background/foreground (mode " + mid.mode + ")");
    assert(t.server.length >= before.server.length, "text went backwards across the lifecycle change");
    assert(mid.failures === 0, "a failure appeared");
    // And the stop still works after the round trip.
    await page.click("#btn-send");
    assert(await waitMode("send", 10000), "Stop did not work after returning to the foreground");
    const end = await truth();
    assert(end.interruptedFlag, "the server never interrupted the turn");
    return `backgrounded mid-answer, returned to Stop mode, ${end.server.length} chars, stop confirmed`;
  });

  /* ---- portrait / landscape ------------------------------------------- */
  await test("Portrait -> landscape -> portrait during streaming keeps the layout intact", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    await waitText(100);
    const before = await page.evaluate(() => ({
      panels: document.querySelectorAll("#messages .activity").length,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    await page.setViewportSize({ width: 844, height: 390 });
    await sleep(1200);
    const land = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      composerBottom: Math.round(document.querySelector("#composer").getBoundingClientRect().bottom),
      vh: window.innerHeight,
      panels: document.querySelectorAll("#messages .activity").length,
      live: document.querySelectorAll("#messages .activity.live").length,
      failures: document.querySelectorAll("#messages .failure").length,
      mode: document.querySelector("#btn-send")?.dataset?.mode,
    }));
    assert(land.overflow <= 2, "horizontal overflow in landscape: " + land.overflow);
    assert(land.composerBottom <= land.vh + 2, `composer clipped in landscape (${land.composerBottom} > ${land.vh})`);
    assert(land.panels === before.panels, `panels changed ${before.panels} -> ${land.panels} in landscape`);
    assert(land.failures === 0, "a failure appeared after rotating");
    assert(land.mode === "stop", "the running turn was lost on rotation (mode " + land.mode + ")");
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(1000);
    const port = await page.evaluate(() => ({
      panels: document.querySelectorAll("#messages .activity").length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      mode: document.querySelector("#btn-send")?.dataset?.mode,
    }));
    assert(port.panels === before.panels, "panels changed coming back to portrait");
    assert(port.overflow <= 2, "horizontal overflow back in portrait: " + port.overflow);
    if (port.mode === "stop") {
      await page.click("#btn-send");
      assert(await waitMode("send", 12000), "the turn could not be stopped after rotating");
    }
    return `${before.clientW}px -> 844px -> 390px, panels ${port.panels} unchanged, composer visible, no overflow`;
  });

  /* ---- long conversation ---------------------------------------------- */
  await test("A 133-message conversation can still be stopped mid-answer", async () => {
    await fresh();
    await openSession("ses_demo_stress");
    const rows = await page.evaluate(() => document.querySelectorAll("#messages [data-msg]").length);
    await send("stop me now");
    assert(await waitBusy(), "the turn never started in the long session");
    await waitText(80);
    await page.click("#btn-send");
    assert(await waitMode("send", 10000), "the stop never completed in the long session");
    await sleep(500);
    const d = await dom();
    assert(d.livePanels === 0, "a panel stayed live in the long session");
    assert(d.failures === 0, "the stop rendered as a failure in the long session");
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("#messages [data-msg]")].map((n) => n.dataset.msg)
    );
    assert(new Set(order).size === order.length, "duplicate message ids after the stop");
    return `${rows} rows before, stop confirmed, ${order.length} rows, no duplicates`;
  });

  console.log("\n============== STOP / RECONCILE / ACTIVITY REPORT 14 ==============");
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(72)} ${r.detail}`);
    r.status === "PASS" ? pass++ : fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
