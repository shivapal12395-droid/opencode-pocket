const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark", serviceWorkers: "block", acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  const report = [];
  const test = async (name, fn) => { try { const d = await fn(); report.push({ name, status: "PASS", detail: d || "" }); } catch (e) { report.push({ name, status: "FAIL", detail: String(e.message).split("\n").slice(0, 5).join(" ").slice(0, 160) }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  await test("IndexedDB local history store", async () => {
    const dbs = await page.evaluate(() => indexedDB.databases());
    assert(dbs.some((d) => d.name === "opencode-pocket-history"), JSON.stringify(dbs));
    return "opencode-pocket-history";
  });

  await test("Opening a session saves a local copy", async () => {
    await page.click('.session-row [data-open="ses_demo1"]');
    await page.waitForSelector(".msg", { timeout: 8000 });
    await sleep(600);
    const info = await page.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open("opencode-pocket-history"); r.onsuccess = () => res(r.result); });
      const sessions = await new Promise((res) => { const r = db.transaction("sessions").objectStore("sessions").getAll(); r.onsuccess = () => res(r.result); });
      const messages = await new Promise((res) => { const r = db.transaction("messages").objectStore("messages").getAll(); r.onsuccess = () => res(r.result); });
      return { sessions: sessions.length, messages: messages.length };
    });
    assert(info.sessions >= 1 && info.messages >= 2, JSON.stringify(info));
    return `${info.sessions} sessions, ${info.messages} messages`;
  });

  await test("Export local history", async () => {
    await page.click("#chat-back");
    await sleep(300);
    await page.click("#open-settings");
    await sleep(300);
    const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    await page.click("#history-export");
    const file = await dl;
    assert(file, "no download");
    return file.suggestedFilename();
  });

  await test("Delete local copy needs confirmation", async () => {
    const open = await page.evaluate(() => document.querySelector("#sheet").hidden);
    if (open) { await page.click("#open-settings"); await sleep(300); }
    await page.click("#history-clear");
    await page.waitForSelector("#sheet-body [data-confirm]", { timeout: 5000 });
    const note = await page.$eval("#sheet-body .sheet-note", (n) => n.textContent);
    assert(/server sessions are not touched/i.test(note), note);
    await page.click("#sheet-body [data-cancel]");
    await sleep(300);
    return "confirm + cancel";
  });

  console.log("\n================ FEATURE TEST REPORT 4 ================");
  let pass = 0, fail = 0;
  for (const r of report) { console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(36)} ${r.detail}`); r.status === "PASS" ? pass++ : fail++; }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
