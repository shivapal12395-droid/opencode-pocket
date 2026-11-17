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
    try { const d = await fn(); report.push({ name, status: "PASS", detail: d || "" }); }
    catch (e) { report.push({ name, status: "FAIL", detail: String(e.message).split("\n").slice(0,6).join(" ") }); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  await test("Sidebar opens from the left", async () => {
    await page.click("#open-sidebar");
    await page.waitForSelector("#sidebar.open", { timeout: 4000 });
    await sleep(320);
    const info = await page.evaluate(() => ({
      hidden: document.querySelector("#sidebar").hidden,
      backdrop: document.querySelector("#sidebar-backdrop").hidden,
      left: Math.round(document.querySelector("#sidebar").getBoundingClientRect().left),
    }));
    assert(!info.hidden && !info.backdrop && info.left === 0, JSON.stringify(info));
    return "drawer + backdrop visible";
  });

  await test("Sidebar sections and session history", async () => {
    const info = await page.evaluate(() => ({
      nav: document.querySelectorAll(".side-nav button").length,
      workspaces: document.querySelectorAll("#side-workspaces .side-item").length,
      recents: document.querySelectorAll("#side-recents [data-side-session]").length,
      pinned: document.querySelectorAll("#side-pinned .side-item").length,
    }));
    assert(info.nav >= 5 && info.recents >= 5 && info.workspaces >= 2, JSON.stringify(info));
    return `${info.nav} nav, ${info.workspaces} ws, ${info.recents} recents`;
  });

  await test("Sidebar filter", async () => {
    await page.fill("#side-filter", "upload");
    await sleep(300);
    const rows = await page.$$eval("#side-recents [data-side-session]", (x) => x.length);
    assert(rows >= 1 && rows < 8, "rows=" + rows);
    await page.fill("#side-filter", "");
    return `${rows} match`;
  });

  await test("Sidebar backdrop closes", async () => {
    await page.click("#sidebar-backdrop", { position: { x: 350, y: 300 } });
    await sleep(350);
    const open = await page.evaluate(() => document.querySelector("#sidebar").classList.contains("open"));
    assert(!open, "still open");
    return "closed";
  });

  await test("Sidebar opens a session", async () => {
    await page.click("#chat-sidebar").catch(async () => { await page.click("#open-sidebar"); });
    await page.waitForSelector("#sidebar.open", { timeout: 4000 });
    await page.click("#side-recents [data-side-session]");
    await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 8000 });
    return await page.$eval("#chat-title .chat-title-text", (n) => n.textContent.trim());
  });

  await test("Welcome state with starters", async () => {
    // go back and open a fresh session (empty transcript)
    await page.click("#chat-back");
    await sleep(300);
    await page.click("#fab-new");
    await page.waitForSelector("[data-dir]", { timeout: 8000 });
    await page.click("[data-dir]");
    await page.click("#create-session");
    await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 8000 });
    await page.waitForSelector(".welcome", { timeout: 8000 });
    const n = await page.$$eval(".starter", (x) => x.length);
    const title = await page.$eval(".welcome h1", (n) => n.textContent.trim());
    assert(n === 6, "starters=" + n);
    return `${title} · ${n} starters`;
  });

  await test("Starter fills a useful prompt", async () => {
    await page.click(".starter");
    await sleep(250);
    const value = await page.$eval("#input", (n) => n.value);
    assert(value.length > 30, "value=" + value.slice(0, 30));
    return value.slice(0, 44) + "…";
  });

  await test("Default model Big Pickle selected", async () => {
    // The mock catalog contains big-pickle; a brand new session should use it.
    await page.click("#chip-model");
    await page.waitForSelector("#model-list .sheet-item", { timeout: 8000 });
    const selected = await page.$eval("#model-list .sheet-item.selected", (n) => n.dataset.model).catch(() => null);
    await page.click("#sheet-close");
    await sleep(250);
    assert(selected === "opencode|big-pickle", "selected=" + selected);
    return selected;
  });

  await test("Pin a chat into the sidebar", async () => {
    const sheetOpen = await page.evaluate(() => document.querySelector("#sheet").classList.contains("open"));
    if (sheetOpen) { await page.click("#sheet-close"); await sleep(500); }
    const inChat = await page.evaluate(() => document.querySelector("#screen-chat").hidden === false);
    await page.click(inChat ? "#chat-sidebar" : "#open-sidebar");
    await sleep(400);
    await page.click("#side-recents [data-side-session]");
    await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 8000 });
    await sleep(600);
    await page.click("#chat-menu");
    await sleep(350);
    await page.click('[data-action="pin"]');
    await sleep(500);
    await page.click("#chat-sidebar");
    await sleep(400);
    const n = await page.$$eval("#side-pinned [data-side-session]", (x) => x.length);
    assert(n >= 1, "pinned=" + n);
    return `${n} pinned`;
  });

  console.log("\n================ FEATURE TEST REPORT 3 ================");
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(34)} ${r.detail}`);
    r.status === "PASS" ? pass++ : fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
