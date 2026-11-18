/* Suite 10 - MCP servers, the whole CRUD loop.
 *
 * The server owns MCP config and its list is the only honest source of status:
 * POST .../connect answers 204 even when the connection failed. So every action
 * here is checked against what the list says afterwards - a row that says
 * connected, or the real error, never a toast that claims success.
 */
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
  const test = async (name, fn) => { try { const d = await fn(); report.push({ name, status: "PASS", detail: d || "" }); } catch (e) { report.push({ name, status: "FAIL", detail: String(e.message).split("\n")[0].slice(0, 110) }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  const openMcp = async () => {
    await page.evaluate(() => document.querySelector("#sheet-close")?.click());
    await sleep(250);
    await page.click("#open-settings");
    await sleep(350);
    await page.click("#open-mcp");
    await sleep(700);
  };
  const rows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".mcp-row")].map((r) => ({
        name: r.dataset.server,
        state: r.querySelector(".dot-status")?.dataset.s ?? "",
        sub: r.querySelector(".si-sub")?.textContent?.trim() ?? "",
        actions: [...r.querySelectorAll(".mcp-actions button")].map((b) => b.textContent.trim()),
      }))
    );
  const toastText = () => page.evaluate(() => document.querySelector("#toast")?.textContent?.trim() ?? "");
  const rowState = async (name) => (await rows()).find((r) => r.name === name) ?? null;

  await page.goto(`${process.env.POCKET_URL || "http://127.0.0.1:8099"}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".session-row", { timeout: 20000 });
  await openMcp();

  await test("The list is the server's, failures included", async () => {
    const list = await rows();
    assert(list.length === 5, "rows=" + JSON.stringify(list.map((r) => r.name)));
    const audio = list.find((r) => r.name === "audio");
    assert(audio.state === "failed" && /exited with code 2/.test(audio.sub), `audio=${JSON.stringify(audio)}`);
    const godot = list.find((r) => r.name === "godot");
    assert(godot.state === "disabled" && /Disabled/.test(godot.sub), `godot=${JSON.stringify(godot)}`);
    const head = await page.$eval("#sheet-body", (n) => n.querySelector(".sheet-note")?.textContent ?? "");
    assert(/3 connected/.test(head), "head=" + head);
    return `5 rows, 3 connected; audio shows its real error`;
  });

  await test("Connecting a dead server never claims success", async () => {
    await page.click('[data-mcp="connect"][data-server="audio"]');
    await sleep(900);
    const after = await rowState("audio");
    assert(after.state === "failed", "state=" + after.state);
    const t = await toastText();
    assert(/ECONNREFUSED|audio/i.test(t) && !/^Connected/.test(t), "toast=" + t);
    return `row still failed, toast "${t.slice(0, 46)}"`;
  });

  await test("Connect and disconnect a healthy server both land", async () => {
    await page.click('[data-mcp="connect"][data-server="godot"]');
    await sleep(900);
    const up = await rowState("godot");
    assert(up.state === "connected" && /Connected/.test(up.sub), JSON.stringify(up));
    assert(up.actions.includes("Disconnect"), "actions=" + up.actions.join(","));
    await page.click('[data-mcp="disconnect"][data-server="godot"]');
    await sleep(900);
    const down = await rowState("godot");
    assert(down.state === "disabled", JSON.stringify(down));
    assert((await toastText()).includes("Disconnected"), "toast=" + (await toastText()));
    return `disabled -> connected -> disabled`;
  });

  await test("A server that cannot be reached is added and shown as failed", async () => {
    await page.click("[data-mcp-add]");
    await page.waitForSelector("#mcp-name", { timeout: 5000 });
    await page.fill("#mcp-name", "dead-remote");
    await page.fill("#mcp-url", "https://mcp.invalid.example/mcp");
    await page.click("#mcp-save");
    await sleep(1000);
    const row = await rowState("dead-remote");
    assert(row, "the server was not added");
    assert(row.state === "failed" && /ECONNREFUSED/.test(row.sub), JSON.stringify(row));
    assert(!/^Added dead-remote: Connected/.test(await toastText()), "toast claimed success: " + (await toastText()));
    return `added, status failed with the real reason`;
  });

  await test("A reachable local server is added and reads connected", async () => {
    await page.click("[data-mcp-add]");
    await page.waitForSelector("#mcp-name", { timeout: 5000 });
    await page.click('#mcp-kind [data-k="local"]');
    await page.fill("#mcp-name", "local-tools");
    await page.fill("#mcp-command", "npx -y @modelcontextprotocol/server-filesystem /tmp");
    await page.click("#mcp-save");
    await sleep(1000);
    const row = await rowState("local-tools");
    assert(row && row.state === "connected", JSON.stringify(row));
    return `local-tools connected`;
  });

  await test("The form refuses input the server would reject", async () => {
    const cases = [];
    await page.click("[data-mcp-add]");
    await page.waitForSelector("#mcp-name", { timeout: 5000 });
    // no name
    await page.fill("#mcp-url", "https://example.com/mcp");
    await page.click("#mcp-save");
    await sleep(350);
    cases.push(await toastText());
    // bad name
    await page.fill("#mcp-name", "bad name!");
    await page.click("#mcp-save");
    await sleep(350);
    cases.push(await toastText());
    // bad url
    await page.fill("#mcp-name", "ok-name");
    await page.fill("#mcp-url", "not-a-url");
    await page.click("#mcp-save");
    await sleep(350);
    cases.push(await toastText());
    // bad headers json
    await page.fill("#mcp-url", "https://example.com/mcp");
    await page.fill("#mcp-headers", "{oops");
    await page.click("#mcp-save");
    await sleep(350);
    cases.push(await toastText());
    assert(cases.every((c) => c && !/Added/.test(c)), JSON.stringify(cases));
    assert(/letters, numbers/.test(cases[1]), "name case=" + cases[1]);
    assert(/http/.test(cases[2]), "url case=" + cases[2]);
    assert(/JSON/.test(cases[3]), "headers case=" + cases[3]);
    const still = await rowState("ok-name");
    assert(!still, "a rejected server was created anyway");
    await page.click("#mcp-cancel");
    await sleep(500);
    return cases.map((c) => c.slice(0, 22)).join(" | ");
  });

  await test("Replace config is honest about not seeing the old one", async () => {
    await page.click('[data-mcp="edit"][data-server="local-tools"]');
    await page.waitForSelector("#mcp-name", { timeout: 5000 });
    const form = await page.evaluate(() => ({
      title: document.querySelector("#sheet-title")?.textContent?.trim() ?? "",
      name: document.querySelector("#mcp-name")?.value ?? "",
      locked: document.querySelector("#mcp-name")?.disabled ?? false,
      note: document.querySelector(".sheet-note")?.textContent ?? "",
      save: document.querySelector("#mcp-save")?.textContent?.trim() ?? "",
    }));
    assert(/Replace local-tools config/.test(form.title), "title=" + form.title);
    assert(form.name === "local-tools" && form.locked, JSON.stringify(form));
    assert(/does not expose a saved configuration/.test(form.note), "note=" + form.note);
    // replace it with a local command that is not reachable in the demo
    await page.click('#mcp-kind [data-k="local"]');
    await page.fill("#mcp-command", "definitely-not-a-server --flag");
    await page.click("#mcp-save");
    await sleep(1000);
    const row = await rowState("local-tools");
    assert(row, "the server disappeared from the list");
    assert((await rows()).filter((r) => r.name === "local-tools").length === 1, "the replace duplicated the server");
    return `replaced in place, still one row`;
  });

  await test("Remove asks first, and cancel keeps the server", async () => {
    await page.click('[data-mcp="remove"][data-server="dead-remote"]');
    await sleep(600);
    const ask = await page.evaluate(() => ({
      title: document.querySelector("#sheet-title")?.textContent?.trim() ?? "",
      note: document.querySelector(".sheet-note")?.textContent ?? "",
      confirm: document.querySelector("[data-confirm]")?.textContent?.trim() ?? "",
    }));
    assert(/Remove dead-remote\?/.test(ask.title), "title=" + ask.title);
    assert(/configuration/.test(ask.note), "note=" + ask.note);
    await page.click("[data-cancel]");
    await sleep(800);
    assert(await rowState("dead-remote"), "cancel removed it anyway");
    // now for real
    await page.click('[data-mcp="remove"][data-server="dead-remote"]');
    await sleep(600);
    await page.click("[data-confirm]");
    await sleep(900);
    assert(!(await rowState("dead-remote")), "confirm did not remove it");
    return `cancelled, then removed with confirmation`;
  });

  await test("A slow write says what it is doing", async () => {
    // PUT and DELETE make the server start or stop a process, which took ~9s on
    // the device. A dead-looking button for that long is a bug in itself.
    await page.click("[data-mcp-add]");
    await page.waitForSelector("#mcp-name", { timeout: 5000 });
    await page.fill("#mcp-name", "slow-write");
    await page.fill("#mcp-url", "https://example.com/mcp");
    await page.click("#mcp-save");
    await sleep(150);
    const during = await page.evaluate(() => ({
      label: document.querySelector("#mcp-save")?.textContent?.trim() ?? "",
      disabled: document.querySelector("#mcp-save")?.disabled ?? false,
    }));
    assert(/Saving/.test(during.label) && during.disabled, JSON.stringify(during));
    await sleep(1200);
    assert(await rowState("slow-write"), "the server was not added");
    // and removing shows progress rather than a frozen dialog
    await page.click('[data-mcp="remove"][data-server="slow-write"]');
    await sleep(500);
    await page.click("[data-confirm]");
    await sleep(150);
    const duringRemove = await page.evaluate(() => ({
      title: document.querySelector("#sheet-title")?.textContent?.trim() ?? "",
      note: document.querySelector(".sheet-note")?.textContent ?? "",
      spinner: !!document.querySelector(".spinner"),
    }));
    assert(/Removing/.test(duringRemove.title) && duringRemove.spinner, JSON.stringify(duringRemove));
    await sleep(1500);
    assert(!(await rowState("slow-write")), "the server survived the removal");
    return `"${during.label}" then "${duringRemove.title}"`;
  });

  await test("Resources come from the connected servers", async () => {
    await page.click("[data-mcp-resources]");
    await sleep(700);
    const info = await page.evaluate(() => ({
      title: document.querySelector("#sheet-title")?.textContent?.trim() ?? "",
      items: [...document.querySelectorAll(".sheet-item .si-title")].map((n) => n.textContent.trim()),
    }));
    assert(/resources/i.test(info.title), "title=" + info.title);
    assert(info.items.length === 3, JSON.stringify(info.items));
    return `${info.items.length} resources: ${info.items.slice(0, 2).join(", ")}`;
  });

  await test("With nothing left, the empty states say so", async () => {
    await openMcp();
    const names = (await rows()).map((r) => r.name);
    for (const name of names) {
      await page.click(`[data-mcp="remove"][data-server="${name}"]`);
      await sleep(500);
      await page.click("[data-confirm]");
      await sleep(700);
    }
    const left = await rows();
    assert(left.length === 0, "left=" + JSON.stringify(left.map((r) => r.name)));
    const note = await page.$eval("#sheet-body", (n) => n.querySelector(".sheet-note")?.textContent ?? "");
    assert(/No MCP server is configured/.test(note), "note=" + note);
    await page.click("[data-mcp-resources]");
    await sleep(700);
    const empty = await page.$eval("#sheet-body", (n) => n.querySelector(".sheet-note")?.textContent ?? "");
    assert(/No resources/.test(empty), "empty=" + empty);
    return "list and resources both explain themselves";
  });

  console.log("\n================ FEATURE TEST REPORT 10 ===============");
  let pass = 0, fail = 0;
  for (const r of report) { console.log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name.padEnd(54)} ${r.detail}`); r.status === "PASS" ? pass++ : fail++; }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
