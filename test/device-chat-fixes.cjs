/* Device suite - the five chat bugs against the real daemon.
 *
 * The web suites prove the logic with deterministic fixtures. This one proves
 * the same things on the phone, against the actual OpenCode runtime: a real
 * model streams, a real interrupt is sent, the real transcript is read back.
 *
 * Usage:  node test/device-chat-fixes.cjs
 * Requires the app installed and running, adb connected.
 */
const { chromium } = require("playwright-core");
const { execFileSync } = require("node:child_process");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADB = process.env.ADB || "C:\\Users\\Shiva\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe";
const CDP = process.env.CDP || "http://127.0.0.1:9228";
const PKG = "com.shivapal.opencodepocket";
const MODEL = { providerID: "opencode", id: "hy4-flash-free" };

const adb = (...a) => {
  try {
    return execFileSync(ADB, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch (e) {
    return "ERR " + String(e.stdout ?? e.message ?? "").slice(0, 140);
  }
};
const appPid = () =>
  adb("shell", `ps -A -o PID,NAME | grep ${PKG} | grep -v grep | awk '{print $1}'`)
    .split(/\s+/)
    .find((x) => /^\d+$/.test(x));

const report = [];
const test = async (name, fn) => {
  try {
    const d = await fn();
    report.push({ name, status: "PASS", detail: d || "" });
  } catch (e) {
    report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 160) });
  }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const attach = async (maxMs = 60000) => {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const pid = appPid();
    if (pid) {
      adb("forward", "--remove", `tcp:${new URL(CDP).port}`);
      adb("forward", `tcp:${new URL(CDP).port}`, `localabstract:webview_devtools_remote_${pid}`);
    }
    try {
      const browser = await chromium.connectOverCDP(CDP);
      let best = null;
      for (const p of browser.contexts()[0].pages().filter((x) => /:80\d\d\/?/.test(x.url()))) {
        try {
          const ok = await p.evaluate(() => !!(window.PocketNative?.isNative?.() && document.querySelector(".session-row, #screen-chat")));
          if (ok) best = p;
        } catch {}
      }
      if (best) return { browser, page: best };
      await browser.close();
    } catch {}
    await sleep(1500);
  }
  throw new Error("could not attach to the app WebView");
};

let page;

/** Direct API calls with the app's own credentials. */
const api = (path, init = {}) =>
  page.evaluate(
    async ({ path, init }) => {
      const cfg = JSON.parse(window.PocketNative.getConfig());
      const res = await fetch(cfg.base + path, {
        ...init,
        headers: {
          authorization: "Basic " + btoa("opencode:" + cfg.secret),
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { status: res.status, body };
    },
    { path, init }
  );

const newSession = async (title) => {
  const created = await api("/api/session", {
    method: "POST",
    body: JSON.stringify({
      location: { directory: "/data/user/0/com.shivapal.opencodepocket/files/opencode-home/workspace" },
      model: MODEL,
    }),
  });
  const sid = created.body?.data?.id;
  assert(sid, "session creation failed: " + JSON.stringify(created.body).slice(0, 120));
  await api("/api/session/" + sid, { method: "PATCH", body: JSON.stringify({ title }) });
  await api("/api/session/" + sid + "/model", { method: "POST", body: JSON.stringify({ model: MODEL }) });
  return sid;
};

const backToList = async () => {
  await page.evaluate(() => {
    const sheet = document.querySelector("#sheet");
    if (sheet && !sheet.hidden) document.querySelector("#sheet-close")?.click();
  });
  await sleep(250);
  if (await page.evaluate(() => !document.querySelector("#screen-chat")?.hidden)) {
    await page.evaluate(() => document.querySelector("#chat-back")?.click());
    await sleep(600);
  }
};

const openSession = async (sid) => {
  // A reload is the honest path: the session was created outside the UI, so the
  // list has to come from the server, not from an in-memory cache. The app
  // restores straight into the last conversation, so return to the list first.
  await page.goto(page.url().split("?")[0], { waitUntil: "domcontentloaded" });
  await sleep(1500);
  await page.evaluate(() => {
    if (!document.querySelector("#screen-chat")?.hidden) document.querySelector("#chat-back")?.click();
  });
  await page.waitForSelector(".session-row", { timeout: 30000 });
  await sleep(800);
  let row = await page.$(`.session-row [data-open="${sid}"]`);
  for (let i = 0; !row && i < 6; i += 1) {
    await page.evaluate(() => document.querySelector("#refresh-sessions")?.click());
    await sleep(1200);
    row = await page.$(`.session-row [data-open="${sid}"]`);
  }
  assert(row, "session not found in the list: " + sid);
  await page.click(`.session-row [data-open="${sid}"]`);
  await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 20000 });
  await sleep(1200);
};

const mode = () => page.evaluate(() => document.querySelector("#btn-send")?.dataset?.mode ?? "");
const waitMode = async (want, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await mode()) === want) return true;
    await sleep(150);
  }
  return false;
};
const liveText = () =>
  page.evaluate(() => {
    const body = [...document.querySelectorAll("#messages .msg-assistant .assistant-body")].pop();
    return body?.innerText ?? "";
  });

const sessionState = async (sid) => {
  const s = await api("/api/session/" + sid);
  return s.body?.data ?? {};
};
const newestAssistant = async (sid) => {
  const r = await api("/api/session/" + sid + "/message?limit=10&order=desc");
  const list = r.body?.data ?? [];
  const a = list.find((m) => m.type === "assistant");
  return {
    message: a ?? null,
    text: (a?.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n\n"),
    idleInterrupted: list.filter((m) => m.type === "idle" && m.outcome === "interrupted").length,
    users: list.filter((m) => m.type === "user").length,
  };
};
const uiState = () =>
  page.evaluate(() => ({
    mode: document.querySelector("#btn-send")?.dataset?.mode ?? "",
    status: document.querySelector("#chat-status")?.hidden ? "" : document.querySelector("#chat-status")?.innerText?.trim() ?? "",
    failures: document.querySelectorAll("#messages .failure").length,
    interrupted: [...document.querySelectorAll("#messages .sys")].filter((n) => /Interrupted|Stopped/.test(n.textContent)).length,
    livePanels: document.querySelectorAll("#messages .activity.live").length,
    runningTools: document.querySelectorAll('#messages .tool-state[data-status="running"]').length,
    interruptedTools: document.querySelectorAll('#messages .tool-state[data-status="interrupted"]').length,
    failedTools: document.querySelectorAll('#messages .tool-state[data-status="error"]').length,
    forms: document.querySelectorAll("#messages .form-card").length,
    jump: document.querySelector("#jump-latest")?.hidden === false,
  }));

(async () => {
  const attached = await attach();
  page = attached.page;
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 200)));

  await test("The installed app is up on the real daemon", async () => {
    const info = await api("/api/info");
    const st = await page.evaluate(() => ({ bridge: !!window.PocketNative?.isNative?.(), banner: document.querySelector("#net-banner")?.hidden }));
    assert(info.status === 200 && info.body?.version, "no daemon: " + info.status);
    assert(st.bridge && st.banner, "socket/bridge not ready");
    return `server ${info.body.version}, bridge up`;
  });

  /* ---- 1. stop a real streaming answer --------------------------------- */
  await test("Real streaming turn -> Stop -> server interruption confirmed", async () => {
    const sid = await newSession("Bugfix: stop streaming");
    await openSession(sid);
    // A model can finish between two samples; the property under test is what a
    // stop does to a *running* turn, so a turn that already ended is retried.
    let aborted = null;
    let streamed = 0;
    for (let attempt = 0; attempt < 2 && !aborted; attempt += 1) {
      await page.fill("#input", "Write a 2500 word guide to streaming systems with headings, tables and TypeScript code blocks. Do not stop early.");
      await page.click("#btn-send");
      assert(await waitMode("stop", 30000), "the turn never started");
      // The property is "a stop on a *running* turn": wait until any text has
      // been painted, and re-check that the turn is still open at that moment.
      // A fixed character count made this depend on how fast the model talks.
      streamed = 0;
      for (let i = 0; i < 240; i += 1) {
        await sleep(250);
        streamed = (await liveText()).length;
        if (streamed > 30) break;
        if ((await mode()) !== "stop") break;
      }
      if ((await mode()) !== "stop") {
        // It completed before the tap: wait for the composer and try again.
        await waitMode("send", 30000);
        continue;
      }
      assert(streamed > 30, "no text streamed: " + streamed);
      const t0 = Date.now();
      await page.click("#btn-send");
      let sawStopping = false;
      for (let i = 0; i < 20; i += 1) {
        const st = await uiState();
        if (/Stopping/i.test(st.status)) sawStopping = true;
        if (st.mode === "send") break;
        await sleep(50);
      }
      const confirmed = await waitMode("send", 20000);
      assert(confirmed, "the real turn never returned to Send");
      await sleep(1200);
      const a = await newestAssistant(sid);
      if (a.message?.error?.type === "aborted") {
        aborted = { ...a, sawStopping, elapsed: Date.now() - t0 };
      }
    }
    assert(aborted, "the server never recorded an aborted step; rows=" + JSON.stringify((await newestAssistant(sid)).message ? "assistant without aborted error" : "no assistant"));
    const s = await sessionState(sid);
    const running = (s.time?.busy ?? 0) > (s.time?.idle ?? 0);
    const ui = await uiState();
    assert(!running, "the daemon still reports the session busy");
    assert(aborted.text.length > 100, "the server lost the partial answer: " + aborted.text.length);
    assert(ui.failures === 0, "the stop rendered as a red failure");
    assert(ui.interrupted >= 1, "no Interrupted row after the real stop");
    assert(ui.livePanels === 0, "a panel is still live");
    assert(ui.mode === "send", "composer is not in Send mode");
    // The last chunk of the server's text must be visible, not just counted.
    const tail = aborted.text.trim().slice(-40).replace(/\s+/g, " ").split(" ").slice(-3).join(" ");
    const shown = await liveText();
    assert(!tail || shown.replace(/\s+/g, " ").includes(tail), `the answer tail "${tail}" is not on screen`);
    return `streamed ${streamed} chars, stopped in ${aborted.elapsed}ms${aborted.sawStopping ? ' (saw "Stopping…")' : ""}, server aborted, ${aborted.text.length} chars kept`;
  });

  /* ---- 2. stop while a real tool runs ---------------------------------- */
  await test("Real tool execution -> Stop -> the tool is finalized, no spinner", async () => {
    const sid = await newSession("Bugfix: stop tool");
    await openSession(sid);
    await page.fill("#input", "Use your shell tool to run exactly this command and wait for it: sleep 25. Do not reply before the command finishes.");
    await page.click("#btn-send");
    assert(await waitMode("stop", 30000), "the turn never started");
    let running = 0;
    for (let i = 0; i < 160; i += 1) {
      running = (await uiState()).runningTools;
      if (running > 0) break;
      await sleep(250);
    }
    assert(running > 0, "the real tool never appeared as running");
    await page.click("#btn-send");
    assert(await waitMode("send", 40000), "the composer never returned to Send");
    await sleep(1500);
    const ui = await uiState();
    const s = await sessionState(sid);
    const a = await newestAssistant(sid);
    assert((s.time?.busy ?? 0) <= (s.time?.idle ?? 0), "the daemon is still busy after the stop");
    assert(ui.runningTools === 0, "a tool spinner survived the real stop (" + ui.runningTools + ")");
    assert(ui.interruptedTools >= 1, "the aborted tool is not shown as stopped");
    assert(ui.failedTools === 0, "the stop rendered a tool as failed (" + ui.failedTools + ")");
    assert(a.error?.type === "aborted" || a.idleInterrupted > 0, "the real turn was not aborted: " + JSON.stringify(a.error));
    assert(ui.failures === 0, "the stop rendered as a failure");
    return `tool was running, stopped -> ${ui.interruptedTools} stopped tool(s), 0 spinners, 0 failed, daemon idle`;
  });

  /* ---- 3. ask question on the real server ------------------------------ */
  await test("Real question form -> answer -> card gone, transcript keeps the question", async () => {
    const sid = await newSession("Bugfix: question");
    await openSession(sid);
    await page.fill("#input", "Use your question tool to ask me exactly one question: which database do you prefer? Do not do anything else.");
    await page.click("#btn-send");
    await page.waitForSelector("#messages .form-card", { timeout: 60000 });
    await sleep(600);
    const before = await uiState();
    assert(before.forms === 1, "pending forms = " + before.forms);
    const field = await page.$("#messages .form-card .form-field input, #messages .form-card .form-field textarea");
    assert(field, "the real form has no input to answer");
    await field.fill("PostgreSQL");
    await page.evaluate(() => document.querySelector("#messages [data-form-submit]")?.click());
    let after = null;
    for (let i = 0; i < 25; i += 1) {
      await sleep(120);
      after = await uiState();
      if (after.forms === 0) break;
    }
    assert(after && after.forms === 0, "the answered real form is still on screen");
    assert(await waitMode("send", 90000), "the follow-up answer never finished");
    await sleep(700);
    const panels = await page.evaluate(() => document.querySelectorAll("#messages .activity").length);
    assert(panels >= 1, "the answered question is not in the turn's activity panel");
    // Reopen: the card must not come back (the server no longer lists it).
    await openSession(sid);
    const reloaded = await uiState();
    assert(reloaded.forms === 0, "the real form came back after reopening the session");
    return `answered on the real daemon, card gone, question kept in ${panels} activity panel(s)`;
  });

  /* ---- 4. activity placement on a real tool turn ------------------------ */
  await test("Real tool turn: user -> one panel -> answer", async () => {
    const sid = await newSession("Bugfix: panel placement");
    await openSession(sid);
    await page.fill("#input", "Read package.json in the workspace with your read tool, then reply with just the number of dependencies. Do not guess.");
    await page.click("#btn-send");
    assert(await waitMode("stop", 30000), "the turn never started");
    assert(await waitMode("send", 120000), "the turn never finished");
    await sleep(900);
    const shape = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#messages > *")];
      const lastUser = rows.map((n, i) => ({ n, i })).filter(({ n }) => n.classList.contains("msg-user")).pop()?.i ?? 0;
      const turn = rows.slice(lastUser);
      return {
        user: lastUser,
        panels: turn.filter((n) => n.classList.contains("activity")).length,
        panel: turn.findIndex((n) => n.classList.contains("activity")),
        tools: turn.find((n) => n.classList.contains("activity"))?.querySelectorAll(".tool-card").length ?? 0,
        answer: turn.findIndex((n) => n.classList.contains("msg-assistant") && n.querySelector(".assistant-body .md")),
        live: document.querySelectorAll("#messages .activity.live").length,
      };
    });
    assert(shape.panels === 1, "panels in the real turn = " + shape.panels);
    assert(shape.panel === 1, `panel at ${shape.panel} (expected right after the user message)`);
    assert(shape.tools >= 1, "no tool card inside the panel");
    assert(shape.answer > shape.panel, `answer at ${shape.answer}, panel at ${shape.panel}`);
    assert(shape.live === 0, "a panel is still live after the turn");
    return `one panel (${shape.tools} tool), between user and answer`;
  });

  /* ---- 5. reading while a real answer streams -------------------------- */
  await test("Real streaming: scrolling up is not yanked", async () => {
    const sid = await newSession("Bugfix: scroll hold");
    await openSession(sid);
    // First build real scrollback: a numbered list is long by construction, so
    // this does not depend on how verbose the model feels today.
    await page.fill("#input", "Print the numbers from 1 to 600, one per line, with no other text.");
    await page.click("#btn-send");
    assert(await waitMode("stop", 30000), "the seed turn never started");
    assert(await waitMode("send", 180000), "the seed turn never finished");
    await sleep(800);
    let room = await page.evaluate(() => {
      const m = document.querySelector("#messages");
      return m.scrollHeight - m.clientHeight;
    });
    assert(room > 1200, "the numbered list did not create scrollback: " + room);

    // Now a long streaming turn, read from the middle of the history.
    await page.fill("#input", "Print the numbers from 1 to 4000, one per line, with no other text.");
    await page.click("#btn-send");
    assert(await waitMode("stop", 30000), "the streaming turn never started");
    for (let i = 0; i < 100; i += 1) {
      if ((await liveText()).length > 300) break;
      await sleep(200);
    }
    await page.evaluate(() => {
      const m = document.querySelector("#messages");
      m.scrollTop = Math.max(0, m.scrollHeight - m.clientHeight - 1200);
    });
    await sleep(300);
    const before = await page.evaluate(() => {
      const node = [...document.querySelectorAll("#messages [data-msg]")].find((n) => n.getBoundingClientRect().bottom > 0);
      return { id: node?.dataset.msg ?? null, top: node ? Math.round(node.getBoundingClientRect().top) : null };
    });
    assert(before.id, "nothing to anchor on");
    await sleep(2200);
    const after = await page.evaluate((id) => {
      const node = document.querySelector(`#messages [data-msg="${CSS.escape(id)}"]`);
      return {
        top: node ? Math.round(node.getBoundingClientRect().top) : null,
        jump: document.querySelector("#jump-latest")?.hidden === false,
        mode: document.querySelector("#btn-send")?.dataset?.mode,
      };
    }, before.id);
    assert(after.top != null, "the anchored message disappeared while streaming");
    assert(Math.abs(after.top - before.top) < 12, `the reader moved ${before.top} -> ${after.top}`);
    assert(after.jump, "jump-to-latest was not offered");
    await page.click("#jump-latest");
    // The answer is still streaming, so the bottom moves; the jump counts as
    // soon as the reader reaches the then-latest message.
    let reached = 0;
    for (let i = 0; i < 25; i += 1) {
      await sleep(80);
      reached = await page.evaluate(() => {
        const m = document.querySelector("#messages");
        return Math.round(m.scrollHeight - m.scrollTop - m.clientHeight);
      });
      if (reached < 200) break;
    }
    assert(reached < 200, "jump-to-latest did not reach the end (" + Math.round(reached) + "px)");
    // Leave the daemon idle for the next suite.
    if ((await mode()) === "stop") {
      await page.click("#btn-send");
      await waitMode("send", 30000);
    }
    return `scrollback ${room}px, anchor stayed within ${Math.abs(after.top - before.top)}px, jump pill worked`;
  });

  console.log("\n=========== DEVICE CHAT FIXES (real daemon) ===========");
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(64)} ${r.detail}`);
    r.status === "PASS" ? pass++ : fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  try { await attached.browser.close(); } catch {}
  process.exitCode = fail ? 1 : 0;
})();
