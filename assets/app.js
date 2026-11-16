import { Api, ApiError, normalizeBase, resolveSecret } from "./api.js";
import { renderMarkdown, escapeHtml } from "./markdown.js";

/* ---------------------------------------------------------------- utils */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const icon = (name, cls = "") => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem("ocp." + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("ocp." + key, JSON.stringify(value));
    } catch {}
  },
  del(key) {
    try {
      localStorage.removeItem("ocp." + key);
    } catch {}
  },
};

const basename = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || String(p || "");
const timeAgo = (ts) => {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const dayKey = (ts) => {
  const d = new Date(ts);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return "Today";
  if (ts >= start - 86_400_000) return "Yesterday";
  if (ts >= start - 7 * 86_400_000) return "Previous 7 days";
  return "Earlier";
};
const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/* ---------------------------------------------------------------- state */

const state = {
  api: null,
  base: "",
  secret: "",
  info: null,
  screen: "connect",
  sessions: [],
  sessionsCursor: null,
  sessionsLoading: false,
  search: "",
  session: null,
  messages: [],
  messagesCursor: null,
  messagesLoading: false,
  models: null,
  agents: null,
  projects: null,
  commands: null,
  busy: false,
  attachments: [],
  permissions: [],
  sseStop: null,
  online: false,
  demo: false,
  lastModel: store.get("lastModel", null),
  theme: store.get("theme", "system"),
  enterToSend: store.get("enterToSend", false),
  sheetOpen: false,
  chatOpen: false,
  lastAssistantId: null,
  pinned: true,
  pendingRender: 0,
};

/* ---------------------------------------------------------------- dom */

const el = {};
function cacheDom() {
  el.connectScreen = $("#screen-connect");
  el.sessionsScreen = $("#screen-sessions");
  el.chatScreen = $("#screen-chat");
  el.connectForm = $("#connect-form");
  el.connectUrl = $("#connect-url");
  el.connectSecret = $("#connect-secret");
  el.connectSubmit = $("#connect-submit");
  el.connectError = $("#connect-error");
  el.sessionList = $("#session-list");
  el.sessionSearch = $("#session-search");
  el.clearSearch = $("#clear-search");
  el.fabNew = $("#fab-new");
  el.connDot = $("#conn-dot");
  el.messages = $("#messages");
  el.chatTitle = $("#chat-title");
  el.chatSub = $("#chat-sub");
  el.chatBack = $("#chat-back");
  el.chatMenu = $("#chat-menu");
  el.chipModel = $("#chip-model");
  el.chipAgent = $("#chip-agent");
  el.chatStatus = $("#chat-status");
  el.permBanner = $("#perm-banner");
  el.input = $("#input");
  el.send = $("#btn-send");
  el.attach = $("#btn-attach");
  el.attachStrip = $("#attach-strip");
  el.composerHint = $("#composer-hint");
  el.jumpLatest = $("#jump-latest");
  el.scrim = $("#scrim");
  el.sheet = $("#sheet");
  el.sheetTitle = $("#sheet-title");
  el.sheetBody = $("#sheet-body");
  el.sheetClose = $("#sheet-close");
  el.toast = $("#toast");
}

/* ---------------------------------------------------------------- theme */

function applyTheme() {
  const resolved =
    state.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : state.theme;
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === "dark" ? "#0a0b0d" : "#f7f6f1";
}

/* ---------------------------------------------------------------- toast */

let toastTimer = 0;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove("show");
    setTimeout(() => (el.toast.hidden = true), 220);
  }, 2600);
}

function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

/* ---------------------------------------------------------------- screens */

function showScreen(name) {
  state.screen = name;
  el.connectScreen.hidden = name !== "connect";
  el.sessionsScreen.hidden = name !== "sessions";
  el.chatScreen.hidden = name !== "chat";
}

function setConnection(stateName, label) {
  el.connDot.dataset.state = stateName;
  el.connDot.title = label;
}

/* ---------------------------------------------------------------- connect */

async function connect(baseInput, secretInput) {
  const base = normalizeBase(baseInput);
  let secret = String(secretInput || "").trim();
  if (!secret) throw new ApiError("Enter the server password or a pairing link", 0);

  const resolved = await resolveSecret(base, secret);
  const api = new Api(resolved.base, resolved.secret);
  const info = await api.info();

  state.api = api;
  state.base = resolved.base;
  state.secret = resolved.secret;
  state.info = info;
  store.set("base", resolved.base);
  store.set("secret", resolved.secret);

  await enterApp();
}

async function enterApp() {
  showScreen("sessions");
  setConnection("online", "Connected");
  renderSessionSkeleton();
  startEvents();

  try {
    await refreshSessions(true);
  } catch (err) {
    handleError(err, "Could not load sessions");
  }
}

function startEvents() {
  stopEvents();
  state.sseStop = state.api.streamEvents(handleEvent, (status) => {
    state.online = status === "online";
    if (status === "online") setConnection(state.busy ? "busy" : "online", "Connected");
    else if (status === "offline") setConnection("offline", "Reconnecting…");
  });
  // Reconnect when returning to the app.
  document.addEventListener("visibilitychange", onVisibility);
}

function stopEvents() {
  state.sseStop?.();
  state.sseStop = null;
  document.removeEventListener("visibilitychange", onVisibility);
}

async function onVisibility() {
  if (document.visibilityState !== "visible" || !state.api) return;
  if (!state.online) {
    startEvents();
  }
  if (state.screen === "sessions") refreshSessions(true).catch(() => {});
}

/* ---------------------------------------------------------------- session list */

async function refreshSessions(showSkeleton = false) {
  if (!state.api || state.sessionsLoading) return;
  state.sessionsLoading = true;
  if (showSkeleton) renderSessionSkeleton();
  try {
    const res = await state.api.listSessions({ search: state.search, limit: 50 });
    state.sessions = res?.data ?? [];
    state.sessionsCursor = res?.cursor?.previous ?? null;
    renderSessions();
  } finally {
    state.sessionsLoading = false;
  }
}

function renderSessionSkeleton() {
  el.sessionList.innerHTML = Array.from({ length: 7 })
    .map(() => `<div class="session-skel"></div>`)
    .join("");
}

function workspaceColor(dir) {
  let h = 0;
  const s = String(dir || "workspace");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 48% 52%)`;
}

function collapsedGroups() {
  return new Set(store.get("collapsedWs", []));
}

function toggleWorkspace(dir) {
  const set = collapsedGroups();
  if (set.has(dir)) set.delete(dir);
  else set.add(dir);
  store.set("collapsedWs", [...set]);
  const group = [...el.sessionList.querySelectorAll(".ws-group")].find((n) => n.dataset.ws === dir);
  group?.classList.toggle("closed");
}

function renderSessions() {
  const list = state.sessions;
  if (!list.length) {
    el.sessionList.innerHTML = `<div class="empty">${icon("terminal")}<b>No sessions yet</b>${
      state.search ? "Try a different search." : "Tap “New session” to start your first task."
    }</div>`;
    return;
  }

  const groups = new Map();
  for (const s of list) {
    const dir = s.location?.directory || "workspace";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(s);
  }

  const collapsed = collapsedGroups();
  let html = "";
  for (const [dir, sessions] of groups) {
    const closed = collapsed.has(dir);
    html += `
      <div class="ws-group${closed ? " closed" : ""}" data-ws="${escapeHtml(dir)}">
        <button class="ws-head" data-ws-toggle="${escapeHtml(dir)}">
          <span class="ws-dot" style="--c:${workspaceColor(dir)}"></span>
          <span class="ws-name">${escapeHtml(basename(dir) || dir)}</span>
          <span class="ws-count">${sessions.length}</span>
          <svg class="ws-caret"><use href="#i-chevron"/></svg>
        </button>
        <div class="ws-items">
          ${sessions
            .map((s) => {
              const busy = (s.time?.busy ?? 0) > (s.time?.idle ?? 0);
              const title = s.title?.trim() || "Untitled session";
              return `
                <div class="session-row${state.session?.id === s.id ? " active" : ""}" data-id="${escapeHtml(s.id)}">
                  <button class="session-main" data-open="${escapeHtml(s.id)}">
                    <span class="session-title">${escapeHtml(title)}</span>
                    ${busy ? `<span class="session-busy"></span>` : ""}
                    <span class="session-time">${timeAgo(s.time?.updated ?? s.time?.created)}</span>
                  </button>
                  <button class="session-more" data-more="${escapeHtml(s.id)}" aria-label="Session actions">${icon("more")}</button>
                </div>`;
            })
            .join("")}
        </div>
      </div>`;
  }
  el.sessionList.innerHTML = html;
}

/* ---------------------------------------------------------------- chat */

function setChatHeader() {
  const s = state.session;
  if (!s) return;
  const title = s.title?.trim() || "New session";
  $(".chat-title-text", el.chatTitle).textContent = title;
  el.chatSub.textContent = `${basename(s.location?.directory) || "workspace"} · ${s.agent ?? "build"}`;
}

function setBusy(busy) {
  state.busy = busy;
  el.chatStatus.hidden = !busy;
  el.chatStatus.querySelector("span").textContent = "Working";
  setConnection(busy ? "busy" : state.online ? "online" : "offline", busy ? "Working" : "Connected");
  updateSendButton();
  updateChatStatus();
}

function updateChatStatus() {
  if (!state.session) return;
  const model = state.session.model;
  el.chipModel.querySelector("span").textContent = model?.id ? shortModel(model.id) : "Model";
  el.chipAgent.querySelector("span").textContent = state.session.agent || "Agent";
}

function shortModel(id) {
  const clean = String(id).split("/").pop();
  return clean.length > 22 ? clean.slice(0, 21) + "…" : clean;
}

async function openSession(sessionOrId) {
  const session =
    typeof sessionOrId === "string"
      ? state.sessions.find((s) => s.id === sessionOrId)
      : sessionOrId;
  if (!session) return;

  state.session = session;
  state.messages = [];
  state.permissions = [];
  updatePermBanner();
  state.lastAssistantId = null;
  setChatHeader();
  updateChatStatus();
  setBusy((session.time?.busy ?? 0) > (session.time?.idle ?? 0));

  if (state.screen !== "chat") {
    showScreen("chat");
    state.chatOpen = true;
    history.pushState({ chat: true }, "");
  }
  el.messages.innerHTML = `<div class="empty"><span class="spinner" style="margin:0 auto 12px"></span>Loading conversation…</div>`;
  el.input.value = "";
  autoGrow();
  updateSendButton();

  try {
    await loadMessages();
    await loadPermissions();
  } catch (err) {
    handleError(err, "Could not load messages");
  }
}

function closeChat(fromPop = false) {
  if (!state.chatOpen) return;
  if (!fromPop) {
    history.back();
    return;
  }
  state.chatOpen = false;
  state.session = null;
  showScreen("sessions");
  refreshSessions(true).catch(() => {});
}

async function loadMessages() {
  if (!state.api || !state.session) return;
  state.messagesLoading = true;
  try {
    const res = await state.api.messages(state.session.id, { limit: 80, order: "desc" });
    state.messages = (res?.data ?? []).slice().reverse();
    state.messagesCursor = res?.cursor?.previous ?? null;
    state.pinned = true;
    renderMessages(true);
  } finally {
    state.messagesLoading = false;
  }
}

function isNearBottom() {
  const m = el.messages;
  return m.scrollHeight - m.scrollTop - m.clientHeight < 140;
}

function scrollToBottom(smooth = false) {
  el.messages.scrollTo({ top: el.messages.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

/* ---------------------------------------------------------------- message rendering */

function messageParts(m) {
  if (m.type === "assistant") return m.content ?? [];
  return [];
}

function ensureAssistant(msgID, data = {}) {
  let m = state.messages.find((x) => x.id === msgID);
  if (!m) {
    m = {
      id: msgID,
      type: "assistant",
      agent: data.agent,
      model: data.model,
      time: { created: data.started ?? Date.now() },
      content: [],
    };
    state.messages.push(m);
  }
  return m;
}

function partKey(msgID, part) {
  return `${msgID}:${part.type}:${part.ordinal ?? part.id ?? 0}`;
}

function toolSummary(part) {
  const input = part.state?.input || {};
  const raw =
    input.command ??
    input.filePath ??
    input.path ??
    input.pattern ??
    input.url ??
    input.query ??
    input.description ??
    input.task ??
    input.prompt ??
    "";
  const oneLine = String(raw).replace(/\s+/g, " ").trim();
  return oneLine.length > 90 ? oneLine.slice(0, 89) + "…" : oneLine;
}

function toolStatus(part) {
  return part.state?.status ?? (part.state?.metadata?.status === "completed" ? "completed" : "running");
}

function renderTool(part) {
  const status = toolStatus(part);
  const key = escapeHtml(part.id ?? Math.random().toString(36));
  const summary = toolSummary(part);
  const content = (part.state?.content ?? [])
    .map((c) => (c.type === "text" ? c.text : c.type === "file" ? `[file] ${c.path ?? ""}` : ""))
    .join("\n")
    .trim();
  const input = part.state?.input;
  const inputText = input ? JSON.stringify(input, null, 2) : "";
  const exit = part.state?.metadata?.exit;
  const iconName = /shell|bash|command/i.test(part.name || "")
    ? "terminal"
    : /grep|glob|search|find/i.test(part.name || "")
      ? "search"
      : /read|write|edit|file/i.test(part.name || "")
        ? "file"
        : "wrench";
  const verb = status === "running" ? "Running" : status === "error" ? "Failed" : "Ran";

  return `
    <div class="tool-card" data-tool="${key}">
      <button class="tool-head" data-toggle-tool="${key}">
        <span class="tool-icon">${icon(iconName)}</span>
        <span class="tool-name">${verb} ${escapeHtml(part.name || "tool")}</span>
        <span class="tool-summary">${escapeHtml(summary)}</span>
        <span class="tool-state" data-status="${status === "error" ? "error" : status === "completed" ? "completed" : "running"}">
          ${status === "completed" ? icon("check") : status === "error" ? icon("x") : `<span class="spinner"></span>`}
        </span>
      </button>
      <div class="tool-body">
        ${inputText ? `<div class="tool-label">Input</div><pre class="tool-pre">${escapeHtml(inputText)}</pre>` : ""}
        ${
          content
            ? `<div class="tool-label">Output${exit != null ? ` · exit ${escapeHtml(String(exit))}` : ""}</div><pre class="tool-pre${status === "error" ? " err" : ""}">${escapeHtml(content)}</pre>`
            : status === "running"
              ? `<div class="tool-label">Waiting for output…</div>`
              : ""
        }
      </div>
    </div>`;
}

function renderReasoning(part, key) {
  const live = !part.time?.completed;
  return `
    <div class="reasoning${live ? " live" : ""}" data-reasoning="${escapeHtml(key)}">
      <button class="reasoning-toggle" data-toggle-reasoning="${escapeHtml(key)}">
        ${icon("brain")}<span>${live ? "Thinking…" : "Thought process"}</span>${icon("chevron", "caret")}
      </button>
      <div class="reasoning-body">${escapeHtml(part.text || "")}</div>
    </div>`;
}

function renderAssistant(m) {
  const parts = messageParts(m);
  const streaming = state.busy && m.id === state.lastAssistantId;
  const html = parts
    .map((part, idx) => {
      if (part.type === "reasoning") {
        return renderReasoning(part, `${m.id}:r:${part.ordinal ?? idx}`);
      }
      if (part.type === "text") {
        const key = `${m.id}:t:${part.ordinal ?? idx}`;
        const caret = streaming && idx === parts.length - 1 ? `<span class="stream-caret"></span>` : "";
        return `<div class="md" data-part="${escapeHtml(key)}">${renderMarkdown(part.text)}${caret}</div>`;
      }
      if (part.type === "tool") return renderTool(part);
      if (part.type === "retry") {
        return `<div class="msg-system"><span class="sys">${icon("refresh")}Retrying…</span></div>`;
      }
      return "";
    })
    .join("");

  return `
    <div class="msg msg-assistant" data-msg="${escapeHtml(m.id)}">
      <div class="assistant-body">${html || (streaming ? `<div class="typing-row"><span class="typing"><i></i><i></i><i></i></span></div>` : "")}</div>
    </div>`;
}

function renderUser(m) {
  const files = (m.files ?? []).filter((f) => (f.mime ?? "").startsWith("image/") && f.uri);
  return `
    <div class="msg msg-user" data-msg="${escapeHtml(m.id)}">
      <div class="bubble">${escapeHtml(m.text ?? "")}
        ${
          files.length
            ? `<div class="files">${files.map((f) => `<img src="${escapeHtml(f.uri)}" alt="">`).join("")}</div>`
            : ""
        }
      </div>
    </div>`;
}

function renderSystem(text, iconName = "check") {
  return `<div class="msg msg-system"><span class="sys">${icon(iconName)}${escapeHtml(text)}</span></div>`;
}

function renderMessages(force = false) {
  if (state.screen !== "chat") return;
  const pinned = isNearBottom() || force;
  const openTools = new Set($$(".tool-card.open", el.messages).map((n) => n.dataset.tool));
  const openReasoning = new Set($$(".reasoning.open", el.messages).map((n) => n.dataset.reasoning));

  const chunks = [];
  let prevType = null;

  for (const m of state.messages) {
    if (m.type === "user") chunks.push(renderUser(m));
    else if (m.type === "assistant") chunks.push(renderAssistant(m));
    else if (m.type === "idle" && m.outcome && m.outcome !== "succeeded")
      chunks.push(renderSystem(m.outcome === "interrupted" ? "Interrupted" : "Failed", m.outcome === "failed" ? "x" : "stop"));
    else if (m.type === "shell")
      chunks.push(renderSystem(`$ ${(m.command ?? "").slice(0, 80)}`, "terminal"));
    else if (m.type === "compaction") chunks.push(renderSystem("Context compacted", "refresh"));
    else if (m.type === "system" && m.text) chunks.push(renderSystem(m.text, "spark"));
    prevType = m.type;
  }

  if (!chunks.length) {
    el.messages.innerHTML = `<div class="empty">${icon("spark")}<b>Fresh start</b>Ask anything, or type / for commands.</div>`;
    return;
  }

  if (state.busy) {
    const last = state.messages[state.messages.length - 1];
    const hasVisible =
      last?.type === "assistant" &&
      (last.content ?? []).some((p) => (p.type === "text" && p.text?.trim()) || p.type === "tool" || (p.type === "reasoning" && p.text?.trim()));
    if (!hasVisible) chunks.push(`<div class="typing-row"><span class="typing"><i></i><i></i><i></i></span><span>Responding</span></div>`);
  }

  el.messages.innerHTML = chunks.join("");
  for (const n of $$(".tool-card", el.messages)) if (openTools.has(n.dataset.tool)) n.classList.add("open");
  for (const n of $$(".reasoning", el.messages)) if (openReasoning.has(n.dataset.reasoning)) n.classList.add("open");

  if (pinned) scrollToBottom(false);
  updateJumpLatest();
}

function updateJumpLatest() {
  el.jumpLatest.hidden = isNearBottom() || state.screen !== "chat";
}

function scheduleStreamRender() {
  if (state.pendingRender) return;
  state.pendingRender = requestAnimationFrame(() => {
    state.pendingRender = 0;
    updateStreamingText();
  });
}

function updateStreamingText() {
  const last = state.messages[state.messages.length - 1];
  if (!last || last.type !== "assistant") return;
  const parts = last.content ?? [];
  const idx = parts.length - 1;
  const part = parts[idx];
  if (!part || part.type !== "text") return;
  const key = `${last.id}:t:${part.ordinal ?? idx}`;
  const node = el.messages.querySelector(`[data-part="${CSS.escape(key)}"]`);
  if (!node) {
    renderMessages();
    return;
  }
  const pinned = isNearBottom();
  node.innerHTML = renderMarkdown(part.text) + `<span class="stream-caret"></span>`;
  if (pinned) scrollToBottom(false);
}

/* ---------------------------------------------------------------- events */

let listRefreshTimer = 0;
let messageRefreshTimer = 0;

function scheduleListRefresh() {
  clearTimeout(listRefreshTimer);
  listRefreshTimer = setTimeout(() => refreshSessions(false).catch(() => {}), 500);
}

function scheduleMessageRefresh(delay = 350) {
  clearTimeout(messageRefreshTimer);
  messageRefreshTimer = setTimeout(() => {
    if (state.session) loadMessages().catch(() => {});
  }, delay);
}

function eventBelongsToOpenSession(data) {
  return data?.sessionID && state.session && data.sessionID === state.session.id;
}

function handleEvent(event) {
  const type = event.type;
  const data = event.data ?? {};

  if (type === "server.connected") {
    state.online = true;
    setConnection(state.busy ? "busy" : "online", "Connected");
    if (state.screen === "chat") scheduleMessageRefresh(200);
    else refreshSessions(false).catch(() => {});
    return;
  }

  if ([
    "session.created",
    "session.deleted",
    "session.renamed",
    "session.archived",
    "session.unarchived",
    "session.moved",
    "session.metadata.updated",
    "session.model.selected",
    "session.agent.selected",
    "session.execution.started",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
  ].includes(type)) {
    scheduleListRefresh();
  }

  if (!eventBelongsToOpenSession(data)) {
    if (type === "session.renamed" && state.session?.id === data.sessionID) {
      state.session.title = data.title;
      setChatHeader();
    }
    return;
  }

  switch (type) {
    case "session.execution.started":
      setBusy(true);
      break;
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
    case "session.idle":
      setBusy(false);
      state.lastAssistantId = null;
      scheduleMessageRefresh(250);
      break;
    case "session.step.started": {
      state.lastAssistantId = data.assistantMessageID;
      ensureAssistant(data.assistantMessageID, { ...data, started: data.started });
      setBusy(true);
      if (!isNearBottom()) updateJumpLatest();
      break;
    }
    case "session.text.started": {
      const m = ensureAssistant(data.assistantMessageID, data);
      let part = m.content.find((p) => p.type === "text" && p.ordinal === data.ordinal);
      if (!part) {
        part = { type: "text", text: "", ordinal: data.ordinal, time: { created: Date.now() } };
        m.content.push(part);
      }
      state.lastAssistantId = m.id;
      if (!$$(`[data-msg="${CSS.escape(m.id)}"]`, el.messages).length) renderMessages();
      break;
    }
    case "session.text.delta": {
      const m = ensureAssistant(data.assistantMessageID, data);
      let part = m.content.find((p) => p.type === "text" && p.ordinal === data.ordinal);
      if (!part) {
        part = { type: "text", text: "", ordinal: data.ordinal };
        m.content.push(part);
      }
      part.text = (part.text ?? "") + (data.delta ?? "");
      state.lastAssistantId = m.id;
      scheduleStreamRender();
      break;
    }
    case "session.text.ended": {
      const m = ensureAssistant(data.assistantMessageID, data);
      const part = m.content.find((p) => p.type === "text" && p.ordinal === data.ordinal);
      if (part) part.text = data.text ?? part.text;
      else m.content.push({ type: "text", text: data.text ?? "", ordinal: data.ordinal });
      renderMessages();
      break;
    }
    case "session.reasoning.started": {
      const m = ensureAssistant(data.assistantMessageID, data);
      if (!m.content.some((p) => p.type === "reasoning" && p.ordinal === data.ordinal)) {
        m.content.push({ type: "reasoning", text: "", ordinal: data.ordinal });
      }
      renderMessages();
      break;
    }
    case "session.reasoning.delta": {
      const m = ensureAssistant(data.assistantMessageID, data);
      let part = m.content.find((p) => p.type === "reasoning" && p.ordinal === data.ordinal);
      if (!part) {
        part = { type: "reasoning", text: "", ordinal: data.ordinal };
        m.content.push(part);
      }
      part.text = (part.text ?? "") + (data.delta ?? "");
      scheduleStreamRender();
      break;
    }
    case "session.reasoning.ended": {
      const m = ensureAssistant(data.assistantMessageID, data);
      const part = m.content.find((p) => p.type === "reasoning" && p.ordinal === data.ordinal);
      if (part) {
        part.text = data.text ?? part.text;
        part.time = { completed: Date.now() };
      }
      renderMessages();
      break;
    }
    case "session.tool.input.started": {
      const m = ensureAssistant(data.assistantMessageID, data);
      if (!m.content.some((p) => p.type === "tool" && p.id === data.id)) {
        m.content.push({ type: "tool", id: data.id, name: data.name, executed: false, state: { status: "running", input: {} } });
      }
      renderMessages();
      break;
    }
    case "session.tool.called": {
      const m = ensureAssistant(data.assistantMessageID, data);
      let part = m.content.find((p) => p.type === "tool" && p.id === data.id);
      if (!part) {
        part = { type: "tool", id: data.id, name: data.name ?? "tool", executed: false, state: { status: "running", input: {} } };
        m.content.push(part);
      }
      part.state = { ...(part.state ?? {}), status: "running", input: data.input ?? part.state?.input };
      renderMessages();
      break;
    }
    case "session.tool.success": {
      const m = ensureAssistant(data.assistantMessageID, data);
      const part = m.content.find((p) => p.type === "tool" && p.id === data.id);
      if (part) {
        part.state = {
          status: "completed",
          input: part.state?.input,
          content: data.content,
          metadata: data.metadata,
        };
        part.executed = data.executed ?? true;
      }
      renderMessages();
      break;
    }
    case "session.tool.failed": {
      const m = ensureAssistant(data.assistantMessageID, data);
      const part = m.content.find((p) => p.type === "tool" && p.id === data.id);
      if (part) {
        part.state = {
          status: "error",
          input: part.state?.input,
          content: data.content ?? [{ type: "text", text: data.error ?? "Tool failed" }],
          metadata: data.metadata,
        };
      }
      renderMessages();
      break;
    }
    case "permission.asked":
      loadPermissions().catch(() => {});
      haptic(16);
      break;
    case "session.inbox.delivered":
      scheduleMessageRefresh(450);
      break;
    default:
      break;
  }
}

/* ---------------------------------------------------------------- permissions */

async function loadPermissions() {
  if (!state.api || !state.session) return;
  try {
    const res = await state.api.permissions(state.session.id);
    state.permissions = res?.data ?? [];
    updatePermBanner();
    if (state.permissions.length && !state.sheetOpen) showPermissionSheet();
  } catch {}
}

function updatePermBanner() {
  el.permBanner.hidden = state.permissions.length === 0;
}

function showPermissionSheet() {
  const req = state.permissions[0];
  if (!req || state.sheetOpen) return;
  const resources = (req.resources ?? []).join("\n");
  openSheet({
    title: "Permission needed",
    body: (root) => {
      root.innerHTML = `
        <p class="sheet-note">OpenCode wants to run a tool. Review it before allowing.</p>
        <div class="permission-card">
          <p class="permission-action">${escapeHtml(req.action || "Action")}</p>
          ${resources ? `<pre class="permission-res">${escapeHtml(resources)}</pre>` : ""}
          ${req.message ? `<p class="sheet-note" style="margin:4px 0 0">${escapeHtml(req.message)}</p>` : ""}
        </div>
        <div class="permission-actions">
          <button class="btn btn-ghost" data-perm="reject">Deny</button>
          <button class="btn btn-ghost" data-perm="always">Always</button>
          <button class="btn btn-primary" data-perm="once">Allow once</button>
        </div>`;
      root.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-perm]");
        if (!btn) return;
        const decision = btn.dataset.perm;
        btn.disabled = true;
        try {
          await state.api.replyPermission(state.session.id, req.id, decision);
          haptic(10);
          toast(decision === "reject" ? "Denied" : decision === "always" ? "Always allowed" : "Allowed");
          state.permissions = state.permissions.filter((p) => p.id !== req.id);
          updatePermBanner();
          closeSheet();
          if (state.permissions.length) setTimeout(showPermissionSheet, 300);
        } catch (err) {
          btn.disabled = false;
          handleError(err, "Could not send reply");
        }
      });
    },
  });
}

/* ---------------------------------------------------------------- composer */

function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, window.innerHeight * 0.34) + "px";
}

function updateSendButton() {
  const hasText = el.input.value.trim().length > 0 || state.attachments.length > 0;
  const stop = state.busy && !hasText;
  el.send.dataset.mode = stop ? "stop" : "send";
  el.send.setAttribute("aria-label", stop ? "Stop" : "Send");
  el.send.disabled = !hasText && !state.busy;
  el.send.innerHTML = icon(stop ? "stop" : "send");
}

function renderAttachments() {
  el.attachStrip.hidden = state.attachments.length === 0;
  el.attachStrip.innerHTML = state.attachments
    .map(
      (a, i) => `
      <div class="attach-chip">
        <img src="${escapeHtml(a.uri)}" alt="">
        <button data-remove-attach="${i}" aria-label="Remove">${icon("x")}</button>
      </div>`
    )
    .join("");
}

async function addFiles(fileList) {
  for (const file of [...fileList].slice(0, 4)) {
    if (!file.type.startsWith("image/")) {
      toast("Only images can be attached right now");
      continue;
    }
    try {
      const dataUri = await compressImage(file);
      state.attachments.push({ uri: dataUri, name: file.name || "image.jpg" });
    } catch {
      toast("Could not read that image");
    }
  }
  renderAttachments();
  updateSendButton();
}

function compressImage(file, maxSide = 1568, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function attachmentsPayload() {
  return state.attachments.map((a) => ({
    uri: a.uri,
    name: a.name,
    source: { type: "inline" },
  }));
}

async function sendMessage() {
  const text = el.input.value.trim();
  if (!state.session) return;

  if (!text && state.busy) {
    await interrupt();
    return;
  }
  if (!text && !state.attachments.length) return;

  const files = attachmentsPayload();
  el.input.value = "";
  autoGrow();
  state.attachments = [];
  renderAttachments();
  updateSendButton();

  // optimistic user message
  const localId = "local_" + Date.now();
  state.messages.push({
    id: localId,
    type: "user",
    text,
    files: files.map((f) => ({ uri: f.uri, mime: "image/jpeg", name: f.name })),
    time: { created: Date.now() },
  });
  renderMessages(true);
  scrollToBottom(true);
  setBusy(true);
  state.lastAssistantId = null;
  renderMessages();

  try {
    if (text.startsWith("/")) {
      const match = text.match(/^\/(\S+)\s*([\s\S]*)$/);
      await state.api.command(state.session.id, {
        name: match?.[1] ?? "help",
        text: match?.[2] ?? "",
        files,
      });
    } else {
      await state.api.prompt(state.session.id, { text, files, delivery: "steer" });
    }
    haptic(6);
    setTimeout(() => {
      state.messages = state.messages.filter((m) => m.id !== localId);
      loadMessages().catch(() => {});
    }, 900);
  } catch (err) {
    setBusy(false);
    renderMessages();
    handleError(err, "Message failed");
  }
}

async function interrupt() {
  if (!state.session) return;
  try {
    await state.api.interrupt(state.session.id);
    haptic(14);
    toast("Stopping…");
  } catch (err) {
    handleError(err, "Could not stop");
  }
}

/* ---------------------------------------------------------------- sheets */

function openSheet({ title, body, onClose }) {
  clearTimeout(state.sheetCloseTimer);
  if (state.sheetOpen) {
    // Swap content of the open sheet without pushing another history entry.
    el.sheetTitle.textContent = title;
    el.sheetBody.innerHTML = "";
    body(el.sheetBody);
    state.sheetOnClose = onClose;
    el.sheetBody.scrollTop = 0;
    return;
  }
  el.sheetTitle.textContent = title;
  el.sheetBody.innerHTML = "";
  body(el.sheetBody);
  el.sheet.hidden = false;
  el.scrim.hidden = false;
  state.sheetOpen = true;
  state.sheetOnClose = onClose;
  requestAnimationFrame(() => {
    el.sheet.classList.add("open");
    el.scrim.classList.add("open");
  });
  history.pushState({ sheet: true }, "");
}

function closeSheet(fromPop = false) {
  if (!state.sheetOpen) return;
  if (!fromPop) {
    history.back();
    return;
  }
  state.sheetOpen = false;
  el.sheet.classList.remove("open");
  el.scrim.classList.remove("open");
  clearTimeout(state.sheetCloseTimer);
  state.sheetCloseTimer = setTimeout(() => {
    if (state.sheetOpen) return;
    el.sheet.hidden = true;
    el.scrim.hidden = true;
    el.sheetBody.innerHTML = "";
  }, 340);
  state.sheetOnClose?.();
  state.sheetOnClose = null;
}

function sheetRow({ iconName, title, sub, selected, danger, attrs = "", check = true }) {
  return `
    <button class="sheet-item${selected ? " selected" : ""}${danger ? " danger" : ""}" ${attrs}>
      ${iconName ? `<span class="si-icon">${icon(iconName)}</span>` : ""}
      <span class="si-text"><span class="si-title">${escapeHtml(title)}</span>${sub ? `<span class="si-sub">${escapeHtml(sub)}</span>` : ""}</span>
      ${selected && check ? `<span class="si-check">${icon("check")}</span>` : ""}
    </button>`;
}

/* ---------------------------------------------------------------- model + agent */

async function ensureModels() {
  if (state.models) return state.models;
  state.models = await state.api.models();
  return state.models;
}
async function ensureAgents() {
  if (state.agents) return state.agents;
  state.agents = await state.api.agents();
  return state.agents;
}
async function ensureProjects() {
  if (state.projects) return state.projects;
  state.projects = await state.api.projects();
  return state.projects;
}
async function ensureCommands() {
  if (state.commands) return state.commands;
  state.commands = await state.api.commands();
  return state.commands;
}

async function openModelSheet() {
  if (!state.session) return;
  let models = [];
  try {
    models = await ensureModels();
  } catch (err) {
    handleError(err, "Could not load models");
    return;
  }
  const current = state.session.model;
  const list = models.filter((m) => m.enabled !== false && (m.type === "chat" || !m.type));

  openSheet({
    title: "Model",
    body: (root) => {
      root.innerHTML = `
        <div class="sheet-search"><div class="search-box">${icon("search")}<input class="search-input" id="model-search" placeholder="Search ${list.length} models" autocomplete="off"></div></div>
        <div class="sheet-list" id="model-list"></div>`;
      const input = $("#model-search", root);
      const listEl = $("#model-list", root);
      const currentKey = current ? `${current.providerID}/${current.id}` : null;
      const ordered = current
        ? [
            ...list.filter((m) => `${m.providerID}/${m.id}` === currentKey),
            ...list.filter((m) => `${m.providerID}/${m.id}` !== currentKey),
          ]
        : list;
      let query = "";
      let cap = 60;

      const paint = () => {
        const q = query.toLowerCase();
        const filtered = ordered.filter(
          (m) => !q || m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q) || (m.providerID ?? "").toLowerCase().includes(q)
        );
        const shown = filtered.slice(0, cap);
        listEl.innerHTML =
          shown
            .map((m) => {
              const selected = current && m.id === current.id && m.providerID === current.providerID;
              return sheetRow({
                iconName: "cpu",
                title: m.name || m.id,
                sub: `${m.providerID} · ${m.id}${m.limit?.context ? ` · ${Math.round(m.limit.context / 1000)}k ctx` : ""}`,
                selected,
                attrs: `data-model="${escapeHtml(m.providerID)}|${escapeHtml(m.id)}"`,
              });
            })
            .join("") +
          (filtered.length > shown.length
            ? `<button class="btn btn-ghost" style="margin:10px 0" data-more-models>Show ${Math.min(60, filtered.length - shown.length)} more</button>`
            : "") ||
          `<p class="sheet-note">No models match.</p>`;
      };
      paint();

      input.addEventListener("input", () => {
        query = input.value.trim();
        cap = 60;
        paint();
      });
      listEl.addEventListener("click", async (e) => {
        if (e.target.closest("[data-more-models]")) {
          cap += 60;
          paint();
          return;
        }
        const btn = e.target.closest("[data-model]");
        if (!btn) return;
        const [providerID, ...rest] = btn.dataset.model.split("|");
        const id = rest.join("|");
        const model = list.find((m) => m.id === id && m.providerID === providerID);
        if (!model) return;
        const variants = model.variants ?? [];
        if (variants.length > 1) {
          openVariantSheet(model);
        } else {
          await applyModel({ providerID, id });
          closeSheet();
        }
      });
    },
  });
}

function openVariantSheet(model) {
  const ref = state.session.model;
  openSheet({
    title: "Reasoning effort",
    body: (root) => {
      const rows = [
        sheetRow({ iconName: "cpu", title: "Default", sub: "Let the provider decide", selected: !ref?.variant || ref.id !== model.id, attrs: `data-variant=""` }),
        ...(model.variants ?? []).map((v) =>
          sheetRow({
            iconName: "brain",
            title: String(v.id).replace(/^./, (c) => c.toUpperCase()),
            sub: v.settings?.reasoning?.effort ? `effort: ${v.settings.reasoning.effort}` : "",
            selected: ref?.id === model.id && ref?.variant === v.id,
            attrs: `data-variant="${escapeHtml(v.id)}"`,
          })
        ),
      ].join("");
      root.innerHTML = `<p class="sheet-note">${escapeHtml(model.name || model.id)} supports multiple reasoning levels.</p><div class="sheet-list">${rows}</div>`;
      root.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-variant]");
        if (!btn) return;
        const variant = btn.dataset.variant || undefined;
        await applyModel({ providerID: model.providerID, id: model.id, variant });
        closeSheet();
        setTimeout(() => closeSheet(), 120);
      });
    },
  });
}

async function applyModel(model) {
  try {
    await state.api.switchModel(state.session.id, model);
    state.session.model = model;
    state.lastModel = model;
    store.set("lastModel", model);
    updateChatStatus();
    toast("Model changed");
    haptic(6);
  } catch (err) {
    handleError(err, "Could not switch model");
  }
}

async function openAgentSheet() {
  if (!state.session) return;
  let agents = [];
  try {
    agents = await ensureAgents();
  } catch (err) {
    handleError(err, "Could not load agents");
    return;
  }
  const list = agents.filter((a) => !a.hidden && a.mode !== "subagent");
  openSheet({
    title: "Agent",
    body: (root) => {
      root.innerHTML = `<div class="sheet-list">${list
        .map((a) =>
          sheetRow({
            iconName: "spark",
            title: a.name || a.id,
            sub: a.description || a.id,
            selected: a.id === state.session.agent,
            attrs: `data-agent="${escapeHtml(a.id)}"`,
          })
        )
        .join("")}</div>`;
      root.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-agent]");
        if (!btn) return;
        try {
          await state.api.switchAgent(state.session.id, btn.dataset.agent);
          state.session.agent = btn.dataset.agent;
          updateChatStatus();
          setChatHeader();
          toast("Agent changed");
          closeSheet();
        } catch (err) {
          handleError(err, "Could not switch agent");
        }
      });
    },
  });
}

/* ---------------------------------------------------------------- session actions */

function sessionActions(session) {
  const busy = (session.time?.busy ?? 0) > (session.time?.idle ?? 0);
  openSheet({
    title: session.title?.trim() || "Session",
    body: (root) => {
      root.innerHTML = `
        <p class="sheet-note">${escapeHtml(session.location?.directory || "")}</p>
        <div class="sheet-list">
          ${sheetRow({ iconName: "edit", title: "Rename", attrs: "data-action=rename" })}
          ${busy ? sheetRow({ iconName: "stop", title: "Stop run", attrs: "data-action=stop" }) : ""}
          ${sheetRow({ iconName: "settings", title: "Session info", attrs: "data-action=info" })}
          ${sheetRow({ iconName: "trash", title: "Delete session", danger: true, attrs: "data-action=delete" })}
        </div>`;
      root.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        closeSheet();
        if (action === "rename") setTimeout(() => renameSession(session), 200);
        if (action === "delete") setTimeout(() => deleteSession(session), 200);
        if (action === "info") setTimeout(() => sessionInfo(session), 200);
        if (action === "stop") {
          state.api.interrupt(session.id).then(() => toast("Stopping…")).catch((err) => handleError(err, "Could not stop"));
        }
      });
    },
  });
}

function renameSession(session) {
  openSheet({
    title: "Rename session",
    body: (root) => {
      root.innerHTML = `
        <label class="field"><span class="label">Title</span>
          <input class="input" id="rename-input" value="${escapeHtml(session.title ?? "")}" maxlength="120">
        </label>
        <button class="btn btn-primary btn-block" style="margin-top:14px" id="rename-save">Save</button>`;
      const input = $("#rename-input", root);
      input.focus();
      input.select();
      $("#rename-save", root).addEventListener("click", async () => {
        const title = input.value.trim();
        if (!title) return;
        try {
          await state.api.updateSession(session.id, { title });
          session.title = title;
          const row = state.sessions.find((s) => s.id === session.id);
          if (row) row.title = title;
          if (state.session?.id === session.id) setChatHeader();
          closeSheet();
          refreshSessions(false).catch(() => {});
          toast("Renamed");
        } catch (err) {
          handleError(err, "Could not rename");
        }
      });
    },
  });
}

function deleteSession(session) {
  openSheet({
    title: "Delete session?",
    body: (root) => {
      root.innerHTML = `
        <p class="sheet-note">“${escapeHtml(session.title || "Untitled session")}” and its messages will be removed. This cannot be undone.</p>
        <div class="permission-actions">
          <button class="btn btn-ghost" data-cancel>Cancel</button>
          <button class="btn btn-danger" data-confirm>Delete</button>
        </div>`;
      root.addEventListener("click", async (e) => {
        if (e.target.closest("[data-cancel]")) return closeSheet();
        if (!e.target.closest("[data-confirm]")) return;
        try {
          await state.api.deleteSession(session.id);
          state.sessions = state.sessions.filter((s) => s.id !== session.id);
          if (state.session?.id === session.id) {
            closeSheet();
            setTimeout(() => closeChat(false), 180);
          } else {
            renderSessions();
            closeSheet();
          }
          toast("Session deleted");
        } catch (err) {
          handleError(err, "Could not delete");
        }
      });
    },
  });
}

function sessionInfo(session) {
  openSheet({
    title: "Session info",
    body: (root) => {
      const rows = [
        ["ID", session.id],
        ["Directory", session.location?.directory ?? "—"],
        ["Agent", session.agent ?? "—"],
        ["Model", session.model ? `${session.model.providerID}/${session.model.id}` : "—"],
        ["Created", new Date(session.time?.created ?? Date.now()).toLocaleString()],
        ["Updated", new Date(session.time?.updated ?? Date.now()).toLocaleString()],
        ["Tokens in", String(session.tokens?.input ?? 0)],
        ["Tokens out", String(session.tokens?.output ?? 0)],
      ];
      root.innerHTML = `<div class="settings-grid">${rows
        .map(
          ([k, v]) => `<div class="setting-row"><div class="setting-text"><div class="setting-title">${escapeHtml(k)}</div><div class="setting-sub">${escapeHtml(v)}</div></div></div>`
        )
        .join("")}</div>`;
    },
  });
}

/* ---------------------------------------------------------------- new session */

async function openNewSession() {
  let projects = [];
  try {
    projects = await ensureProjects();
  } catch (err) {
    handleError(err, "Could not load projects");
    return;
  }
  projects = [...projects].sort((a, b) => (b.time?.active ?? 0) - (a.time?.active ?? 0)).slice(0, 12);
  const dirs = new Map();
  for (const p of projects) if (p.canonical) dirs.set(p.canonical, { dir: p.canonical, active: p.time?.active ?? 0 });
  for (const s of state.sessions) {
    const dir = s.location?.directory;
    if (dir && !dirs.has(dir)) dirs.set(dir, { dir, active: s.time?.updated ?? 0 });
  }
  const workspaceList = [...dirs.values()].sort((a, b) => b.active - a.active).slice(0, 14);
  const lastDir = store.get("lastDir", state.sessions[0]?.location?.directory ?? workspaceList[0]?.dir ?? "");

  openSheet({
    title: "New session",
    body: (root) => {
      root.innerHTML = `
        <p class="sheet-note">Pick a workspace. OpenCode runs in that directory.</p>
        <div class="sheet-list scroll" id="project-list">
          ${
            workspaceList.length
              ? workspaceList
                  .map((p) =>
                    sheetRow({
                      iconName: "folder",
                      title: basename(p.dir) || p.dir,
                      sub: p.dir,
                      selected: p.dir === lastDir,
                      attrs: `data-dir="${escapeHtml(p.dir)}"`,
                    })
                  )
                  .join("")
              : `<p class="sheet-note">No known workspaces yet — enter a path below.</p>`
          }
        </div>
        <button class="btn btn-ghost btn-block" style="margin-top:10px" id="custom-dir">Use a custom path…</button>
        <div id="custom-wrap" hidden style="margin-top:10px">
          <input class="input" id="custom-input" placeholder="/data/data/com.termux/files/home/project" spellcheck="false">
        </div>
        <button class="btn btn-primary btn-block" style="margin-top:16px" id="create-session">Start session</button>`;
      let selected = lastDir;

      root.addEventListener("click", (e) => {
        const row = e.target.closest("[data-dir]");
        if (row) {
          selected = row.dataset.dir;
          for (const n of $$(".sheet-item", root)) n.classList.toggle("selected", n === row);
        }
        if (e.target.closest("#custom-dir")) {
          $("#custom-wrap", root).hidden = false;
          $("#custom-input", root).focus();
        }
        if (e.target.closest("#create-session")) create();
      });

      async function create() {
        const custom = $("#custom-input", root);
        const dir = (custom && !$("#custom-wrap", root).hidden && custom.value.trim()) || selected;
        if (!dir) return toast("Choose a workspace first");
        const btn = $("#create-session", root);
        btn.disabled = true;
        btn.textContent = "Starting…";
        try {
          const res = await state.api.createSession({
            directory: dir,
            model: state.lastModel || undefined,
          });
          const session = res?.data;
          store.set("lastDir", dir);
          state.sessions.unshift(session);
          closeSheet();
          setTimeout(() => openSession(session), 220);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Start session";
          handleError(err, "Could not create session");
        }
      }
    },
  });
}

/* ---------------------------------------------------------------- settings */

let deferredInstall = null;

function openSettings() {
  openSheet({
    title: "Settings",
    body: (root) => {
      const theme = state.theme;
      const serverLabel = state.info ? `OpenCode ${state.info.version} · ${state.info.hostname ?? ""}` : "";
      root.innerHTML = `
        <div class="settings-grid">
          <div class="setting-row">
            <div class="setting-text"><div class="setting-title">Appearance</div><div class="setting-sub">Theme</div></div>
            <div class="seg" id="theme-seg">
              <button data-theme="system" class="${theme === "system" ? "on" : ""}">Auto</button>
              <button data-theme="dark" class="${theme === "dark" ? "on" : ""}">Dark</button>
              <button data-theme="light" class="${theme === "light" ? "on" : ""}">Light</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-text"><div class="setting-title">Enter to send</div><div class="setting-sub">Enter sends, Shift+Enter newline</div></div>
            <button class="switch ${state.enterToSend ? "on" : ""}" id="enter-toggle" aria-label="Toggle enter to send"></button>
          </div>
          <div class="setting-row">
            <div class="setting-text"><div class="setting-title">Server</div><div class="setting-sub">${escapeHtml(state.demo ? "Demo mode · fake data, no server" : state.base)}</div></div>
            <span class="si-icon" style="color:var(--accent)">${icon("wifi")}</span>
          </div>
          ${
            state.demo
              ? ""
              : `<div class="setting-row">
                  <div class="setting-text"><div class="setting-title">Password</div><div class="setting-sub">${escapeHtml(state.secret.slice(0, 6))}••••••••</div></div>
                  <button class="btn btn-ghost" style="height:38px;padding:0 12px;font-size:12.5px" id="edit-conn">Change</button>
                </div>`
          }
          ${state.info ? `<div class="setting-row"><div class="setting-text"><div class="setting-title">Version</div><div class="setting-sub">${escapeHtml(serverLabel)}</div></div></div>` : ""}
          ${
            deferredInstall
              ? `<div class="setting-row"><div class="setting-text"><div class="setting-title">Install app</div><div class="setting-sub">Add OpenCode Pocket to your home screen</div></div><button class="btn btn-primary" style="height:38px;padding:0 14px;font-size:12.5px" id="install-app">Install</button></div>`
              : ""
          }
          <a class="setting-row" href="https://github.com/shivapal12395-droid/opencode-pocket" target="_blank" rel="noreferrer" style="text-decoration:none">
            <div class="setting-text"><div class="setting-title">Source code</div><div class="setting-sub">github.com/shivapal12395-droid/opencode-pocket</div></div>
            <span class="si-icon">${icon("github")}</span>
          </a>
          <div class="setting-row">
            <div class="setting-text">
              <div class="setting-title">${state.demo ? "Exit demo" : "Disconnect"}</div>
              <div class="setting-sub">${state.demo ? "Go back to the connect screen" : "Forget this server on this device"}</div>
            </div>
            <button class="btn btn-danger" style="height:38px;padding:0 12px;font-size:12.5px" id="disconnect">${state.demo ? "Exit" : "Forget"}</button>
          </div>
        </div>`;

      root.addEventListener("click", async (e) => {
        const themeBtn = e.target.closest("#theme-seg button");
        if (themeBtn) {
          state.theme = themeBtn.dataset.theme;
          store.set("theme", state.theme);
          applyTheme();
          for (const b of $$("#theme-seg button", root)) b.classList.toggle("on", b === themeBtn);
        }
        if (e.target.closest("#enter-toggle")) {
          state.enterToSend = !state.enterToSend;
          store.set("enterToSend", state.enterToSend);
          e.target.closest("#enter-toggle").classList.toggle("on", state.enterToSend);
        }
        if (e.target.closest("#install-app")) {
          deferredInstall?.prompt?.();
          deferredInstall = null;
          closeSheet();
        }
        if (e.target.closest("#edit-conn")) {
          closeSheet();
          setTimeout(openConnectionSheet, 220);
        }
        if (e.target.closest("#disconnect")) {
          closeSheet();
          setTimeout(() => {
            if (state.demo) {
              location.href = location.pathname;
              return;
            }
            store.del("base");
            store.del("secret");
            stopEvents();
            state.api = null;
            location.reload();
          }, 220);
        }
      });
    },
  });
}

function openConnectionSheet() {
  openSheet({
    title: "Connection",
    body: (root) => {
      root.innerHTML = `
        <label class="field"><span class="label">Server URL</span>
          <input class="input" id="srv-url" value="${escapeHtml(state.base)}" spellcheck="false">
        </label>
        <label class="field" style="margin-top:12px"><span class="label">Password or pairing link</span>
          <input class="input" id="srv-secret" value="" placeholder="Leave blank to keep current" spellcheck="false" autocapitalize="off">
        </label>
        <button class="btn btn-primary btn-block" style="margin-top:16px" id="srv-save">Save & reconnect</button>
        <p class="sheet-note" style="margin-top:12px">Run <code>opencode serve</code> then <code>opencode pair</code> in Termux.</p>`;
      $("#srv-save", root).addEventListener("click", async () => {
        const base = $("#srv-url", root).value.trim();
        const secret = $("#srv-secret", root).value.trim() || state.secret;
        const btn = $("#srv-save", root);
        btn.disabled = true;
        try {
          const resolved = await resolveSecret(base, secret);
          const api = new Api(resolved.base, resolved.secret);
          await api.info();
          store.set("base", resolved.base);
          store.set("secret", resolved.secret);
          state.api = api;
          state.base = resolved.base;
          state.secret = resolved.secret;
          state.models = state.agents = state.projects = state.commands = null;
          stopEvents();
          startEvents();
          closeSheet();
          await refreshSessions(true);
          toast("Connected");
        } catch (err) {
          btn.disabled = false;
          toast(err?.message || "Connection failed");
        }
      });
    },
  });
}

/* ---------------------------------------------------------------- commands */

function maybeShowCommandHints() {
  const value = el.input.value;
  if (!value.startsWith("/") || /\s/.test(value)) {
    el.composerHint.textContent = defaultHint();
    return;
  }
  ensureCommands()
    .then((commands) => {
      const q = value.slice(1).toLowerCase();
      const matches = commands.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 1);
      if (matches.length && value.length > 1) {
        el.composerHint.textContent = `/${matches[0].name} — ${matches[0].description ?? ""}`;
      } else {
        el.composerHint.textContent = defaultHint();
      }
    })
    .catch(() => {});
}

function defaultHint() {
  if (matchMedia("(pointer: fine)").matches) return "Enter to send · Shift+Enter for newline";
  return "";
}

/* ---------------------------------------------------------------- errors */

function handleError(err, fallback) {
  console.error(err);
  if (err instanceof ApiError && err.status === 401) {
    toast("Session expired — reconnect");
    setConnection("offline", "Unauthorized");
    store.del("secret");
    setTimeout(() => {
      stopEvents();
      state.chatOpen = false;
      state.session = null;
      showScreen("connect");
      el.connectError.hidden = false;
      el.connectError.textContent = "Your password or pairing link is no longer valid. Start the server again and reconnect.";
      el.connectUrl.value = state.base || "http://127.0.0.1:4096";
      el.connectSecret.value = "";
      el.connectSecret.focus();
    }, 600);
    return;
  }
  toast(err?.message ? `${fallback}: ${err.message}` : fallback);
}

/* ---------------------------------------------------------------- init */

function bindEvents() {
  // connect
  el.connectForm.addEventListener("submit", async (e) => {    e.preventDefault();
    el.connectError.hidden = true;
    el.connectSubmit.disabled = true;
    el.connectSubmit.textContent = "Connecting…";
    try {
      await connect(el.connectUrl.value, el.connectSecret.value);
    } catch (err) {
      el.connectError.hidden = false;
      el.connectError.textContent =
        err?.status === 401
          ? "Wrong password or expired link. Check the terminal where the server runs."
          : err?.message || "Could not reach that server.";
    } finally {
      el.connectSubmit.disabled = false;
      el.connectSubmit.textContent = "Connect";
    }
  });

  // session list
  el.sessionList.addEventListener("click", (e) => {    const ws = e.target.closest("[data-ws-toggle]");
    if (ws) {
      toggleWorkspace(ws.dataset.wsToggle);
      return;
    }
    const more = e.target.closest("[data-more]");
    if (more) {
      const s = state.sessions.find((x) => x.id === more.dataset.more);
      if (s) sessionActions(s);
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) {
      const s = state.sessions.find((x) => x.id === open.dataset.open);
      if (s) openSession(s);
    }
  });

  el.sessionList.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".session-row");
    if (!row) return;
    e.preventDefault();
    const s = state.sessions.find((x) => x.id === row.dataset.id);
    if (s) sessionActions(s);
  });

  el.sessionSearch.addEventListener("input", () => {
    state.search = el.sessionSearch.value.trim();
    el.clearSearch.hidden = !state.search;
    clearTimeout(bindEvents._searchTimer);
    bindEvents._searchTimer = setTimeout(() => refreshSessions(false).catch(() => {}), 280);
  });
  el.clearSearch.addEventListener("click", () => {
    el.sessionSearch.value = "";
    state.search = "";
    el.clearSearch.hidden = true;
    refreshSessions(true).catch(() => {});
  });

  el.fabNew.addEventListener("click", () => openNewSession());
  $("#try-demo").addEventListener("click", () => {
    location.search = "?demo=1";
  });

  // chat header
  el.chatBack.addEventListener("click", () => closeChat(false));
  el.chatTitle.addEventListener("click", () => state.session && renameSession(state.session));
  el.chatMenu.addEventListener("click", () => state.session && sessionActions(state.session));
  el.chipModel.addEventListener("click", () => openModelSheet());
  el.chipAgent.addEventListener("click", () => openAgentSheet());
  el.permBanner.addEventListener("click", () => showPermissionSheet());

  // messages interactions
  el.messages.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      const code = copy.closest(".code-block")?.querySelector("code")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy"), 1400);
      } catch {
        toast("Copy failed");
      }
      return;
    }
    const tool = e.target.closest("[data-toggle-tool]");
    if (tool) {
      tool.closest(".tool-card")?.classList.toggle("open");
      return;
    }
    const reasoning = e.target.closest("[data-toggle-reasoning]");
    if (reasoning) {
      reasoning.closest(".reasoning")?.classList.toggle("open");
    }
  });

  el.messages.addEventListener("scroll", () => {
    state.pinned = isNearBottom();
    updateJumpLatest();
  });
  el.jumpLatest.addEventListener("click", () => {
    scrollToBottom(true);
    state.pinned = true;
    updateJumpLatest();
  });

  // composer
  el.input.addEventListener("input", () => {
    autoGrow();
    updateSendButton();
    maybeShowCommandHints();
  });
  el.input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const finePointer = matchMedia("(pointer: fine)").matches;
    if (!state.enterToSend && !finePointer) return;
    e.preventDefault();
    sendMessage();
  });
  el.send.addEventListener("click", () => {
    if (el.send.dataset.mode === "stop") interrupt();
    else sendMessage();
  });

  el.attach.addEventListener("click", () => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.multiple = true;
    picker.addEventListener("change", () => addFiles(picker.files));
    picker.click();
  });
  el.attachStrip.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-attach]");
    if (!btn) return;
    state.attachments.splice(Number(btn.dataset.removeAttach), 1);
    renderAttachments();
    updateSendButton();
  });

  // sheet
  el.scrim.addEventListener("click", () => closeSheet(false));
  el.sheetClose.addEventListener("click", () => closeSheet(false));

  // settings
  $("#open-settings").addEventListener("click", openSettings);
  el.connDot.addEventListener("click", () => {
    if (state.online) toast("Connected");
    else {
      startEvents();
      toast("Reconnecting…");
    }
  });

  // back button
  window.addEventListener("popstate", () => {
    if (state.sheetOpen) closeSheet(true);
    else if (state.chatOpen) closeChat(true);
  });

  // install prompt
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "system") applyTheme();
  });
}

async function boot() {
  cacheDom();
  applyTheme();
  bindEvents();
  el.composerHint.textContent = defaultHint();

  const savedBase = store.get("base", "");
  const savedSecret = store.get("secret", "");
  el.connectUrl.value = savedBase || "http://127.0.0.1:4096";

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  if (new URLSearchParams(location.search).get("demo") === "1") {
    const { MockApi } = await import("./mock.js");
    state.api = new MockApi();
    state.base = "demo://pocket";
    state.info = await state.api.info();
    state.demo = true;
    showScreen("sessions");
    startEvents();
    renderSessionSkeleton();
    await refreshSessions(true);
    const tag = document.querySelector(".brand-tag");
    if (tag) tag.textContent = "DEMO";
    return;
  }

  if (savedBase && savedSecret) {
    el.connectScreen.hidden = false;
    showScreen("sessions");
    renderSessionSkeleton();
    try {
      const api = new Api(savedBase, savedSecret);
      const info = await api.info();
      state.api = api;
      state.base = savedBase;
      state.secret = savedSecret;
      state.info = info;
      await enterApp();
      return;
    } catch (err) {
      console.warn("saved connection failed", err);
      if (err?.status === 401) {
        store.del("secret");
      }
      showScreen("connect");
      el.connectError.hidden = false;
      el.connectError.textContent =
        err?.status === 401
          ? "Saved password expired (it changes when the server restarts). Paste the new one."
          : "Could not reach the saved server. Is Termux still running?";
      el.connectSecret.value = "";
      el.connectSecret.focus();
      return;
    }
  }

  showScreen("connect");
}

boot();
