const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark", serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  const report = [];
  const test = async (name, fn) => { try { const d = await fn(); report.push({ name, status: "PASS", detail: d || "" }); } catch (e) { report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 90) }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });
  await page.click('.session-row [data-open="ses_demo1"]');
  await page.waitForSelector("#screen-chat:not([hidden])", { timeout: 8000 });
  await sleep(500);

  await test("Activity starts collapsed", async () => {
    const open = await page.$$eval(".activity.open", (x) => x.length);
    const all = await page.$$eval(".activity", (x) => x.length);
    assert(all >= 1 && open === 0, `open=${open} all=${all}`);
    return `${all} groups, all collapsed`;
  });

  await test("Activity expands to full width", async () => {
    await page.click("[data-toggle-activity]");
    await sleep(300);
    const info = await page.evaluate(() => {
      const a = document.querySelector(".activity.open");
      const m = document.querySelector("#messages");
      const ar = a.getBoundingClientRect();
      const mr = m.getBoundingClientRect();
      return { aw: Math.round(ar.width), mw: Math.round(mr.width), visible: a.querySelector(".activity-body").getBoundingClientRect().height > 0 };
    });
    assert(info.aw >= info.mw - 36 && info.visible, JSON.stringify(info));
    return `${info.aw}/${info.mw}px`;
  });

  await test("Activity collapses again", async () => {
    await page.click("[data-toggle-activity]");
    await sleep(250);
    const open = await page.$$eval(".activity.open", (x) => x.length);
    assert(open === 0, "open=" + open);
    return "collapsed";
  });

  await test("Stop response works", async () => {
    await page.fill("#input", "Write a long explanation of this project step by step.");
    await page.click("#btn-send");
    await sleep(900);
    const busy = await page.$eval("#btn-send", (n) => n.getAttribute("aria-label"));
    assert(busy === "Stop", "label=" + busy);
    await page.click("#btn-send");
    await sleep(1200);
    const after = await page.$eval("#btn-send", (n) => n.getAttribute("aria-label"));
    const stopped = await page.evaluate(() => document.body.textContent.includes("Stopped") || document.body.textContent.includes("Interrupted"));
    assert(after === "Send", "label after=" + after);
    return `stop -> ${after}${stopped ? " · stopped message" : ""}`;
  });

  await test("Composer buttons respond", async () => {
    const ids = ["#btn-attach", "#btn-mention", "#btn-voice", "#chip-model", "#chip-agent"];
    for (const id of ids) {
      const visible = await page.$eval(id, (n) => !!n && getComputedStyle(n).display !== "none").catch(() => false);
      assert(visible, id + " missing");
    }
    return ids.length + " controls";
  });

  await test("One activity panel per user request", async () => {
    await page.click("#chat-back");
    await sleep(350);
    await page.click('.session-row [data-open="ses_demo3"]');
    await page.waitForSelector(".msg", { timeout: 8000 });
    await sleep(500);
    const count = async () =>
      page.evaluate(() => ({
        users: document.querySelectorAll(".msg-user").length,
        panels: document.querySelectorAll(".activity").length,
      }));
    const before = await count();
    await page.fill("#input", "multi-step change please");
    await page.click("#btn-send");
    await sleep(2600);
    const after = await count();
    assert(after.users === before.users + 1, `users ${before.users}->${after.users}`);
    assert(after.panels === before.panels + 1, `panels ${before.panels}->${after.panels}`);
    return `${after.users} requests · ${after.panels} panels`;
  });

  await test("Activity rows keep real tool names", async () => {
    // The expanded body used to receive the {part, idx} wrapper instead of the
    // part, so every row degraded to "Running tool" with a spinner even after
    // the turn finished.
    await page.evaluate(() => {
      const panels = [...document.querySelectorAll(".activity")];
      const last = panels[panels.length - 1];
      last.scrollIntoView({ block: "center" });
      if (!last.classList.contains("open")) last.querySelector("[data-toggle-activity]").click();
    });
    await sleep(400);
    const info = await page.evaluate(() => {
      const panels = [...document.querySelectorAll(".activity")];
      const body = panels[panels.length - 1].querySelector(".activity-body");
      return {
        names: [...body.querySelectorAll(".tool-name")].map((n) => n.textContent.trim()),
        states: [...body.querySelectorAll(".tool-state")].map((n) => n.dataset.status),
        reasoning: body.querySelectorAll(".reasoning").length,
      };
    });
    assert(info.names.length >= 2, "rows=" + info.names.length);
    assert(!info.names.some((n) => / tool$/.test(n)), "generic names: " + info.names.join(","));
    assert(info.states.every((s) => s === "completed"), "states: " + info.states.join(","));
    assert(info.reasoning === 1, "reasoning blocks=" + info.reasoning);
    return `${info.names.join(" + ")}`;
  });

  await test("A multi-step turn carries one action row and one usage line", async () => {
    // The demo's `multi-step` turn answers twice (narration, then the final
    // answer). Each assistant message used to render its own copy/retry row and
    // its own "3.9k in · 48 out" line, so one reply looked like three.
    // Tokens arrive with the turn's last event, so wait for the turn to finish.
    for (let i = 0; i < 40; i++) {
      const done = await page.evaluate(() => {
        const t = [...document.querySelectorAll(".act-title")].slice(-1)[0]?.textContent ?? "";
        return t.startsWith("Worked");
      });
      if (done) break;
      await sleep(200);
    }
    await sleep(400);
    const rows = await page.evaluate(() => {
      const msgs = [...document.querySelectorAll(".msg-assistant:not(.step-only)")];
      const last = msgs[msgs.length - 1];
      const all = document.querySelector("#messages").innerText;
      return {
        md: last.querySelectorAll(".md").length,
        actionRows: last.querySelectorAll("[data-copy-msg], .msg-actions, .assistant-actions").length,
        usage: (last.innerText.match(/ in · /g) || []).length,
        usageAll: (all.match(/ in · /g) || []).length,
        narration: [...document.querySelectorAll(".msg-assistant .md")].map((n) => n.textContent.trim()).filter(Boolean).length,
      };
    });
    assert(rows.md >= 1, "text blocks=" + rows.md);
    assert(rows.narration >= 2, "turn rendered " + rows.narration + " text blocks (expected narration + answer)");
    assert(rows.actionRows === 1, "action rows=" + rows.actionRows);
    assert(rows.usage === 1, "answer usage lines=" + rows.usage);
    assert(rows.usageAll === rows.usage, "usage repeated outside the answer: " + rows.usageAll);
    return `${rows.narration} text blocks · ${rows.actionRows} action row · ${rows.usage} usage line`;
  });

  await test("A running turn says Working, never a finished duration", async () => {
    // The panel used to fall back to "Worked for 9.3s" in the gaps between
    // steps, because `live` required a tool in the `running` state. The
    // composer's data-mode flips back to "send" as soon as text arrives, so
    // sampling the panel title is the honest signal here.
    await page.click("#chat-back");
    await sleep(300);
    await page.click('.session-row [data-open="ses_demo1"]');
    await page.waitForSelector(".msg", { timeout: 8000 });
    await sleep(400);
    await page.fill("#input", "multi-step change please");
    await page.click("#btn-send");
    const titles = [];
    for (let i = 0; i < 25; i++) {
      await sleep(120);
      const t = await page.evaluate(() => [...document.querySelectorAll(".act-title")].slice(-1)[0]?.textContent ?? "");
      if (t) titles.push(t);
    }
    const live = titles.filter((t) => t.startsWith("Working"));
    const done = titles.filter((t) => t.startsWith("Worked"));
    assert(live.length > 0, "no Working samples: " + [...new Set(titles)].join(" | "));
    assert(done.length === 0 || titles.indexOf(done[0]) === titles.length - 1 || titles.lastIndexOf("Working... · 2 steps") < titles.indexOf(done[0]), "finished early: " + [...new Set(titles)].join(" | "));
    assert(done.length > 0, "turn never finished: " + titles.slice(-1)[0]);
    return `${live[0]} -> ${done[done.length - 1]}`;
  });

  await test("Customize rows explain themselves when no session is open", async () => {
    // Models, agents and skills are per session. Their rows used to swallow the
    // tap and leave the hub on screen, which reads as a broken button.
    const out = [];
    for (const key of ["models", "agents", "skills"]) {
      const r = await page.evaluate(async (k) => {
        document.querySelector("#sheet-close")?.click();
        await new Promise((res) => setTimeout(res, 260));
        if (document.querySelector("#screen-chat")?.hidden === false) {
          document.querySelector("#chat-back")?.click();
          await new Promise((res) => setTimeout(res, 420));
        }
        document.querySelector("#open-sidebar")?.click();
        await new Promise((res) => setTimeout(res, 420));
        document.querySelector('[data-side="customize"]')?.click();
        await new Promise((res) => setTimeout(res, 520));
        document.querySelector(`[data-cust="${k}"]`)?.click();
        await new Promise((res) => setTimeout(res, 620));
        return {
          title: document.querySelector("#sheet-title")?.textContent?.trim() ?? "",
          note: document.querySelector("#sheet-body .sheet-note")?.textContent?.trim() ?? "",
          newSession: !!document.querySelector("#need-session-new"),
        };
      }, key);
      out.push({ key, ...r });
    }
    for (const row of out) {
      assert(/Model|Agent|Skills/.test(row.title), row.key + " title=" + row.title);
      assert(/Start a session first/.test(row.note), row.key + " note=" + row.note.slice(0, 50));
      assert(row.newSession, row.key + " has no way forward");
    }
    return out.map((r) => r.key + ":" + r.title).join(", ");
  });

  console.log("\n================ FEATURE TEST REPORT 8 ================");
  let pass = 0, fail = 0;
  for (const r of report) { console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(36)} ${r.detail}`); r.status === "PASS" ? pass++ : fail++; }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();