/* Device check - the mention picker must work on the real runtime.
 *
 * `/api/fs/find` answers 500 on the bundled 2.3.0 build, so the picker falls
 * back to walking the workspace with `/api/fs/list`. This verifies the app
 * shows real workspace files on the phone and that inserting one produces a
 * structured mention in the composer (nothing is sent, so the user's chat is
 * untouched).
 */
const { chromium } = require("playwright-core");
const { execFileSync } = require("node:child_process");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADB = process.env.ADB || "C:\\Users\\Shiva\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe";
const CDP = process.env.CDP || "http://127.0.0.1:9228";
const PKG = "com.shivapal.opencodepocket";

const adb = (...a) => {
  try {
    return execFileSync(ADB, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch {
    return "";
  }
};
const appPid = () =>
  adb("shell", `ps -A -o PID,NAME | grep ${PKG} | grep -v grep | awk '{print $1}'`)
    .split(/\s+/)
    .find((x) => /^\d+$/.test(x));

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

const attach = async () => {
  // A stopped activity detaches its WebView page; bring the app forward so a
  // run after a long test session still finds it.
  adb("shell", "am", "start", "-n", PKG + "/.MainActivity");
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const pid = appPid();
    if (pid) {
      adb("forward", "--remove", `tcp:${new URL(CDP).port}`);
      adb("forward", `tcp:${new URL(CDP).port}`, `localabstract:webview_devtools_remote_${pid}`);
    }
    try {
      const browser = await chromium.connectOverCDP(CDP);
      for (const p of browser.contexts()[0].pages()) {
        try {
          if (/:80\d\d\/?/.test(p.url())) return { browser, page: p };
        } catch {}
      }
      await browser.close();
    } catch {}
    await sleep(1500);
  }
  throw new Error("could not attach to the app WebView");
};

(async () => {
  console.log("\n=========== DEVICE MENTIONS (real runtime) ===========");
  const { browser, page } = await attach();
  const url = page.url();
  const demo = await page.evaluate(() => window.__pocketTest?.state?.demo ?? false);
  if (demo) throw new Error("the app is in demo mode; open a real session first");

  await test("1. A session is open in the real app", async () => {
    if (await page.evaluate(() => !!(document.querySelector("#screen-chat")?.hidden ?? true))) {
      await page.waitForSelector(".session-row [data-open]", { timeout: 15000 });
      await page.click(".session-row [data-open]");
    }
    await page.waitForSelector("#messages .msg", { timeout: 15000 });
    const title = await page.evaluate(() => document.querySelector(".chat-title-text")?.textContent?.trim() ?? "");
    return title ? `chat: ${title}` : "chat is open";
  });

  await test("2. The @ picker lists real workspace files despite /api/fs/find 500", async () => {
    await page.click("#btn-mention");
    await page.waitForSelector(".mention-tabs", { timeout: 8000 });
    await page.waitForSelector('[data-mention-kind="file"]', { timeout: 12000 });
    const rows = await page.$$eval('[data-mention-kind="file"]', (n) => n.map((x) => x.dataset.mentionKey));
    assert(rows.length > 0, "no files listed");
    return `${rows.length} files, first: ${rows[0]}`;
  });

  await test("3. Inserting a file mention records a structured mention", async () => {
    const picked = await page.$eval('[data-mention-kind="file"]', (n) => n.dataset.mentionKey);
    await page.click('[data-mention-kind="file"]');
    await sleep(400);
    // The real app exposes no test hook (that is demo-only), so this checks
    // what the user can see: the mention text landed and the picker closed.
    const state = await page.evaluate(() => ({
      value: document.querySelector("#input").value,
      sheetHidden: document.querySelector("#sheet").hidden,
    }));
    assert(state.value.startsWith("@" + picked), "draft: " + state.value.slice(0, 60));
    assert(state.sheetHidden, "picker did not close");
    // Leave the composer clean for the user.
    await page.fill("#input", "");
    return `@${picked} inserted (not sent)`;
  });

  await browser.close();
  const passed = report.filter((r) => r.status === "PASS").length;
  const failed = report.length - passed;
  for (const r of report) console.log(`${r.status}  ${r.name}  -  ${r.detail}`);
  console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.error("SUITE CRASHED:", e.message);
  process.exitCode = 1;
});
