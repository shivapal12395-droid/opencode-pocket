/**
 * Minimal OpenCode HTTP API client.
 * Docs: https://opencode.ai/docs/api
 */

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function normalizeBase(input) {
  let raw = String(input || "").trim();
  if (!raw) raw = "http://127.0.0.1:4096";
  if (!/^https?:\/\//i.test(raw)) raw = "http://" + raw;
  try {
    const url = new URL(raw);
    return url.origin + url.pathname.replace(/\/+$/, "") + (url.search || "");
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

/** Accepts a raw password or a pairing link / code. Returns { base, secret }. */
export async function resolveSecret(base, input, fetchImpl = fetch) {
  const value = String(input || "").trim();
  const match = value.match(/^(https?:\/\/[^\s]+?)\/auth\/connect\/([A-Za-z0-9_-]+)\/?$/);
  if (match) {
    const linkBase = normalizeBase(match[1]);
    return { base: linkBase, secret: await redeemPairingCode(linkBase, match[2], fetchImpl) };
  }
  if (/^[A-Za-z0-9]{18,32}$/.test(value) && !/^\d+\./.test(value)) {
    // Looks like a bare pairing code; try to redeem it, fall back to password.
    try {
      return { base, secret: await redeemPairingCode(base, value, fetchImpl) };
    } catch {
      return { base, secret: value };
    }
  }
  return { base, secret: value };
}

export async function redeemPairingCode(base, code, fetchImpl = fetch) {
  const res = await fetchImpl.call(globalThis, `${base}/auth/connect/${encodeURIComponent(code)}`, {
    headers: { accept: "application/json" },
    credentials: "omit",
  });
  if (!res.ok) throw new ApiError("Pairing link is invalid or expired", res.status);
  const json = await res.json();
  if (!json?.token) throw new ApiError("Pairing did not return a token", res.status);
  return json.token;
}

export function basicAuth(secret) {
  const bytes = new TextEncoder().encode(`opencode:${secret}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}

export class Api {
  constructor(base, secret, fetchImpl = fetch) {
    this.base = normalizeBase(base);
    this.secret = secret;
    this.fetch = (url, init) => fetchImpl.call(globalThis, url, init);
  }

  get authHeader() {
    return basicAuth(this.secret);
  }

  async request(method, path, body, { timeout = 30000, signal, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await this.fetch(this.base + path, {
        method,
        credentials: "omit",
        signal: controller.signal,
        headers: {
          authorization: this.authHeader,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      if (!res.ok) {
        const message =
          json?.message ||
          json?.error ||
          (res.status === 401 ? "Authentication failed" : `Request failed (${res.status})`);
        throw new ApiError(message, res.status, json);
      }
      return json;
    } catch (err) {
      if (err?.name === "AbortError") throw new ApiError("Request timed out", 0);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  /** Same as request(), but hands back the raw body — file contents are not JSON. */
  async requestText(path, { timeout = 20000, signal } = {}) {
    const controller = new AbortController();
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await this.fetch(this.base + path, {
        credentials: "omit",
        signal: controller.signal,
        headers: { authorization: this.authHeader, accept: "text/plain, */*" },
      });
      const text = await res.text();
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const json = JSON.parse(text);
          message = json?.message || json?.error || message;
        } catch {}
        throw new ApiError(message, res.status, text);
      }
      return text;
    } catch (err) {
      if (err?.name === "AbortError") throw new ApiError("Request timed out", 0);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  info() {
    return this.request("GET", "/api/info", undefined, { timeout: 8000 });
  }

  listSessions({ search = "", limit = 40, cursor = null, order = "desc" } = {}) {
    const q = new URLSearchParams({ limit: String(limit), order });
    if (search) q.set("search", search);
    if (cursor) q.set("cursor", cursor);
    return this.request("GET", `/api/session?${q}`);
  }

  createSession({ directory, model, agent }) {
    const body = { location: { directory } };
    if (model) body.model = model;
    if (agent) body.agent = agent;
    return this.request("POST", "/api/session", body);
  }

  getSession(id) {
    return this.request("GET", `/api/session/${id}`);
  }

  updateSession(id, patch) {
    return this.request("PATCH", `/api/session/${id}`, patch);
  }

  deleteSession(id) {
    return this.request("DELETE", `/api/session/${id}`);
  }

  messages(id, { limit = 60, order = "desc", cursor = null } = {}) {
    const q = new URLSearchParams({ limit: String(limit), order });
    if (cursor) q.set("cursor", cursor);
    return this.request("GET", `/api/session/${id}/message?${q}`);
  }

  prompt(id, { text, files, delivery = "steer" }) {
    const body = { text };
    if (files?.length) body.files = files;
    if (delivery) body.delivery = delivery;
    return this.request("POST", `/api/session/${id}/prompt`, body, { timeout: 120000 });
  }

  command(id, { name, text, files }) {
    const body = { name, text: text ?? "" };
    if (files?.length) body.files = files;
    return this.request("POST", `/api/session/${id}/command`, body, { timeout: 120000 });
  }

  interrupt(id) {
    return this.request("POST", `/api/session/${id}/interrupt`, undefined, { timeout: 15000 });
  }

  switchModel(id, model) {
    return this.request("POST", `/api/session/${id}/model`, { model });
  }

  switchAgent(id, agent) {
    return this.request("POST", `/api/session/${id}/agent`, { agent });
  }

  /* ------------------------------------------------------------------ *
   * Everything below mirrors routes in the server's OpenAPI document.
   * Sub-resources are location-scoped with `location[directory]=<path>`;
   * a JSON-encoded `location` is rejected by the query codec.
   * ------------------------------------------------------------------ */

  static located(directory) {
    return directory ? `location[directory]=${encodeURIComponent(directory)}` : "";
  }

  /** Files in the workspace, for @-mentions. Returns FileSystem.Entry[]. */
  async findFiles(query, { directory, type, limit = 40, signal } = {}) {
    const q = new URLSearchParams({ query, limit: String(limit) });
    if (type) q.set("type", type);
    const loc = Api.located(directory);
    const path = `/api/fs/find?${q}${loc ? "&" + loc : ""}`;
    const res = await this.request("GET", path, undefined, { signal, timeout: 20000 });
    return res?.data ?? [];
  }

  /** One directory level: [{ path, type: "file" | "directory" }]. */
  async listDir(path = ".", { directory } = {}) {
    const q = new URLSearchParams({ path });
    const loc = Api.located(directory);
    const res = await this.request("GET", `/api/fs/list?${q}${loc ? "&" + loc : ""}`, undefined, {
      timeout: 20000,
    });
    return res?.data ?? [];
  }

  /** Raw text of one file (used to preview a mention). */
  async readFile(relativePath, { directory } = {}) {
    const loc = Api.located(directory);
    const clean = String(relativePath).split("/").map(encodeURIComponent).join("/");
    return this.requestText(`/api/fs/read/${clean}${loc ? "?" + loc : ""}`);
  }

  /** Files this session changed: FileDiff.Info[] with a unified patch each. */
  async sessionDiff(id) {
    const res = await this.request("GET", `/api/session/${id}/diff`, undefined, { timeout: 20000 });
    return res?.data ?? [];
  }

  /** The message window currently sent to the model. */
  async sessionContext(id) {
    const res = await this.request("GET", `/api/session/${id}/context`, undefined, { timeout: 20000 });
    return res?.data ?? [];
  }

  /** Branch a session; `before` forks up to (not including) that message. */
  async forkSession(id, before) {
    return this.request("POST", `/api/session/${id}/fork`, before ? { before } : {});
  }

  /** Summarise the conversation so far into fresh context. */
  async compactSession(id, { delivery } = {}) {
    return this.request("POST", `/api/session/${id}/compact`, delivery ? { delivery } : {}, { timeout: 120000 });
  }

  /**
   * OpenCode's undo. Staging a message rewinds the transcript and restores the
   * files touched since it; committing keeps the rewind, clearing drops it.
   */
  async stageRevert(id, messageID, files = false) {
    const res = await this.request("POST", `/api/session/${id}/revert/stage`, { messageID, files });
    return res?.data ?? null;
  }

  commitRevert(id) {
    return this.request("POST", `/api/session/${id}/revert/commit`);
  }

  clearRevert(id) {
    return this.request("DELETE", `/api/session/${id}/revert`);
  }

  /** Mark the session read up to an idle watermark (Session.Info.time.idle). */
  viewSession(id, idle) {
    return this.request("POST", `/api/session/${id}/view`, { idle });
  }

  /** Run a shell command through the session, like a `!cmd` prompt. */
  runShell(id, command) {
    return this.request("POST", `/api/session/${id}/shell`, { command }, { timeout: 120000 });
  }

  async skills({ directory } = {}) {
    const loc = Api.located(directory);
    const res = await this.request("GET", `/api/skill${loc ? "?" + loc : ""}`, undefined, { timeout: 20000 });
    return res?.data ?? [];
  }

  /** Load a skill into the running session. */
  activateSkill(id, skillID) {
    return this.request("POST", `/api/experimental/session/${id}/skill`, { id: skillID });
  }

  async references({ directory } = {}) {
    const loc = Api.located(directory);
    const res = await this.request("GET", `/api/reference${loc ? "?" + loc : ""}`, undefined, { timeout: 20000 });
    return res?.data ?? [];
  }

  async mcpServers({ directory } = {}) {
    const loc = Api.located(directory);
    const res = await this.request("GET", `/api/mcp${loc ? "?" + loc : ""}`, undefined, { timeout: 20000 });
    return res?.data ?? [];
  }

  async providers({ directory } = {}) {
    const loc = Api.located(directory);
    const res = await this.request("GET", `/api/provider${loc ? "?" + loc : ""}`, undefined, { timeout: 20000 });
    return res?.data ?? [];
  }

  /** "Always allow" rules the user has saved, newest first. */
  async savedPermissions(projectID) {
    const q = projectID ? `?projectID=${encodeURIComponent(projectID)}` : "";
    const res = await this.request("GET", `/api/permission/saved${q}`, undefined, { timeout: 20000 });
    return res?.data ?? [];
  }

  removeSavedPermission(id) {
    return this.request("DELETE", `/api/permission/saved/${id}`);
  }

  /** Checked-out worktrees for a project. */
  async worktrees(projectID) {
    const res = await this.request("GET", `/api/worktree?projectID=${encodeURIComponent(projectID)}`, undefined, {
      timeout: 20000,
    });
    return res?.data ?? res ?? [];
  }

  async defaultModel({ directory } = {}) {
    const loc = Api.located(directory);
    const res = await this.request("GET", `/api/model/default${loc ? "?" + loc : ""}`, undefined, { timeout: 20000 });
    return res?.data ?? null;
  }

  /** Usage rollup across sessions (experimental). */
  async stats({ from, to, timezone } = {}) {
    const q = new URLSearchParams();
    if (from) q.set("from", String(from));
    if (to) q.set("to", String(to));
    if (timezone) q.set("timezone", timezone);
    const res = await this.request("GET", `/api/experimental/session/stats?${q}`, undefined, { timeout: 20000 });
    return res?.data ?? null;
  }

  permissions(id) {
    return this.request("GET", `/api/session/${id}/permission`);
  }

  replyPermission(id, requestID, decision, message) {
    return this.request("POST", `/api/session/${id}/permission/${requestID}/reply`, {
      decision,
      ...(message ? { message } : {}),
    });
  }

  async models() {
    const res = await this.request("GET", "/api/model", undefined, { timeout: 20000 });
    return res?.data ?? [];
  }

  async agents() {
    const res = await this.request("GET", "/api/agent");
    return res?.data ?? [];
  }

  async projects() {
    const res = await this.request("GET", "/api/project");
    if (Array.isArray(res)) return res;
    return res?.data ?? [];
  }

  async commands() {
    const res = await this.request("GET", "/api/command");
    return res?.data ?? [];
  }

  /**
   * Live event stream. Reconnects automatically; returns a stop() function.
   * onEvent({type, data, ...}), onStatus("online" | "offline" | "connecting")
   */
  streamEvents(onEvent, onStatus) {
    let stopped = false;
    let controller = null;
    let attempt = 0;

    const loop = async () => {
      while (!stopped) {
        onStatus?.(attempt === 0 ? "connecting" : "connecting");
        controller = new AbortController();
        try {
          const res = await this.fetch(this.base + "/api/event", {
            headers: { authorization: this.authHeader, accept: "text/event-stream" },
            signal: controller.signal,
            credentials: "omit",
            cache: "no-store",
          });
          if (!res.ok || !res.body) throw new ApiError(`Event stream failed (${res.status})`, res.status);

          attempt = 0;
          onStatus?.("online");
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf("\n\n")) !== -1) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const data = chunk
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trimStart())
                .join("\n");
              if (!data) continue;
              try {
                onEvent?.(JSON.parse(data));
              } catch {
                /* ignore malformed frames */
              }
            }
          }
          if (!stopped) throw new ApiError("Event stream closed", 0);
        } catch (err) {
          if (stopped) return;
          onStatus?.("offline");
          attempt += 1;
          await sleep(Math.min(12000, 600 * 2 ** Math.min(attempt, 4)));
        }
      }
    };

    loop();
    return () => {
      stopped = true;
      try {
        controller?.abort();
      } catch {}
    };
  }
}
