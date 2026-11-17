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
  await page.click('.session-row [data-open="ses_demo1"]');
  await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 8000 });
  await sleep(500);

  await test("Activity starts collapsed", async () => {
    const open = await page.$$eval(".activity.open", (x) => x.length);
    const all = await page.$$eval(".activity", (x) => x.length);
    assert(all >= 1 && open === 0, `open=${open} all=${all}`);
    return `${all} groups, all collapsed`;
  });

  await test("Activity expands to full width", async () => {
    await page.click("[data-toggle-activity]");
    await sleep(300);
    const info = await page.evaluate(() => {
      const a = document.querySelector(".activity.open");
      const m = document.querySelector("#messages");
      const ar = a.getBoundingClientRect();
      const mr = m.getBoundingClientRect();
      return { aw: Math.round(ar.width), mw: Math.round(mr.width), visible: a.querySelector(".activity-body").getBoundingClientRect().height > 0 };
    });
    assert(info.aw >= info.mw - 36 && info.visible, JSON.stringify(info));
    return `${info.aw}/${info.mw}px`;
  });

  await test("Activity collapses again", async () => {
    await page.click("[data-toggle-activity]");
    await sleep(250);
    const open = await page.$$eval(".activity.open", (x) => x.length);
    assert(open === 0, "open=" + open);
    return "collapsed";
  });

  await test("Stop response works", async () => {
    await page.fill("#input", "Write a long explanation of this project step by step.");
    await page.click("#btn-send");
    await sleep(900);
    const busy = await page.$eval("#btn-send", (n) => n.getAttribute("aria-label"));
    assert(busy === "Stop", "label=" + busy);
    await page.click("#btn-send");
    await sleep(1200);
    const after = await page.$eval("#btn-send", (n) => n.getAttribute("aria-label"));
    const stopped = await page.evaluate(() => document.body.textContent.includes("Stopped") || document.body.textContent.includes("Interrupted"));
    assert(after === "Send", "label after=" + after);
    return `stop -> ${after}${stopped ? " · stopped message" : ""}`;
  });

  await test("Composer buttons respond", async () => {
    const ids = ["#btn-attach", "#btn-mention", "#btn-voice", "#chip-model", "#chip-agent"];
    for (const id of ids) {
      const visible = await page.$eval(id, (n) => !!n && getComputedStyle(n).display !== "none").catch(() => false);
      assert(visible, id + " missing");
    }
    return ids.length + " controls";
  });

  await test("One activity panel per user request", async () => {
    await page.click("#chat-back");
    await sleep(350);
    await page.click('.session-row [data-open="ses_demo3"]');
    await page.waitForSelector(".msg", { timeout: 8000 });
    await sleep(500);
    const count = async () =>
      page.evaluate(() => ({
        users: document.querySelectorAll(".msg-user").length,
        panels: document.querySelectorAll(".activity").length,
      }));
    const before = await count();
    await page.fill("#input", "multi-step change please");
    await page.click("#btn-send");
    await sleep(2600);
    const after = await count();
    assert(after.users === before.users + 1, `users ${before.users}->${after.users}`);
    assert(after.panels === before.panels + 1, `panels ${before.panels}->${after.panels}`);
    return `${after.users} requests · ${after.panels} panels`;
  });

  console.log("\n================ FEATURE TEST REPORT 8 ================");
  let pass = 0, fail = 0;
  for (const r of report) { console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(36)} ${r.detail}`); r.status === "PASS" ? pass++ : fail++; }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();