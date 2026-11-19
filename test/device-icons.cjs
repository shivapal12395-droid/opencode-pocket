/* Device suite - Lucide icons in the real Android WebView, including offline.
 * Requires the rebuilt APK installed and adb attached. Everything is local:
 * the sprite is inline in index.html, so no icon request may leave the phone.
 *
 * The WebView belongs to the user: this suite navigates to ?demo=1 to get
 * deterministic fixtures, but ALWAYS restores the original URL and the network
 * state afterwards, even when a check fails.
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

const icons = (page) =>
  page.evaluate(() => {
    const uses = [...document.querySelectorAll('use[href^="#i-"]')];
    const missing = uses.map((u) => u.getAttribute("href")).filter((h) => !document.querySelector(h));
    const strokes = new Set();
    for (const use of uses) {
      const svg = use.parentElement;
      if (svg && !svg.classList.contains("sprite")) strokes.add(getComputedStyle(svg).strokeWidth);
    }
    const unnamed = [...document.querySelectorAll("button")]
      .filter((b) => b.querySelector("use") && !(b.innerText || "").trim())
      .filter((b) => !(b.getAttribute("aria-label") || b.getAttribute("title") || "").trim())
      .map((b) => b.id || b.className);
    return { count: uses.length, missing, strokes: [...strokes], unnamed };
  });
const expectClean = (r) => {
  assert(r.count > 0, "no icons rendered");
  assert(r.missing.length === 0, "missing: " + r.missing.slice(0, 4).join(","));
  assert(r.strokes.length === 1 && r.strokes[0] === "1.8px", "strokes: " + r.strokes.join("/"));
  assert(r.unnamed.length === 0, "unnamed: " + r.unnamed.slice(0, 4).join(","));
  return `${r.count} icons, stroke ${r.strokes[0]}, 0 missing`;
};

(async () => {
  console.log("\n=========== DEVICE LUCIDE ICONS (offline WebView) ===========");
  const { browser, page } = await attach();
  const requests = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (e) => requests.push(e.request.url));

  // Remember exactly where the user was before opening the demo fixtures.
  const originalUrl = page.url();
  const url = new URL(originalUrl);
  url.search = "?demo=1";
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  await test("1. WebView renders the local Lucide sprite online", async () => {
    return expectClean(await icons(page));
  });

  await test("2. No CDN or external icon requests on the phone", async () => {
    const external = requests.filter((u) => !/^http:\/\/127\.0\.0\.1:80\d\d\//.test(u) && !/^(data|blob|about):/.test(u));
    assert(external.length === 0, external.slice(0, 3).join(" | "));
    return `${requests.length} local requests, 0 external`;
  });

  try {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });

    await test("3. Icons still render with the network offline", async () => {
      return expectClean(await icons(page));
    });

    await test("4. Dynamic chat update while offline keeps icons valid", async () => {
      await page.click('.session-row [data-open="ses_demo1"]');
      await page.waitForSelector("#messages .msg", { timeout: 15000 });
      await page.fill("#input", "quick tool please");
      await page.click("#btn-send");
      await page.waitForFunction(() => document.querySelector("#btn-send")?.dataset?.mode === "stop", { timeout: 10000 });
      await sleep(800);
      const during = expectClean(await icons(page));
      await page.waitForFunction(() => document.querySelector("#btn-send")?.dataset?.mode === "send", { timeout: 20000 });
      await sleep(400);
      return during + " / " + expectClean(await icons(page));
    });

    await test("5. Sheet rendered offline has no missing icon placeholders", async () => {
      await page.click("#chat-sidebar");
      await page.waitForSelector('#sidebar [data-side="customize"]', { timeout: 5000 });
      await page.click('#sidebar [data-side="customize"]');
      await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 });
      await sleep(300);
      const result = expectClean(await icons(page));
      await page.click("#sheet-close");
      return result;
    });
  } finally {
    // Undo BOTH test mutations even when a check fails: leave the network up
    // and put the WebView back on the URL the user was on before the run.
    await cdp
      .send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
      .catch(() => {});
    if (page.url() !== originalUrl) {
      await page.goto(originalUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page
        .waitForSelector("#screen-sessions:not([hidden]), #screen-connect:not([hidden])", { timeout: 10000 })
        .catch(() => {});
    }
  }

  await test("6. WebView restored to the original URL, no demo data left behind", async () => {
    const state = await page.evaluate(() => ({
      url: location.href,
      demo: window.__pocketTest?.state?.demo ?? false,
    }));
    assert(state.url === originalUrl, "URL is " + state.url + ", expected " + originalUrl);
    assert(state.demo === false, "demo mode is still active");
    return state.url;
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
