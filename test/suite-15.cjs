/* Suite 15 - execution liveness after the audit's P0-B.
 *
 * Every case here is written so the old code (session.idle + `time.busy >
 * time.idle`) either fails outright or silently depends on frames the 2.3.0
 * daemon was measured not to send. The demo double no longer emits
 * `session.idle`, and its `/api/session/active` mirrors the real response
 * `{data:{[sessionID]:{type:"running"}}}`.
 *
 * Scenarios 1-13 map to the approved implementation request.
 */
const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

  const report = [];
  const test = async (name, fn) => {
    try {
      const detail = await fn();
      report.push({ name, status: "PASS", detail: detail || "" });
    } catch (e) {
      report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 160) });
    }
  };
  const assert = (c, m) => {
    if (!c) throw new Error(m);
  };

  const fresh = async () => {
    await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".session-row", { timeout: 20000 });
  };
  const openSession = async (id) => {
    await page.evaluate(() => {
      const sheet = document.querySelector("#sheet");
      if (sheet && !sheet.hidden) document.querySelector("#sheet-close")?.click();
    });
    await sleep(150);
    if (await page.evaluate(() => !document.querySelector("#screen-chat")?.hidden)) await goBack();
    await page.click(`.session-row [data-open="${id}"]`);
    await page.waitForSelector("#messages .msg", { timeout: 15000 });
    await sleep(400);
  };
  const goBack = async () => {
    await page.evaluate(() => document.querySelector("#chat-back")?.click());
    await page.waitForSelector(".session-row", { timeout: 10000 });
    await sleep(200);
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
  const waitBusy = (ms = 12000) => waitMode("stop", ms);

  const snapshot = () =>
    page.evaluate(() => {
      const t = window.__pocketTest;
      return {
        busy: t.state.busy,
        phase: t.state.phase,
        activeCalls: t.api.activeCalls,
        activeSet: t.state.activeSessions ? [...t.state.activeSessions] : null,
        idleRows: t.state.messages.filter((m) => m.type === "idle").length,
        busySessions: [...t.api.busySessions],
        sid: t.state.session?.id,
      };
    });
  const textLen = () =>
    page.evaluate(() => {
      const t = window.__pocketTest;
      // lastAssistantId is cleared on a terminal; the transcript is stable.
      const m = t.state.lastAssistantId
        ? t.state.messages.find((x) => x.id === t.state.lastAssistantId)
        : t.state.messages.filter((x) => x.type === "assistant").pop();
      return (m?.content ?? []).filter((p) => p.type === "text").reduce((a, p) => a + (p.text ?? "").length, 0);
    });
  /** Wait for the *current turn's* text, not an older assistant in the thread. */
  const waitText = async (min = 30, ms = 12000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const ok = await page.evaluate((min) => {
        const t = window.__pocketTest;
        const id = t.state.lastAssistantId;
        if (!id) return false;
        const m = t.state.messages.find((x) => x.id === id);
        return (
          (m?.content ?? []).filter((p) => p.type === "text").reduce((a, p) => a + (p.text ?? "").length, 0) >= min
        );
      }, min);
      if (ok) return true;
      await sleep(120);
    }
    return false;
  };
  /** Drop the socket, then let it reconnect and emit `server.connected`. */
  const reconnect = () =>
    page.evaluate(() => {
      const t = window.__pocketTest;
      t.api.dropped = true;
      t.api.dropStream();
      setTimeout(() => t.api.restoreStream(), 60);
    });
  const hookFrames = (type, key) =>
    page.evaluate(
      ({ type, key }) => {
        const t = window.__pocketTest;
        window[key] = 0;
        const original = t.api.emit.bind(t.api);
        t.api.emit = (name, data) => {
          if (name === type) window[key] += 1;
          return original(name, data);
        };
      },
      { type, key }
    );
  const frameCount = (key) => page.evaluate((key) => window[key] ?? 0, key);

  await fresh();

  /* ---- 1: a normal turn settles without session.idle ------------------- */
  await test("1. Normal successful turn settles on execution.succeeded, not session.idle", async () => {
    await openSession("ses_demo1");
    await hookFrames("session.idle", "__idleFrames");
    await send("hello there");
    assert(await waitBusy(), "the turn never started");
    assert(await waitMode("send", 15000), "the composer never returned to Send");
    const s = await snapshot();
    assert((await frameCount("__idleFrames")) === 0, "the mock sent a session.idle frame");
    assert(s.busy === false, "state.busy is still true");
    assert(s.idleRows >= 1, "no projected idle row in the transcript");
    return `Send, no idle frames, ${s.idleRows} idle row(s)`;
  });

  /* ---- 2: a failed execution ------------------------------------------- */
  await test("2. Failed execution returns to Send", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("fail please");
    assert(await waitBusy(), "the turn never started");
    assert(await waitMode("send", 15000), "the composer stayed in Stop after execution.failed");
    const failures = await page.evaluate(() => document.querySelectorAll("#messages .failure").length);
    assert(failures > 0, "the failure was not rendered");
    return `Send after execution.failed, ${failures} failure card(s)`;
  });

  /* ---- 3: user interrupt ----------------------------------------------- */
  await test("3. User interrupt returns to Send on the execution terminal", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    assert(await waitText(30), "nothing streamed before the stop");
    await page.click("#btn-send");
    assert(await waitMode("send", 12000), "the composer stayed in Stop after execution.interrupted");
    const calls = await page.evaluate(() => window.__pocketTest.api.interruptCalls);
    assert(calls === 1, "interrupt calls: " + calls);
    return `interrupted once, Send`;
  });

  /* ---- 4: partial response kept ---------------------------------------- */
  await test("4. A partial response is kept on an interrupted turn", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    assert(await waitText(120), "no partial answer streamed before the stop");
    await page.click("#btn-send");
    assert(await waitMode("send", 12000), "no terminal after the stop");
    let kept = 0;
    const settle = Date.now() + 4000;
    while (Date.now() < settle && kept < 120) {
      kept = await textLen();
      if (kept < 120) await sleep(150);
    }
    assert(kept >= 120, "the partial answer was discarded: " + kept);
    return `${kept} chars of partial answer kept`;
  });

  /* ---- 5: reconnect while the execution is still active ---------------- */
  await test("5. Reconnect while execution is active keeps the composer in Stop", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    assert(await waitText(30), "nothing streamed before the reconnect");
    const before = await snapshot();
    await reconnect();
    await sleep(1200);
    const after = await snapshot();
    assert((await mode()) === "stop", "a reconnect wrongly released an active turn");
    assert(after.activeCalls > before.activeCalls, "no active snapshot was fetched on reconnect");
    assert(after.activeSet?.includes(after.sid), "the running set does not contain the session");
    return `snapshot ${before.activeCalls} -> ${after.activeCalls}, still Stop`;
  });

  /* ---- 6: missed terminal with a dead process (the timestamp trap) ----- */
  await test("6. Reconnect after a missed terminal settles a stale busy state", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    // The daemon is gone: no drain owns the session, no terminal event is
    // coming, but `time.busy > time.idle` still says "running".
    await page.evaluate(() => {
      const t = window.__pocketTest;
      const sid = t.state.session.id;
      t.api.clearTimers();
      t.api.busySessions.delete(sid);
      t.api.staleBusy.add(sid);
    });
    const stale = await page.evaluate(async () => {
      const t = window.__pocketTest;
      const s = (await t.api.getSession(t.state.session.id)).data;
      return (s.time?.busy ?? 0) > (s.time?.idle ?? 0);
    });
    assert(stale, "the fixture no longer reproduces busy > idle");
    await reconnect();
    assert(await waitMode("send", 8000), "the stale turn was never settled after reconnect");
    const after = await snapshot();
    assert(after.activeSet?.length === 0, "the running set was not empty");
    return "timestamps said running, running set said idle -> Send";
  });

  /* ---- 7: duplicate terminal event ------------------------------------- */
  await test("7. A duplicated terminal event is deduplicated by event id", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("hello there");
    assert(await waitBusy(), "the turn never started");
    assert(await waitMode("send", 15000), "the turn never settled");
    await sleep(600); // let the terminal's transcript reload land before counting rows
    const before = await snapshot();
    await page.evaluate(() => {
      const t = window.__pocketTest;
      const sid = t.state.session.id;
      t.api.emitWith("evt_dup_terminal_test", "session.execution.succeeded", { sessionID: sid });
      t.api.emitWith("evt_dup_terminal_test", "session.execution.succeeded", { sessionID: sid });
    });
    await sleep(500);
    const after = await snapshot();
    assert((await mode()) === "send", "a replay reopened the turn");
    assert(after.idleRows === before.idleRows, "a replay duplicated the idle row");
    assert(errors.length === 0, "page errors: " + errors.join("; "));
    return `idle rows ${before.idleRows} -> ${after.idleRows}, no replay`;
  });

  /* ---- 8: late event after a newer terminal ---------------------------- */
  await test("8. A late execution.started after a stopped turn cannot reopen it", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    await page.click("#btn-send");
    assert(await waitMode("send", 12000), "the stop never settled");
    await page.evaluate(() => {
      const t = window.__pocketTest;
      t.api.emit("session.execution.started", { sessionID: t.state.session.id });
      t.api.emit("session.step.started", { sessionID: t.state.session.id, assistantMessageID: "msg_late", started: Date.now() });
    });
    await sleep(700);
    assert((await mode()) === "send", "a late wind-down event reopened the composer");
    return "late started/step ignored, still Send";
  });

  /* ---- 9: snapshot says active while the UI thinks idle ---------------- */
  await test("9. An active snapshot promotes a stale idle composer to Stop", async () => {
    await fresh();
    await openSession("ses_demo2");
    assert((await mode()) === "send", "the session opened in Stop mode");
    await page.evaluate(() => {
      const t = window.__pocketTest;
      t.api.busySessions.add(t.state.session.id);
    });
    await reconnect();
    assert(await waitMode("stop", 8000), "the snapshot was ignored");
    const after = await snapshot();
    assert(after.activeSet?.includes(after.sid), "the running set was not stored");
    return "idle -> Stop from /api/session/active";
  });

  /* ---- 10: snapshot says no active ------------------------------------- */
  await test("10. An empty snapshot returns a busy composer to Send", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    await page.evaluate(() => {
      const t = window.__pocketTest;
      t.api.clearTimers();
      t.api.busySessions.delete(t.state.session.id);
    });
    assert((await mode()) === "stop", "the turn ended before the test");
    await reconnect();
    assert(await waitMode("send", 8000), "an empty running set did not settle the composer");
    const after = await snapshot();
    assert(after.activeSet?.length === 0, "running set was not empty");
    return "active -> Send from an empty running set";
  });

  /* ---- 11: snapshot request fails -------------------------------------- */
  await test("11. A failed snapshot request keeps event-established state", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    const before = await snapshot();
    await page.evaluate(() => {
      window.__pocketTest.api.activeFails = true;
    });
    await reconnect();
    await sleep(1500);
    const after = await snapshot();
    assert((await mode()) === "stop", "a failed lookup cleared a live turn");
    assert(after.activeCalls > before.activeCalls, "the lookup was not attempted");
    assert(errors.length === 0, "page errors: " + errors.join("; "));
    await page.evaluate(() => {
      window.__pocketTest.api.activeFails = false;
    });
    return `lookup failed ${after.activeCalls - before.activeCalls}x, still Stop`;
  });

  /* ---- 12: multiple sessions and switching ----------------------------- */
  await test("12. Switching sessions uses each session's own liveness", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    await goBack();
    await openSession("ses_demo2");
    assert((await mode()) === "send", "the other session inherited Stop");
    await goBack();
    await openSession("ses_demo1");
    assert(await waitMode("stop", 8000), "switching back lost the running turn");
    const s = await snapshot();
    assert(s.busySessions.includes("ses_demo1"), "the server is no longer running the first session");
    return "A running, B idle, back to A still running";
  });

  /* ---- 13: text ended before a delayed terminal ------------------------ */
  await test("13. A streaming answer stays live until its terminal arrives", async () => {
    await fresh();
    await openSession("ses_demo1");
    await hookFrames("session.text.ended", "__endedFrames");
    await send("delayed completion please");
    assert(await waitBusy(), "the turn never started");
    const end = Date.now() + 12000;
    while (Date.now() < end && (await frameCount("__endedFrames")) === 0) await sleep(120);
    assert((await frameCount("__endedFrames")) > 0, "text.ended never arrived");
    assert((await mode()) === "stop", "text.ended alone released the composer");
    assert(await waitMode("send", 12000), "the delayed terminal never settled the turn");
    return "text.ended kept Stop; execution.succeeded settled it";
  });

  /* ---- 14: a steered correction survives Stop (Fix A) ------------------- */
  await test("14. A prompt steered into a stopped turn is promoted exactly once", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the first turn never started");
    assert(await waitText(60), "the first turn never streamed");
    // Default delivery is "steer": the server admits this into the inbox.
    await send("steer then stop please");
    // A steer joins the running turn, so the app keeps it in `state.inbox`
    // without showing the queue chip (that chip is for queued prompts).
    let parkedUi = 0;
    for (let i = 0; i < 20 && parkedUi === 0; i += 1) {
      parkedUi = await page.evaluate(() => window.__pocketTest.state.inbox.length);
      if (!parkedUi) await sleep(100);
    }
    assert(parkedUi === 1, "the steer was not admitted to the inbox: " + parkedUi);
    const parked = await page.evaluate(() => window.__pocketTest.api.steers.get(window.__pocketTest.state.session.id)?.length ?? 0);
    assert(parked === 1, "the server double did not park the steer: " + parked);
    await page.click("#btn-send"); // stop with an empty composer
    assert(await waitMode("send", 15000), "the stopped turn never settled");
    // The promoted steer runs its own short turn after the stop.
    const end = Date.now() + 12000;
    let resumed = false;
    while (Date.now() < end) {
      resumed = await page.evaluate(() => {
        const t = window.__pocketTest;
        return (t.state.messages ?? []).some((m) => (m.content ?? []).some((p) => /Resumed after the stop/.test(p.text ?? "")));
      });
      if (resumed) break;
      await sleep(150);
    }
    const result = await page.evaluate(() => {
      const t = window.__pocketTest;
      const all = t.state.messages ?? [];
      return {
        resume: t.api.lastInterruptResume,
        calls: t.api.interruptCalls,
        prompts: [...document.querySelectorAll("#messages .msg-user")].filter((n) =>
          /steer then stop please/.test(n.innerText ?? "")
        ).length,
        parked: t.api.steers.get(t.state.session.id)?.length ?? 0,
      };
    });
    assert(result.resume === true, "the client did not ask the server to resume");
    assert(result.calls === 1, "the stop was sent more than once: " + result.calls);
    assert(result.prompts === 1, "the steered prompt appeared " + result.prompts + " times");
    assert(resumed, "the steered prompt was never promoted after the stop");
    return `resume=true, one interrupt, steer ran once`;
  });

  /* ---- 15: offline Stop stays honest ------------------------------------ */
  await test("15. A stop made offline stays pending until the connection returns", async () => {
    await fresh();
    await openSession("ses_demo1");
    await send("stop me now");
    assert(await waitBusy(), "the turn never started");
    await waitText(60);
    await page.evaluate(() => {
      window.__pocketTest.state.online = false;
    });
    await page.click("#btn-send");
    await sleep(400);
    const offline = await page.evaluate(() => {
      const t = window.__pocketTest;
      return {
        pending: t.state.stopPending,
        phase: t.state.phase,
        calls: t.api.interruptCalls,
        status: document.querySelector("#chat-status")?.innerText ?? "",
      };
    });
    assert(offline.pending === true, "offline stop was not remembered");
    assert(offline.phase === "stopping", "the turn was not shown as stopping: " + offline.phase);
    assert(/Stopping/i.test(offline.status), "the status did not say Stopping: " + offline.status);
    assert(offline.calls === 0, "an offline stop reached the server");
    assert(!/Stopped/i.test(offline.status), "the UI claimed Stopped while offline");
    await page.evaluate(() => {
      window.__pocketTest.state.online = true;
    });
    await reconnect();
    await sleep(1000);
    const retried = await page.evaluate(() => window.__pocketTest.api.interruptCalls);
    assert(retried === 1, "the pending stop was not retried: " + retried);
    return `pending while offline, retried once on reconnect`;
  });

  await browser.close();
  const passed = report.filter((entry) => entry.status === "PASS").length;
  const failed = report.length - passed;
  for (const entry of report) {
    console.log(`${entry.status === "PASS" ? "PASS" : "FAIL"}  ${entry.name}${entry.detail ? "  -  " + entry.detail : ""}`);
  }
  console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error("SUITE CRASHED:", error);
  process.exitCode = 1;
});
