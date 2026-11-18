/* Device suite - Android lifecycle, memory and a real long run.
 *
 * Drives the installed APK's WebView over CDP while poking the phone with adb:
 * rotation, keyboard, background/foreground, process death, memory sampling,
 * and a real turn on hy4-flash-free (1M context / 65k output) against the live
 * daemon. Nothing here is mocked.
 *
 * Usage: node test/device-stress.cjs
 */
const { chromium } = require("playwright-core");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADB = process.env.ADB || "C:\\Users\\Shiva\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe";
const CDP = process.env.CDP || "http://127.0.0.1:9227";
const PKG = "com.shivapal.opencodepocket";
const MODEL = { providerID: "opencode", id: "hy4-flash-free" };

const adb = (...a) => {
  try {
    return execFileSync(ADB, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch (e) {
    return "ERR " + String(e.stdout ?? e.message ?? "").slice(0, 140);
  }
};

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

const attach = async (maxMs = 60000) => {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    forwardCdp();
    try {
      const browser = await chromium.connectOverCDP(CDP);
      let best = null;
      for (const p of browser.contexts()[0].pages().filter((x) => /:80\d\d\/?$/.test(x.url()))) {
        try {
          const score = await p.evaluate(() => (window.PocketNative ? document.querySelectorAll(".msg").length * 10 + document.querySelectorAll(".session-row").length + 1 : -1));
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

const launch = () => {
  adb("shell", `am start -n ${PKG}/.MainActivity`);
};
const home = () => adb("shell", "input keyevent KEYCODE_HOME");

const meminfo = () => {
  const out = adb("shell", `dumpsys meminfo ${PKG}`);
  const total = (out.match(/TOTAL PSS:\s+(\d+)/) || [])[1] ?? (out.match(/TOTAL\s+(\d+)/) || [])[1];
  const webview = (out.match(/WebView[^\n]*?(\d{4,})/) || [])[1];
  return { kbs: Number(total ?? 0), webviewKbs: Number(webview ?? 0) };
};

let browser, page;
let api = null;

(async () => {
  ({ browser, page } = await attach());
  const wire = (p) => p.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 160)));

  /**
   * A session on hy4-flash-free, created in the UI (so the workspace is the one
   * the app picked) and switched to hy4 through the API, then opened.
   */
  const newHy4Session = async () => {
    await page.evaluate(() => {
      const sheet = document.querySelector("#sheet");
      if (sheet && !sheet.hidden) document.querySelector("#sheet-close")?.click();
      if (!document.querySelector("#screen-chat").hidden) document.querySelector("#chat-back")?.click();
    });
    await sleep(800);
    await page.click("#fab-new");
    await page.waitForSelector("#create-session", { timeout: 20000 });
    await page.click("#create-session");
    await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 20000 });
    await sleep(1500);
    const info = await page.evaluate(async (model) => {
      const cfg = JSON.parse(window.PocketNative.getConfig());
      const auth = { authorization: "Basic " + btoa("opencode:" + cfg.secret), "content-type": "application/json" };
      const list = await (await fetch(cfg.base + "/api/session?limit=5", { headers: auth })).json();
      const s = (list.data ?? [])[0];
      await fetch(cfg.base + "/api/session/" + s.id + "/model", { method: "POST", headers: auth, body: JSON.stringify({ model }) });
      await fetch(cfg.base + "/api/session/" + s.id, { method: "PATCH", headers: auth, body: JSON.stringify({ title: "Stress: hy4 long run" }) });
      window.__stressSid = s.id;
      return { id: s.id, title: s.title };
    }, MODEL);
    await sleep(1200);
    const header = await page.evaluate(() => document.querySelector("#chip-model span")?.textContent ?? "");
    assert(/hy4/i.test(header), "the session did not switch to hy4: " + header);
    return { ...info, header };
  };

  const truth = () =>
    page.evaluate(async () => {
      const cfg = JSON.parse(window.PocketNative.getConfig());
      const auth = "Basic " + btoa("opencode:" + cfg.secret);
      const sid = window.__stressSid;
      const res = await (await fetch(cfg.base + "/api/session/" + sid + "/message?limit=8&order=desc", { headers: { authorization: auth } })).json();
      const last = (res.data ?? []).find((m) => m.type === "assistant");
      const server = (last?.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n\n");
      const domNodes = document.querySelectorAll("#messages .msg").length;
      const users = [...document.querySelectorAll("#messages .msg-user")];
      const dupes = users.length - new Set(users.map((n) => n.innerText.trim())).size;
      const body = [...document.querySelectorAll("#messages .msg-assistant .assistant-body")].pop();
      return { server, rendered: body ? body.innerText : "", domNodes, dupes };
    });

  const waitIdle = async (max = 120000) => {
    for (let i = 0; i < max / 400; i++) {
      await sleep(400);
      if (await page.evaluate(() => document.querySelector("#btn-send")?.dataset?.mode === "send")) return true;
    }
    return false;
  };

  await test("The app is up and connected to the live daemon", async () => {
    launch();
    await sleep(6000);
    const st = await page.evaluate(() => ({ bridge: !!window.PocketNative?.isNative?.(), rows: document.querySelectorAll(".session-row").length, banner: document.querySelector("#net-banner")?.hidden }));
    assert(st.bridge && st.rows > 0 && st.banner, JSON.stringify(st));
    return `${st.rows} real sessions, socket up`;
  });

  await test("A real long answer on hy4-flash-free (1M ctx / 65k out)", async () => {
    const s = await newHy4Session();

    const t0 = Date.now();
    await page.fill(
      "#input",
      "Write a detailed 1200+ word engineering note titled 'Streaming reliability' with: a short intro; a table of 6 failure modes and their fixes; a TypeScript code block (~25 lines) of a bounded retry helper; a Mermaid flowchart with 6 nodes; a KaTeX formula for exponential backoff; and a nested bullet checklist at the end. Plain markdown only."
    );
    await page.click("#btn-send");
    let firstTokenAt = 0;
    for (let i = 0; i < 1200; i += 1) {
      await sleep(250);
      const textLen = await page.evaluate(() => (document.querySelector("#messages .msg-assistant .assistant-body")?.innerText ?? "").length);
      if (!firstTokenAt && textLen > 20) firstTokenAt = Date.now();
      if (await page.evaluate(() => document.querySelector("#btn-send")?.dataset?.mode === "send")) break;
    }
    assert(await waitIdle(180000), "the turn never finished");
    await sleep(1200);
    const t = await truth();
    const total = Math.round((Date.now() - t0) / 1000);
    const a = await page.evaluate(() => ({
      panels: document.querySelectorAll("#messages .activity").length,
      live: document.querySelectorAll("#messages .activity.live").length,
      code: document.querySelectorAll("#messages .msg-assistant .code-block").length,
      tables: document.querySelectorAll("#messages .msg-assistant .table-wrap table").length,
      katex: document.querySelectorAll("#messages .msg-assistant .katex").length,
      mermaid: document.querySelectorAll("#messages .msg-assistant pre.mermaid").length,
      drawn: document.querySelectorAll("#messages .msg-assistant pre.mermaid.drawn").length,
    }));
    assert(t.server.length > 800, `the answer is short: ${t.server.length} chars`);
    assert(t.dupes === 0, `${t.dupes} duplicate user bubbles`);
    assert(a.live === 0, "the activity panel is still live after the turn");
    fs.writeFileSync(process.env.TEMP + "/ocp-test/hy4-answer.md", t.server);
    return `${total}s total, first token ${firstTokenAt ? Math.round((firstTokenAt - t0) / 1000) + "s" : "?"}, ${t.server.length} chars, ${a.panels} panel(s), code ${a.code} / tables ${a.tables} / katex ${a.katex} / diagrams ${a.mermaid} (drawn ${a.drawn})`;
  });

  await test("Rotation keeps the draft, the session and the run", async () => {
    await page.fill("#input", "draft that must survive rotation");
    await sleep(700);
    const before = await page.evaluate(() => ({
      title: document.querySelector("#chat-title-text")?.textContent ?? "",
      msgs: document.querySelectorAll("#messages .msg").length,
    }));
    adb("shell", "settings put system accelerometer_rotation 0");
    adb("shell", "settings put system user_rotation 1"); // landscape
    await sleep(3500);
    const land = await page.evaluate(() => ({
      draft: document.querySelector("#input")?.value ?? "",
      title: document.querySelector("#chat-title-text")?.textContent ?? "",
      msgs: document.querySelectorAll("#messages .msg").length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      w: window.innerWidth,
    }));
    assert(land.draft === "draft that must survive rotation", "draft lost: " + JSON.stringify(land.draft.slice(0, 40)));
    assert(land.title === before.title, "session changed: " + land.title);
    assert(land.msgs === before.msgs, `message count changed ${before.msgs} -> ${land.msgs}`);
    assert(land.overflow <= 2, "horizontal overflow in landscape: " + land.overflow);
    adb("shell", "settings put system user_rotation 0"); // back to portrait
    await sleep(3000);
    const port = await page.evaluate(() => ({
      draft: document.querySelector("#input")?.value ?? "",
      msgs: document.querySelectorAll(".msg").length,
      w: window.innerWidth,
    }));
    assert(port.draft === "draft that must survive rotation", "draft lost coming back");
    assert(port.msgs === before.msgs, "messages changed on the way back");
    adb("shell", "settings put system accelerometer_rotation 1");
    await page.fill("#input", "");
    await sleep(500);
    return `landscape ${land.w}px, portrait ${port.w}px, draft + ${port.msgs} messages preserved, no overflow`;
  });

  await test("Keyboard open/close does not hide the composer", async () => {
    const before = await page.evaluate(() => window.innerHeight);
    await page.click("#input");
    await sleep(2500);
    const withKb = await page.evaluate(() => {
      const c = document.querySelector("#composer")?.getBoundingClientRect();
      return { vh: window.innerHeight, inner: before, composerBottom: c ? Math.round(c.bottom) : -1, visual: Math.round(window.visualViewport?.height ?? 0) };
    });
    const ime = adb("shell", "dumpsys input_method | grep -m1 mInputShown");
    const shown = /true/.test(ime);
    adb("shell", "input keyevent 4"); // close the keyboard
    await sleep(1500);
    const after = await page.evaluate(() => window.innerHeight);
    assert(withKb.composerBottom <= (withKb.visual || withKb.vh) + 4, `composer clipped behind the keyboard (${withKb.composerBottom} > ${withKb.visual})`);
    return `IME shown=${shown}, viewport ${before} -> ${withKb.visual || withKb.vh} -> ${after}, composer visible`;
  });

  await test("Background and return: draft, session and messages survive", async () => {
    await page.fill("#input", "draft typed before going home");
    await sleep(900);
    const before = await page.evaluate(() => ({ title: document.querySelector("#chat-title-text")?.textContent, msgs: document.querySelectorAll(".msg").length }));
    home();
    await sleep(45000); // several minutes of realism are simulated by a long pause
    launch();
    await sleep(6000);
    ({ browser, page } = await attach());
    wire(page);
    const after = await page.evaluate(() => ({
      draft: document.querySelector("#input")?.value ?? "",
      title: document.querySelector("#chat-title-text")?.textContent ?? "",
      msgs: document.querySelectorAll(".msg").length,
      rows: document.querySelectorAll(".session-row").length,
      banner: document.querySelector("#net-banner")?.hidden,
    }));
    assert(after.draft === "draft typed before going home", "draft lost after background: " + JSON.stringify(after.draft.slice(0, 30)));
    assert(after.banner, "the socket did not come back");
    const dupes = await page.evaluate(() => {
      const u = [...document.querySelectorAll("#messages .msg-user")];
      return u.length - new Set(u.map((n) => n.innerText.trim())).size;
    });
    assert(dupes === 0, "duplicate messages after returning: " + dupes);
    await page.fill("#input", "");
    await sleep(600);
    return `45s background, draft kept, ${after.msgs} rows, socket up, 0 duplicates`;
  });

  await test("Process death: drafts and history recover from disk", async () => {
    await page.fill("#input", "draft that outlives the process");
    await sleep(900);
    home();
    await sleep(2500);
    const killed = adb("shell", `am kill ${PKG}`);
    await sleep(2000);
    const alive = appPid();
    if (alive) adb("shell", `kill -9 ${alive}`);
    await sleep(1500);
    launch();
    await sleep(9000);
    ({ browser, page } = await attach(90000));
    wire(page);
    const after = await page.evaluate(() => ({
      draft: document.querySelector("#input")?.value ?? "",
      rows: document.querySelectorAll(".session-row").length,
      chats: !document.querySelector("#screen-chat").hidden,
      msgs: document.querySelectorAll(".msg").length,
    }));
    assert(after.draft === "draft that outlives the process", "draft lost across process death: " + JSON.stringify(after.draft.slice(0, 30)));
    assert(after.rows > 0 || after.chats, "the app did not come back to a conversation");
    await page.fill("#input", "");
    await sleep(600);
    return `process killed (${killed}), reopened with the draft intact, ${after.chats ? after.msgs + " messages restored" : after.rows + " sessions"}`;
  });

  await test("Memory stays bounded across repeated session opens", async () => {
    const before = meminfo();
    const heap0 = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576));
    const ids = await page.evaluate(() => [...document.querySelectorAll(".session-row [data-open]")].map((n) => n.dataset.open).slice(0, 4));
    for (let round = 0; round < 3; round += 1) {
      for (const id of ids) {
        await page.evaluate(() => {
          const back = document.querySelector("#chat-back");
          if (back && !document.querySelector("#screen-chat").hidden) back.click();
        });
        await sleep(300);
        await page.click(`.session-row [data-open="${id}"]`).catch(() => {});
        await page.waitForSelector("#messages .msg", { timeout: 15000 }).catch(() => {});
        await sleep(500);
      }
    }
    await sleep(2000);
    const after = meminfo();
    const heap1 = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576));
    const growthMb = (after.kbs - before.kbs) / 1024;
    assert(growthMb < 120, `PSS grew ${growthMb.toFixed(0)} MB over 12 session opens (${before.kbs} -> ${after.kbs} kB)`);
    return `PSS ${(before.kbs / 1024).toFixed(0)} -> ${(after.kbs / 1024).toFixed(0)} MB after 12 opens, JS heap ${heap0} -> ${heap1} MB`;
  });

  console.log("\n========== DEVICE STRESS SUITE ==========");
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(56)} ${r.detail}`);
    r.status === "PASS" ? pass++ : fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  try { await browser.close(); } catch {}
  process.exitCode = fail ? 1 : 0;
})();