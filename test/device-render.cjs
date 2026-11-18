/* Device suite — the Aurora-derived renderer inside the installed APK.
 *
 * Aurora Preview (MIT, github.com/Abhishekkumar2021/aurora-preview) is the
 * reference for the transcript renderer. This suite drives the real WebView of
 * the installed app (CDP) over the bundled pipeline and checks every adopted
 * piece on the phone itself: callouts, KaTeX (inline + block), highlight.js,
 * tables, task lists, footnotes, Hindi text, the image lightbox, a lazily drawn
 * Mermaid diagram, the self-contained HTML export (through PocketNative.saveText
 * into Downloads) and the native print document.
 *
 * It uses the demo transcript ses_demo10 so the content is deterministic; the
 * live server path is covered by device-live.cjs.
 */
const { chromium } = require("playwright-core");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADB = process.env.ADB || "C:\\Users\\Shiva\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe";
const CDP = process.env.CDP || "http://127.0.0.1:9226";
const PKG = "com.shivapal.opencodepocket";

const adb = (...args) => {
  try {
    return execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch (e) {
    return "ERR " + String(e.stdout ?? e.message ?? "").slice(0, 160);
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

const forwardCdp = () => {
  const pid = adb("shell", `ps -A -o PID,NAME | grep ${PKG} | grep -v grep | awk '{print $1}'`)
    .split(/\s+/).find((x) => /^\d+$/.test(x));
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
          const score = await p.evaluate(() => (window.PocketNative ? document.querySelectorAll(".msg").length + 1 : -1));
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

(async () => {
  let { browser, page } = await attach();
  const realUrl = page.url();
  const origin = new URL(realUrl).origin;
  console.log("real app url:", realUrl);
  const downloads = () => adb("shell", "ls -t /sdcard/Download/ | head -12").split(/\s+/).filter(Boolean);

  await test("The bundled renderer loads (Aurora pipeline, no CDN)", async () => {
    await page.goto(`${origin}/?demo=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".session-row", { timeout: 20000 });
    const externals = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((r) => r.name).filter((n) => !n.startsWith(location.origin) && !n.startsWith("data:") && !n.startsWith("blob:"))
    );
    assert(externals.length === 0, "external requests: " + externals.join(", "));
    const libs = await page.evaluate(() => {
      const names = performance.getEntriesByType("resource").map((r) => r.name);
      return {
        md: names.some((n) => n.includes("pocket-md")),
        css: [...document.styleSheets].some((s) => (s.href || "").includes("katex.css")),
      };
    });
    assert(libs.md, "pocket-md.mjs was not loaded");
    return `bundled markdown engine${libs.css ? " + local KaTeX css" : ""}, zero external requests`;
  });

  await test("Everything adopted from Aurora renders on the phone", async () => {
    await page.click('.session-row [data-open="ses_demo10"]');
    await page.waitForSelector(".msg .md", { timeout: 20000 });
    await sleep(800);
    const info = await page.evaluate(() => {
      const md = document.querySelector(".msg .md");
      const code = md.querySelector(".code-block code");
      return {
        callout: md.querySelectorAll(".markdown-alert-warning").length,
        calloutTitle: md.querySelector(".markdown-alert-title")?.innerText.trim() ?? "",
        katex: md.querySelectorAll("eq .katex").length,
        katexBlock: md.querySelectorAll("eqn .katex-display").length,
        rawMathLeft: /\\frac|\\cdot|T_\{exp\}/.test(md.innerText),
        hljs: code ? code.querySelectorAll("[class*='hljs-']").length : 0,
        codeToolbar: md.querySelectorAll(".code-block [data-copy]").length,
        tableRows: md.querySelectorAll("table tr").length,
        tasks: md.querySelectorAll(".task").length,
        tasksDone: md.querySelectorAll(".task.done").length,
        footnote: md.querySelectorAll(".footnote-ref, .footnotes li").length,
        hindi: /सत्र|सत्र|पाठ|स्रोत/.test(md.innerText) || /[\u0900-\u097F]/.test(md.innerText),
        image: md.querySelectorAll("img").length,
        mermaidBlocks: md.querySelectorAll("pre.mermaid").length,
      };
    });
    assert(info.callout === 1, "callouts=" + info.callout);
    assert(/warning/i.test(info.calloutTitle), "callout title=" + info.calloutTitle);
    assert(info.katex >= 1 && info.katexBlock >= 1, `katex inline=${info.katex} block=${info.katexBlock}`);
    assert(!info.rawMathLeft, "raw TeX is still visible");
    assert(info.hljs >= 3, "highlight tokens=" + info.hljs);
    assert(info.codeToolbar >= 1, "no copy button on the code block");
    assert(info.tableRows >= 3, "table rows=" + info.tableRows);
    assert(info.tasks === 3 && info.tasksDone === 1, `tasks=${info.tasks} done=${info.tasksDone}`);
    assert(info.footnote >= 2, "footnote markup=" + info.footnote);
    assert(info.hindi, "Hindi text missing");
    assert(info.image >= 1, "inline image missing");
    assert(info.mermaidBlocks >= 1, "no diagram block");
    return `callout, ${info.katex} inline + ${info.katexBlock} block math, ${info.hljs} code tokens, ${info.tableRows} table rows, ${info.tasks} tasks, footnote, Hindi`;
  });

  await test("The diagram is drawn lazily and opens full-screen", async () => {
    await page.$eval("pre.mermaid", (n) => n.scrollIntoView({ block: "center" }));
    await page.waitForFunction(() => document.querySelectorAll("pre.mermaid.drawn svg").length >= 1, { timeout: 30000 });
    const box = await page.evaluate(() => {
      const svg = document.querySelector("pre.mermaid.drawn svg");
      const r = svg.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), nodes: svg.querySelectorAll("g.node").length };
    });
    assert(box.w > 40 && box.h > 20, "diagram has no size: " + JSON.stringify(box));
    await page.click("pre.mermaid.drawn");
    await sleep(900);
    const viewer = await page.evaluate(() => ({
      open: document.querySelector("#lightbox")?.classList.contains("open"),
      svg: document.querySelectorAll("#lightbox svg").length,
      source: !document.querySelector("#lightbox-source")?.hidden,
    }));
    assert(viewer.open && viewer.svg >= 1, "full-screen viewer did not open: " + JSON.stringify(viewer));
    await page.click("#lightbox-close");
    await sleep(400);
    return `${box.w}x${box.h}px, ${box.nodes} nodes, viewer opened with a Source toggle`;
  });

  await test("The image opens in the lightbox", async () => {
    await page.$eval(".msg .md img", (n) => n.scrollIntoView({ block: "center" }));
    await page.click(".msg .md img");
    await sleep(700);
    const img = await page.evaluate(() => ({
      open: document.querySelector("#lightbox")?.classList.contains("open"),
      src: document.querySelector("#lightbox img")?.getAttribute("src") ?? "",
    }));
    assert(img.open && img.src, "image lightbox did not open");
    await page.click("#lightbox-close");
    await sleep(300);
    return "opened and closed";
  });

  await test("Export HTML is a self-contained file in Downloads", async () => {
    const before = downloads();
    const more = await page.$$('.msg-actions button[data-act="more-msg"]');
    await more[more.length - 1].click();
    await sleep(500);
    await page.click('[data-mact="export-html"]');
    await sleep(2500);
    const after = downloads();
    const fresh = after.find((f) => !before.includes(f) && /\.html$/i.test(f));
    assert(fresh, "no new .html in Downloads (before=" + before.slice(0, 4).join(",") + ")");
    const local = path.join(process.env.TEMP || ".", "device-export-" + Date.now() + ".html");
    adb("pull", `/sdcard/Download/${fresh}`, local);
    const html = fs.readFileSync(local, "utf8");
    assert(/^<!doctype html>/i.test(html.trim()), "not a document");
    assert(html.includes("<math"), "no MathML math in the export");
    assert(html.includes("markdown-alert"), "no callout styling");
    assert(html.includes('class="code-block"'), "no code block");
    assert(html.includes("@media print"), "no print sheet");
    assert(!/<script/i.test(html), "the export contains a script");
    assert(html.length > 8000, "suspiciously small: " + html.length);
    assert(/[\u0900-\u097F]/.test(html), "Hindi lost in the export");
    return `${fresh} · ${Math.round(html.length / 1024)} KB · self-contained, no script`;
  });

  await test("Print goes through the Android print service", async () => {
    const more = await page.$$('.msg-actions button[data-act="more-msg"]');
    await more[more.length - 1].click();
    await sleep(500);
    await page.click('[data-mact="print"]');
    // The native bridge hands a rendered document to PrintManager, so the proof
    // is the system print UI coming to the front (there is no iframe on device).
    let top = "";
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      top = adb("shell", "dumpsys activity activities | grep -E 'topResumedActivity' | head -1");
      if (/print/i.test(top)) break;
    }
    assert(/print/i.test(top), "the print UI never opened: " + top.slice(0, 140));
    adb("shell", "input keyevent 4");
    await sleep(1200);
    const spooler = (top.match(/[a-z0-9_.]*print[a-z0-9_.]*\/[A-Za-z0-9_.]*/i) || [top])[0];
    return `system print UI opened (${spooler.replace(/^.*?u0 /, "").slice(0, 60)})`;
  });

  await test("The real app comes back clean (no demo ids, no fake offline copy)", async () => {
    await page.goto(realUrl, { waitUntil: "domcontentloaded" });
    let st = null;
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      st = await page.evaluate(() => ({
        rows: document.querySelectorAll(".session-row").length,
        chatMsgs: document.querySelectorAll("#messages .msg").length,
        chats: !document.querySelector("#screen-chat")?.hidden,
        connect: !document.querySelector("#screen-connect")?.hidden,
        banner: document.querySelector("#net-banner")?.hidden,
        demoRows: [...document.querySelectorAll(".session-row")].filter((n) => /^ses_demo/.test(n.dataset.id || "")).length,
        fakeOffline: /server offline|saved copy/i.test(document.body.innerText),
        saved: {
          last: localStorage.getItem("ocp.lastSessionID") || "",
          tabs: localStorage.getItem("ocp.sessionTabs") || "",
        },
        demoKeys: Object.keys(localStorage).filter((k) => k.startsWith("ocp.demo.")).length,
      }));
      if ((st.rows > 0 || (st.chats && st.chatMsgs > 0)) && !st.connect) break;
    }
    assert(st && !st.connect, "the app fell back to the connect screen");
    assert(st.rows > 0 || (st.chats && st.chatMsgs > 0), "no real session after the demo run");
    assert(st.banner, "the connection did not settle");
    assert(st.demoRows === 0, st.demoRows + " demo sessions leaked into the real list");
    assert(!st.fakeOffline, "the app claims a saved copy after a demo run");
    assert(!/ses_demo/.test(st.saved.last) && !/ses_demo/.test(st.saved.tabs), "demo ids were remembered: " + JSON.stringify(st.saved));
    return `${st.rows} real sessions, 0 demo ids, ${st.demoKeys} isolated demo keys, no fake offline notice`;
  });

  console.log("\n========== DEVICE RENDER SUITE (Aurora-derived pipeline) ==========");
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(60)} ${r.detail}`);
    r.status === "PASS" ? pass++ : fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  try { await browser.close(); } catch {}
  process.exitCode = fail ? 1 : 0;
})();