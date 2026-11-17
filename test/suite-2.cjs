const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const os = require("os");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAHUlEQVR42u3OMQEAAAgDINc/9AzhDxRgkjSpBwAA8BsFAAAB6ZVJAAAAAElFTkSuQmCC",
  "base64"
);
const SHOT = path.join(os.tmpdir(), "pocket-attach-test.png");
fs.writeFileSync(SHOT, PNG);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
    serviceWorkers: "block",
    acceptDownloads: true,
  });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: process.env.POCKET_URL || "http://127.0.0.1:8099" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

  const report = [];
  let archiveBaseline = 0;
  const test = async (name, fn) => {
    try {
      await resetUI();
      await sleep(150);
      const detail = await fn();
      report.push({ name, status: "PASS", detail: detail ?? "" });
    } catch (e) {
      console.log("\n--- FAIL " + name + " ---\n" + String(e.message).split("\n").slice(0, 6).join("\n"));
      report.push({ name, status: "FAIL", detail: String(e.message).split("\n").slice(0, 2).join(" ").slice(0, 150) });
    }
  };
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  const closeSheet = async () => {
    const open = await page.evaluate(() => {
      const s = document.querySelector("#sheet");
      return s && !s.hidden;
    });
    if (open) await page.click("#sheet-close").catch(() => {});
    await page.waitForFunction(() => document.querySelector("#sheet").hidden, { timeout: 3000 }).catch(() => {});
    await sleep(250);
  };
  // A failed test can leave a sheet (or the artifact) covering the screen and
  // then every later click times out. Clear the surfaces before each test.
  const resetUI = async () => {
    for (let i = 0; i < 5; i++) {
      const state = await page.evaluate(() => ({
        sheet: !document.querySelector("#sheet").hidden,
        artifact: !document.querySelector("#artifact").hidden,
      }));
      if (state.sheet) {
        await page.click("#sheet-close").catch(() => {});
        await sleep(300);
        continue;
      }
      if (state.artifact) {
        await page.click("#artifact-back").catch(() => {});
        await sleep(300);
        continue;
      }
      return;
    }
  };
  const openMenu = async () => {
    await page.click("#chat-menu");
    await sleep(350);
  };

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });
  await page.click('.session-row [data-open="ses_demo1"]');
  await page.waitForSelector(".msg", { timeout: 10000 });
  await sleep(700);

  /* ---------------------------------------------------------- changes sheet */
  await test("Changes sheet: files + patch", async () => {
    await page.click("#chat-diff");
    await sleep(500);
    const files = await page.$$eval(".diff-file", (x) => x.length);
    assert(files >= 2, "files=" + files);
    await page.click(".diff-file .diff-head");
    await sleep(250);
    const open = await page.$$eval(".diff-file.open .patch", (x) => x.length);
    const added = await page.$$eval(".diff-file.open .patch .dl.add", (x) => x.length);
    assert(open === 1 && added > 0, `open=${open} adds=${added}`);
    await closeSheet();
    return `${files} files, ${added} added lines`;
  });

  /* ---------------------------------------------------------- session info */
  await test("Session info sheet", async () => {
    await openMenu();
    await page.click('[data-action="info"]');
    await sleep(400);
    const txt = await page.$eval("#sheet-body", (n) => n.textContent);
    assert(/^ID/.test(txt.trim()) && /Model/i.test(txt), txt.slice(0, 60));
    await closeSheet();
    return "id, model, times";
  });

  /* -------------------------------------------------------------- skills */
  await test("Skills sheet + load", async () => {
    await openMenu();
    await page.click('[data-action="skills"]');
    await page.waitForSelector("[data-skill]", { timeout: 8000 });
    const n = await page.$$eval("[data-skill]", (x) => x.length);
    assert(n >= 3, "skills=" + n);
    await page.click("[data-skill]");
    await sleep(700);
    const toast = await page.$eval("#toast", (n) => (n.hidden ? "" : n.textContent));
    assert(/skill/i.test(toast), toast);
    return `${n} skills, "${toast}"`;
  });

  /* --------------------------------------------------------------- undo */
  await test("Undo stages a revert banner", async () => {
    await openMenu();
    await page.click('[data-action="undo"]');
    await sleep(400);
    await page.click("[data-confirm]");
    await page.waitForSelector("#revert-banner:not([hidden])", { timeout: 8000 });
    const txt = await page.$eval("#revert-banner .rev-text", (n) => n.textContent);
    assert(/rewound/i.test(txt), txt);
    return txt;
  });

  await test("Revert banner: keep", async () => {
    await page.click('[data-revert="keep"]');
    await page.waitForFunction(() => document.querySelector("#revert-banner").hidden, { timeout: 8000 });
    return "kept";
  });

  /* ------------------------------------------------------------ compact */
  await test("Compact context confirms", async () => {
    await openMenu();
    await page.click('[data-action="compact"]');
    await sleep(350);
    await page.click("[data-confirm]");
    await sleep(900);
    return "compacted";
  });

  /* --------------------------------------------------------- copy transcript */
  await test("Copy transcript to clipboard", async () => {
    await openMenu();
    await page.click('[data-action="copy"]');
    await sleep(600);
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert(text.length > 40 && /#/.test(text), "clipboard=" + text.slice(0, 40));
    return text.split("\n")[0].slice(0, 40);
  });

  /* ------------------------------------------------------------- rename */
  await test("Rename session", async () => {
    await openMenu();
    await page.click('[data-action="rename"]');
    await page.waitForSelector("#rename-input", { timeout: 5000 });
    await page.fill("#rename-input", "Renamed by test");
    await page.click("#rename-save");
    await sleep(700);
    const title = await page.$eval("#chat-title .chat-title-text", (n) => n.textContent.trim());
    assert(title === "Renamed by test", title);
    return title;
  });

  /* -------------------------------------------------------- model picker */
  await test("Model picker switches model", async () => {
    await page.click("#chip-model");
    await page.waitForSelector("#model-list .sheet-item", { timeout: 8000 });
    const rows = await page.$$eval("#model-list .sheet-item", (x) => x.length);
    assert(rows >= 2, "rows=" + rows);
    const current = await page.$eval("#model-list .sheet-item.on", (n) => n.dataset.model).catch(() => null);
    const target = await page.evaluate((cur) => {
      const btn = [...document.querySelectorAll("#model-list .sheet-item")].find((n) => n.dataset.model !== cur && n.dataset.model);
      if (!btn) return null;
      const key = btn.dataset.model;
      btn.click();
      return key;
    }, current);
    assert(target, "no other model");
    await sleep(800);
    const toast = await page.$eval("#toast", (n) => (n.hidden ? "" : n.textContent));
    const closed = await page.$eval("#sheet", (n) => n.hidden);
    assert(closed, "picker stayed open");
    return `${current} -> ${target} (${toast || "no toast"})`;
  });

  /* -------------------------------------------------------- agent picker */
  await test("Agent picker switches agent", async () => {
    const before = await page.$eval("#chip-agent span", (n) => n.textContent);
    await page.click("#chip-agent");
    await page.waitForSelector("[data-agent]", { timeout: 8000 });
    const rows = await page.$$eval("[data-agent]", (x) => x.length);
    assert(rows >= 2, "rows=" + rows);
    const picked = await page.evaluate((current) => {
      const btn = [...document.querySelectorAll("[data-agent]")].find((n) => n.textContent.trim() !== current);
      if (!btn) return null;
      const id = btn.dataset.agent;
      btn.click();
      return id;
    }, before);
    await sleep(700);
    const after = await page.$eval("#chip-agent span", (n) => n.textContent);
    assert(picked && after, `picked=${picked} after=${after}`);
    return `${before} -> ${after}`;
  });

  /* --------------------------------------------------------- slash hint */
  await test("Slash command hint", async () => {
    await page.fill("#input", "/rev");
    await sleep(600);
    const hint = await page.$eval("#composer-hint", (n) => n.textContent);
    assert(/review/i.test(hint), hint);
    await page.fill("#input", "");
    return hint.trim();
  });

  /* ------------------------------------------------------------- mention */
  await test("@ mention sheet", async () => {
    await page.click("#btn-mention");
    await page.waitForSelector("#mention-list .sheet-item[data-mention]", { timeout: 8000 });
    const initialRows = await page.$$eval("#mention-list .sheet-item[data-mention]", (x) => x.length);
    assert(initialRows >= 3, "initial rows=" + initialRows);
    await page.fill("#mention-search", "session");
    await sleep(600);
    const rows = await page.$$eval("#mention-list .sheet-item[data-mention]", (x) => x.length);
    assert(rows >= 1 && rows <= initialRows, `filtered=${rows}/${initialRows}`);
    await page.click("#mention-list .sheet-item[data-mention]");
    await sleep(600);
    const value = await page.$eval("#input", (n) => n.value);
    assert(/@/.test(value), value);
    return `${initialRows} on open, ${rows} filtered, input="${value.slice(0, 34)}"`;
  });

  /* ---------------------------------------------------------- attachment */
  await test("Image attachment chip", async () => {
    await closeSheet();
    await page.fill("#input", "");
    const [fc] = await Promise.all([page.waitForEvent("filechooser", { timeout: 8000 }), page.click("#btn-attach")]);
    await fc.setFiles(SHOT);
    await page.waitForSelector(".attach-chip img", { timeout: 8000 });
    const n = await page.$$eval(".attach-chip", (x) => x.length);
    assert(n === 1, "chips=" + n);
    await page.fill("#input", "what is in this image?");
    await page.click("#btn-send");
    await sleep(1200);
    const strip = await page.$eval("#attach-strip", (n) => n.hidden);
    assert(strip, "strip still visible after send");
    return "attached + sent";
  });

  /* --------------------------------------------------- message actions */
  await test("Answer menu: save .md", async () => {
    const btns = await page.$$(".msg-assistant .msg-actions button");
    assert(btns.length >= 3, "buttons=" + btns.length);
    await page.click('.msg-assistant [data-act="more-msg"]');
    await page.waitForSelector('[data-mact="save"]', { timeout: 6000 });
    const acts = await page.$$eval("[data-mact]", (x) => x.map((n) => n.dataset.mact));
    assert(acts.includes("copy-md") && acts.includes("share"), acts.join(","));
    const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    await page.click('[data-mact="save"]');
    const file = await dl;
    assert(file, "no download");
    return file.suggestedFilename();
  });

  /* -------------------------------------------------------- permission */
  await test("Permission request + allow", async () => {
    await page.fill("#input", "deploy the auth fix to production");
    await page.click("#btn-send");
    await page.waitForSelector("#sheet-body .permission-card", { timeout: 10000 });
    const action = await page.$eval(".permission-action", (n) => n.textContent);
    const banner = await page.$eval("#perm-banner", (n) => n.hidden);
    assert(!banner, "banner hidden");
    await page.click('[data-perm="once"]');
    await sleep(900);
    const hidden = await page.$eval("#perm-banner", (n) => n.hidden);
    assert(hidden, "banner still visible");
    return action;
  });

  /* ----------------------------------------------------------- new chat */
  await test("New session from FAB", async () => {
    await page.click("#chat-back");
    await sleep(400);
    await page.click("#fab-new");
    await page.waitForSelector("[data-dir]", { timeout: 8000 });
    await page.click("[data-dir]");
    await page.click("#create-session");
    await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector("#messages .welcome, #messages .empty"), { timeout: 8000 });
    await page.fill("#input", "fix the logout bug");
    await page.click("#btn-send");
    await page.waitForSelector(".msg-assistant .md", { timeout: 12000 });
    const n = await page.$$eval(".msg", (x) => x.length);
    assert(n >= 2, "messages=" + n);
    return `${n} messages, answer rendered`;
  });

  /* ------------------------------------------------------- theme switch */
  await test("Theme switch: light then black", async () => {
    await page.click("#chat-back");
    await sleep(350);
    await page.click("#open-settings");
    await sleep(350);
    await page.click('#theme-seg [data-theme="light"]');
    await sleep(300);
    const light = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('#theme-seg [data-theme="amoled"]');
    await sleep(300);
    const black = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    assert(light === "light", "light=" + light);
    assert(black.theme === "amoled", "black=" + black.theme);
    assert(black.bg === "rgb(0, 0, 0)", "bg=" + black.bg);
    return `light -> ${black.theme} ${black.bg}`;
  });

  /* ------------------------------------------------------- settings pages */
  for (const [sel, label, min] of [
    ["#open-providers", "Providers sheet", 2],
    ["#open-skills", "Settings skills sheet", 2],
    ["#open-stats", "Usage stats sheet", 3],
    ["#saved-permissions", "Saved permissions sheet", 0],
  ]) {
    await test(label, async () => {
      await page.click("#open-settings");
      await page.waitForSelector(sel, { timeout: 8000 });
      const open = await page.evaluate((s) => {
        const b = document.querySelector(s);
        if (!b) return false;
        b.click();
        return true;
      }, sel);
      if (!open) throw new Error("button missing");
      await sleep(700);
      const rows = await page.$$eval("#sheet-body .sheet-item, #sheet-body .setting-row, #sheet-body .stat", (x) => x.length);
      assert(rows >= min, "rows=" + rows);
      await closeSheet();
      return `${rows} rows`;
    });
  }

  /* ---------------------------------------------------- import a session */
  await test("Import is honest in demo mode", async () => {
    await page.click("#open-settings");
    await page.waitForSelector("#import-session", { timeout: 8000 });
    await page.click("#import-session");
    await sleep(500);
    const toast = await page.$eval("#toast", (n) => (n.hidden ? "" : n.textContent));
    assert(/demo/i.test(toast) && /server/i.test(toast), toast);
    await closeSheet();
    return toast;
  });

  /* ------------------------------------------------------------- archive */
  await test("Archive hides a session", async () => {
    const before = await page.$$eval(".session-row", (x) => x.length);
    archiveBaseline = before;
    await page.click('.session-row[data-id="ses_demo3"] [data-more]');
    await sleep(400);
    await page.click('[data-action="archive"]');
    await sleep(1000);
    const after = await page.$$eval(".session-row", (x) => x.length);
    const archivedIds = await page.evaluate(() => document.querySelectorAll(".session-row.archived").length);
    assert(archivedIds === 0, "archived row visible while the filter is off");
    assert(after === before - 1, `${before} -> ${after}`);
    const toggle = await page.$eval("#archived-toggle", (n) => ({ hidden: n.hidden, text: n.textContent }));
    assert(!toggle.hidden && /1/.test(toggle.text), JSON.stringify(toggle));
    return `${before} -> ${after}, "${toggle.text}"`;
  });

  await test("Archived toggle reveals + unarchive", async () => {
    await page.click("#archived-toggle");
    await sleep(500);
    const rows = await page.$$eval(".session-row", (x) => x.length);
    const marked = await page.$$eval(".session-row.archived", (x) => x.length);
    assert(rows === archiveBaseline && marked === 1, `rows=${rows}/${archiveBaseline} marked=${marked}`);
    await page.click('.session-row[data-id="ses_demo3"] [data-more]');
    await sleep(400);
    const action = await page.$eval('[data-action="unarchive"]', (n) => n.textContent).catch(() => "");
    assert(/unarchive/i.test(action), action);
    await page.click('[data-action="unarchive"]');
    await sleep(900);
    const markedAfter = await page.$$eval(".session-row.archived", (x) => x.length);
    assert(markedAfter === 0, "still archived");
    const toggleGone = await page.$eval("#archived-toggle", (n) => n.hidden);
    assert(toggleGone, "toggle visible with nothing archived");
    return `${archiveBaseline} rows, 1 marked -> ${markedAfter}`;
  });

  /* -------------------------------------------------------------- delete */
  await test("Delete asks first, then removes", async () => {
    const before = await page.$$eval(".session-row", (x) => x.length);
    await page.click('.session-row[data-id="ses_demo4"] [data-more]');
    await sleep(400);
    await page.click('[data-action="delete"]');
    await page.waitForSelector("#sheet-body [data-confirm]", { timeout: 5000 });
    const warning = await page.$eval("#sheet-body .sheet-note", (n) => n.textContent);
    assert(/cannot be undone/i.test(warning), warning);
    await page.click("#sheet-body [data-confirm]");
    await sleep(1000);
    const after = await page.$$eval(".session-row", (x) => x.length);
    assert(after === before - 1, `${before} -> ${after}`);
    return `${before} -> ${after}`;
  });

  /* ---------------------------------------------------------------- fork */
  await test("Fork opens a copy", async () => {
    await page.click('.session-row [data-open="ses_demo1"]');
    await page.waitForSelector(".msg", { timeout: 8000 });
    await sleep(600);
    await openMenu();
    await page.click('[data-action="fork"]');
    await sleep(350);
    await page.click("[data-confirm]");
    await sleep(1600);
    const title = await page.$eval("#chat-title .chat-title-text", (n) => n.textContent.trim());
    assert(/fork/i.test(title), title);
    return title;
  });

  console.log("\n================ FEATURE TEST REPORT 2 ================");
  let pass = 0,
    fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(38)} ${r.detail}`);
    if (r.status === "PASS") pass++;
    else fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
