/* Suite 17 - icon integrity after the Lucide migration.
 *
 * The sprite is generated from the pinned `lucide` vanilla JS package into
 * index.html (offline, no CDN, no runtime icon JS). This suite checks the
 * static contract and then walks the live UI: every `<use>` must resolve,
 * every icon-only button must have an accessible name, icon-only controls must
 * share one stroke width, and nothing may regress after a streaming reply or a
 * sheet is rendered dynamically.
 */
const { chromium } = require("playwright-core");
const { execFileSync } = require("node:child_process");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

  const report = [];
  const test = async (name, fn) => {
    try {
      const detail = await fn();
      report.push({ name, status: "PASS", detail: detail || "" });
    } catch (e) {
      report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 170) });
    }
  };
  const assert = (c, m) => {
    if (!c) throw new Error(m);
  };

  const checkIcons = (label) =>
    page.evaluate((label) => {
      const uses = [...document.querySelectorAll('use[href^="#i-"]')];
      const missing = uses.map((u) => u.getAttribute("href")).filter((h) => !document.querySelector(h));
      const strokes = new Set();
      for (const use of uses) {
        const svg = use.parentElement;
        if (!svg || svg.classList.contains("sprite")) continue;
        strokes.add(getComputedStyle(svg).strokeWidth);
      }
      const unnamed = [...document.querySelectorAll("button")]
        .filter((b) => b.querySelector("use") && !(b.innerText || "").trim())
        .filter((b) => !(b.getAttribute("aria-label") || b.getAttribute("title") || "").trim())
        .map((b) => b.id || b.className);
      return { label, count: uses.length, missing, strokes: [...strokes], unnamed };
    }, label);
  const expectClean = (r) => {
    assert(r.count > 0, r.label + ": no icons rendered");
    assert(r.missing.length === 0, r.label + ": missing " + r.missing.slice(0, 4).join(","));
    assert(r.strokes.length === 1, r.label + ": mixed stroke widths " + r.strokes.join("/"));
    assert(r.strokes[0] === "1.8px", r.label + ": stroke " + r.strokes[0]);
    assert(r.unnamed.length === 0, r.label + ": unnamed icon buttons " + r.unnamed.slice(0, 4).join(","));
    return `${r.count} icons, stroke ${r.strokes[0]}, 0 missing, 0 unnamed`;
  };

  /* ---- static contract --------------------------------------------------- */
  await test("1. Generator reports the committed sprite up to date", async () => {
    const out = execFileSync(process.execPath, ["tools/icons.mjs", "--check"], { encoding: "utf8" });
    assert(/up to date/.test(out), out.trim());
    return out.trim();
  });

  await test("2. No CDN or runtime icon JS is referenced", async () => {
    const html = require("node:fs").readFileSync("index.html", "utf8");
    assert(!/lucide\.(dev|com)/i.test(html.replace(/<!--[\s\S]*?-->/g, "")), "CDN url in markup");
    assert(!/data-lucide/.test(html), "data-lucide placeholder found");
    assert(!/assets\/vendor\/lucide/i.test(html), "runtime Lucide bundle referenced");
    return "local inline sprite only";
  });

  await test("3. Every sprite symbol is a Lucide 24px outline", async () => {
    const html = require("node:fs").readFileSync("index.html", "utf8");
    const symbols = [...html.matchAll(/<symbol id="i-([a-z0-9-]+)"([^>]*)>/g)];
    assert(symbols.length >= 45, "only " + symbols.length + " symbols");
    const bad = symbols
      .filter((m) => !/id="i-(logo|github)"/.test(m[0]))
      .filter((m) => !/viewBox="0 0 24 24"/.test(m[2]) || !/stroke-width="1\.8"/.test(m[2]) || !/stroke="currentColor"/.test(m[2]))
      .map((m) => m[1]);
    assert(bad.length === 0, "non-Lucide symbols: " + bad.join(","));
    return `${symbols.length} symbols, 2 brand marks`;
  });

  /* ---- live UI ----------------------------------------------------------- */
  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  await test("4. Sessions screen: all icons resolve and are labelled", async () => {
    return expectClean(await checkIcons("sessions"));
  });

  const openSession = async () => {
    await page.click('.session-row [data-open="ses_demo1"]');
    await page.waitForSelector("#messages .msg", { timeout: 15000 });
    await sleep(400);
  };
  await openSession();

  await test("5. Chat screen: composer, header and messages", async () => {
    return expectClean(await checkIcons("chat"));
  });

  await test("6. Chat controls use the intended Lucide glyphs", async () => {
    const names = await page.evaluate(() => {
      const ref = (sel) => document.querySelector(sel)?.querySelector("use")?.getAttribute("href") ?? "";
      return {
        attach: ref("#btn-attach"),
        voice: ref("#btn-voice"),
        send: ref("#btn-send"),
        find: ref("#chat-find"),
        diff: ref("#chat-diff"),
      };
    });
    assert(names.attach === "#i-attach", "attach: " + names.attach);
    assert(names.voice === "#i-mic", "voice: " + names.voice);
    assert(names.send === "#i-send", "send: " + names.send);
    assert(names.find === "#i-search", "find: " + names.find);
    assert(names.diff === "#i-diff", "diff: " + names.diff);
    return `attach=${names.attach} mic=${names.voice} send=${names.send}`;
  });

  await test("7. Streaming update keeps copy / retry / expand icons valid", async () => {
    await page.fill("#input", "quick tool please");
    await page.click("#btn-send");
    await page.waitForFunction(() => document.querySelector("#btn-send")?.dataset?.mode === "stop", { timeout: 10000 });
    await sleep(900);
    const mid = await checkIcons("streaming");
    // Force a tool/activity row and message action bar to render.
    await page.waitForSelector("#messages .activity", { timeout: 10000 });
    await page.waitForSelector("#btn-send[data-mode='send']", { timeout: 20000 });
    await sleep(400);
    const after = await checkIcons("after stream");
    const actions = await page.evaluate(() => {
      const btn = document.querySelector("#messages .msg-actions button");
      return btn ? btn.querySelector("use")?.getAttribute("href") ?? "" : "";
    });
    assert(actions === "#i-copy", "first message action: " + actions);
    return expectClean(mid) + " / " + expectClean(after);
  });

  await test("8. Stop swaps Send to the Lucide stop glyph, then back", async () => {
    await page.fill("#input", "stop me now");
    await page.click("#btn-send");
    await page.waitForFunction(() => document.querySelector("#btn-send")?.dataset?.mode === "stop", { timeout: 10000 });
    await sleep(700);
    const stop = await page.evaluate(() => ({
      glyph: document.querySelector("#btn-send use")?.getAttribute("href"),
      label: document.querySelector("#btn-send")?.getAttribute("aria-label"),
    }));
    assert(stop.glyph === "#i-stop", "stop glyph: " + stop.glyph);
    assert(stop.label === "Stop", "stop label: " + stop.label);
    await page.click("#btn-send");
    await page.waitForFunction(() => document.querySelector("#btn-send")?.dataset?.mode === "send", { timeout: 15000 });
    return "stop -> send, handlers intact";
  });

  await test("9. Every sheet renders valid icons (Customize, Providers, Plugins & MCP, Projects, Worktrees, Scheduled, Library, Settings)", async () => {
    const sections = ["customize", "plugins", "projects", "worktrees", "tasks", "library"];
    const seen = [];
    // The sidebar toggle lives on the sessions screen, not in chat.
    await page.click("#chat-back");
    await page.waitForSelector("#open-sidebar", { timeout: 5000 });
    for (const section of sections) {
      await page.click("#open-sidebar");
      await page.waitForSelector(`#sidebar [data-side="${section}"]`, { timeout: 5000 });
      await page.click(`#sidebar [data-side="${section}"]`);
      await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 });
      await sleep(250);
      seen.push(expectClean(await checkIcons(section)) + ` (${section})`);
      if (section === "customize") {
        await page.click('[data-cust="providers"]');
        await page.waitForFunction(() => /provider/i.test(document.querySelector("#sheet-title")?.textContent || ""), {
          timeout: 5000,
        });
        await sleep(250);
        seen.push(expectClean(await checkIcons("providers")) + " (providers)");
      }
      await page.click("#sheet-close");
      await sleep(180);
    }
    // Settings is reachable from the sessions header.
    await page.click("#open-settings");
    await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 });
    await sleep(250);
    seen.push(expectClean(await checkIcons("settings")));
    await page.click("#sheet-close");
    return seen.join(" | ");
  });

  await test("10. No page errors after all dynamic rendering", async () => {
    assert(errors.length === 0, errors.slice(0, 3).join("; "));
    return "0 errors";
  });

  await browser.close();
  const passed = report.filter((entry) => entry.status === "PASS").length;
  const failed = report.length - passed;
  for (const entry of report) {
    console.log(`${entry.status === "PASS" ? "PASS" : "FAIL"}  ${entry.name}${entry.detail ? "  -  " + entry.detail : ""}`);
  }
  console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error("SUITE CRASHED:", error);
  process.exitCode = 1;
});
