/* Device suite - uninstall / reinstall recovery (issue 3).
 *
 * The runtime's store is app-private, so Android deletes it on uninstall. This
 * suite proves the app can put the original sessions back afterwards, with
 * their original ids, from a backup the user made (never automatically).
 *
 * It is destructive by design: the app is uninstalled and reinstalled. A tar of
 * the whole app data directory is kept on the PC first
 * (C:\Users\Shiva\opencode-pocket-backups) as a safety net.
 *
 * Usage: node test/device-reinstall.cjs
 */
const { chromium } = require("playwright-core");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADB = process.env.ADB || "C:\\Users\\Shiva\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe";
const CDP = process.env.CDP || "http://127.0.0.1:9224";
const PKG = "com.shivapal.opencodepocket";
const APK = path.join(__dirname, "..", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const SAFETY = path.join(process.env.USERPROFILE || ".", "opencode-pocket-backups");

const adb = (...args) => {
  try {
    return execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e) {
    const out = String(e.stdout ?? "") + String(e.message ?? "");
    return "ERR " + out.slice(0, 160);
  }
};
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

const appPid = () =>
  adb("shell", `ps -A -o PID,NAME | grep ${PKG} | grep -v grep | awk '{print $1}'`)
    .split(/\s+/)
    .filter((x) => /^\d+$/.test(x))[0];

const forwardCdp = () => {
  const pid = appPid();
  if (!pid) return null;
  adb("forward", "--remove", `tcp:${new URL(CDP).port}`);
  adb("forward", `tcp:${new URL(CDP).port}`, `localabstract:webview_devtools_remote_${pid}`);
  return pid;
};

/**
 * Attach to the *live* WebView.
 *
 * `activity.recreate()` leaves the previous WebView as a second CDP target for
 * a while, and both look like the app. The live one is the one with a
 * transcript, so the targets are scored and the richest one wins.
 */
const attach = async (maxMs = 90000) => {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    forwardCdp();
    try {
      const browser = await chromium.connectOverCDP(CDP);
      const ctx = browser.contexts()[0];
      let best = null;
      for (const p of ctx.pages().filter((x) => /:80\d\d\/?$/.test(x.url()))) {
        try {
          const score = await p.evaluate(() => {
            if (!window.PocketNative || !document.querySelector("#messages")) return -1;
            return document.querySelectorAll(".session-row").length * 10 + document.querySelectorAll("#messages .msg").length;
          });
          if (score >= 0 && (!best || score > best.score)) best = { page: p, score };
        } catch {}
      }
      if (best) return { browser, page: best.page };
      await browser.close();
    } catch {}
    await sleep(1500);
  }
  throw new Error("could not attach to the app WebView");
};

const startApp = async () => {
  adb("shell", "am force-stop " + PKG);
  await sleep(1200);
  adb("shell", `am start -n ${PKG}/.MainActivity`);
};

/**
 * The *server's* sessions, not the screen's.
 *
 * Pocket keeps local copies of anything the server no longer has (a deliberate
 * recovery copy), so the visible list can legitimately contain more rows than
 * the restored database. What a backup must preserve is the server's own data.
 */
const sessionIds = () =>
  page.evaluate(async () => {
    const cfg = JSON.parse(window.PocketNative.getConfig());
    const auth = "Basic " + btoa("opencode:" + cfg.secret);
    const res = await fetch(cfg.base + "/api/session?limit=100", { headers: { authorization: auth } });
    const json = await res.json();
    return (json.data ?? []).map((s) => s.id);
  });

let browser, page;
let before = [];

(async () => {
  fs.mkdirSync(SAFETY, { recursive: true });

  /* ---- 1. a backup made from the running app, with the current sessions ---- */

  const resume = process.env.FROM_RESTORE === "1";

  await test("The app is running and has real sessions to lose", async () => {
    if (resume) {
      // Resuming after a wipe: the ids to expect come from the previous run.
      before = (process.env.EXPECT_IDS ?? "").split(",").filter(Boolean);
      assert(before.length > 0, "set EXPECT_IDS to the original session ids");
      return `${before.length} original ids: ${before.join(", ")}`;
    }
    // `adb install -r` can leave the process alive without an Activity, and the
    // foreground service can restart it with no UI at all.
    await startApp();
    await sleep(4000);
    ({ browser, page } = await attach());
    await page.evaluate(() => {
      const sheet = document.querySelector("#sheet");
      if (sheet && !sheet.hidden) document.querySelector("#sheet-close")?.click();
      if (!document.querySelector("#screen-chat")?.hidden) document.querySelector("#chat-back")?.click();
    });
    await sleep(800);
    before = await sessionIds();
    assert(before.length > 0, "no sessions on the device to protect");
    return `${before.length} sessions: ${before.join(", ")}`;
  });

  let safetySize = 0;
  if (!resume) await test("A safety copy of the app data and the engine bundle is on the PC first", async () => {
    const out = path.join(SAFETY, `device-opencode-home-${Date.now()}.tar.gz`);
    const res = execFileSync(ADB, ["exec-out", `run-as ${PKG} tar -czf - -C files opencode-home`], {
      maxBuffer: 1024 * 1024 * 1024,
    });
    fs.writeFileSync(out, res);
    safetySize = fs.statSync(out).size;
    assert(safetySize > 100_000, "the safety copy looks empty");
    // The engine bundle is needed to reinstall without a network download.
    const bundle = path.join(SAFETY, "runtime.tar.gz");
    if (!fs.existsSync(bundle) || fs.statSync(bundle).size < 100_000_000) {
      const bytes = execFileSync(ADB, ["exec-out", `run-as ${PKG} cat files/runtime.tar.gz`], {
        maxBuffer: 1024 * 1024 * 1024,
      });
      fs.writeFileSync(bundle, bytes);
    }
    return `${path.basename(out)} (${(safetySize / 1024 / 1024).toFixed(1)} MB) + engine ${(fs.statSync(bundle).size / 1024 / 1024).toFixed(0)} MB`;
  });

  let backupName = "";
  let localZip = "";
  if (!resume) await test("Back up the runtime before the uninstall", async () => {
    const res = JSON.parse(await page.evaluate(() => window.PocketNative.backupRuntime()));
    assert(res.ok, "backup failed: " + (res.error ?? ""));
    backupName = res.name;
    const list = JSON.parse(await page.evaluate(() => window.PocketNative.listRuntimeBackups()));
    assert(list.some((b) => b.name === backupName), "the new backup is not listed");
    // Keep the same file on the PC: after the uninstall it can no longer be
    // listed, and this is the file the user would pick from Downloads.
    localZip = path.join(SAFETY, backupName);
    adb("pull", `/sdcard/Download/OpenCodePocket/${backupName}`, localZip);
    assert(fs.existsSync(localZip) && fs.statSync(localZip).size > 100_000, "could not keep a copy of the backup");
    return `${backupName} · ${res.entries} files · ${(res.bytes / 1024 / 1024).toFixed(1)} MB`;
  });

  try { await browser.close(); } catch {}

  /* ---- 2. uninstall / reinstall ------------------------------------------- */

  if (!resume) await test("Uninstall wipes the app's own storage", async () => {
    const un = adb("uninstall", PKG);
    assert(/Success/i.test(un), "uninstall said: " + un);
    const still = adb("shell", `run-as ${PKG} ls files 2>&1`);
    assert(/ERR|not debuggable|No such|unknown package/i.test(still) || still.length === 0, "app data survived: " + still);
    return un;
  });

  if (!resume) await test("Reinstall the APK (the engine must be restorable without a 124 MB download)", async () => {
    const ins = adb("install", APK);
    assert(/Success/i.test(ins), "install said: " + ins);
    // The engine bundle is not in the APK; put the one this device already
    // downloaded back so the test does not depend on the phone's network.
    const local = path.join(SAFETY, "runtime.tar.gz");
    if (!fs.existsSync(local)) {
      throw new Error("missing " + local + " (pull files/runtime.tar.gz into the safety folder first)");
    }
    adb("push", local, "/data/local/tmp/runtime.tar.gz");
    // A freshly installed app has no data directory until it runs once.
    adb("shell", `run-as ${PKG} mkdir -p files`);
    const cp = adb("shell", `run-as ${PKG} cp /data/local/tmp/runtime.tar.gz files/runtime.tar.gz`);
    const have = adb("shell", `run-as ${PKG} ls -l files/runtime.tar.gz`);
    assert(!/ERR|No such/.test(cp + have), "could not place the engine bundle: " + cp + " / " + have);
    return `installed; engine ${(fs.statSync(local).size / 1024 / 1024).toFixed(0)} MB restored in place (safety copy ${(safetySize / 1024 / 1024).toFixed(1)} MB)`;
  });

  await test("A fresh install has no sessions, and offers the backup instead of restoring it", async () => {
    await startApp();
    await sleep(4000);
    ({ browser, page } = await attach());
    // wait for the runtime to come up and either an empty list or the offer
    let st = null;
    for (let i = 0; i < 40; i++) {
      await sleep(2000);
      st = await page.evaluate(() => ({
        sessions: document.querySelectorAll(".session-row").length,
        sheet: document.querySelector("#sheet-title")?.textContent ?? "",
        inChat: !document.querySelector("#screen-chat")?.hidden,
        splash: !!document.querySelector(".splash"),
      }));
      if (st.sessions === 0 && st.sheet) break;
      if (st.sessions > 0) break;
    }
    assert(st.sessions === 0, `expected a fresh install to have 0 sessions, got ${st.sessions}`);
    assert(/Nothing here yet|backup/i.test(st.sheet), "the app did not offer a restore (sheet: " + st.sheet + ")");
    return `0 sessions, offered "${st.sheet}"`;
  });

  await test("The backup file is readable after the reinstall (Downloads survives)", async () => {
    const names = adb("shell", "ls /sdcard/Download/OpenCodePocket/");
    assert(/opencode-backup-.*\.zip/.test(names), "no backup files left in Downloads: " + names);
    const zips = names.split(/\s+/).filter((n) => n.endsWith(".zip"));
    assert(zips.includes(backupName), `${backupName} is missing from Downloads (${zips.join(", ")})`);
    return `${zips.length} backup files still in Downloads, including ${backupName}`;
  });

  await test("Restoring from the picked file brings the original sessions back", async () => {
    const zip = localZip || path.join(SAFETY, "pocket-backup-1119.zip");
    assert(fs.existsSync(zip), "no backup file to restore from: " + zip);
    let viaPicker = false;
    // The system picker is what a user would use; intercept it if the driver
    // supports it, otherwise fall back to handing the same bytes to the bridge.
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
      viaPicker = false;
    }
    assert(viaPicker || (await page.evaluate(() => window.__restoreFallback?.ok)), "restore did not start");
    // The runtime restarts and the Activity is recreated.
    await sleep(6000);
    try { await browser.close(); } catch {}
    ({ browser, page } = await attach());
    let after = [];
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      await page.evaluate(() => {
        const sheet = document.querySelector("#sheet");
        if (sheet && !sheet.hidden) document.querySelector("#sheet-close")?.click();
        if (!document.querySelector("#screen-chat")?.hidden) document.querySelector("#chat-back")?.click();
      });
      await sleep(500);
      after = await sessionIds();
      if (after.length >= before.length) break;
    }
    const missing = before.filter((id) => !after.includes(id));
    assert(after.length > 0, "no sessions came back");
    assert(missing.length === 0, "these original ids are missing: " + missing.join(", "));
    return `${after.length} sessions restored via ${viaPicker ? "the system file picker" : "the bridge"}, all ${before.length} original ids present`;
  });

  await test("A restored session still opens with its transcript", async () => {
    // The app reopens the last session after the restart, so go back to the
    // list before choosing one.
    await page.evaluate(() => {
      const sheet = document.querySelector("#sheet");
      if (sheet && !sheet.hidden) document.querySelector("#sheet-close")?.click();
      if (!document.querySelector("#screen-chat")?.hidden) document.querySelector("#chat-back")?.click();
    });
    await sleep(700);
    await page.click(`.session-row [data-open="${before[0]}"]`);
    await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 20000 });
    await sleep(1500);
    const st = await page.evaluate(() => ({
      msgs: document.querySelectorAll("#messages .msg").length,
      text: (document.querySelector("#messages")?.innerText ?? "").slice(0, 120).replace(/\s+/g, " "),
      socketOk: document.querySelector("#net-banner")?.hidden,
    }));
    assert(st.msgs > 0, "the restored transcript is empty");
    assert(st.socketOk, "the connection did not settle after the restore");
    return `${st.msgs} messages: "${st.text}"`;
  });

  console.log("\n================ REINSTALL RECOVERY SUITE ================");
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(66)} ${r.detail}`);
    r.status === "PASS" ? pass++ : fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  try { await browser.close(); } catch {}
  process.exitCode = fail ? 1 : 0;
})();
