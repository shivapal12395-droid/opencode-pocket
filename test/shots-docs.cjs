// Regenerates the README screenshots from demo mode, so documentation always
// shows the current UI (including the bundled fonts) instead of a phone theme.
const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "C:\\Users\\Shiva\\Projects\\opencode-pocket\\docs";

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  const base = process.env.POCKET_URL || "http://127.0.0.1:8099";

  await page.goto(`${base}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "amoled");
    const stored = JSON.parse(localStorage.getItem("ocp.prefs") || "{}");
    localStorage.setItem("ocp.prefs", JSON.stringify({ ...stored, theme: "amoled", accent: "blue", verbosity: "medium" }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  // Sessions list + welcome state
  await page.screenshot({ path: `${OUT}\\sessions.png` });
  await page.click("#fab-new");
  await page.waitForSelector("[data-dir]", { timeout: 10000 });
  await page.click("[data-dir]");
  await page.click("#create-session");
  await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 15000 });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}\\welcome.png` });

  // A real demo conversation with a folded activity run
  await page.click("#chat-back").catch(() => {});
  await sleep(400);
  await page.click('.session-row [data-open="ses_demo1"]');
  await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 8000 });
  await page.waitForSelector(".activity", { timeout: 8000 });
  await sleep(700);
  await page.evaluate(() => document.querySelector(".activity").scrollIntoView({ block: "center" }));
  await sleep(400);
  await page.screenshot({ path: `${OUT}\\chat.png` });

  await page.click("[data-toggle-activity]");
  await sleep(500);
  await page.evaluate(() => document.querySelector(".activity.open").scrollIntoView({ block: "start" }));
  await sleep(300);
  await page.screenshot({ path: `${OUT}\\chat-activity.png` });
  await page.click("[data-toggle-activity]");

  // Sidebar
  await page.click("#chat-sidebar");
  await sleep(600);
  await page.screenshot({ path: `${OUT}\\sidebar.png` });
  await page.click("#side-collapse");
  await sleep(400);

  // Attachment menu
  await page.click("#btn-attach");
  await sleep(500);
  await page.screenshot({ path: `${OUT}\\attach-menu.png` });
  await page.click("#sheet-close");
  await sleep(400);

  // Customize hub
  await page.click("#chat-sidebar");
  await sleep(500);
  await page.click('[data-side="customize"]');
  await sleep(500);
  await page.screenshot({ path: `${OUT}\\customize.png` });

  console.log("saved", ["sessions", "welcome", "chat", "chat-activity", "sidebar", "attach-menu", "customize"].join(", "));
  await browser.close();
})();