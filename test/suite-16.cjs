/* Suite 16 - the stop request contract, at the wire.
 *
 * The audit measured the 2.3.0 endpoint (protocol/src/groups/session.ts,
 * `session.interrupt`): `resume=true` promotes steering input after the
 * interrupt, `resume=1` is rejected with 400, and an idle session answers
 * `{interrupted:false}`. Pocket used to send no `resume` at all, so a prompt a
 * user steered into the turn they stopped was admitted and never promoted.
 *
 * This suite drives the real `assets/api.js` client against a local HTTP server,
 * so it fails if the query parameter regresses, without touching a phone.
 */
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const { Api, ApiError } = await import(pathToFileURL(path.join(__dirname, "..", "assets", "api.js")).href);

  const report = [];
  const test = async (name, fn) => {
    try {
      const detail = await fn();
      report.push({ name, status: "PASS", detail: detail || "" });
    } catch (error) {
      report.push({ name, status: "FAIL", detail: String(error.message).split("\n")[0].slice(0, 160) });
    }
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  const seen = [];
  let response = { status: 200, body: { interrupted: true } };
  let destroy = false;

  const server = http.createServer((req, res) => {
    const entry = {
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
      contentType: req.headers["content-type"] ?? null,
      body: null,
    };
    seen.push(entry);
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw) {
        try { entry.body = JSON.parse(raw); } catch { entry.body = raw; }
      }
      if (destroy) {
        req.destroy();
        return;
      }
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(JSON.stringify(response.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = new Api(base, "topsecret");

  const last = () => seen[seen.length - 1];

  await test("1. Stop sends resume=true on the interrupt route", async () => {
    seen.length = 0;
    response = { status: 200, body: { interrupted: true } };
    const result = await api.interrupt("ses_abc");
    assert(seen.length === 1, "requests sent: " + seen.length);
    assert(last().method === "POST", "method: " + last().method);
    assert(
      last().url === "/api/session/ses_abc/interrupt?resume=true",
      "url: " + last().url
    );
    assert(result?.interrupted === true, "response body not returned");
    return last().url;
  });

  await test("2. Authentication and POST shape are preserved", async () => {
    const expected = "Basic " + Buffer.from("opencode:topsecret").toString("base64");
    assert(last().auth === expected, "authorization: " + last().auth);
    assert(last().contentType === null, "interrupt must not send a JSON body");
    return "basic auth, no body";
  });

  await test("3. A stop is never retried automatically", async () => {
    seen.length = 0;
    response = { status: 500, body: { message: "boom" } };
    let threw = null;
    try {
      await api.interrupt("ses_abc");
    } catch (error) {
      threw = error;
    }
    assert(threw instanceof ApiError, "expected an ApiError");
    assert(threw.status === 500, "status: " + threw.status);
    assert(seen.length === 1, "a write was retried: " + seen.length + " requests");
    assert(last().url === "/api/session/ses_abc/interrupt?resume=true", "url: " + last().url);
    return "one POST, 500 surfaced";
  });

  await test("4. A dropped stop is an offline ApiError the UI can retry", async () => {
    seen.length = 0;
    destroy = true;
    let threw = null;
    try {
      await api.interrupt("ses_abc");
    } catch (error) {
      threw = error;
    }
    destroy = false;
    assert(threw instanceof ApiError, "expected an ApiError");
    assert(threw.status === 0, "status: " + threw.status);
    assert(threw.offline === true, "offline flag not set");
    assert(threw.retryable === true, "retryable flag not set");
    return "status 0, offline + retryable";
  });

  await test("5. Active sessions are read from /api/session/active", async () => {
    seen.length = 0;
    response = { status: 200, body: { data: { ses_a: { type: "running" }, ses_b: { type: "running" } } } };
    const result = await api.activeSessions();
    assert(last().method === "GET", "method: " + last().method);
    assert(last().url === "/api/session/active", "url: " + last().url);
    assert(result?.data?.ses_a?.type === "running", "shape not returned");
    return "GET /api/session/active";
  });

  await test("6. An empty running set is a valid answer, not an error", async () => {
    response = { status: 200, body: { data: {} } };
    const result = await api.activeSessions();
    assert(result && typeof result.data === "object", "no data object");
    assert(Object.keys(result.data).length === 0, "expected an empty map");
    return "{ data: {} }";
  });

  await test("7. resume=false stays available and sends no query", async () => {
    seen.length = 0;
    response = { status: 200, body: { interrupted: false } };
    await api.interrupt("ses_abc", { resume: false });
    assert(seen.length === 1, "requests: " + seen.length);
    assert(last().url === "/api/session/ses_abc/interrupt", "url: " + last().url);
    return last().url;
  });

  await test("8. Prompt carries the official structured fields", async () => {
    seen.length = 0;
    response = { status: 200, body: { data: { id: "msg_1" } } };
    await api.prompt("ses_abc", {
      text: "look at @src/app.ts",
      files: [{ uri: "file:///w/src/app.ts", source: { type: "uri" }, name: "app.ts", mention: { start: 9, end: 20, text: "@src/app.ts" } }],
      agents: [{ name: "build", mention: { start: 0, end: 0, text: "@build" } }],
      skills: [{ id: "opencode", name: "opencode", mention: { start: 0, end: 0, text: "@opencode" } }],
      metadata: { displayText: "look at @src/app.ts", agent: "build", model: { providerID: "opencode", id: "big-pickle" } },
      delivery: "steer",
    });
    const body = last().body;
    assert(last().url === "/api/session/ses_abc/prompt", "url: " + last().url);
    assert(body.files?.[0]?.uri === "file:///w/src/app.ts", "files: " + JSON.stringify(body.files));
    assert(body.files?.[0]?.mention?.text === "@src/app.ts", "file mention missing");
    assert(body.agents?.[0]?.name === "build", "agents: " + JSON.stringify(body.agents));
    assert(body.skills?.[0]?.id === "opencode", "skills: " + JSON.stringify(body.skills));
    assert(body.metadata?.model?.id === "big-pickle" && body.metadata?.agent === "build", "metadata: " + JSON.stringify(body.metadata));
    assert(body.delivery === "steer", "delivery: " + body.delivery);
    return "files + agents + skills + metadata";
  });

  await test("9. A plain prompt stays minimal (no empty arrays)", async () => {
    seen.length = 0;
    await api.prompt("ses_abc", { text: "hello" });
    const body = last().body;
    assert(body.text === "hello", "text: " + body.text);
    assert(body.files === undefined && body.agents === undefined && body.skills === undefined, "empty arrays leaked: " + JSON.stringify(body));
    assert(body.delivery === "steer", "delivery default: " + body.delivery);
    return "text + delivery only";
  });

  server.close();

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
