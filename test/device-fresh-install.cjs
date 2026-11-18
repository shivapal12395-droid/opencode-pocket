const { chromium } = require("playwright-core");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADB = process.env.ADB || "C:\\Users\\Shiva\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe";
const CDP = process.env.CDP || "http://127.0.0.1:9225";
const PKG = "com.shivapal.opencodepocket";
const APK = path.join(__dirname, "..", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const SAFETY = path.join(process.env.USERPROFILE || ".", "opencode-pocket-backups");

const adb = (...args) => {
  try {
    return execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e) {
    return "ERR " + String(e.stdout ?? e.message ?? "").slice(0, 160);
  }
};
const adbBytes = (args) => execFileSync(ADB, args, { maxBuffer: 1024 * 1024 * 1024 });

const report = [];
const test = async (name, fn) => {
  try {
    const d = await fn();
    report.push({ name, status: "PASS", detail: d || "" });
  } catch (e) {
    report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 150) });
  }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const appPid = () => adb("shell", `ps -A -o PID,NAME | grep ${PKG} | grep -v grep | awk '{print $1}'`)
  .split(/\s+/).find((x) => /^\d+$/.test(x));

const forwardCdp = () => {
  const pid = appPid();
  if (!pid) return null;
  adb("forward", "--remove", `tcp:${new URL(CDP).port}`);
  adb("forward", `tcp:${new URL(CDP).port}`, `localabstract:webview_devtools_remote_${pid}`);
  return pid;
};

const attach = async (maxMs) => {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    forwardCdp();
    try {
      const browser = await chromium.connectOverCDP(CDP);
      let best = null;
      for (const p of browser.contexts()[0].pages().filter((x) => /:80\d\d\/?$/.test(x.url()))) {
        try {
          const score = await p.evaluate(() => {
            if (!window.PocketNative) return -1;
            return document.querySelectorAll(".session-row").length * 10 + document.querySelectorAll("#messages .msg").length;
          });
          if (score >= 0 && (!best || score > best.score)) best = { page: p, score };
        } catch {}
      }
      if (best) return { browser, page: best.page };
      await browser.close();
    } catch {}
    await sleep(2000);
  }
  throw new Error("the WebView never appeared (the shell loads only after the engine is ready)");
};

const home = "files/opencode-home";
const logTail = (n = 8) => adb("shell", `run-as ${PKG} tail -n ${n} files/embedded-runtime.log`);

(async () => {
  fs.mkdirSync(SAFETY, { recursive: true });
  let browser, page;
  let before = [];
  let localZip = "";

  await test("A safety copy and a fresh in-app backup exist before the wipe", async () => {
    // data tar first (belt and braces)
    const tar = execFileSync(ADB, ["exec-out", `run-as ${PKG} tar -czf - -C files opencode-home`], { maxBuffer: 1024 * 1024 * 1024 });
    const tarPath = path.join(SAFETY, `pre-fresh-install-${Date.now()}.tar.gz`);
    fs.writeFileSync(tarPath, tar);

    adb("shell", `am start -n ${PKG}/.MainActivity`);
    await sleep(4000);
    ({ browser, page } = await attach(90000));
    before = await page.evaluate(async () => {
      const cfg = JSON.parse(window.PocketNative.getConfig());
      const auth = "Basic " + btoa("opencode:" + cfg.secret);
      const j = await (await fetch(cfg.base + "/api/session?limit=100", { headers: { authorization: auth } })).json();
      return (j.data ?? []).map((s) => s.id);
    });
    assert(before.length > 0, "no sessions to protect");
    const res = JSON.parse(await page.evaluate(() => window.PocketNative.backupRuntime()));
    assert(res.ok, "backup failed: " + res.error);
    localZip = path.join(SAFETY, res.name);
    adb("pull", `/sdcard/Download/OpenCodePocket/${res.name}`, localZip);
    assert(fs.existsSync(localZip), "could not pull the backup");
    return `${before.length} sessions protected; ${path.basename(tarPath)} (${(fs.statSync(tarPath).size / 1024 / 1024).toFixed(1)} MB) + ${res.name}`;
  });

  try { await browser.close(); } catch {}

  await test("Uninstall, then install WITHOUT the engine bundle", async () => {
    const un = adb("uninstall", PKG);
    assert(/Success/i.test(un), "uninstall: " + un);
    const ins = adb("install", APK);
    assert(/Success/i.test(ins), "install: " + ins);
    const files = adb("shell", `run-as ${PKG} ls files/ 2>&1`);
    assert(/No such file|ERR/.test(files) || !/runtime\.tar\.gz/.test(files), "a bundle is already there: " + files);
    return "fresh install, no engine on disk";
  });

  let timeline = [];
  await test("The app downloads, verifies and unpacks the engine on its own", async () => {
    adb("shell", "logcat -c");
    adb("shell", `am start -n ${PKG}/.MainActivity`);
    const started = Date.now();
    let seenBytes = 0;
    const marks = [];
    for (let i = 0; i < 300; i++) {
      await sleep(2000);
      const size = Number((adb("shell", `run-as ${PKG} ls -l files/runtime.tar.gz 2>/dev/null | awk '{print $5}'`) || "0").trim()) || 0;
      if (size !== seenBytes) {
        seenBytes = size;
        marks.push(`${Math.round((Date.now() - started) / 1000)}s: ${(size / 1024 / 1024).toFixed(1)} MB`);
      }
      const log = adb("shell", `run-as ${PKG} tail -n 20 files/embedded-runtime.log 2>/dev/null`);
      if (/daemon ready/.test(log)) {
        timeline = marks;
        return `downloaded ${(size / 1024 / 1024).toFixed(0)} MB in ${Math.round((Date.now() - started) / 1000)}s; ${log.split("\n").filter((l) => /downloading|downloaded|SHA|extract|chmod|daemon ready/.test(l)).slice(-6).join(" | ")}`;
      }
      if (/install failed|SHA mismatch|Could not install/.test(log)) {
        throw new Error("the app's own install failed: " + log.split("\n").slice(-3).join(" | "));
      }
    }
    throw new Error("the engine never became ready; last log: " + logTail());
  });

  await test("The engine is the one the repo publishes (SHA-verified on the device)", async () => {
    const log = logTail(30);
    assert(/SHA verified/.test(log), "no SHA verification in the log: " + log);
    assert(/extract exit=0/.test(log), "extraction did not succeed");
    assert(!/SHA mismatch/.test(log), "the device rejected the bundle");
    const size = adb("shell", `run-as ${PKG} ls -l files/runtime.tar.gz | awk '{print $5}'`);
    return `SHA verified, extract exit=0, bundle ${(Number(size) / 1024 / 1024).toFixed(0)} MB`;
  });

  await test("A brand-new install still shows nothing and offers the backup", async () => {
    ({ browser, page } = await attach(120000));
    let st = null;
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      st = await page.evaluate(() => ({
        sessions: document.querySelectorAll(".session-row").length,
        sheet: document.querySelector("#sheet-title")?.textContent ?? "",
      }));
      if (st.sessions === 0 && st.sheet) break;
    }
    assert(st.sessions === 0, `expected 0 sessions on a fresh install, got ${st.sessions}`);
    assert(/Nothing here yet/i.test(st.sheet), "no restore offer (sheet: " + st.sheet + ")");
    return `0 sessions, offered "${st.sheet}"`;
  });

  await test("Restoring brings the conversations back", async () => {
    const zip = localZip;
    let viaPicker = false;
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 8000 }),
        page.click("#sheet-body [data-pick]"),
      ]);
      await chooser.setFiles(zip);
      viaPicker = true;
    } catch {
      await page.evaluate(async ([b64, name]) => {
        const res = JSON.parse(window.PocketNative.restoreRuntimeFromBase64(name, b64) || "{}");
        window.__restoreFallback = res;
        if (res.ok) window.PocketNative.restartAfterRestore();
      }, [fs.readFileSync(zip).toString("base64"), path.basename(zip)]);
    }
    await sleep(6000);
    try { await browser.close(); } catch {}
    ({ browser, page } = await attach(120000));
    let after = [];
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      after = await page.evaluate(async () => {
        const cfg = JSON.parse(window.PocketNative.getConfig());
        const auth = "Basic " + btoa("opencode:" + cfg.secret);
        const j = await (await fetch(cfg.base + "/api/session?limit=100", { headers: { authorization: auth } })).json();
        return (j.data ?? []).map((s) => s.id);
      });
      if (after.length >= before.length) break;
    }
    const missing = before.filter((id) => !after.includes(id));
    assert(missing.length === 0, "missing after restore: " + missing.join(", "));
    return `${after.length} sessions via ${viaPicker ? "the system file picker" : "the bridge"}; all ${before.length} original ids present`;
  });

  console.log("\n========== FRESH INSTALL (engine downloaded from the repo) ==========");
  if (timeline.length) console.log("download progress: " + timeline.filter((_, i) => i % Math.max(1, Math.ceil(timeline.length / 8)) === 0).join("  "));
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(62)} ${r.detail}`);
    r.status === "PASS" ? pass++ : fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  try { await browser.close(); } catch {}
  process.exitCode = fail ? 1 : 0;
})();
