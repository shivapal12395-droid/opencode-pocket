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
  await sleep(250);
  await page.click("#open-mcp");
  await sleep(500);

  await test("Add custom MCP button exists", async () => {
    const n = await page.$$eval("[data-mcp-add]", (x) => x.length);
    assert(n === 1, "buttons=" + n);
    return "visible";
  });

  await test("Remote server form", async () => {
    await page.click("[data-mcp-add]");
    await page.waitForSelector("#mcp-name", { timeout: 5000 });
    await page.fill("#mcp-name", "my-remote");
    await page.fill("#mcp-url", "https://example.com/mcp");
    await page.click("#mcp-save");
    await sleep(900);
    const txt = await page.$eval("#sheet-body", (n) => n.textContent);
    assert(/my-remote/.test(txt), txt.slice(0, 80));
    return "remote added";
  });

  await test("Local server form", async () => {
    await page.click("[data-mcp-add]");
    await page.waitForSelector("#mcp-name", { timeout: 5000 });
    await page.click('#mcp-kind [data-k="local"]');
    await page.fill("#mcp-name", "my-local");
    await page.fill("#mcp-command", "npx -y demo-server");
    await page.click("#mcp-save");
    await sleep(900);
    const txt = await page.$eval("#sheet-body", (n) => n.textContent);
    assert(/my-local/.test(txt), txt.slice(0, 80));
    return "local added";
  });

  console.log("\n================ FEATURE TEST REPORT 6 ================");
  let pass = 0, fail = 0;
  for (const r of report) { console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(32)} ${r.detail}`); r.status === "PASS" ? pass++ : fail++; }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
