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
  const test = async (name, fn) => { try { const d = await fn(); report.push({ name, status: "PASS", detail: d || "" }); } catch (e) { report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 90) }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  await test("Open two sessions -> tabs appear", async () => {
    await page.click('.session-row [data-open="ses_demo1"]');
    await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 8000 });
    await sleep(400);
    await page.click("#chat-back");
    await sleep(350);
    await page.click('.session-row [data-open="ses_demo2"]');
    await sleep(700);
    const n = await page.$$eval(".session-tab", (x) => x.length);
    const active = await page.$eval(".session-tab.active", (n) => n.textContent.trim()).catch(() => "");
    assert(n >= 2, "tabs=" + n);
    return `${n} tabs · ${active.slice(0, 24)}`;
  });

  await test("Switch tab restores session", async () => {
    const tabs = await page.$$eval(".session-tab", (x) => x.map((n) => n.dataset.tab));
    await page.click(`.session-tab[data-tab="${tabs[tabs.length - 1]}"]`);
    await sleep(600);
    const title = await page.$eval("#chat-title .chat-title-text", (n) => n.textContent.trim());
    assert(title.length > 2, "title=" + title);
    return title.slice(0, 30);
  });

  await test("Close a tab", async () => {
    const before = await page.$$eval(".session-tab", (x) => x.length);
    await page.click(".session-tab i[data-tab-close]");
    await sleep(500);
    const after = await page.$$eval(".session-tab", (x) => x.length);
    assert(after === before - 1 || after < 2, `${before}->${after}`);
    return `${before} -> ${after}`;
  });

  await test("Scheduled tasks sheet from sidebar", async () => {
    await page.click("#chat-sidebar");
    await sleep(450);
    await page.click('[data-side="tasks"]');
    await page.waitForSelector("#sched-create", { timeout: 8000 });
    await page.fill("#sched-name", "Nightly review");
    await page.fill("#sched-when", "2 hours");
    await page.fill("#sched-prompt", "Review the open changes");
    await page.click("#sched-create");
    await sleep(900);
    const txt = await page.$eval("#sheet-body", (n) => n.textContent);
    assert(/Nightly review/.test(txt), txt.slice(0, 80));
    return "created + listed";
  });

  await test("Instructions viewer", async () => {
    await page.click("#sheet-close");
    await sleep(450);
    await page.click("#chat-sidebar");
    await sleep(450);
    // Instructions live under Customize now; the Library row lists artifacts.
    await page.click('[data-side="customize"]');
    await sleep(400);
    await page.click('[data-cust="instructions"]');
    await page.waitForSelector(".instr-card", { timeout: 8000 });
    const n = await page.$$eval(".instr-card", (x) => x.length);
    assert(n >= 1, "cards=" + n);
    return `${n} instruction entries`;
  });

  await test("GUI plugins list", async () => {
    await page.click("#sheet-close");
    await sleep(450);
    await page.click("#chat-sidebar");
    await sleep(450);
    await page.click('[data-side="plugins"]');
    await page.waitForSelector("#sheet-body .sheet-item", { timeout: 8000 });
    const n = await page.$$eval("#sheet-body .sheet-item", (x) => x.length);
    assert(n >= 1, "plugins=" + n);
    return `${n} plugins`;
  });

  await test("Voice button present", async () => {
    const n = await page.$$eval("#btn-voice", (x) => x.length);
    assert(n === 1, "buttons=" + n);
    return "composer mic";
  });

  console.log("\n================ FEATURE TEST REPORT 7 ================");
  let pass = 0, fail = 0;
  for (const r of report) { console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(34)} ${r.detail}`); r.status === "PASS" ? pass++ : fail++; }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
