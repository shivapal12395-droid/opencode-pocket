/* Device suite - the real thing, on the connected phone.
 *
 * Runs against the WebView in the installed APK over Chrome DevTools Protocol
 * (adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>) and the
 * real OpenCode daemon inside the app. Nothing here is mocked.
 *
 * Requires: adb + the app installed and running, `adb forward tcp:9223 ...`
 * already set. Usage: node test/device-live.cjs
 */
const { chromium } = require("playwright-core");
const { execFileSync } = require("node:child_process");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADB = process.env.ADB || "C:\\Users\\Shiva\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe";
const CDP = process.env.CDP || "http://127.0.0.1:9223";

const rawAdb = (...args) => execFileSync(ADB, args, { encoding: "utf8" }).trim();
const adb = (...args) => {
  try {
    return rawAdb(...args);
  } catch (e) {
    return "ERR " + String(e.message).slice(0, 90);
  }
};

/**
 * The WebView debug socket is named after the app's process id, which changes
 * on every cold start, so the forward is re-pointed before attaching.
 */
const setupCdp = () => {
  const port = new URL(CDP).port;
  adb("forward", "--remove", `tcp:${port}`);
  const pid = adb("shell", "ps -A -o PID,NAME | grep com.shivapal.opencodepocket | grep -v grep | awk '{print $1}'")
    .split(/\s+/)
    .filter((x) => /^\d+$/.test(x))[0];
  if (!pid) throw new Error("the app is not running: start it, then re-run");
  adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  return pid;
};

(async () => {
  const report = [];
  const test = async (name, fn) => {
    try {
      const d = await fn();
      report.push({ name, status: "PASS", detail: d || "" });
    } catch (e) {
      report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 140) });
    }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  /**
   * Attach to the *live* app WebView.
   *
   * A recreated Activity briefly leaves the old WebView as a target, and the UI
   * port can move (8099 -> 8098) when the runtime restarts, so the target is
   * chosen by asking each one whether it really is the app.
   */
  const attach = async (maxMs = 60000) => {
    const deadline = Date.now() + maxMs;
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        const browser = await chromium.connectOverCDP(CDP);
        const ctx = browser.contexts()[0];
        // A recreated Activity leaves the old WebView as a second target; the
        // live one is the one with a transcript, so score them.
        let best = null;
        for (const p of ctx.pages().filter((x) => /:80\d\d\/?$/.test(x.url()))) {
          try {
            const score = await p.evaluate(() => {
              if (!window.PocketNative?.isNative?.() || !document.querySelector("#messages")) return -1;
              return document.querySelectorAll(".session-row").length * 10 + document.querySelectorAll("#messages .msg").length;
            });
            if (score >= 0 && (!best || score > best.score)) best = { page: p, score };
          } catch {
            /* stale target from a destroyed WebView */
          }
        }
        if (best) return { browser, page: best.page };
        await browser.close();
      } catch (e) {
        lastErr = e;
      }
      await sleep(1000);
    }
    throw new Error("could not attach to the app WebView" + (lastErr ? ": " + lastErr.message : ""));
  };

  const appPid = setupCdp();
  let { browser, page } = await attach();
  const errors = [];
  const wire = (p) => {
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    p.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  };
  wire(page);

  const showList = async () => {
    await page.evaluate(() => {
      const sheet = document.querySelector("#sheet");
      if (sheet && !sheet.hidden) document.querySelector("#sheet-close")?.click();
    });
    await sleep(250);
    const inChat = await page.evaluate(() => !document.querySelector("#screen-chat")?.hidden);
    if (inChat) { await page.evaluate(() => document.querySelector("#chat-back")?.click()); await sleep(600); }
  };

  const waitMode = async (target, max = 20000) => {
    for (let i = 0; i < max / 250; i++) {
      await sleep(250);
      const mode = await page.evaluate(() => document.querySelector("#btn-send")?.dataset?.mode ?? "");
      if (mode === target) return true;
    }
    return false;
  };

  let testSession = null;

  await test("The installed app serves the new client and the native bridge", async () => {
    const st = await page.evaluate(() => ({
      bridge: !!window.PocketNative?.isNative?.(),
      hasBanner: !!document.querySelector("#net-banner"),
      hasOlder: !!document.querySelector("#messages [data-load-older]") || document.querySelectorAll("#messages").length === 1,
      version: document.querySelector(".brand-tag")?.textContent ?? "",
      sessions: document.querySelectorAll(".session-row").length,
      rows: [...document.querySelectorAll(".session-row")].slice(0, 3).map((n) => n.innerText.replace(/\s+/g, " ").slice(0, 40)),
    }));
    assert(st.bridge, "PocketNative is missing: this is not the app WebView");
    assert(st.hasBanner, "the client in the APK is not the updated one");
    return `native bridge ok, ${st.sessions} real sessions, first: ${st.rows[0] ?? "-"}`;
  });

  await test("A real turn: Thinking, then an answer, then idle", async () => {
    await showList();
    await page.click("#fab-new");
    await page.waitForSelector("#create-session", { timeout: 20000 });
    await page.click("#create-session");
    await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 20000 });
    await sleep(1200);
    testSession = await page.evaluate(() => document.querySelector("#chat-title-text")?.textContent ?? "");
    const sid = await page.evaluate(async () => {
      // the open session's id from the tab strip, which carries it in the DOM
      const tab = document.querySelector(".session-tab.active") ?? document.querySelector(".session-tab");
      return tab?.dataset?.id ?? null;
    });
    await page.fill("#input", "Reply with exactly one word: pong");
    await page.click("#btn-send");
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      await sleep(250);
      const s = await page.evaluate(() => {
        const el = document.querySelector("#chat-status");
        return { hidden: el.hidden, text: el.hidden ? "" : el.querySelector("span").textContent, mode: document.querySelector("#btn-send").dataset.mode };
      });
      if (!s.hidden) seen.add(s.text);
      if (s.mode === "send") break;
    }
    await sleep(800);
    const text = await page.evaluate(() => document.querySelector("#messages")?.innerText ?? "");
    assert(/pong/i.test(text), "the answer never arrived: " + text.slice(-200));
    return `session "${testSession}" answered; states ${[...seen].join(" -> ") || "(too fast)"}; sid=${sid ?? "-"}`;
  });

  await test("Stop interrupts a real run", async () => {
    await page.fill("#input", "Count from 1 to 300, one number per line, slowly.");
    await page.click("#btn-send");
    await sleep(2500);
    const mode1 = await page.evaluate(() => document.querySelector("#btn-send").dataset.mode);
    assert(mode1 === "stop", "the turn did not start (mode=" + mode1 + ")");
    await page.fill("#input", "");
    await page.click("#btn-send");
    const back = await waitMode("send", 15000);
    assert(back, "Stop did not return the composer to Send");
    return "interrupted and back to Send";
  });

  await test("Backup writes a real archive out of app storage", async () => {
    const raw = await page.evaluate(() => window.PocketNative.backupRuntime());
    const res = JSON.parse(raw);
    assert(res.ok, "backup failed: " + (res.error ?? raw));
    assert(res.entries > 0 && res.bytes > 10000, "backup looks empty: " + JSON.stringify(res));
    const list = JSON.parse(await page.evaluate(() => window.PocketNative.listRuntimeBackups()));
    assert(list.some((b) => b.name === res.name), "the backup is not listed");
    return `${res.name} · ${res.entries} files · ${(res.bytes / 1024 / 1024).toFixed(1)} MB at ${res.where}`;
  });

  await test("Killing the daemon shows the connection banner; restart recovers", async () => {
    // The daemon is the live `ld-musl-aarch64.so.1` child of the app process.
    // A killed one lingers as `[ld-musl-aarch64]` (defunct), so bracketed names
    // are excluded or the test would "kill" a corpse.
    const pid = adb("shell", "ps -A -o PID,NAME,PPID | grep ld-musl | grep -v '\\[' | awk '{print $1}'")
      .split(/\s+/)
      .filter((x) => /^\d+$/.test(x))[0];
    assert(pid, "could not find the live daemon pid");
    adb("shell", `run-as com.shivapal.opencodepocket kill ${pid}`);
    let banner = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      banner = await page.evaluate(() => ({
        hidden: document.querySelector("#net-banner").hidden,
        text: document.querySelector("#net-text").textContent,
        retry: !document.querySelector("#net-retry").hidden,
      }));
      if (!banner.hidden) break;
    }
    assert(banner && !banner.hidden, "no banner after the daemon died");
    const bannerText = banner.text;
    // Restart the runtime from inside the app. The activity is recreated, so the
    // CDP session dies and has to be reattached.
    await page.evaluate(() => window.PocketNative.restartRuntime());
    await sleep(6000);
    try { await browser.close(); } catch {}
    ({ browser, page } = await attach());
    wire(page);
    await sleep(2500);
    let recovered = null;
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      recovered = await page.evaluate(() => ({
        hidden: document.querySelector("#net-banner")?.hidden,
        sessions: document.querySelectorAll(".session-row").length,
        inChat: !document.querySelector("#screen-chat")?.hidden,
        rows: document.querySelectorAll("#messages .msg").length,
      }));
      if (recovered.hidden && (recovered.sessions > 0 || recovered.inChat)) break;
    }
    assert(recovered?.hidden, "the banner never cleared after the restart");
    assert(recovered.sessions > 0 || recovered.inChat, "the session list did not come back");
    return `daemon ${pid} killed ("${bannerText}"), restart recovered ${recovered.sessions} sessions`;
  });

  console.log("\n================ DEVICE SUITE (real daemon) ================");
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(52)} ${r.detail}`);
    r.status === "PASS" ? pass++ : fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  try { await browser.close(); } catch {}
  process.exitCode = fail ? 1 : 0;
})();
