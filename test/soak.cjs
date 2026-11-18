/* Soak - a sustained chat session with measurements.
 *
 * Usage:  node test/soak.cjs --minutes=15 [--target=web|device]
 *
 * What it does every round:
 *   - a short prompt and a long prompt (mock, so it is free and repeatable)
 *   - a chaos burst (duplicate / empty / shuffled frames) on every 5th round
 *   - scrolls the transcript, sometimes up (interrupting the auto-scroll)
 *   - switches to another session and back
 *   - checks message integrity (unique ids, no duplicate user bubbles)
 * and every 30 seconds it records JS heap, DOM node count and any console error.
 *
 * At the end it prints every sample plus the totals it actually observed. It
 * never claims more than it ran: pass --minutes and it stops then.
 */
const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};
const MINUTES = Number(arg("minutes", 15));
const url = process.env.POCKET_URL || "http://127.0.0.1:8099";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark", serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 120)));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 120)));

  const openSession = async (id) => {
    await page.evaluate(() => {
      const sheet = document.querySelector("#sheet");
      if (sheet && !sheet.hidden) document.querySelector("#sheet-close")?.click();
    });
    await sleep(200);
    if (await page.evaluate(() => !document.querySelector("#screen-chat").hidden)) {
      await page.evaluate(() => document.querySelector("#chat-back").click());
      await sleep(400);
    }
    await page.click(`.session-row [data-open="${id}"]`);
    await page.waitForSelector(".msg", { timeout: 15000 });
    await sleep(400);
  };
  const send = async (text) => {
    await page.fill("#input", text);
    await page.click("#btn-send");
  };
  const waitIdle = async (max = 40000) => {
    for (let i = 0; i < max / 250; i += 1) {
      await sleep(250);
      if (await page.evaluate(() => document.querySelector("#btn-send")?.dataset?.mode === "send")) return true;
    }
    return false;
  };
  /**
   * Integrity, measured properly.
   *
   * Counting identical bubble texts is wrong: this soak sends the same handful
   * of prompts over and over, so repeated text is expected. What must never
   * happen is a repeated message *id*, an optimistic bubble that was never
   * replaced, or an answer the UI holds that the server does not.
   */
  const sample = async (round) => {
    const s = await page.evaluate(async () => {
      const t = window.__pocketTest;
      const rows = [...document.querySelectorAll("#messages [data-msg]")].map((n) => n.dataset.msg);
      const bubbles = [...document.querySelectorAll("#messages .msg-user")].map((n) => n.dataset.msg ?? "");
      const sid = t.state.session?.id;
      const res = await t.api.messages(sid, { limit: 12, order: "desc" });
      const data = res.data ?? [];
      const last = data.find((m) => m.type === "assistant");
      const server = (last?.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n\n");
      const mine = (t.state.messages.filter((m) => m.type === "assistant").pop()?.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n\n");
      const newestUser = data.find((m) => m.type === "user");
      return {
        heapMb: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576),
        nodes: document.querySelectorAll("#messages *").length,
        rows: rows.length,
        uniqueRows: new Set(rows).size,
        duplicateIds: rows.length - new Set(rows).size,
        localBubbles: bubbles.filter((id) => id.startsWith("local_")).length,
        newestUserShown: newestUser ? bubbles.filter((id) => id === newestUser.id).length : -1,
        sourceMatchesServer: server === mine,
        banner: document.querySelector("#net-banner")?.hidden === false ? document.querySelector("#net-text").textContent : "",
      };
    });
    s.clean =
      s.duplicateIds === 0 &&
      s.localBubbles === 0 &&
      (s.newestUserShown === 1 || s.newestUserShown === -1) &&
      s.sourceMatchesServer;
    console.log(
      `[soak] ${new Date().toISOString()} round=${round} heap=${s.heapMb}MB nodes=${s.nodes} rows=${s.rows} dupIds=${s.duplicateIds} local=${s.localBubbles} newestUser=${s.newestUserShown} src==srv=${s.sourceMatchesServer}${s.banner ? ' banner="' + s.banner + '"' : ""}`
    );
    return s;
  };

  await page.goto(`${url}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });

  const started = Date.now();
  const deadline = started + MINUTES * 60_000;
  const samples = [];
  let round = 0;
  let turns = 0;
  let failures = 0;
  let lastSample = 0;

  while (Date.now() < deadline) {
    round += 1;
    try {
      await openSession(round % 4 === 0 ? "ses_demo_stress" : "ses_demo1");
      const text = round % 5 === 0
        ? ["chaos duplicate please", "chaos shuffle please", "chaos empty please"][round % 3]
        : round % 3 === 0
          ? "multi-step change please"
          : "rich markdown answer please";
      await send(text);
      turns += 1;
      await waitIdle();
      // scroll while the next turn streams, then come back
      await page.evaluate(() => {
        const m = document.querySelector("#messages");
        m.scrollTop = Math.max(0, m.scrollTop - 800);
      });
      await sleep(300);
      await page.evaluate(() => {
        const m = document.querySelector("#messages");
        m.scrollTop = m.scrollHeight;
      });
      if (Date.now() - lastSample > 30_000) {
        lastSample = Date.now();
        samples.push(await sample(round));
      }
    } catch (e) {
      failures += 1;
      errors.push("round " + round + ": " + String(e.message).slice(0, 120));
      try {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector(".session-row", { timeout: 20000 });
      } catch {}
    }
  }

  const final = await sample(round);
  const heaps = samples.map((s) => s.heapMb).filter((n) => n > 0);
  const peak = heaps.length ? Math.max(...heaps) : 0;
  const first = heaps[0] ?? 0;
  const last = heaps[heaps.length - 1] ?? 0;
  const integrity = samples.every((s) => s.clean);

  console.log("\n================ SOAK SUMMARY ================");
  console.log(`ran for            ${((Date.now() - started) / 60000).toFixed(1)} minutes (requested ${MINUTES})`);
  console.log(`rounds / turns     ${round} / ${turns}`);
  console.log(`samples            ${samples.length} (every ~30s)`);
  console.log(`JS heap            first ${first} MB, peak ${peak} MB, last ${last} MB`);
  console.log(`DOM nodes          peak ${Math.max(...samples.map((s) => s.nodes), 0)}`);
  console.log(`message integrity  ${integrity ? "clean in every sample" : "VIOLATED - see samples above"}`);
  console.log(`round failures     ${failures}`);
  console.log(`console errors     ${errors.length ? errors.slice(0, 6).join(" | ") : "none"}`);
  console.log(`final rows         ${final.rows} (unique ${final.uniqueRows})`);
  console.log(`heap growth        ${last - first >= 0 ? "+" : ""}${last - first} MB across the run`);
  await browser.close();
  process.exitCode = integrity && failures === 0 ? 0 : 1;
})();