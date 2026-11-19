const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark", serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  const report = [];
  const test = async (name, fn) => {
    try {
      const detail = await fn();
      report.push({ name, status: "PASS", detail: detail ?? "" });
    } catch (e) {
      report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 90) });
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  const closeArtifact = async () => {
    const open = await page.evaluate(() => !document.querySelector("#artifact").hidden);
    if (open) await page.click("#artifact-back");
    await page.waitForFunction(() => document.querySelector("#artifact").hidden, { timeout: 3000 }).catch(() => {});
    await sleep(350);
  };
  const closeSheet = async () => {
    const open = await page.evaluate(() => !document.querySelector("#sheet").hidden);
    if (open) await page.click("#sheet-close");
    await sleep(350);
  };

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  /* ---------------- sessions list ---------------- */
  await test("Sessions list + workspace grouping", async () => {
    const n = await page.$$eval(".session-row", (x) => x.length);
    const g = await page.$$eval(".ws-group", (x) => x.length);
    assert(n >= 8 && g >= 3, `rows=${n} groups=${g}`);
    return `${n} sessions, ${g} workspaces`;
  });

  await test("Session search", async () => {
    await page.fill("#session-search", "upload");
    await sleep(500);
    const n = await page.$$eval(".session-row", (x) => x.length);
    assert(n >= 1 && n <= 3, `filtered rows=${n}`);
    await page.fill("#session-search", "");
    await sleep(400);
    return `${n} match`;
  });

  await test("Unread badge", async () => {
    const n = await page.$$eval(".session-row.unread", (x) => x.length);
    assert(n >= 1, "no unread row");
    return `${n} unread`;
  });

  /* ---------------- open a chat ---------------- */
  await page.click('.session-row [data-open="ses_demo8"]');
  await page.waitForSelector(".msg", { timeout: 10000 });
  await sleep(800);

  await test("Chat render: markdown + table", async () => {
    const t = await page.$$eval(".md .table-wrap", (x) => x.length);
    const h = await page.$$eval(".md h1, .md h2", (x) => x.length);
    assert(t >= 1 && h >= 2, `tables=${t} headings=${h}`);
    return `${t} table, ${h} headings`;
  });

  await test("Activity timeline expand", async () => {
    const before = await page.$$eval(".activity.open", (x) => x.length);
    await page.click("[data-toggle-activity]");
    await sleep(200);
    const after = await page.$$eval(".activity.open", (x) => x.length);
    assert(after > before, `${before}->${after}`);
    return `${before} -> ${after}`;
  });

  await test("Message actions present", async () => {
    const n = await page.$$eval(".msg-actions button", (x) => x.length);
    assert(n >= 4, `actions=${n}`);
    return `${n} action buttons`;
  });

  await test("Task progress checklist", async () => {
    const hidden = await page.$eval("#todo-panel", (n) => n.hidden);
    const rows = await page.$$eval(".todo-row", (x) => x.length);
    assert(!hidden && rows === 4, `hidden=${hidden} rows=${rows}`);
    return `${rows} steps`;
  });

  await test("Branch chip (VCS)", async () => {
    const hidden = await page.$eval("#chat-branch", (n) => n.hidden);
    const txt = await page.$eval("#chat-branch", (n) => n.textContent);
    assert(!hidden, "hidden");
    return txt;
  });

  await test("Find in conversation + jump", async () => {
    await page.click("#chat-find");
    await page.fill("#find-q", "upload");
    await sleep(300);
    const hits = await page.$$eval(".find-hit", (x) => x.length);
    assert(hits >= 1, `hits=${hits}`);
    await page.click(".find-hit");
    await sleep(700);
    const flashed = await page.$$eval(".msg.flash", (x) => x.length);
    assert(flashed >= 1, "no flash");
    return `${hits} hits, jumped`;
  });

  /* ---------------- artifacts ---------------- */
  await test("Artifact cards detected", async () => {
    const n = await page.$$eval(".artifact-card", (x) => x.length);
    assert(n >= 3, `cards=${n}`);
    return `${n} cards`;
  });

  for (const [idx, label] of [[0, "Code artifact workspace"], [1, "Diagram artifact"], [2, "Document artifact"]]) {
    await test(label, async () => {
      const cards = await page.$$(".artifact-card");
      if (!cards[idx]) throw new Error("card missing");
      await cards[idx].click();
      await sleep(500);
      const info = await page.evaluate(() => ({
        open: !document.querySelector("#artifact").hidden,
        title: document.querySelector("#artifact-title")?.textContent,
        tabs: document.querySelectorAll("#artifact-tabs button").length,
        body: document.querySelector("#artifact-body")?.innerHTML.length,
      }));
      assert(info.open && info.body > 50, JSON.stringify(info));
      await closeArtifact();
      return `${info.title}`;
    });
  }

  // HTML artifact in ses_demo7
  await page.click("#chat-back");
  await sleep(400);
  await page.click('.session-row [data-open="ses_demo7"]');
  await page.waitForSelector(".msg", { timeout: 10000 });
  await sleep(700);

  await test("HTML artifact sandbox preview", async () => {
    const card = await page.$(".artifact-card");
    assert(card, "no card");
    await card.click();
    await sleep(500);
    const info = await page.evaluate(() => ({
      frame: !!document.querySelector("#artifact-body iframe"),
      sandbox: document.querySelector("#artifact-body iframe")?.getAttribute("sandbox"),
    }));
    assert(info.frame && info.sandbox?.includes("allow-scripts") && !info.sandbox?.includes("allow-same-origin"), JSON.stringify(info));
    await closeArtifact();
    return "sandboxed iframe";
  });

  await test("Artifact actions menu (copy/wrap)", async () => {
    const card = await page.$(".artifact-card");
    await card.click();
    await sleep(400);
    await page.click("#artifact-more");
    await sleep(400);
    const acts = await page.$$eval("[data-aact]", (x) => x.map((n) => n.dataset.aact));
    assert(acts.includes("copy") && acts.includes("wrap"), JSON.stringify(acts));
    await page.click('[data-aact="wrap"]');
    await sleep(300);
    const wrapped = await page.$eval("#artifact-body", (n) => n.classList.contains("wrap"));
    assert(wrapped, "wrap not applied");
    await closeArtifact();
    return acts.join(",");
  });

  /* ---------------- scroll fix ---------------- */
  await test("Send message scrolls to bottom", async () => {
    await page.fill("#input", "hello there");
    await page.click("#btn-send");
    await sleep(1500);
    const p = await page.evaluate(() => {
      const m = document.querySelector("#messages");
      return Math.round(m.scrollHeight - m.scrollTop - m.clientHeight);
    });
    assert(p < 140, `fromBottom=${p}`);
    return `fromBottom=${p}`;
  });

  /* ---------------- forms & queue ---------------- */
  await test("Form question tool", async () => {
    await page.fill("#input", "which approach should I take?");
    await page.click("#btn-send");
    await page.waitForSelector(".form-card", { timeout: 12000 });
    const fields = await page.$$eval(".form-field", (x) => x.length);
    assert(fields >= 3, `fields=${fields}`);
    return `${fields} fields`;
  });

  await test("Form conditional fields", async () => {
    const before = await page.$eval('.form-field[data-key="note"]', (n) => n.hidden);
    await page.click('.opt[data-value="refresh"]');
    await sleep(250);
    const after = await page.$eval('.form-field[data-key="note"]', (n) => n.hidden);
    assert(before && !after, `${before}->${after}`);
    return "shows on refresh";
  });

  await test("Form submit + answer", async () => {
    await page.click("[data-form-submit]");
    // The pending card closes; the question stays in the transcript as the
    // turn's activity, and the agent's follow-up answer arrives.
    await page.waitForFunction(() => !document.querySelector("#messages .form-card"), { timeout: 8000 });
    await page.waitForFunction(() => /going with/i.test(document.querySelector("#messages")?.innerText ?? ""), { timeout: 8000 });
    return "answered, card closed, follow-up shown";
  });

  await test("Queue / steer + inbox", async () => {
    await page.fill("#input", "Summarize the auth module");
    await page.click("#btn-send");
    await sleep(700);
    const chipHidden = await page.$eval("#delivery-toggle", (n) => n.hidden);
    assert(!chipHidden, "delivery chip hidden");
    await page.click("#delivery-toggle");
    await page.fill("#input", "Then add a test");
    await page.click("#btn-send");
    await page.waitForSelector("#inbox-bar:not([hidden]) .inbox-chip", { timeout: 8000 });
    const txt = await page.$eval(".inbox-chip .ib-mode", (n) => n.textContent);
    assert(txt === "Queued", txt);
    await page.click("[data-inbox-cancel]");
    await sleep(300);
    return "queued + cancelled";
  });

  /* ---------------- settings ---------------- */
  await page.click("#chat-back");
  await sleep(400);
  await page.click("#open-settings");
  await sleep(300);

  await test("Preferences studio", async () => {
    await page.click("#open-prefs");
    await sleep(300);
    const s = await page.$$eval(".prefs-head", (x) => x.map((n) => n.textContent));
    assert(s.length === 4, JSON.stringify(s));
    await page.click('[data-pref-toggle="timestamps"]');
    await sleep(200);
    const ts = await page.$eval("html", (n) => n.dataset.timestamps);
    assert(ts === "on", ts);
    await page.click("[data-pref-reset]");
    await sleep(200);
    return `${s.length} sections`;
  });
  await closeSheet();

  await test("Connections sheet", async () => {
    await page.click("#open-settings");
    await sleep(250);
    await page.click("#open-auth");
    await sleep(500);
    const n = await page.$$eval(".auth-provider", (x) => x.length);
    assert(n >= 4, `providers=${n}`);
    await closeSheet();
    return `${n} providers`;
  });

  await test("MCP controls + resources", async () => {
    await page.click("#open-settings");
    await sleep(250);
    await page.click("#open-mcp");
    await sleep(500);
    const buttons = await page.$$eval(".mcp-actions button", (x) => x.length);
    assert(buttons >= 6, `buttons=${buttons}`);
    await page.click("[data-mcp-resources]");
    await sleep(400);
    const res = await page.$$eval(".sheet-item .si-title", (x) => x.length);
    assert(res >= 2, `resources=${res}`);
    await closeSheet();
    return `${buttons} buttons, ${res} resources`;
  });

  await test("Export session", async () => {
    await page.click('.session-row [data-open="ses_demo1"]');
    await page.waitForSelector(".msg", { timeout: 8000 });
    await sleep(500);
    await page.click("#chat-menu");
    await sleep(300);
    const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    await page.click('[data-action="export"]');
    const file = await dl;
    assert(file, "no download");
    return file.suggestedFilename();
  });

  console.log("\n================ FEATURE TEST REPORT ================");
  let pass = 0, fail = 0;
  for (const r of report) {
    console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(38)} ${r.detail}`);
    if (r.status === "PASS") pass++; else fail++;
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
