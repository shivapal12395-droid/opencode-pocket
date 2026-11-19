/* Suite 18 - structured prompt attachments (official OpenCode parity).
 *
 * The 2.3.0 prompt endpoint accepts files[], agents[], skills[] and metadata.
 * Pocket used to send {text, files(images), delivery}, so @file mentions were
 * plain text and skills/agents were never attached to the turn. These checks
 * capture the real payload the app sends and assert each field.
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
      report.push({ name, status: "PASS", detail: (await fn()) || "" });
    } catch (e) {
      report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 170) });
    }
  };
  const assert = (c, m) => {
    if (!c) throw new Error(m);
  };

  const fresh = async () => {
    await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".session-row", { timeout: 20000 });
  };
  const openSession = async () => {
    await page.click('.session-row [data-open="ses_demo1"]');
    await page.waitForSelector("#messages .msg", { timeout: 15000 });
    await sleep(350);
  };
  const capture = () =>
    page.evaluate(() => {
      window.__calls = [];
      const t = window.__pocketTest;
      const original = t.api.prompt.bind(t.api);
      t.api.prompt = (id, body) => {
        window.__calls.push({ id, body });
        return original(id, body);
      };
    });
  const calls = () => page.evaluate(() => window.__calls ?? []);
  const lastCall = async () => (await calls()).at(-1);
  const waitSend = () =>
    page.waitForFunction(() => document.querySelector("#btn-send")?.dataset?.mode === "send", { timeout: 20000 });
  /** Typing `@` opens the mention picker by design; dismiss it before Send. */
  const closeAnySheet = async () => {
    if (await page.evaluate(() => !document.querySelector("#sheet")?.hidden)) {
      await page.click("#sheet-close").catch(() => {});
      await sleep(200);
    }
  };
  const send = async (text) => {
    await page.fill("#input", text);
    await closeAnySheet();
    await page.click("#btn-send");
    await waitSend();
    await sleep(300);
  };

  await fresh();
  await openSession();
  await capture();

  await test("1. Mention sheet offers Files, Agents and Skills", async () => {
    await page.click("#btn-mention");
    await page.waitForSelector("#sheet:not([hidden]) .mention-tabs", { timeout: 5000 });
    const tabs = await page.$$eval(".mention-tabs [data-mkind]", (n) => n.map((x) => x.textContent.trim()));
    assert(tabs.join(",") === "Files,Agents,Skills", "tabs: " + tabs.join(","));
    await page.click('.mention-tabs [data-mkind="agent"]');
    await page.waitForSelector('[data-mention-kind="agent"]', { timeout: 8000 });
    const agents = await page.$$eval('[data-mention-kind="agent"]', (n) => n.length);
    await page.click('.mention-tabs [data-mkind="skill"]');
    await page.waitForSelector('[data-mention-kind="skill"]', { timeout: 8000 });
    const skills = await page.$$eval('[data-mention-kind="skill"]', (n) => n.length);
    assert(agents > 0 && skills >= 0, `agents=${agents} skills=${skills}`);
    return `${tabs.join(" / ")}; ${agents} agents`;
  });

  await test("2. A file mention is sent as a structured file with its range", async () => {
    await page.click('.mention-tabs [data-mkind="file"]');
    await page.waitForSelector('[data-mention-kind="file"]', { timeout: 10000 });
    const picked = await page.$eval('[data-mention-kind="file"]', (n) => n.dataset.mentionKey);
    await page.click('[data-mention-kind="file"]');
    await page.waitForSelector("#sheet", { state: "hidden", timeout: 5000 }).catch(() => {});
    const value = await page.inputValue("#input");
    assert(value.startsWith("@" + picked), "draft: " + value.slice(0, 60));
    await send(value.trim());
    const call = await lastCall();
    assert(call, "no prompt was sent");
    const file = (call.body.files ?? []).find((f) => f.mention);
    assert(file, "no structured file in payload");
    assert(file.uri.startsWith("file://"), "uri: " + file.uri);
    assert(file.uri.includes(picked.split("/").pop()), "uri does not name the file: " + file.uri);
    const text = call.body.text;
    assert(text.slice(file.mention.start, file.mention.end) === file.mention.text, "range does not match the text");
    assert(file.mention.text === "@" + picked, "mention text: " + file.mention.text);
    return `${picked} -> file://… (${file.mention.start}-${file.mention.end})`;
  });

  await test("3. An agent mention is sent in agents[]", async () => {
    await page.click("#btn-mention");
    await page.click('.mention-tabs [data-mkind="agent"]');
    await page.waitForSelector('[data-mention-kind="agent"]', { timeout: 8000 });
    const name = await page.$eval('[data-mention-kind="agent"]', (n) => n.dataset.mentionKey);
    await page.click('[data-mention-kind="agent"]');
    await sleep(250);
    await send((await page.inputValue("#input")).trim());
    const call = await lastCall();
    assert(call, "no prompt was sent");
    assert(Array.isArray(call.body.agents) && call.body.agents[0]?.name === name, JSON.stringify(call.body.agents));
    assert(call.body.agents[0].mention?.text === "@" + name, "agent mention text");
    assert(call.body.metadata?.agent, "metadata.agent missing");
    assert(call.body.metadata?.model?.id, "metadata.model missing");
    return `agents=[${name}] + metadata.agent/model`;
  });

  await test("4. A skill mention is sent in skills[]", async () => {
    await page.click("#btn-mention");
    await page.click('.mention-tabs [data-mkind="skill"]');
    await page.waitForSelector('[data-mention-kind="skill"]', { timeout: 8000 });
    const id = await page.$eval('[data-mention-kind="skill"]', (n) => n.dataset.mentionKey);
    await page.click('[data-mention-kind="skill"]');
    await sleep(250);
    await send((await page.inputValue("#input")).trim());
    const call = await lastCall();
    assert(call, "no prompt was sent");
    assert(Array.isArray(call.body.skills) && call.body.skills[0]?.id === id, JSON.stringify(call.body.skills));
    return `skills=[${id}]`;
  });

  await test("5. Editing before a mention keeps the range correct", async () => {
    await page.click("#btn-mention");
    await page.waitForSelector('[data-mention-kind="file"]', { timeout: 10000 });
    const picked = await page.$eval('[data-mention-kind="file"]', (n) => n.dataset.mentionKey);
    await page.click('[data-mention-kind="file"]');
    await sleep(200);
    const draft = await page.inputValue("#input");
    const edited = "please look at this: " + draft;
    await page.fill("#input", edited);
    await send(edited.trim());
    const call = await lastCall();
    const file = (call.body.files ?? []).find((f) => f.mention);
    assert(file, "mention lost after editing");
    assert(call.body.text.slice(file.mention.start, file.mention.end) === "@" + picked, "range drifted");
    return `offset ${file.mention.start} still points at @${picked}`;
  });

  await test("6. Standing instructions travel as an attachment", async () => {
    await page.click("#chat-back");
    await page.waitForSelector("#open-settings", { timeout: 5000 });
    await page.click("#open-settings");
    await page.waitForSelector("#open-prompt-instructions", { timeout: 5000 });
    await page.click("#open-prompt-instructions");
    await page.waitForSelector("#instructions-text", { timeout: 5000 });
    await page.fill("#instructions-text", "Always answer in short bullets.");
    await page.click("#instructions-save");
    await sleep(300);
    await closeAnySheet();
    await openSession();
    await capture();
    await send("hello from suite 18");
    const call = await lastCall();
    assert(call, "no prompt was sent");
    const note = (call.body.files ?? []).find((f) => f.name === "pocket-instructions.txt");
    assert(note, "instructions attachment missing");
    assert(note.uri.startsWith("data:text/plain;base64,"), "uri: " + note.uri.slice(0, 40));
    return "pocket-instructions.txt attached";
  });

  await test("7. Library artifact attaches to the next prompt", async () => {
    await page.click("#chat-back");
    await page.waitForSelector(".session-row", { timeout: 5000 });
    await page.click('.session-row [data-open="ses_demo7"]');
    await page.waitForSelector("#messages .msg", { timeout: 10000 });
    await sleep(500);
    const artifacts = await page.evaluate(() => (window.__pocketTest.state.artifacts ?? []).length);
    assert(artifacts > 0, "no artifacts were detected");
    // In chat the drawer toggle is #chat-sidebar; #open-sidebar is the sessions header.
    await page.click("#chat-sidebar");
    await page.waitForSelector('#sidebar [data-side="library"]', { timeout: 5000 });
    await page.click('#sidebar [data-side="library"]');
    await page.waitForSelector("[data-lib-attach]", { timeout: 5000 });
    await page.click("[data-lib-attach]");
    await sleep(400);
    const attached = await page.evaluate(() => (window.__pocketTest.state.attachments ?? []).map((a) => ({ name: a.name, uri: (a.uri || "").slice(0, 30) })));
    assert(attached.length === 1, "attachment count: " + attached.length);
    assert(attached[0].uri.startsWith("data:"), "artifact uri: " + attached[0].uri);
    await capture();
    await send("use the attached artifact");
    const call = await lastCall();
    const art = (call.body.files ?? []).find((f) => f.name === attached[0].name);
    assert(art, "artifact attachment missing from the prompt");
    return `${attached[0].name} sent as data URL`;
  });

  await test("8. Switching sessions clears draft mentions", async () => {
    await page.click("#btn-mention");
    await page.waitForSelector('[data-mention-kind="file"]', { timeout: 10000 });
    await page.click('[data-mention-kind="file"]');
    await sleep(200);
    const before = await page.evaluate(() => window.__pocketTest.state.mentions.length);
    assert(before > 0, "no mentions recorded");
    await page.click("#chat-back");
    await page.click('.session-row [data-open="ses_demo2"]');
    await page.waitForSelector("#messages .msg", { timeout: 10000 });
    const after = await page.evaluate(() => window.__pocketTest.state.mentions.length);
    assert(after === 0, "mentions survived the session switch: " + after);
    return "cleared on switch";
  });

  await test("10. File picker falls back to /api/fs/list when find fails", async () => {
    await page.click("#chat-back");
    await page.waitForSelector(".session-row", { timeout: 5000 });
    await page.click('.session-row [data-open="ses_demo1"]');
    await page.waitForSelector("#messages .msg", { timeout: 10000 });
    await page.evaluate(() => {
      const t = window.__pocketTest;
      t.__find = t.api.findFiles;
      t.api.findFiles = () => Promise.reject(Object.assign(new Error("Internal Server Error"), { status: 500 }));
    });
    await page.click("#btn-mention");
    await page.waitForSelector('[data-mention-kind="file"]', { timeout: 8000 });
    const rows = await page.$$eval('[data-mention-kind="file"]', (n) => n.map((x) => x.dataset.mentionKey));
    await page.evaluate(() => {
      window.__pocketTest.api.findFiles = window.__pocketTest.__find;
    });
    assert(rows.length > 0, "fallback listed nothing");
    return `${rows.length} files via listDir (${rows.slice(0, 2).join(", ")})`;
  });

  await test("9. No page errors", async () => {
    assert(errors.length === 0, errors.slice(0, 3).join("; "));
    return "0 errors";
  });

  await browser.close();
  const passed = report.filter((r) => r.status === "PASS").length;
  const failed = report.length - passed;
  for (const r of report) console.log(`${r.status}  ${r.name}  -  ${r.detail}`);
  console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.error("SUITE CRASHED:", e);
  process.exitCode = 1;
});