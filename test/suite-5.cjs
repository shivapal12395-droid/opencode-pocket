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
  await page.click("#open-settings");
  await sleep(300);

  await test("Provider catalog opens", async () => {
    await page.click("#provider-catalog");
    await page.waitForSelector(".catalog-card", { timeout: 20000 });
    const n = await page.$$eval(".catalog-card", (x) => x.length);
    assert(n > 20, "cards=" + n);
    return `${n} providers`;
  });

  await test("Colorful provider logos", async () => {
    const info = await page.$$eval(".catalog-card img", (imgs) => imgs.slice(0, 6).map((i) => ({ src: i.getAttribute("src"), color: i.style.color })));
    assert(info.length >= 6 && info.every((i) => i.src.includes("models.dev/logos") && i.color), JSON.stringify(info.slice(0, 2)));
    return "logos + brand colors";
  });

  await test("Search providers", async () => {
    await page.fill("#catalog-search", "anthropic");
    await sleep(250);
    const names = await page.$$eval(".catalog-name", (x) => x.map((n) => n.textContent));
    assert(names.length >= 1 && names.every((n) => /anthropic/i.test(n)), JSON.stringify(names));
    await page.fill("#catalog-search", "");
    return names.join(", ");
  });

  await test("Free models incl. Big Pickle", async () => {
    await page.fill("#catalog-search", "opencode");
    await sleep(250);
    await page.click('[data-catalog="opencode"]');
    await page.waitForSelector("#catalog-models .sheet-item", { timeout: 6000 });
    const txt = await page.$eval("#catalog-models", (n) => n.textContent);
    assert(/Big Pickle/i.test(txt) && /free models/i.test(txt), txt.slice(0, 80));
    return "big-pickle listed as free";
  });

  console.log("\n================ FEATURE TEST REPORT 5 ================");
  let pass = 0, fail = 0;
  for (const r of report) { console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(34)} ${r.detail}`); r.status === "PASS" ? pass++ : fail++; }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
