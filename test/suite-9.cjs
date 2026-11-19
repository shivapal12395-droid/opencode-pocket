/* Suite 9 - the chat window end to end.
 *
 * Written after a real session where the work had happened but the transcript
 * showed none of it and the answer carried no icons. The transcript renders in
 * two passes (one to collect a turn's steps, one to draw them) and the two used
 * to disagree about which turn a message belonged to whenever the loaded window
 * started mid-turn - which is the normal case, because the API returns the last
 * N messages. ses_demo9 keeps that shape so it cannot regress again.
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
  const test = async (name, fn) => { try { const d = await fn(); report.push({ name, status: "PASS", detail: d || "" }); } catch (e) { report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 110) }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  const openSession = async (id) => {
    await page.evaluate(() => document.querySelector("#sheet-close")?.click());
    await sleep(300);
    const inChat = await page.evaluate(() => !document.querySelector("#screen-chat")?.hidden);
    if (inChat) { await page.evaluate(() => document.querySelector("#chat-back")?.click()); await sleep(450); }
    await page.click(`.session-row [data-open="${id}"]`);
    await page.waitForSelector(".msg", { timeout: 8000 });
    await sleep(700);
  };

  const transcript = () =>
    page.evaluate(() =>
      // Direct children, in order: a turn's activity panel is a row of its own
      // between the user message and the answer, not a child of a message.
      [...document.querySelectorAll("#messages > *")].map((n) => ({
        kind: n.classList.contains("activity") ? "panel" : n.classList.contains("msg") ? "msg" : "other",
        stepOnly: n.classList.contains("step-only"),
        msg: n.dataset.msg ?? "-",
        panels: n.querySelectorAll(".activity").length,
        panelHead: (n.querySelector(".activity-head")?.innerText ?? "").replace(/\s+/g, " ").trim(),
        actionButtons: n.querySelectorAll(".msg-actions button").length,
        usage: n.querySelectorAll(".usage-line").length,
        sys: n.querySelector(".sys")?.innerText?.trim() ?? null,
      }))
    );

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  await test("A window that opens mid-turn keeps every turn's work", async () => {
    await openSession("ses_demo9");
    const rows = await transcript();
    const panels = rows.filter((r) => r.kind === "panel");
    assert(panels.length === 2, `panels=${panels.length} rows=${JSON.stringify(rows.map((r) => [r.msg, r.kind]))}`);
    const iUser = rows.findIndex((r) => r.msg === "msg_d9u");
    const iAnswer = rows.findIndex((r) => r.msg === "msg_d9an");
    assert(iUser > 0 && iAnswer > iUser, "the window is missing its user/answer rows");
    // the leading run belongs to a request whose user message is not loaded,
    // so its panel leads the transcript
    assert(rows.indexOf(panels[0]) < iUser, "the cut-off turn's panel is not first");
    // the loaded turn's panel sits between its user message and its answer
    assert(rows.indexOf(panels[1]) > iUser && rows.indexOf(panels[1]) < iAnswer, `turn panel at ${rows.indexOf(panels[1])}, user ${iUser}, answer ${iAnswer}`);
    return `pre-user panel ("${panels[0].panelHead}"), turn panel ("${panels[1].panelHead}") between user and answer`;
  });

  await test("Exactly one activity panel per user request", async () => {
    const rows = await transcript();
    const users = rows.filter((r) => r.msg.startsWith("msg_d9u")).length;
    const panels = rows.filter((r) => r.kind === "panel").length;
    // two requests in the window: the cut-off one and the loaded one
    assert(users === 1 && panels === 2, `users=${users} panels=${panels}`);
    const heads = rows.filter((r) => r.panelHead).map((r) => r.panelHead);
    assert(heads.every((h) => /step/.test(h)), JSON.stringify(heads));
    return heads.join(" | ");
  });

  await test("A step that only ran tools never becomes its own message", async () => {
    const rows = await transcript();
    const stepOnly = rows.filter((r) => r.stepOnly);
    assert(stepOnly.length === 0, "tool-only rows still rendered: " + JSON.stringify(stepOnly.map((r) => r.msg)));
    const cards = await page.evaluate(() => ({
      total: document.querySelectorAll("#messages .tool-card").length,
      insidePanel: document.querySelectorAll("#messages .activity .tool-card").length,
    }));
    assert(cards.total > 0, "no tool cards at all");
    assert(cards.total === cards.insidePanel, `${cards.total - cards.insidePanel} tool cards live outside a panel`);
    const strays = rows.filter((r) => r.kind === "other");
    assert(strays.length === 0, "stray rows: " + JSON.stringify(strays.map((r) => r.msg)));
    return `${cards.total} tool cards, all inside the turn panels; 0 step-only rows`;
  });

  await test("Only the answer of a turn carries the icons and the token line", async () => {
    const rows = await transcript();
    const answer = rows.find((r) => r.msg === "msg_d9an");
    assert(answer, "the answer row is missing");
    assert(answer.actionButtons === 3, `answer buttons=${answer.actionButtons}`);
    assert(answer.usage === 1, `usage lines on the answer=${answer.usage}`);
    const noisy = rows.filter((r) => r.msg !== "msg_d9an" && !r.msg.startsWith("msg_d9u") && r.actionButtons > 0);
    assert(noisy.length === 0, "actions leaked onto " + JSON.stringify(noisy.map((r) => r.msg)));
    const usages = rows.reduce((n, r) => n + r.usage, 0);
    assert(usages === 1, `usage lines in the window=${usages}`);
    return `answer has ${answer.actionButtons} actions, 1 token line; no step carries either`;
  });

  await test("The compaction divider is drawn once, in place", async () => {
    const rows = await transcript();
    const dividers = rows.filter((r) => r.sys && /compacted/i.test(r.sys));
    assert(dividers.length === 1, "dividers=" + dividers.length);
    const order = rows.map((r) => r.msg);
    assert(order.indexOf("msg_d9c") === -1 || order.indexOf("msg_d9c") === -1, "compaction rendered as a message");
    return dividers[0].sys;
  });

  await test("Copy on the answer uses the answer text", async () => {
    await page.click('#messages .msg[data-msg="msg_d9an"] [data-act="copy-msg"]');
    await sleep(400);
    const toastText = await page.evaluate(() => document.querySelector("#toast")?.textContent?.trim() ?? "");
    assert(/copied/i.test(toastText), "toast=" + toastText);
    return toastText;
  });

  await test("More actions opens a real menu for that answer", async () => {
    await page.click('#messages .msg[data-msg="msg_d9an"] [data-act="more-msg"]');
    await sleep(600);
    const menu = await page.evaluate(() => ({
      title: document.querySelector("#sheet-title")?.textContent?.trim() ?? "",
      rows: [...document.querySelectorAll("#sheet-body .sheet-item .si-title")].map((n) => n.textContent.trim()),
    }));
    assert(menu.rows.length >= 2, "menu rows=" + JSON.stringify(menu.rows));
    await page.evaluate(() => document.querySelector("#sheet-close")?.click());
    await sleep(400);
    return `${menu.rows.length} entries: ${menu.rows.slice(0, 3).join(", ")}`;
  });

  await test("Reopening the session rebuilds the same transcript", async () => {
    const before = await transcript();
    await openSession("ses_demo1");
    await openSession("ses_demo9");
    const after = await transcript();
    const shape = (rows) => rows.map((r) => `${r.msg}:${r.panels}:${r.actionButtons}:${r.usage}`).join("|");
    assert(shape(before) === shape(after), `before=${shape(before)} after=${shape(after)}`);
    return `${after.length} rows identical across a session switch`;
  });

  await test("A live turn reports itself once, then hands over to the answer", async () => {
    // "multi-step" is the demo's scripted multi-step turn: reasoning + tools in
    // two assistant messages, emitted step by step, which is the shape a real
    // turn has. The panel must say Working while it runs, and must not put the
    // icons on an intermediate step.
    await openSession("ses_demo1");
    await page.fill("#input", "multi-step change please");
    await page.click("#btn-send");
    await sleep(900);
    const readLive = () =>
      page.evaluate(() => {
        const heads = [...document.querySelectorAll("#messages .activity-head")].map((n) => n.innerText.replace(/\s+/g, " ").trim());
        const rows = [...document.querySelectorAll("#messages .msg")];
        const last = rows[rows.length - 1];
        return {
          heads,
          lastHead: heads[heads.length - 1] ?? "",
          mode: document.querySelector("#btn-send")?.getAttribute("aria-label") ?? "",
          lastRowActions: last?.querySelectorAll(".msg-actions button").length ?? 0,
          lastRowLive: /Working/.test(heads[heads.length - 1] ?? ""),
        };
      });
    // A fresh turn has no steps yet: wait for the first one instead of sampling
    // a frame where the previous turn's panel is still the newest on screen.
    const samples = [];
    let live = { heads: [], lastHead: "", mode: "", lastRowActions: 0 };
    for (let i = 0; i < 24; i++) {
      await sleep(400);
      live = await readLive();
      samples.push(`${live.mode}|${live.lastHead}|a${live.lastRowActions}`);
      if (/^Working/.test(live.lastHead)) break;
      if (live.mode !== "Stop") break;
    }
    const working = samples.filter((s) => /^Stop\|Working/.test(s));
    assert(working.length >= 1, "no working panel while running: " + JSON.stringify(samples.slice(0, 8)));
    // While the turn runs: never a finished duration, never the icons.
    const flashed = samples.filter((s) => /^Stop\|\s*(Worked|Worked ·)/.test(s));
    assert(flashed.length === 0, "a running turn flashed a finished panel: " + JSON.stringify(flashed));
    const iconsWhileRunning = samples.filter((s) => /^Stop\|/.test(s) && !/\|a0$/.test(s) && /Working/.test(s));
    assert(iconsWhileRunning.length === 0, "icons appeared on an intermediate step: " + JSON.stringify(iconsWhileRunning));
    for (let i = 0; i < 40; i++) { await sleep(700); if (await page.evaluate(() => document.querySelector("#btn-stop")?.hidden)) break; }
    const done = await page.evaluate(() => {
      const heads = [...document.querySelectorAll("#messages .activity-head")];
      return {
        panels: heads.length,
        head: (heads[heads.length - 1]?.innerText ?? "").replace(/\s+/g, " ").trim(),
        used: document.querySelectorAll("#messages .usage-line").length,
        lastActions: document.querySelectorAll('#messages .msg:last-child .msg-actions button').length,
        stillWorking: heads.filter((n) => /^Working/.test(n.innerText)).length,
      };
    });
    assert(done.panels >= 1, "panel vanished after the turn");
    assert(/^Worked for/.test(done.head), "finished head=" + done.head);
    assert(done.stillWorking === 0, "a panel still says Working after the run");
    assert(done.used >= 1, "no token line after the turn");
    assert(done.lastActions === 3, `last row buttons=${done.lastActions}`);
    return `live "${working[0]}" -> "${done.head}", 3 icons`;  });

  await test("Opening a conversation clears its unread dot", async () => {
    // The server tracks `time.viewed`; opening a session is what advances it.
    // The client's viewSession used to send a boolean, which the route rejects
    // with a 400, so a conversation stayed unread forever.
    await page.evaluate(() => document.querySelector("#sheet-close")?.click());
    await sleep(300);
    await page.evaluate(() => document.querySelector("#chat-back")?.click());
    await sleep(700);
    const before = await page.evaluate(() => document.querySelector(".session-row.unread")?.dataset?.id ?? null);
    assert(before, "no unread row to open");
    await page.click(`.session-row[data-id="${before}"] [data-open]`);
    await page.waitForSelector(".msg", { timeout: 8000 });
    await sleep(800);
    await page.evaluate(() => document.querySelector("#chat-back")?.click());
    await sleep(800);
    const stillUnread = await page.evaluate((id) => !!document.querySelector(`.session-row.unread[data-id="${id}"]`), before);
    assert(!stillUnread, `${before} is still unread after being opened`);
    return `${before} cleared`;
  });

  await test("Scroll position survives a refresh mid-transcript", async () => {
    await openSession("ses_demo9");
    await page.evaluate(() => { const m = document.querySelector("#messages"); m.scrollTop = Math.round(m.scrollHeight / 3); });
    await sleep(300);
    const before = await page.evaluate(() => Math.round(document.querySelector("#messages").scrollTop));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await sleep(600);
    const after = await page.evaluate(() => Math.round(document.querySelector("#messages").scrollTop));
    assert(Math.abs(after - before) < 40 || after > before, `scroll moved ${before} -> ${after}`);
    return `stayed within ${Math.abs(after - before)}px`;
  });

  console.log("\n================ FEATURE TEST REPORT 9 ================");
  let pass = 0, fail = 0;
  for (const r of report) { console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(52)} ${r.detail}`); r.status === "PASS" ? pass++ : fail++; }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
