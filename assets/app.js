import { Api, ApiError, normalizeBase, resolveSecret } from "./api.js";
import { renderMarkdown, escapeHtml } from "./markdown.js";
import { formCardHtml, buildAnswer, missingRequired, applyFormConditions } from "./forms.js";
import { getPrefs, setPref, onPrefs, applyPrefs, ACCENTS, DEFAULTS, densityLabel, verbosityLabel, verbosityHint, scaleLabel } from "./prefs.js";
import { detectArtifacts, artifactCardHtml, artifactBodyHtml } from "./artifacts.js";

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
  theme: store.get("theme", "system"), // system dark -> amoled
  enterToSend: store.get("enterToSend", false),
  sheetOpen: false,
  chatOpen: false,
  lastAssistantId: null,
  pendingRender: 0,
  diff: [],
  revert: null,
  // pending + recently settled forms for the open session (question tool)
  forms: [],
  // prompts waiting in this session's inbox (queue)
  inbox: [],
  // steer = join the running turn, queue = run after it
  delivery: store.get("delivery", "steer"),
  // placeholders so a 1.x service worker cannot call missing hooks
  artifacts: [],
  prefs: getPrefs(),
  artifacts: [],
  artifact: null,
  artifactTab: "preview",
  sheetKind: null,
  renderSignature: "",
  renderedIds: new Set(),
  skipEntrance: false,
  visibilityHooked: false,
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
  el.chatDiff = $("#chat-diff");
  el.chatBranch = $("#chat-branch");
  el.chatFind = $("#chat-find");
  el.chatDiffCount = $("#chat-diff-count");
  el.revertBanner = $("#revert-banner");
  el.btnMention = $("#btn-mention");
  el.permBanner = $("#perm-banner");
  el.input = $("#input");
  el.send = $("#btn-send");
  el.attach = $("#btn-attach");
  el.attachStrip = $("#attach-strip");
  el.composerHint = $("#composer-hint");
  el.jumpLatest = $("#jump-latest");
  el.inboxBar = $("#inbox-bar");
  el.deliveryToggle = $("#delivery-toggle");
  el.artifact = $("#artifact");
  el.artifactTitle = $("#artifact-title");
  el.artifactSub = $("#artifact-sub");
  el.artifactBody = $("#artifact-body");
  el.artifactTabs = $("#artifact-tabs");
  el.artifactBack = $("#artifact-back");
  el.artifactMore = $("#artifact-more");
  el.scrim = $("#scrim");
  el.sheet = $("#sheet");
  el.sheetTitle = $("#sheet-title");
  el.sheetBody = $("#sheet-body");
  el.sheetClose = $("#sheet-close");
  el.toast = $("#toast");
}

/* ---------------------------------------------------------------- theme */

function applyTheme() {
  // A dark system scheme resolves to amoled: the pocket client is used on a
  // phone, nearly all of which are OLED, so true black is the better dark.
  // Picking Dark explicitly still gives the softer #0b0f14 palette.
  const resolved =
    state.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "amoled"
        : "light"
      : state.theme;
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  const surface = { light: "#fafafa", dark: "#0b0f14", amoled: "#000000" }[resolved] ?? "#0b0f14";
  if (meta) meta.content = surface;
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
  // Reconnect when returning to the app — once, however often events restart.
  if (!state.visibilityHooked) {
    state.visibilityHooked = true;
    document.addEventListener("visibilitychange", onVisibility);
  }
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
              // Unread is the server's own clock: updated after the last view.
              // Unread means the server recorded a view and the session moved on
              // since. No watermark at all is not "unread", it is "never opened".
              const unread =
                s.time?.viewed != null && (s.time?.updated ?? 0) > s.time.viewed && !busy;
              const failed = s.outcome === "failed";
              return `
                <div class="session-row${state.session?.id === s.id ? " active" : ""}${unread ? " unread" : ""}" data-id="${escapeHtml(s.id)}">
                  <button class="session-main" data-open="${escapeHtml(s.id)}">
                    <span class="session-title">${escapeHtml(title)}</span>
                    ${failed ? `<span class="session-failed" title="Last run failed"></span>` : ""}
                    ${busy ? `<span class="session-busy"></span>` : `${unread ? `<span class="session-unread"></span>` : ""}`}
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

/* ------------------------------------------------------ clipboard helpers */

async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
    haptic(6);
    return true;
  } catch {
    // WebViews without clipboard permission: fall back to a hidden textarea.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast(label);
      return true;
    } catch {
      toast("Copy failed");
      return false;
    }
  }
}

function downloadText(name, text, type = "text/markdown") {
  const blob = new Blob([text], { type: type + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("Saved " + name);
}

function markdownOf(m) {
  const parts = (m.content ?? []).filter((p) => p.type === "text");
  return parts.map((p) => p.text).join("\n\n").trim();
}

async function shareText(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch {}
  }
  await copyText(text, "Copied to share");
}

/** Re-asks the prompt that produced this answer. The server has no separate
 *  regenerate route, so this is an honest re-run rather than a fake one. */
async function askAgain(m) {
  if (!state.session) return;
  if (state.busy) {
    toast("Wait for this turn to finish");
    return;
  }
  const idx = state.messages.findIndex((x) => x.id === m.id);
  const user = [...state.messages.slice(0, idx === -1 ? state.messages.length : idx)].reverse().find((x) => x.type === "user");
  if (!user?.text) {
    toast("No prompt to repeat");
    return;
  }
  try {
    await state.api.prompt(state.session.id, { text: user.text, delivery: "steer" });
    haptic(8);
    toast("Asked again");
    setBusy(true);
    setTimeout(() => loadMessages().catch(() => {}), 900);
  } catch (err) {
    handleError(err, "Could not repeat that prompt");
  }
}

function openMessageSheet(m) {
  const isAssistant = m.type === "assistant";
  openSheet({
    title: isAssistant ? "Answer" : "Prompt",
    body: (root) => {
      root.innerHTML = `<div class="sheet-list">
        ${sheetRow({ iconName: "copy", title: "Copy text", attrs: "data-mact=copy" })}
        ${isAssistant ? sheetRow({ iconName: "code", title: "Copy as Markdown", attrs: "data-mact=copy-md" }) : ""}
        ${isAssistant ? sheetRow({ iconName: "save", title: "Save as .md", attrs: "data-mact=save" }) : ""}
        ${isAssistant ? sheetRow({ iconName: "share", title: "Share", attrs: "data-mact=share" }) : ""}
        ${isAssistant ? sheetRow({ iconName: "rotate", title: "Ask again", sub: "Re-runs the same prompt", attrs: "data-mact=regen" }) : ""}
        ${sheetRow({ iconName: "edit", title: isAssistant ? "Copy into composer" : "Edit and resend", attrs: "data-mact=edit" })}
      </div>`;
      root.addEventListener("click", async (e) => {
        const row = e.target.closest("[data-mact]");
        if (!row) return;
        const act = row.dataset.mact;
        const text = messageText(m);
        closeSheet();
        if (act === "copy") return copyText(text);
        if (act === "copy-md" && isAssistant) await copyText(markdownOf(m), "Markdown copied");
        if (act === "save" && isAssistant) {
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
          downloadText(`opencode-answer-${stamp}.md`, markdownOf(m));
        }
        if (act === "share") return shareText(text);
        if (act === "regen") return askAgain(m);
        if (act === "edit") {
          el.input.value = text;
          autoGrow();
          updateSendButton();
          el.input.focus();
          toast("In the composer");
        }
      });
    },
  });
}

function handleMessageAction(action, msgID) {
  const m = state.messages.find((x) => x.id === msgID);
  if (!m) return;
  if (action === "copy-msg") return copyText(messageText(m), "Copied");
  if (action === "edit-msg") {
    el.input.value = m.text ?? "";
    autoGrow();
    updateSendButton();
    el.input.focus();
    toast("Edit and send");
    return;
  }
  if (action === "regen") return askAgain(m);
  if (action === "more-msg") return openMessageSheet(m);
}

function setChatHeader() {
  const s = state.session;
  if (!s) return;
  const title = s.title?.trim() || "New session";
  $(".chat-title-text", el.chatTitle).textContent = title;
  el.chatSub.textContent = `${basename(s.location?.directory) || "workspace"} · ${s.agent ?? "build"}`;
}

function setBusy(busy) {
  state.busy = busy;
  if (el.deliveryToggle) {
    el.deliveryToggle.hidden = !busy;
    el.deliveryToggle.querySelector("span").textContent = state.delivery === "queue" ? "Queue" : "Steer";
    el.deliveryToggle.classList.toggle("queue", state.delivery === "queue");
  }
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

  state.revert = session.revert ?? null;
  state.diff = [];
  resetMessageRender();
  updateRevertBanner();
  updateDiffChip();

  try {
    await loadMessages();
    await loadPermissions();
  } catch (err) {
    handleError(err, "Could not load messages");
  }
  // Fire and forget: the watermark and the change list are decorations.
  if (session.time?.idle) state.api.viewSession(session.id, session.time.idle).catch(() => {});
  refreshDiff();
  refreshVcs();
}

function closeChat(fromPop = false) {
  if (!state.chatOpen) return;
  if (!fromPop) {
    history.back();
    return;
  }
  state.chatOpen = false;
  state.session = null;
  resetMessageRender();
  showScreen("sessions");
  refreshSessions(true).catch(() => {});
}

async function loadMessages() {
  if (!state.api || !state.session) return;
  // Only the first load of a session jumps to the newest message. A refresh that
  // arrives mid-scroll must leave the reader where they are.
  const firstLoad = state.messages.length === 0;
  state.messagesLoading = true;
  try {
    const res = await state.api.messages(state.session.id, { limit: 80, order: "desc" });
    state.messages = (res?.data ?? []).slice().reverse();
    state.messagesCursor = res?.cursor?.previous ?? null;
    renderMessages(firstLoad);
    // Both are cheap and both block work if ignored: a waiting question, or a
    // prompt still sitting in the queue.
    loadForms();
    loadInbox();
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


// Tool state is a tagged union on `status`: streaming | running | completed | error
// (SessionMessage.ToolState). Streaming carries the raw, partial input as a string.
function toolStatus(part) {
  const status = part.state?.status;
  if (status === "streaming") return "running";
  return status ?? "running";
}

function toolInput(part) {
  const input = part.state?.input;
  if (input == null) return null;
  if (typeof input === "string") return input; // streaming: raw partial JSON
  return JSON.stringify(input, null, 2);
}

function contentToText(content) {
  // The schema says array; a defensive string branch keeps one odd tool result
  // from blanking the whole transcript.
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .map((c) => {
      if (c.type === "text") return c.text;
      if (c.type === "file") return `[file] ${c.name || c.uri}${c.mime ? ` · ${c.mime}` : ""}`;
      return "";
    })
    .join("\n")
    .trim();
}

function toolSummary(part) {
  const raw = part.state?.input;
  if (typeof raw === "string") return raw.replace(/\s+/g, " ").trim().slice(0, 90);
  const input = raw || {};
  const rawValue =
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
  const oneLine = String(rawValue).replace(/\s+/g, " ").trim();
  return oneLine.length > 90 ? oneLine.slice(0, 89) + "…" : oneLine;
}

function renderTool(part) {
  const status = toolStatus(part);
  const failed = part.state?.status === "error";
  const key = escapeHtml(part.id ?? Math.random().toString(36));
  const summary = toolSummary(part);
  // An errored tool keeps its partial output in `content` and its reason in `error`.
  const content = [contentToText(part.state?.content), failed ? part.state?.error?.message : ""]
    .filter(Boolean)
    .join("\n\n");
  const inputText = toolInput(part);
  const exit = part.state?.metadata?.exit;
  const iconName = /shell|bash|command/i.test(part.name || "")
    ? "terminal"
    : /grep|glob|search|find/i.test(part.name || "")
      ? "search"
      : /read|write|edit|file/i.test(part.name || "")
        ? "file"
        : "wrench";
  const verb = status === "running" ? "Running" : failed ? "Failed" : "Ran";

  return `
    <div class="tool-card" data-tool="${key}">
      <button class="tool-head" data-toggle-tool="${key}">
        <span class="tool-icon">${icon(iconName)}</span>
        <span class="tool-name">${verb} ${escapeHtml(part.name || "tool")}</span>
        <span class="tool-summary">${escapeHtml(summary)}</span>
        <span class="tool-state" data-status="${failed ? "error" : status === "completed" ? "completed" : "running"}">
          ${status === "completed" ? icon("check") : failed ? icon("x") : `<span class="spinner"></span>`}
        </span>
      </button>
      <div class="tool-body">
        ${inputText ? `<div class="tool-label">Input</div><pre class="tool-pre">${escapeHtml(inputText)}</pre>` : ""}
        ${
          content
            ? `<div class="tool-label">Output${exit != null ? ` · exit ${escapeHtml(String(exit))}` : ""}</div><pre class="tool-pre${failed ? " err" : ""}">${escapeHtml(content)}</pre>`
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

/* ------------------------------------------------------- activity rows
 * A coding turn is mostly tool calls. Showing every one as its own card turned
 * the transcript into a log; grouping a run of them behind one line ("Worked ·
 * 4 steps") is what the desktop and TUI do, and what makes the answer readable.
 * Verbosity is a local preference: low = one row, medium = grouped with results
 * folded, high = the old, fully inline log.
 */

function toolVerb(part) {
  const name = String(part.name || "").toLowerCase();
  if (/shell|bash|command/.test(name)) return "ran";
  if (/^read|cat/.test(name)) return "read";
  if (/edit|write|patch|apply/.test(name)) return "edited";
  if (/grep|glob|search|find|list/.test(name)) return "searched";
  if (/webfetch|fetch|web/.test(name)) return "fetched";
  if (/question|ask/.test(name)) return "asked";
  return "used";
}

function activitySummary(items) {
  const counts = new Map();
  let failed = 0;
  for (const { part } of items) {
    if (part.type !== "tool") continue;
    counts.set(toolVerb(part), (counts.get(toolVerb(part)) ?? 0) + 1);
    if (part.state?.status === "error") failed += 1;
  }
  const bits = [...counts.entries()].map(([verb, n]) => `${verb} ${n}`);
  if (failed) bits.push(`${failed} failed`);
  return bits.join(" · ");
}

function renderActivity(items, m, streaming) {
  const verbosity = state.prefs.verbosity;
  const key = `${m.id}:a:${items[0].idx}`;
  const tools = items.filter((i) => i.part.type === "tool");
  const reasoning = items.filter((i) => i.part.type === "reasoning");

  // high: no grouping at all, exactly as the server described it
  if (verbosity === "high") {
    return items
      .map((i) =>
        i.part.type === "tool" ? renderTool(i.part) : renderReasoning(i.part, `${m.id}:r:${i.part.ordinal ?? i.idx}`)
      )
      .join("");
  }

  const live = streaming && items.some((i) => i.part.type === "tool" && toolStatus(i.part) === "running");
  const steps = tools.length + (reasoning.length ? 1 : 0);
  const title = live ? "Working" : steps === 1 ? "1 step" : `${steps} steps`;
  const sub = activitySummary(items);
  const body =
    verbosity === "low"
      ? tools.map(renderTool).join("")
      : items
          .map((i) =>
            i.part.type === "tool" ? renderTool(i.part) : renderReasoning(i.part, `${m.id}:r:${i.part.ordinal ?? i.idx}`)
          )
          .join("");

  return `<div class="activity${live ? " live" : ""}" data-activity="${escapeHtml(key)}">
    <button class="activity-head" data-toggle-activity="${escapeHtml(key)}" aria-expanded="false">
      <span class="act-dot${live ? " live" : ""}"></span>
      <span class="act-title">${escapeHtml(title)}</span>
      ${sub ? `<span class="act-sub">${escapeHtml(sub)}</span>` : ""}
      ${icon("chevron", "caret")}
    </button>
    <div class="activity-body">${body}</div>
  </div>`;
}

/* ------------------------------------------------------- message actions */

function messageText(m) {
  if (m.type === "user") return m.text ?? "";
  return (m.content ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trim();
}

function assistantActions(m) {
  const id = escapeHtml(m.id);
  return `<div class="msg-actions" data-for="${id}">
    <button data-act="copy-msg" data-msg-id="${id}" aria-label="Copy answer">${icon("copy")}</button>
    <button data-act="regen" data-msg-id="${id}" aria-label="Regenerate">${icon("rotate")}</button>
    <button data-act="more-msg" data-msg-id="${id}" aria-label="More actions">${icon("more")}</button>
  </div>`;
}

function userActions(m) {
  const id = escapeHtml(m.id);
  return `<div class="msg-actions user-actions" data-for="${id}">
    <button data-act="copy-msg" data-msg-id="${id}" aria-label="Copy prompt">${icon("copy")}</button>
    <button data-act="edit-msg" data-msg-id="${id}" aria-label="Edit and resend">${icon("edit")}</button>
  </div>`;
}

function stamp(m) {
  const t = m.time?.created;
  if (!t) return "";
  const d = new Date(t);
  return `<span class="msg-time">${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}</span>`;
}

/* --------------------------------------------------------- follow-up chips
 * Only offered when the answer gives a reason to: code, a failure, or a tool
 * that changed files. Generic "tell me more" chips are noise.
 */

function followUpsFor(m) {
  if (!state.prefs.showFollowUps) return "";
  if (m.type !== "assistant" || m.id !== state.lastAssistantId || state.busy) return "";
  const text = messageText(m);
  if (!text) return "";

  const hasCode = (m.content ?? []).some((p) => p.type === "text" && /```/.test(p.text ?? ""));
  const hasError = /error|failed|exception|traceback|429|timed out/i.test(text);
  const editedFiles = (m.content ?? []).some(
    (p) => p.type === "tool" && /edit|write|patch/i.test(p.name ?? "") && p.state?.status === "completed"
  );
  const ranShell = (m.content ?? []).some((p) => p.type === "tool" && /shell|bash/i.test(p.name ?? ""));

  const chips = [];
  if (hasCode) chips.push(["Explain this code", "Explain the code above, step by step, in two short paragraphs."]);
  if (hasCode) chips.push(["Add tests", "Write tests for the code above. Use the project's existing test framework."]);
  if (editedFiles) chips.push(["Review the diff", "Review the changes you just made and call out anything risky."]);
  if (hasError) chips.push(["Debug this", "Find the root cause of that failure and propose the smallest safe fix."]);
  if (ranShell) chips.push(["Run it again", "Run that command again and show me the output."]);
  if (!chips.length) chips.push(["Go deeper", "Go one level deeper on the most important part of that answer."]);
  chips.push(["Continue", "Continue from where you left off."]);

  return `<div class="follow-ups">${chips
    .slice(0, 3)
    .map(
      ([label, prompt]) =>
        `<button class="follow-chip" data-follow="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`
    )
    .join("")}</div>`;
}

function renderAssistant(m) {
  const parts = messageParts(m);
  const streaming = state.busy && m.id === state.lastAssistantId;

  // Group a run of tool/reasoning parts so the prose stays the spine of the
  // transcript; a text part always breaks the run.
  const blocks = [];
  let run = [];
  const flushRun = () => {
    if (run.length) {
      blocks.push({ kind: "activity", items: run });
      run = [];
    }
  };
  parts.forEach((part, idx) => {
    if (part.type === "tool" || part.type === "reasoning") run.push({ part, idx });
    else {
      flushRun();
      blocks.push({ kind: "part", part, idx });
    }
  });
  flushRun();

  const html = blocks
    .map((b) => {
      if (b.kind === "activity") return renderActivity(b.items, m, streaming);
      const { part, idx } = b;
      if (part.type === "text") {
        const key = `${m.id}:t:${part.ordinal ?? idx}`;
        const caret = streaming && idx === parts.length - 1 ? `<span class="stream-caret"></span>` : "";
        return `<div class="md" data-part="${escapeHtml(key)}">${renderMarkdown(part.text)}${caret}</div>`;
      }
      return "";
    })
    .join("");

  // A failed step keeps its reason on the message (`Assistant.error`), and a provider
  // hiccup shows up as `Assistant.retry` before any content has been written.
  const retry = m.retry
    ? `<div class="assistant-note">${icon("refresh")}Retrying, attempt ${escapeHtml(String(m.retry.attempt))}${
        m.retry.error?.message ? ` · ${escapeHtml(m.retry.error.message)}` : ""
      }</div>`
    : "";
  const failure = m.error ? renderFailure(m.error) : "";
  const empty =
    !html && !failure && streaming ? `<div class="typing-row"><span class="typing"><i></i><i></i><i></i></span></div>` : "";

  const footer = streaming ? "" : `${usageLine(m)}${followUpsFor(m)}`;

  return `
    <div class="msg msg-assistant" data-msg="${escapeHtml(m.id)}">
      <div class="assistant-body">${html}${retry}${failure}${empty}</div>
      ${artifactCards(m)}
      ${stamp(m)}
      ${streaming ? "" : assistantActions(m)}
      ${footer}
    </div>`;
}

// Attachments come back from the API as raw base64 (`data` + `mime`), and go out
// from the composer as a data URI (`uri`). Accept both, and build the data URI once.
function fileSrc(f) {
  if (f.uri) return f.uri;
  if (!f.data) return "";
  if (!f._src) f._src = `data:${f.mime || "image/jpeg"};base64,${f.data}`;
  return f._src;
}

function renderUser(m) {
  const files = (m.files ?? [])
    .filter((f) => (f.mime ?? "image/jpeg").startsWith("image/"))
    .map((f) => ({ ...f, src: fileSrc(f) }))
    .filter((f) => f.src);
  return `
    <div class="msg msg-user" data-msg="${escapeHtml(m.id)}">
      <div class="bubble">${escapeHtml(m.text ?? "")}
        ${
          files.length
            ? `<div class="files">${files.map((f) => `<img src="${escapeHtml(f.src)}" alt="${escapeHtml(f.name ?? "attachment")}">`).join("")}</div>`
            : ""
        }
      </div>
      ${stamp(m)}
      ${userActions(m)}
    </div>`;
}

function renderSystem(text, iconName = "check") {
  return `<div class="msg msg-system"><span class="sys">${icon(iconName)}${escapeHtml(text)}</span></div>`;
}

const fmtWait = (ms) => {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `~${Math.max(mins, 1)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `~${hours} h`;
  return `~${Math.round(hours / 24)} days`;
};

// `Shell` messages carry the command, its status, exit code and combined output.
function renderShell(m) {
  const cmd = (m.command ?? "").replace(/\s+/g, " ").trim();
  const head = cmd.length > 80 ? cmd.slice(0, 79) + "..." : cmd;
  const exit = m.exit ?? m.output?.exit;
  const tail = exit != null ? ` · exit ${exit}` : m.status ? ` · ${m.status}` : "";
  return renderSystem(`$ ${head}${tail}`, "terminal");
}

// `Compaction` is a tagged union on `status`: running | completed | failed.
function renderCompaction(m) {
  if (m.status === "failed") return renderFailure(m.error);
  const label = m.status === "running" ? "Compacting context..." : "Context compacted";
  return renderSystem(m.reason ? `${label} · ${m.reason}` : label, "refresh");
}

function failureHint(err) {
  const status = err?.status;
  const type = err?.type ?? "";
  if (type.includes("free-limit") || status === 429) {
    const wait = err?.retryAfterMs ? ` Try again in ${fmtWait(err.retryAfterMs)}.` : "";
    return type.includes("free-limit")
      ? `Tip: switch to another model from the chip above the composer.${wait}`
      : `Tip: wait a moment, or switch models from the chip above the composer.${wait}`;
  }
  if (status === 401 || status === 403) return "Your password may have changed. Reconnect from Settings.";
  if (status === 404) return "The model or provider is no longer available. Pick another one.";
  if (!status) return "The server didn't respond. Check that Termux is still running, then send again.";
  return "";
}

function renderFailure(err) {
  const msg = err?.message || "The request failed before the model replied.";
  const hint = failureHint(err);
  return `<div class="msg msg-system">
    <div class="failure">
      <div class="failure-head">${icon("x")}Failed</div>
      <div class="failure-text">${escapeHtml(msg)}</div>
      ${hint ? `<div class="failure-hint">${escapeHtml(hint)}</div>` : ""}
    </div>
  </div>`;
}

// Cheap projection of everything the markup depends on. Rebuilding identical
// markup costs a repaint and replays the entry animation, so it is skipped.
function transcriptSignature() {
  const bits = [
    state.busy ? "1" : "0",
    state.lastAssistantId ?? "-",
    state.prefs.verbosity,
    state.prefs.timestamps ? "ts" : "",
    state.prefs.showFollowUps ? "fu" : "",
  ];
  for (const f of state.forms) bits.push(f.form?.id ?? "", f.status);
  for (const m of state.messages) {
    bits.push(m.id, m.type);
    if (m.type === "assistant") {
      for (const p of m.content ?? []) {
        bits.push(
          p.type,
          String(p.text?.length ?? 0),
          p.state?.status ?? "",
          String(p.state?.content?.length ?? 0),
          p.time?.completed ? "c" : ""
        );
      }
      if (m.error) bits.push("err" + (m.error.message ?? "").length);
      if (m.retry) bits.push("retry" + (m.retry.attempt ?? "") + (m.retry.error?.message ?? "").length);
      bits.push(String(m.tokens?.input ?? ""), String(m.cost ?? ""));
    } else if (m.type === "idle") {
      bits.push(m.outcome ?? "");
    } else {
      bits.push(String(m.text?.length ?? 0), m.command ?? "", m.outcome ?? "", m.status ?? "");
    }
  }
  return bits.join("|");
}

function resetMessageRender() {
  state.renderSignature = "";
  state.renderedIds = new Set();
  state.skipEntrance = true;
}

function renderMessages(force = false) {
  if (state.screen !== "chat") return;

  const signature = transcriptSignature();
  const wasAtBottom = isNearBottom();
  const pinned = force || wasAtBottom;

  if (signature === state.renderSignature) {
    // Nothing visible changed: leave the DOM (and the scroll position) alone.
    if (pinned) scrollToBottom(false);
    updateJumpLatest();
    return;
  }
  state.renderSignature = signature;
  // Artifact detection is memoised per message, so this stays cheap even while
  // a long answer streams in.
  state.artifacts = detectArtifacts(state.messages);
  const prevScroll = el.messages.scrollTop;
  const openTools = new Set($$(".tool-card.open", el.messages).map((n) => n.dataset.tool));
  const openReasoning = new Set($$(".reasoning.open", el.messages).map((n) => n.dataset.reasoning));
  const openActivity = new Set($$(".activity.open", el.messages).map((n) => n.dataset.activity));

  const chunks = [];

  // Mirrors the SessionMessage.Info union: every variant gets a row, and anything
  // unknown still renders (nothing in a transcript should silently disappear).
  // A failed turn records the same error twice — on the assistant step and on the
  // closing idle marker — so remember what has already been shown and skip the repeat.
  let shownFailure = null;
  for (const m of state.messages) {
    if (m.type === "user") {
      shownFailure = null;
      chunks.push(renderUser(m));
    } else if (m.type === "assistant") {
      if (m.error) shownFailure = m.error.message ?? "";
      chunks.push(renderAssistant(m));
    } else if (m.type === "idle" && m.outcome && m.outcome !== "succeeded") {
      if (m.outcome === "failed") {
        const msg = m.error?.message ?? "";
        if (!msg || msg !== shownFailure) chunks.push(renderFailure(m.error));
      } else {
        chunks.push(renderSystem(m.outcome === "interrupted" ? "Interrupted" : "Stopped", "stop"));
      }
    } else if (m.type === "shell") chunks.push(renderShell(m));
    else if (m.type === "compaction") chunks.push(renderCompaction(m));
    else if (m.type === "skill") chunks.push(renderSystem(`Skill · ${m.name ?? m.skill ?? ""}`, "spark"));
    else if (m.type === "synthetic" && m.text) chunks.push(renderSystem(m.description || m.text, "spark"));
    else if (m.type === "system" && m.text) chunks.push(renderSystem(m.description || m.text, "spark"));
    else if (m.type === "agent-switched") chunks.push(renderSystem(`Agent · ${m.agent ?? ""}`, "spark"));
    else if (m.type === "model-switched") chunks.push(renderSystem(`Model · ${m.model?.id ?? ""}`, "spark"));
    else if (m.type === "location-switched") chunks.push(renderSystem("Workspace changed", "folder"));
  }
  // Forms sit at the end of the transcript: they block the turn that produced
  // them, so they have to be impossible to miss.
  for (const entry of state.forms) {
    if (!entry?.form) continue;
    chunks.push(formCardHtml(entry.form, { status: entry.status, answer: entry.answer }));
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
  for (const n of $$(".activity", el.messages)) if (openActivity.has(n.dataset.activity)) n.classList.add("open");

  // Only messages that arrive while the conversation is open play the entry
  // animation. A freshly opened session renders at once, with no fade.
  const animate = !state.skipEntrance;
  state.skipEntrance = false;
  const idsNow = new Set();
  for (const n of $$("[data-msg]", el.messages)) {
    const id = n.dataset.msg;
    if (!id || idsNow.has(id)) continue;
    idsNow.add(id);
    if (animate && !state.renderedIds.has(id)) n.classList.add("enter");
  }
  state.renderedIds = idsNow;

  if (pinned) scrollToBottom(false);
  else el.messages.scrollTop = prevScroll;
  updateJumpLatest();
}

/* -------------------------------------------------------------- forms
 * The server can stop mid-turn and ask (Form.Info). Rendering the request as a
 * card in the transcript is what keeps the turn alive; ignoring the
 * form.created event is exactly how a conversation appears to hang.
 */

function upsertForm(form) {
  const i = state.forms.findIndex((f) => f.form?.id === form.id);
  if (i >= 0) state.forms[i] = { form, status: "pending", answer: null };
  else state.forms.push({ form, status: "pending", answer: null });
}

function settleForm(id, status, answer) {
  const entry = state.forms.find((f) => f.form?.id === id);
  if (entry) {
    entry.status = status;
    entry.answer = answer;
  }
}

async function loadForms() {
  if (!state.api || !state.session) return;
  try {
    const list = await state.api.forms(state.session.id);
    const settled = state.forms.filter((f) => f.status !== "pending");
    state.forms = list.map((form) => settled.find((s) => s.form.id === form.id) ?? { form, status: "pending", answer: null });
    renderMessages();
  } catch {
    // Forms are optional in older servers; never block the transcript on them.
  }
}

async function submitForm(formID) {
  if (!state.session) return;
  const card = el.messages.querySelector(`.form-card[data-form="${CSS.escape(formID)}"]`);
  const entry = state.forms.find((f) => f.form?.id === formID);
  if (!card || !entry) return;

  const missing = missingRequired(card, entry.form);
  if (missing) {
    toast(`Answer "${missing.title || missing.key}" first`);
    return;
  }
  const answer = buildAnswer(card, entry.form);
  try {
    await state.api.replyForm(state.session.id, formID, answer);
    settleForm(formID, "answered", answer);
    haptic(10);
    renderMessages(true);
    scrollToBottom(true);
  } catch (err) {
    handleError(err, "Could not send the answer");
  }
}

async function dismissForm(formID) {
  if (!state.session) return;
  try {
    await state.api.cancelForm(state.session.id, formID);
    settleForm(formID, "cancelled", null);
    renderMessages(true);
  } catch (err) {
    handleError(err, "Could not dismiss");
  }
}

/* --------------------------------------------------------------- inbox
 * A prompt sent while the agent is working is either a steer (joins the run) or
 * a queue entry (waits). The server keeps both in the session inbox, and this is
 * the only place they can be seen, re-aimed or cancelled.
 */

const inboxItem = (raw) => raw?.item ?? raw ?? {};
const inboxTitle = (raw) => {
  const item = inboxItem(raw);
  if (item.type === "user") return item.payload?.text ?? "Prompt";
  if (item.type === "compaction") return "Compact context";
  if (item.type === "move") return "Move session";
  if (item.type === "synthetic") return item.payload?.description || item.payload?.text || "Note";
  return item.type ?? "Queued";
};

async function loadInbox() {
  if (!state.api || !state.session) return;
  try {
    state.inbox = await state.api.inbox(state.session.id);
  } catch {
    state.inbox = [];
  }
  renderInbox();
}

function renderInbox() {
  if (!el.inboxBar) return;
  const items = (state.inbox ?? []).filter((x) => x && x.id);
  el.inboxBar.hidden = items.length === 0;
  if (!items.length) {
    el.inboxBar.innerHTML = "";
    return;
  }
  el.inboxBar.innerHTML = items
    .map((raw) => {
      const delivery = raw.delivery ?? "queue";
      const text = inboxTitle(raw);
      const short = text.length > 46 ? text.slice(0, 45) + "..." : text;
      return `<span class="inbox-chip" data-inbox="${escapeHtml(raw.id)}">
        <button class="ib-main" data-inbox-toggle="${escapeHtml(raw.id)}" data-delivery="${escapeHtml(delivery)}" title="Switch between queue and steer">
          <span class="ib-mode">${delivery === "queue" ? "Queued" : "Steer"}</span>
          <span class="ib-text">${escapeHtml(short)}</span>
        </button>
        <button class="ib-x" data-inbox-cancel="${escapeHtml(raw.id)}" aria-label="Cancel">${icon("x")}</button>
      </span>`;
    })
    .join("");
}

async function toggleInboxDelivery(inboxID) {
  if (!state.session) return;
  const raw = state.inbox.find((x) => x.id === inboxID);
  if (!raw) return;
  const next = (raw.delivery ?? "queue") === "queue" ? "steer" : "queue";
  try {
    await state.api.setInboxDelivery(state.session.id, inboxID, next);
    raw.delivery = next;
    renderInbox();
    haptic(6);
  } catch (err) {
    handleError(err, "Could not change delivery");
  }
}

async function cancelInboxItem(inboxID) {
  if (!state.session) return;
  try {
    await state.api.cancelInbox(state.session.id, inboxID);
    state.inbox = state.inbox.filter((x) => x.id !== inboxID);
    renderInbox();
    haptic(10);
  } catch (err) {
    handleError(err, "Could not cancel");
  }
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

// Live-only fragments: applied in place, never worth a refetch.
const STREAM_FRAGMENTS = new Set([
  "session.text.delta",
  "session.reasoning.delta",
  "session.tool.input.delta",
]);

function handleEvent(event) {
  const type = event.type;
  const data = event.data ?? {};

  // Forms and the inbox come before the open-session filter: a question can
  // arrive for a session that is not on screen and still must be remembered.
  if (type === "form.created" && data.form) {
    upsertForm(data.form);
    if (state.session?.id === data.form.sessionID && state.screen === "chat") {
      renderMessages(true);
      scrollToBottom(true);
      haptic(10);
      toast("The agent asked a question");
    }
    return;
  }
  if (type === "form.replied" || type === "form.cancelled") {
    settleForm(data.id, type === "form.replied" ? "answered" : "cancelled", data.answer ?? null);
    if (state.session?.id === data.sessionID) renderMessages();
    return;
  }
  if (type.startsWith("session.inbox.")) {
    if (eventBelongsToOpenSession(data)) loadInbox().catch(() => {});
    return;
  }

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
    case "session.retry.scheduled": {
      // The provider hiccuped and the server is waiting to try again. Showing it
      // prevents a silent pause that looks like a hang.
      const m = ensureAssistant(data.assistantMessageID, data);
      m.retry = { attempt: data.attempt ?? 1, error: data.error };
      setBusy(true);
      renderMessages();
      break;
    }
    case "session.step.failed": {
      const m = ensureAssistant(data.assistantMessageID, data);
      m.retry = undefined;
      m.error = data.error ?? m.error ?? { message: "The step failed" };
      setBusy(false);
      renderMessages();
      break;
    }
    case "session.step.ended": {
      const m = state.messages.find((x) => x.id === data.assistantMessageID);
      if (m) m.finish = data.finish;
      break;
    }
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
      if (part) {
        part.text = data.text ?? part.text;
        part.time = { completed: Date.now() };
      } else {
        m.content.push({ type: "text", text: data.text ?? "", ordinal: data.ordinal });
      }
      $(".stream-caret", el.messages)?.remove();
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
      refreshDiff();
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
      refreshDiff();
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
    case "session.usage.updated":
      scheduleMessageRefresh(400);
      break;
    case "session.revert.staged":
      state.revert = data.revert ?? state.revert;
      updateRevertBanner();
      break;
    case "session.revert.cleared":
    case "session.revert.committed":
      state.revert = null;
      updateRevertBanner();
      break;
    case "session.shell.ended":
      refreshDiff();
      break;
    case "session.compaction.started":
      setBusy(true);
      scheduleMessageRefresh(300);
      break;
    default:
      // Any other event about this session (step, tool input, shell, skill, synthetic…)
      // changes the transcript projection, so re-read it rather than guessing at it.
      // Stream fragments are the exception: they are already applied above.
      if (type.startsWith("session.") && !STREAM_FRAGMENTS.has(type)) scheduleMessageRefresh(300);
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

/**
 * Typing `@` opens the file picker, the way the TUI does it. Only fires on the
 * char that starts a mention, and never while a sheet is already up.
 */
let mentionOpenedFor = null;
function maybeOfferMentions() {
  const value = el.input.value;
  const caret = el.input.selectionStart ?? value.length;
  const before = value.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (!match) {
    mentionOpenedFor = null;
    return;
  }
  if (state.sheetOpen) return;
  if (mentionOpenedFor === match[1]) return;
  mentionOpenedFor = match[1];
  openMentionSheet(match[1]);
}

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
  // While a turn is running the server accepts two meanings for a prompt: join
  // the run (steer) or wait for it (queue). The composer exposes the choice.
  const delivery = state.busy ? state.delivery : "steer";
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
      await state.api.prompt(state.session.id, { text, files, delivery });
    }
    haptic(6);
    if (delivery === "queue") {
      toast("Queued — runs after this turn");
      loadInbox().catch(() => {});
    }
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

/* ------------------------------------------------------------------------ *
 * OpenCode feature surface.
 *
 * Every call here maps to a route in the server's OpenAPI document, and the
 * shapes match the schema package (SessionMessage.Info, FileDiff.Info, ...).
 * Mobile rules applied throughout: nothing nested more than one sheet deep,
 * every destructive action confirmed, no hover-only affordances.
 * ------------------------------------------------------------------------ */

const workspaceDir = () => state.session?.location?.directory ?? state.sessions?.[0]?.location?.directory;
const toPosix = (p) => String(p ?? "").replace(/\\/g, "/");
const baseName = (p) => toPosix(p).replace(/\/+$/, "").split("/").pop() || p;
const parentDir = (p) => toPosix(p).replace(/\/+$/, "").split("/").slice(0, -1).join("/");

const fmtCount = (n) => {
  if (n == null) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "") + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
};

const fmtCost = (usd) => {
  const n = Number(usd ?? 0);
  if (!n) return "";
  return n < 0.01 ? "<$0.01" : "$" + n.toFixed(2);
};

/* ------------------------------------------------------------------ diff */

async function refreshDiff() {
  if (!state.api || !state.session) {
    state.diff = [];
    updateDiffChip();
    return;
  }
  try {
    state.diff = await state.api.sessionDiff(state.session.id);
  } catch {
    state.diff = [];
  }
  updateDiffChip();
  if (state.sheetKind === "changes") openChangesSheet();
}

function updateDiffChip() {
  const files = state.diff ?? [];
  el.chatDiff.hidden = files.length === 0;
  if (!files.length) return;
  const adds = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const dels = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  el.chatDiffCount.textContent = files.length + "  +" + adds + " \u2212" + dels;
}

function diffLines(patch) {
  return String(patch ?? "")
    .split("\n")
    .map((line) => {
      const kind = /^(\+\+\+|---)/.test(line)
        ? "meta"
        : line.startsWith("+")
          ? "add"
          : line.startsWith("-")
            ? "del"
            : line.startsWith("@@")
              ? "hunk"
              : "ctx";
      return '<i class="dl ' + kind + '">' + escapeHtml(line || " ") + "</i>";
    })
    .join("");
}

/* ------------------------------------------------------- find and export */

/** Find a prompt or answer in the open conversation and jump to it. */
function openFindSheet() {
  if (!state.session) return;
  const rows = state.messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.type === "user" || m.type === "assistant");

  const textOf = (m) => messageText(m).replace(/\s+/g, " ").trim();

  openSheet({
    kind: "find",
    title: "Find in conversation",
    body: (root) => {
      root.innerHTML = `
        <label class="field"><input class="input" id="find-q" placeholder="Search this conversation" spellcheck="false" autocomplete="off"></label>
        <div class="sheet-list" id="find-results"></div>`;
      const input = root.querySelector("#find-q");
      const results = root.querySelector("#find-results");

      const paint = (q) => {
        const needle = q.trim().toLowerCase();
        const hits = rows.filter(({ m }) => !needle || textOf(m).toLowerCase().includes(needle)).slice(0, 40);
        results.innerHTML = hits.length
          ? hits
              .map(({ m, i }) => {
                const text = textOf(m) || "(empty)";
                const label = m.type === "user" ? "You" : "Agent";
                const short = text.length > 120 ? text.slice(0, 119) + "..." : text;
                return `<button class="sheet-item find-hit" data-jump="${i}">
                  <span class="si-text"><span class="si-title">${escapeHtml(label)}</span><span class="si-sub">${escapeHtml(short)}</span></span>
                  <span class="find-time">${escapeHtml(timeAgo(m.time?.created))}</span>
                </button>`;
              })
              .join("")
          : `<div class="sheet-note">Nothing matches that.</div>`;
      };

      input.addEventListener("input", () => paint(input.value));
      paint("");

      results.addEventListener("click", (e) => {
        const hit = e.target.closest("[data-jump]");
        if (!hit) return;
        const idx = Number(hit.dataset.jump);
        const target = state.messages[idx];
        closeSheet();
        setTimeout(() => jumpToMessage(target?.id), 220);
      });
    },
  });
}

function jumpToMessage(id) {
  if (!id) return;
  const node = el.messages.querySelector(`[data-msg="${CSS.escape(id)}"]`);
  if (!node) {
    toast("That message is not loaded");
    return;
  }
  node.scrollIntoView({ block: "center", behavior: state.prefs.reducedMotion ? "auto" : "smooth" });
  node.classList.add("flash");
  setTimeout(() => node.classList.remove("flash"), 1200);
  updateJumpLatest();
}

/** Session export / import. The payload is exactly what the server returns. */
async function exportSession(session) {
  if (!session) return;
  try {
    const data = await state.api.exportSession(session.id);
    const name = (session.title || "session").replace(/[^\w.-]+/g, "-").slice(0, 60);
    downloadText(name + ".json", JSON.stringify(data, null, 2), "application/json");
  } catch (err) {
    handleError(err, "Could not export this session");
  }
}

function importSession() {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "application/json,.json";
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (!payload?.info || !payload?.messages) {
        toast("That file is not a session export");
        return;
      }
      await state.api.request("POST", "/api/experimental/session/import", payload, { timeout: 120000 });
      toast("Session imported");
      refreshSessions(true).catch(() => {});
    } catch (err) {
      handleError(err, "Could not import that file");
    }
  });
  picker.click();
}

/** Branch and dirty count for the open session's workspace. */
async function refreshVcs() {
  if (!state.api || !state.session) {
    el.chatBranch.hidden = true;
    return;
  }
  try {
    const status = await state.api.vcsStatus({ directory: state.session.location?.directory });
    const files = Array.isArray(status?.data) ? status.data : [];
    const branch = await state.api.vcsBranch({ directory: state.session.location?.directory }).catch(() => null);
    const name = branch?.branch || branch?.name || branch?.data?.branch || "";
    el.chatBranch.hidden = !name && !files.length;
    el.chatBranch.textContent = [name, files.length ? files.length + " changed" : ""].filter(Boolean).join(" · ");
  } catch {
    el.chatBranch.hidden = true;
  }
}

function openChangesSheet() {
  const files = state.diff ?? [];
  openSheet({
    kind: "changes",
    title: files.length ? files.length + " changed files" : "Changes",
    body: (root) => {
      if (!state.session) {
        root.innerHTML = '<p class="sheet-note">Open a session first.</p>';
        return;
      }
      if (!files.length) {
        root.innerHTML = '<p class="sheet-note">No file changes in this session yet.</p>';
        return;
      }
      const adds = files.reduce((n, f) => n + (f.additions ?? 0), 0);
      const dels = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
      root.innerHTML =
        '<p class="sheet-note">' +
        files.length +
        ' files \u00b7 <b class="adds">+' +
        adds +
        '</b> <b class="dels">\u2212' +
        dels +
        "</b></p>" +
        '<div class="diff-list">' +
        files
          .map((f, i) => {
            const status = f.status ?? "modified";
            return (
              '<div class="diff-file" data-file="' + i + '">' +
              '<button class="diff-head" data-toggle-diff="' + i + '">' +
              '<span class="df-status" data-s="' + escapeHtml(status) + '">' + escapeHtml(status.slice(0, 1).toUpperCase()) + "</span>" +
              '<span class="df-text"><span class="df-name">' + escapeHtml(baseName(f.file)) + "</span>" +
              '<span class="df-dir">' + escapeHtml(parentDir(f.file) || ".") + "</span></span>" +
              '<span class="df-counts"><b class="adds">+' + (f.additions ?? 0) + '</b><b class="dels">\u2212' + (f.deletions ?? 0) + "</b></span>" +
              icon("chevron", "caret") +
              "</button>" +
              '<div class="diff-body"><pre class="patch">' + diffLines(f.patch) + "</pre>" +
              (f.more ? '<p class="sheet-note">Patch truncated by the server.</p>' : "") +
              "</div></div>"
            );
          })
          .join("") +
        "</div>";
      root.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-toggle-diff]");
        if (!btn) return;
        btn.closest(".diff-file").classList.toggle("open");
      });
    },
  });
}

/* --------------------------------------------------------------- mentions */

/* ------------------------------------------------------------- artifacts
 * Detected from what the model actually produced: a real file, a page, a
 * document, a diff, a diagram. The card lives in the transcript; opening it
 * takes over the screen and leaves the conversation exactly where it was.
 */

const artifactExt = (a) =>
  a.language === "ts" || a.language === "tsx"
    ? "ts"
    : a.language === "py"
      ? "py"
      : a.language === "html"
        ? "html"
        : a.language === "css"
          ? "css"
          : a.language === "json"
            ? "json"
            : a.language === "diff" || a.language === "patch"
              ? "diff"
              : "txt";

function artifactCards(m) {
  const list = (state.artifacts ?? []).filter((a) => a.messageID === m.id);
  if (!list.length) return "";
  return `<div class="artifact-cards">${list.map(artifactCardHtml).join("")}</div>`;
}

function artifactSubtitle(a) {
  const kind =
    a.kind === "doc"
      ? "Document"
      : a.kind === "html"
        ? "Live preview"
        : a.kind === "diagram"
          ? "Diagram"
          : a.kind === "diff"
            ? "Diff"
            : a.language || "Code";
  return [kind, a.lines ? a.lines + " lines" : "", a.version > 1 ? "v" + a.version : ""].filter(Boolean).join(" · ");
}

function renderArtifact() {
  const a = state.artifact;
  if (!a || !el.artifactBody) return;
  const tab = state.artifactTab;
  el.artifactBody.innerHTML = artifactBodyHtml(a, {
    tab,
    wrap: state.prefs.codeWrap,
    numbers: state.prefs.codeLineNumbers,
  });
  el.artifactBody.classList.toggle("wrap", !!state.prefs.codeWrap);
  for (const b of $$("#artifact-tabs button", el.artifact)) {
    b.classList.toggle("on", b.dataset.atab === tab);
  }
  el.artifactTitle.textContent = a.title;
  el.artifactSub.textContent = artifactSubtitle(a);
}

function openArtifact(a) {
  if (!a || !el.artifact) return;
  state.artifact = a;
  state.artifactTab = a.kind === "diff" ? "code" : "preview";
  el.artifact.hidden = false;
  renderArtifact();
  haptic(8);
  history.pushState({ artifact: true }, "");
}

function closeArtifact(fromPop = false) {
  if (!state.artifact) return;
  // Hand the pop back to the browser and let popstate do the closing, exactly
  // like the sheet. Clearing state here would make popstate think it should
  // close the whole conversation instead.
  if (!fromPop) {
    history.back();
    return;
  }
  state.artifact = null;
  el.artifact.hidden = true;
}

function artifactActions() {
  const a = state.artifact;
  if (!a) return;
  openSheet({
    title: a.title,
    body: (root) => {
      root.innerHTML = `<div class="sheet-list">
        ${sheetRow({ iconName: "copy", title: "Copy source", attrs: "data-aact=copy" })}
        ${sheetRow({ iconName: "download", title: "Save file", attrs: "data-aact=save" })}
        ${sheetRow({
          iconName: "wrap",
          title: "Line wrap",
          sub: state.prefs.codeWrap ? "On" : "Off",
          attrs: "data-aact=wrap",
        })}
        ${sheetRow({
          iconName: "queue",
          title: "Line numbers",
          sub: state.prefs.codeLineNumbers ? "On" : "Off",
          attrs: "data-aact=numbers",
        })}
        ${a.kind === "html" ? sheetRow({ iconName: "refresh", title: "Reload preview", attrs: "data-aact=reload" }) : ""}
        ${a.kind === "code" || a.kind === "diff" ? sheetRow({ iconName: "code", title: "Show code", attrs: "data-aact=tab-code" }) : ""}
        ${sheetRow({ iconName: "x", title: "Close", attrs: "data-aact=close" })}
      </div>`;
      root.addEventListener("click", (e) => {
        const row = e.target.closest("[data-aact]");
        if (!row) return;
        const act = row.dataset.aact;
        closeSheet();
        if (act === "copy") copyText(a.code ?? a.doc ?? "", "Source copied");
        if (act === "save") {
          const name = (a.title || "artifact").replace(/[^\w.-]+/g, "-");
          downloadText(name + "." + artifactExt(a), a.code ?? a.doc ?? "", "text/plain");
        }
        if (act === "wrap") {
          setPref("codeWrap", !state.prefs.codeWrap);
          renderArtifact();
        }
        if (act === "numbers") {
          setPref("codeLineNumbers", !state.prefs.codeLineNumbers);
          renderArtifact();
        }
        if (act === "reload") renderArtifact();
        if (act === "tab-code") {
          state.artifactTab = "code";
          renderArtifact();
        }
        if (act === "close") closeArtifact();
      });
    },
  });
}

/** Opens a code block in the artifact workspace (same surface as artifacts). */
function openCodeViewer(block) {
  if (!block) return;
  const lang = block.dataset.lang || "code";
  const code = block.querySelector("code")?.textContent ?? "";
  openArtifact({
    kind: "code",
    title: `${lang} snippet`,
    language: lang,
    code,
    source: "conversation",
  });
}

async function openMentionSheet(initial = "") {
  if (!state.session) return;
  openSheet({
    kind: "mention",
    title: "Mention a file",
    body: (root) => {
      root.innerHTML =
        '<div class="sheet-search"><div class="search-box">' +
        icon("search") +
        '<input class="search-input" id="mention-search" placeholder="Search files by name" autocomplete="off" spellcheck="false"></div></div>' +
        '<div class="sheet-list" id="mention-list"></div>';
      const input = $("#mention-search", root);
      const list = $("#mention-list", root);
      let token = 0;

      const search = async (q) => {
        const mine = ++token;
        const query = String(q ?? "").trim();
        if (!query) {
          list.innerHTML = '<p class="sheet-note">Start typing to search this workspace.</p>';
          return;
        }
        list.innerHTML = '<p class="sheet-note">Searching...</p>';
        let hits = [];
        try {
          hits = await state.api.findFiles(query, { directory: workspaceDir(), limit: 60 });
        } catch (err) {
          if (mine === token) list.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Search failed") + "</p>";
          return;
        }
        if (mine !== token) return;
        if (!hits.length) {
          list.innerHTML = '<p class="sheet-note">No files match \u201c' + escapeHtml(query) + "\u201d.</p>";
          return;
        }
        list.innerHTML = hits
          .map(
            (h) =>
              '<button class="sheet-item" data-mention="' + escapeHtml(toPosix(h.path)) + '">' +
              '<span class="si-icon">' + icon(h.type === "directory" ? "folder" : "file") + "</span>" +
              '<span class="si-text"><span class="si-title">' + escapeHtml(baseName(h.path)) + "</span>" +
              '<span class="si-sub">' + escapeHtml(parentDir(h.path) || ".") + "</span></span></button>"
          )
          .join("");
      };

      let timer = 0;
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => search(input.value), 220);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        clearTimeout(timer);
        search(input.value);
      });
      list.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-mention]");
        if (btn) insertMention(btn.dataset.mention);
      });

      if (initial) {
        input.value = initial;
        search(initial);
      }
      input.focus();
    },
  });
}

function insertMention(path) {
  const value = el.input.value;
  const caret = el.input.selectionStart ?? value.length;
  const before = value.slice(0, caret);
  // Replace a half-typed "@path" right before the caret, otherwise just append.
  const match = /@([^\s@]*)$/.exec(before);
  const mention = "@" + toPosix(path) + " ";
  el.input.value = match
    ? before.slice(0, match.index) + mention + value.slice(caret)
    : before + mention + value.slice(caret);
  const at = (match ? match.index : before.length) + mention.length;
  el.input.focus();
  el.input.setSelectionRange(at, at);
  autoGrow();
  updateSendButton();
  closeSheet();
  haptic(8);
}

/* ----------------------------------------------------------------- skills */

function openSkillSheet() {
  if (!state.session) return;
  openSheet({
    kind: "skills",
    title: "Skills",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading skills...</p>';
      let skills = [];
      try {
        skills = await state.api.skills({ directory: workspaceDir() });
      } catch (err) {
        root.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Could not load skills") + "</p>";
        return;
      }
      if (!skills.length) {
        root.innerHTML = '<p class="sheet-note">This workspace has no skills configured.</p>';
        return;
      }
      root.innerHTML =
        '<p class="sheet-note">Loading a skill puts its instructions into this session.</p><div class="sheet-list">' +
        skills
          .map(
            (s) =>
              '<button class="sheet-item" data-skill="' + escapeHtml(s.id) + '">' +
              '<span class="si-icon">' + icon("book") + "</span>" +
              '<span class="si-text"><span class="si-title">' + escapeHtml(s.name || s.id) + "</span>" +
              '<span class="si-sub">' + escapeHtml(s.description || (s.autoinvoke ? "Auto-invoked" : "Manual")) + "</span></span></button>"
          )
          .join("") +
        "</div>";
      root.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-skill]");
        if (!btn) return;
        try {
          await state.api.activateSkill(state.session.id, btn.dataset.skill);
          closeSheet();
          toast("Skill loaded");
          scheduleMessageRefresh(300);
        } catch (err) {
          handleError(err, "Could not load skill");
        }
      });
    },
  });
}

/* -------------------------------------------------------- session actions */

function forkSession(session) {
  openSheet({
    kind: "fork",
    title: "Fork session?",
    body: (root) => {
      root.innerHTML =
        '<p class="sheet-note">Continues this conversation in a new session, leaving the original untouched.</p>' +
        '<div class="permission-actions"><button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-confirm>Fork</button></div>';
      root.addEventListener("click", async (e) => {
        if (e.target.closest("[data-cancel]")) return closeSheet();
        if (!e.target.closest("[data-confirm]")) return;
        try {
          const res = await state.api.forkSession(session.id);
          const forked = res?.data;
          closeSheet();
          toast("Forked");
          await refreshSessions(false).catch(() => {});
          if (forked?.id) setTimeout(() => openSession(forked), 260);
        } catch (err) {
          handleError(err, "Could not fork");
        }
      });
    },
  });
}

function compactSession(session) {
  openSheet({
    kind: "compact",
    title: "Compact context?",
    body: (root) => {
      root.innerHTML =
        '<p class="sheet-note">Summarises the conversation so far so the session keeps going without running out of context.</p>' +
        '<div class="permission-actions"><button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-confirm>Compact</button></div>';
      root.addEventListener("click", async (e) => {
        if (e.target.closest("[data-cancel]")) return closeSheet();
        if (!e.target.closest("[data-confirm]")) return;
        closeSheet();
        try {
          await state.api.compactSession(session.id);
          toast("Compacting...");
          scheduleMessageRefresh(600);
        } catch (err) {
          handleError(err, "Could not compact");
        }
      });
    },
  });
}

/**
 * Undo. OpenCode rewinds to a message and restores the files it touched; the
 * revert stays staged until it is kept or dropped, hence the banner.
 */
function openUndoSheet(session) {
  const users = state.messages.filter((m) => m.type === "user");
  const last = users[users.length - 1];
  if (state.session?.id !== session.id || !last) {
    toast("Open the session to undo a turn");
    return;
  }
  const label = String(last.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  openSheet({
    kind: "undo",
    title: "Undo last turn?",
    body: (root) => {
      root.innerHTML =
        '<p class="sheet-note">Rewinds the conversation to before \u201c' +
        escapeHtml(label || "your last prompt") +
        "\u201d and restores the files changed since. You can keep or drop it afterwards.</p>" +
        '<div class="permission-actions"><button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-confirm>Rewind</button></div>';
      root.addEventListener("click", async (e) => {
        if (e.target.closest("[data-cancel]")) return closeSheet();
        if (!e.target.closest("[data-confirm]")) return;
        try {
          const res = await state.api.stageRevert(session.id, last.id, true);
          state.revert = res ?? { messageID: last.id };
          closeSheet();
          updateRevertBanner();
          await loadMessages();
          refreshDiff();
          toast("Rewound");
        } catch (err) {
          handleError(err, "Could not undo");
        }
      });
    },
  });
}

function updateRevertBanner() {
  el.revertBanner.hidden = !state.revert;
  if (!state.revert) return;
  const files = state.revert.files ?? [];
  const text = $(".rev-text", el.revertBanner);
  if (!text) return;
  text.textContent = files.length
    ? "Rewound \u00b7 " + files.length + (files.length === 1 ? " file restored" : " files restored")
    : "Rewound \u00b7 transcript only";
}

async function resolveRevert(keep) {
  if (!state.session) return;
  try {
    if (keep) await state.api.commitRevert(state.session.id);
    else await state.api.clearRevert(state.session.id);
    state.revert = null;
    updateRevertBanner();
    await loadMessages();
    refreshDiff();
    toast(keep ? "Kept" : "Restored");
  } catch (err) {
    handleError(err, "Could not resolve undo");
  }
}

function copyTranscript(session) {
  const quote = String.fromCharCode(96);
  const lines = [];
  for (const m of state.messages) {
    if (m.type === "user") lines.push("## You\n\n" + (m.text ?? ""));
    else if (m.type === "assistant") {
      const body = (m.content ?? [])
        .map((p) => {
          if (p.type === "text") return p.text;
          if (p.type === "reasoning") return "> " + String(p.text ?? "").replace(/\n/g, "\n> ");
          if (p.type === "tool") return "_" + (p.name ?? "tool") + " \u2014 " + (p.state?.status ?? "") + "_";
          return "";
        })
        .filter(Boolean)
        .join("\n\n");
      if (body) lines.push("## Assistant\n\n" + body);
    } else if (m.type === "system" && m.text) lines.push("_" + (m.description || m.text) + "_");
  }
  const text =
    "# " + (session.title || "Session") + "\n\n" + quote + session.id + quote + "\n\n" + lines.join("\n\n") + "\n";
  closeSheet();
  setTimeout(async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Transcript copied");
    } catch {
      const blob = new Blob([text], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (session.title || "session").replace(/[^\w.-]+/g, "-").slice(0, 60) + ".md";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("Transcript downloaded");
    }
  }, 220);
}

async function archiveSession(session, archived) {
  try {
    await state.api.updateSession(session.id, { archived });
    closeSheet();
    toast(archived ? "Archived" : "Unarchived");
    await refreshSessions(false).catch(() => {});
    if (archived && state.session?.id === session.id) closeChat(false);
  } catch (err) {
    handleError(err, archived ? "Could not archive" : "Could not unarchive");
  }
}

function openShellSheet(session) {
  openSheet({
    kind: "shell",
    title: "Run a command",
    body: (root) => {
      root.innerHTML =
        '<label class="field"><span class="label">Shell command</span>' +
        '<input class="input" id="shell-input" placeholder="git status" autocomplete="off" spellcheck="false" autocapitalize="off"></label>' +
        '<p class="sheet-note">Runs through OpenCode and lands in the transcript as output.</p>' +
        '<button class="btn btn-primary btn-block" id="shell-run">Run</button>';
      const input = $("#shell-input", root);
      const go = async () => {
        const command = input.value.trim();
        if (!command) return;
        closeSheet();
        try {
          await state.api.runShell(session.id, command);
          toast("Running " + command.split(/\s+/)[0]);
          scheduleMessageRefresh(400);
        } catch (err) {
          handleError(err, "Could not run command");
        }
      };
      $("#shell-run", root).addEventListener("click", go);
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        go();
      });
      input.focus();
    },
  });
}

/* --------------------------------------------------------------- settings */

function openSavedPermissionsSheet() {
  openSheet({
    kind: "permissions",
    title: "Always allowed",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading...</p>';
      let rules = [];
      try {
        rules = await state.api.savedPermissions(state.session?.projectID);
      } catch (err) {
        root.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Could not load rules") + "</p>";
        return;
      }
      if (!rules.length) {
        root.innerHTML =
          '<p class="sheet-note">Nothing is pre-approved. Answering a request with \u201cAlways\u201d adds a rule here.</p>';
        return;
      }
      root.innerHTML =
        '<p class="sheet-note">Requests matching these rules are approved without asking.</p><div class="sheet-list">' +
        rules
          .map(
            (r) =>
              '<div class="sheet-item"><span class="si-icon">' + icon("shield") + "</span>" +
              '<span class="si-text"><span class="si-title">' + escapeHtml(r.action) + " " + escapeHtml(r.resource) + "</span>" +
              '<span class="si-sub">' + escapeHtml(new Date(r.time?.created ?? Date.now()).toLocaleDateString()) + "</span></span>" +
              '<button class="rule-remove" data-rule="' + escapeHtml(r.id) + '" aria-label="Remove rule">' + icon("x") + "</button></div>"
          )
          .join("") +
        "</div>";
      root.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-rule]");
        if (!btn) return;
        try {
          await state.api.removeSavedPermission(btn.dataset.rule);
          btn.closest(".sheet-item").remove();
          haptic(10);
        } catch (err) {
          handleError(err, "Could not remove rule");
        }
      });
    },
  });
}

function openMcpSheet() {
  openSheet({
    kind: "mcp",
    title: "MCP servers",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading...</p>';
      let servers = [];
      try {
        servers = await state.api.mcpServers({ directory: workspaceDir() });
      } catch (err) {
        root.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Could not load servers") + "</p>";
        return;
      }
      if (!servers.length) {
        root.innerHTML = '<p class="sheet-note">No MCP servers configured for this project.</p>';
        return;
      }
      root.innerHTML =
        '<p class="sheet-note">' + servers.length + " servers configured.</p><div class=\"sheet-list\">" +
        servers
          .map((s) => {
            const status = s.status?.status ?? "unknown";
            const detail = s.status?.error ? String(s.status.error).slice(0, 100) : status;
            return (
              '<div class="sheet-item"><span class="dot-status" data-s="' + escapeHtml(status) + '"></span>' +
              '<span class="si-text"><span class="si-title">' + escapeHtml(s.title || s.name) + "</span>" +
              '<span class="si-sub">' + escapeHtml(detail) + "</span></span></div>"
            );
          })
          .join("") +
        "</div>";
    },
  });
}

function openProvidersSheet() {
  openSheet({
    kind: "providers",
    title: "Providers",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading...</p>';
      let providers = [];
      try {
        providers = await state.api.providers({ directory: workspaceDir() });
      } catch (err) {
        root.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Could not load providers") + "</p>";
        return;
      }
      if (!providers.length) {
        root.innerHTML = '<p class="sheet-note">No providers configured.</p>';
        return;
      }
      const order = { enabled: 0, auto: 1, disabled: 2 };
      root.innerHTML =
        '<p class="sheet-note">Which model providers this OpenCode can reach. Keys are configured on the host.</p><div class="sheet-list">' +
        [...providers]
          .sort((a, b) => (order[a.activation] ?? 9) - (order[b.activation] ?? 9))
          .map(
            (p) =>
              '<div class="sheet-item"><span class="si-icon">' + icon("plug") + "</span>" +
              '<span class="si-text"><span class="si-title">' + escapeHtml(p.name || p.id) + "</span>" +
              '<span class="si-sub">' + escapeHtml(p.activation) + "</span></span></div>"
          )
          .join("") +
        "</div>";
    },
  });
}

function openStatsSheet() {
  openSheet({
    kind: "stats",
    title: "Usage",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading...</p>';
      let s = null;
      try {
        s = await state.api.stats({});
      } catch (err) {
        root.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Could not load usage") + "</p>";
        return;
      }
      if (!s) {
        root.innerHTML = '<p class="sheet-note">No usage recorded yet.</p>';
        return;
      }
      const t = s.tokens ?? {};
      const rows = [
        ["Sessions", fmtCount(s.sessions)],
        ["Prompts", fmtCount(s.prompts)],
        ["Steps", fmtCount(s.steps)],
        ["Input tokens", fmtCount(t.input)],
        ["Output tokens", fmtCount(t.output)],
        ["Cache reads", fmtCount(t.cache?.read)],
        ["Spend", fmtCost(s.cost) || "$0.00"],
        ["Active days", fmtCount(s.activeDays) + (s.streak ? " \u00b7 " + s.streak + " day streak" : "")],
      ];
      root.innerHTML =
        '<div class="settings-grid">' +
        rows
          .map(
            (r) =>
              '<div class="setting-row"><div class="setting-text"><div class="setting-title">' + escapeHtml(r[0]) +
              '</div></div><div class="setting-value">' + escapeHtml(r[1]) + "</div></div>"
          )
          .join("") +
        "</div>";
    },
  });
}

/* ------------------------------------------------------------ usage footer */

function usageLine(m) {
  const t = m.tokens;
  const cost = fmtCost(m.cost);
  if (!t && !cost) return "";
  const bits = [];
  if (t) {
    if (t.input != null) bits.push(fmtCount(t.input) + " in");
    if (t.output != null) bits.push(fmtCount(t.output) + " out");
    if (t.cache?.read) bits.push(fmtCount(t.cache.read) + " cached");
  }
  if (cost) bits.push(cost);
  if (!bits.length) return "";
  return '<div class="usage-line">' + escapeHtml(bits.join(" \u00b7 ")) + "</div>";
}

/* ---------------------------------------------------------------- sheets */

function openSheet({ title, body, onClose, kind = null }) {
  clearTimeout(state.sheetCloseTimer);
  state.sheetKind = kind;
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
  state.sheetKind = null;
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
          ${sheetRow({ iconName: "search", title: "Find in conversation", sub: "Jump to a prompt or answer", attrs: "data-action=find" })}
          ${
            state.diff?.length
              ? sheetRow({ iconName: "diff", title: "Changes", sub: state.diff.length + " files touched here", attrs: "data-action=changes" })
              : ""
          }
          ${sheetRow({ iconName: "branch", title: "Fork session", sub: "Continue in a copy", attrs: "data-action=fork" })}
          ${sheetRow({ iconName: "undo", title: "Undo last turn", sub: "Rewind and restore files", attrs: "data-action=undo" })}
          ${sheetRow({ iconName: "refresh", title: "Compact context", sub: "Summarise to free context", attrs: "data-action=compact" })}
          ${sheetRow({ iconName: "terminal", title: "Run a command", sub: "Shell inside this session", attrs: "data-action=shell" })}
          ${sheetRow({ iconName: "book", title: "Load a skill", attrs: "data-action=skills" })}
          ${sheetRow({ iconName: "download", title: "Export session", sub: "JSON, as the server stores it", attrs: "data-action=export" })}
          ${sheetRow({ iconName: "copy", title: "Copy transcript", sub: "Conversation as Markdown", attrs: "data-action=copy" })}
          ${
            session.time?.archived
              ? sheetRow({ iconName: "archive", title: "Unarchive", attrs: "data-action=unarchive" })
              : sheetRow({ iconName: "archive", title: "Archive", sub: "Hide from the list", attrs: "data-action=archive" })
          }
          ${busy ? sheetRow({ iconName: "stop", title: "Stop run", attrs: "data-action=stop" }) : ""}
          ${sheetRow({ iconName: "settings", title: "Session info", attrs: "data-action=info" })}
          ${sheetRow({ iconName: "trash", title: "Delete session", danger: true, attrs: "data-action=delete" })}
        </div>`;
      root.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === "copy") return copyTranscript(session);
        if (action === "archive") return archiveSession(session, true);
        if (action === "unarchive") return archiveSession(session, false);
        if (action === "rename") return renameSession(session);
        if (action === "delete") return deleteSession(session);
        if (action === "info") return sessionInfo(session);
        if (action === "find") {
          if (state.session?.id !== session.id) {
            toast("Open the session to search it");
            return;
          }
          return openFindSheet();
        }
        if (action === "export") {
          closeSheet();
          return exportSession(session);
        }
        if (action === "changes") return openChangesSheet();
        if (action === "fork") return forkSession(session);
        if (action === "undo") return openUndoSheet(session);
        if (action === "compact") return compactSession(session);
        if (action === "shell") return openShellSheet(session);
        if (action === "skills") return openSkillSheet();
        closeSheet();
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
        ["Tokens in", fmtCount(session.tokens?.input ?? 0)],
        ["Tokens out", fmtCount(session.tokens?.output ?? 0)],
        ["Cache reads", fmtCount(session.tokens?.cache?.read ?? 0)],
        ["Cost", fmtCost(session.cost) || "$0.00"],
        ["Outcome", session.outcome ?? "running"],
        ["Archived", session.time?.archived ? new Date(session.time.archived).toLocaleString() : "no"],
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

function sheetSettingRow(iconName, title, sub, id) {
  return `<button class="setting-row" id="${id}">` +
    `<div class="setting-text"><div class="setting-title">${escapeHtml(title)}</div>` +
    `<div class="setting-sub">${escapeHtml(sub)}</div></div>` +
    `<span class="si-icon">${icon(iconName)}</span>` +
    `</button>`;
}

/* ----------------------------------------------------------- preferences
 * Everything here is deliberately local to Pocket. None of it changes what the
 * agent can do — that lives in the server's opencode.jsonc, which Pocket only
 * reads. The split matters: someone tuning their type size should never touch
 * a permission rule.
 */

function prefToggleRow(name, title, sub) {
  const on = !!state.prefs[name];
  return `<div class="setting-row">
    <div class="setting-text"><div class="setting-title">${escapeHtml(title)}</div><div class="setting-sub">${escapeHtml(sub)}</div></div>
    <button class="switch ${on ? "on" : ""}" data-pref-toggle="${name}" aria-label="${escapeHtml(title)}"></button>
  </div>`;
}

function prefSegRow(title, sub, name, options, current) {
  return `<div class="setting-row">
    <div class="setting-text"><div class="setting-title">${escapeHtml(title)}</div><div class="setting-sub">${escapeHtml(sub)}</div></div>
    <div class="seg" data-pref-seg="${name}">
      ${options
        .map(
          ([value, label]) =>
            `<button data-pref-value="${value}" class="${current === value ? "on" : ""}">${escapeHtml(label)}</button>`
        )
        .join("")}
    </div>
  </div>`;
}

function openPrefsStudio() {
  const p = state.prefs;
  openSheet({
    kind: "prefs",
    title: "Preferences",
    body: (root) => {
      root.innerHTML = `
        <div class="prefs-section">
          <div class="prefs-head">Appearance</div>
          ${prefSegRow("Theme", "Black is true black on OLED", "theme", [["system", "Auto"], ["amoled", "Black"], ["dark", "Dark"], ["light", "Light"]], state.theme)}
          <div class="setting-row">
            <div class="setting-text"><div class="setting-title">Accent</div><div class="setting-sub">Buttons, links, active states</div></div>
            <div class="accent-row">
              ${Object.entries(ACCENTS)
                .map(
                  ([key, a]) =>
                    `<button class="accent-dot ${p.accent === key ? "on" : ""}" data-accent="${key}" style="--dot:${a.accent}" aria-label="${key}"></button>`
                )
                .join("")}
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-text"><div class="setting-title">Text size</div><div class="setting-sub">${scaleLabel(p.fontScale)}</div></div>
            <div class="stepper">
              <button data-size="font" data-step="-1" aria-label="Smaller text">A−</button>
              <button data-size="font" data-step="1" aria-label="Larger text">A+</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-text"><div class="setting-title">Code size</div><div class="setting-sub">${scaleLabel(p.codeScale)}</div></div>
            <div class="stepper">
              <button data-size="code" data-step="-1" aria-label="Smaller code">A−</button>
              <button data-size="code" data-step="1" aria-label="Larger code">A+</button>
            </div>
          </div>
          ${prefSegRow("Reading mode", "How much of the work you see", "density", [["comfortable", "Comfortable"], ["compact", "Compact"], ["focus", "Focus"]], p.density)}
          ${prefToggleRow("timestamps", "Timestamps", "Show the time next to each message")}
          ${prefToggleRow("reducedMotion", "Reduced motion", "No transitions or entry animations")}
        </div>

        <div class="prefs-section">
          <div class="prefs-head">Chat</div>
          ${prefSegRow("Activity detail", verbosityHint[p.verbosity] ?? "", "verbosity", [["low", "Low"], ["medium", "Medium"], ["high", "High"]], p.verbosity)}
          ${prefToggleRow("toolOpen", "Tool cards start open", "Show output without tapping")}
          ${prefToggleRow("showFollowUps", "Suggested follow-ups", "Chips under a finished answer")}
          ${prefToggleRow("autoScroll", "Follow the answer", "Keep scrolling as new text arrives")}
          ${prefToggleRow("keepDraft", "Keep draft", "Restore an unsent prompt after a restart")}
        </div>

        <div class="prefs-section">
          <div class="prefs-head">Code</div>
          ${prefToggleRow("codeWrap", "Wrap long lines", "Both in the transcript and the viewer")}
          ${prefToggleRow("codeLineNumbers", "Line numbers", "In code blocks and the artifact viewer")}
        </div>

        <div class="prefs-section">
          <div class="prefs-head">Composer</div>
          ${prefToggleRow("enterToSend", "Enter sends", "Shift+Enter for a new line")}
        </div>

        <div class="prefs-foot">
          <button class="btn btn-ghost" data-pref-reset>Restore defaults</button>
        </div>`;

      root.onclick = (e) => {
        const theme = e.target.closest("[data-pref-value]");
        if (theme) {
          const group = theme.closest("[data-pref-seg]")?.dataset.prefSeg;
          if (group === "theme") {
            state.theme = theme.dataset.prefValue;
            store.set("theme", state.theme);
            setPref("theme", state.theme);
            applyTheme();
          } else {
            setPref(group, theme.dataset.prefValue);
          }
          state.prefs = getPrefs();
          openPrefsStudio();
          return;
        }

        const accent = e.target.closest("[data-accent]");
        if (accent) {
          setPref("accent", accent.dataset.accent);
          state.prefs = getPrefs();
          openPrefsStudio();
          return;
        }

        const step = e.target.closest("[data-size]");
        if (step) {
          const which = step.dataset.size === "code" ? "codeScale" : "fontScale";
          const stepSize = step.dataset.size === "code" ? 0.05 : 0.04;
          const next = Math.min(1.3, Math.max(0.88, Number((state.prefs[which] + Number(step.dataset.step) * stepSize).toFixed(2))));
          setPref(which, next);
          state.prefs = getPrefs();
          openPrefsStudio();
          return;
        }

        const toggle = e.target.closest("[data-pref-toggle]");
        if (toggle) {
          const name = toggle.dataset.prefToggle;
          setPref(name, !state.prefs[name]);
          if (name === "enterToSend") {
            state.enterToSend = !state.enterToSend;
            store.set("enterToSend", state.enterToSend);
          }
          state.prefs = getPrefs();
          openPrefsStudio();
          return;
        }

        if (e.target.closest("[data-pref-reset]")) {
          for (const [k, v] of Object.entries(DEFAULTS)) setPref(k, v);
          state.prefs = getPrefs();
          state.theme = state.prefs.theme;
          store.set("theme", state.theme);
          applyTheme();
          openPrefsStudio();
          toast("Defaults restored");
        }
      };
    },
  });
}

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
              <button data-theme="amoled" class="${theme === "amoled" ? "on" : ""}">Black</button>
            </div>
          </div>
          ${sheetSettingRow("settings", "Preferences", "Type size, accent, reading mode, code", "open-prefs")}
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
          ${sheetSettingRow("download", "Import a session", "From a JSON export", "import-session")}
          ${sheetSettingRow("shield", "Permissions", "Rules that skip the approval sheet", "saved-permissions")}
          ${sheetSettingRow("plug", "MCP servers", "Tools connected to this workspace", "open-mcp")}
          ${sheetSettingRow("cpu", "Providers", "Model providers this server reaches", "open-providers")}
          ${sheetSettingRow("book", "Skills", "Instructions available to the agent", "open-skills")}
          ${sheetSettingRow("spark", "Usage", "Tokens and spend across sessions", "open-stats")}
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
          setPref("theme", state.theme);
          applyTheme();
          for (const b of $$("#theme-seg button", root)) b.classList.toggle("on", b === themeBtn);
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
        if (e.target.closest("#import-session")) {
          if (state.demo) {
            toast("Demo mode has no server to import into");
            return;
          }
          importSession();
          return;
        }
        if (e.target.closest("#open-prefs")) {
          openPrefsStudio();
          return;
        }
        if (e.target.closest("#saved-permissions")) {
          openSavedPermissionsSheet();
          return;
        }
        if (e.target.closest("#open-mcp")) {
          openMcpSheet();
          return;
        }
        if (e.target.closest("#open-providers")) {
          openProvidersSheet();
          return;
        }
        if (e.target.closest("#open-skills")) {
          openSkillSheet();
          return;
        }
        if (e.target.closest("#open-stats")) {
          openStatsSheet();
          return;
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
  el.connectForm.addEventListener("submit", async (e) => {
    e.preventDefault();
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
  el.chatFind?.addEventListener("click", () => openFindSheet());
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
      return;
    }

    const activity = e.target.closest("[data-toggle-activity]");
    if (activity) {
      const box = activity.closest(".activity");
      box?.classList.toggle("open");
      activity.setAttribute("aria-expanded", box?.classList.contains("open") ? "true" : "false");
      return;
    }

    // code block controls
    const wrapBtn = e.target.closest("[data-code-wrap]");
    if (wrapBtn) {
      wrapBtn.closest(".code-block")?.classList.toggle("wrap");
      return;
    }
    const openBtn = e.target.closest("[data-code-open]");
    if (openBtn) {
      openCodeViewer(openBtn.closest(".code-block"));
      return;
    }

    // follow-up chips put a ready-made prompt in the composer
    const follow = e.target.closest("[data-follow]");
    if (follow) {
      el.input.value = follow.dataset.follow;
      autoGrow();
      updateSendButton();
      el.input.focus();
      haptic(6);
      return;
    }

    const openCard = e.target.closest("[data-artifact]");
    if (openCard) {
      const a = state.artifacts.find((x) => x.id === openCard.dataset.artifact);
      if (a) openArtifact(a);
      return;
    }

    const act = e.target.closest("[data-act]");
    if (act) {
      handleMessageAction(act.dataset.act, act.dataset.msgId);
      return;
    }

    // ---- forms
    const pick = e.target.closest(".opt[data-pick]");
    if (pick) {
      const card = pick.closest(".form-card");
      const entry = state.forms.find((f) => f.form?.id === card?.dataset.form);
      const field = entry?.form?.fields?.find((f) => f.key === pick.dataset.pick);
      if (entry && field) {
        if (field.type !== "multiselect") {
          for (const other of card.querySelectorAll(`.opt[data-pick="${CSS.escape(pick.dataset.pick)}"]`)) {
            if (other !== pick) other.setAttribute("aria-pressed", "false");
          }
          pick.setAttribute("aria-pressed", "true");
        } else {
          pick.setAttribute("aria-pressed", pick.getAttribute("aria-pressed") === "true" ? "false" : "true");
        }
        applyFormConditions(card, entry.form);
      }
      return;
    }
    const submit = e.target.closest("[data-form-submit]");
    if (submit) {
      await submitForm(submit.dataset.formSubmit);
      return;
    }
    const dismiss = e.target.closest("[data-form-cancel]");
    if (dismiss) {
      await dismissForm(dismiss.dataset.formCancel);
      return;
    }

    // ---- inbox
    const inboxCancel = e.target.closest("[data-inbox-cancel]");
    if (inboxCancel) {
      await cancelInboxItem(inboxCancel.dataset.inboxCancel);
      return;
    }
    const inboxToggle = e.target.closest("[data-inbox-toggle]");
    if (inboxToggle) {
      await toggleInboxDelivery(inboxToggle.dataset.inboxToggle);
      return;
    }
  });

  el.inboxBar?.addEventListener("click", async (e) => {
    const cancel = e.target.closest("[data-inbox-cancel]");
    if (cancel) return cancelInboxItem(cancel.dataset.inboxCancel);
    const toggle = e.target.closest("[data-inbox-toggle]");
    if (toggle) return toggleInboxDelivery(toggle.dataset.inboxToggle);
  });

  el.deliveryToggle?.addEventListener("click", () => {
    state.delivery = state.delivery === "queue" ? "steer" : "queue";
    store.set("delivery", state.delivery);
    el.deliveryToggle.querySelector("span").textContent = state.delivery === "queue" ? "Queue" : "Steer";
    el.deliveryToggle.classList.toggle("queue", state.delivery === "queue");
    haptic(6);
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
  el.messages.addEventListener("input", (e) => {
    const card = e.target.closest(".form-card");
    if (!card) return;
    const entry = state.forms.find((f) => f.form?.id === card.dataset.form);
    if (entry) applyFormConditions(card, entry.form);
  });

  el.input.addEventListener("input", () => {
    autoGrow();
    updateSendButton();
    maybeShowCommandHints();
    maybeOfferMentions();
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

  el.btnMention.addEventListener("click", () => openMentionSheet());
  el.chatDiff.addEventListener("click", () => openChangesSheet());
  el.revertBanner.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-revert]");
    if (btn) resolveRevert(btn.dataset.revert === "keep");
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

  // artifact workspace
  el.artifactBack?.addEventListener("click", () => closeArtifact(false));
  el.artifactMore?.addEventListener("click", artifactActions);
  el.artifactTabs?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-atab]");
    if (!b) return;
    state.artifactTab = b.dataset.atab;
    renderArtifact();
  });

  // back button: artifact, then sheet, then the conversation
  window.addEventListener("popstate", () => {
    if (state.artifact) closeArtifact(true);
    else if (state.sheetOpen) closeSheet(true);
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
  applyPrefs(state.prefs);
  applyTheme();
  bindEvents();
  onPrefs((prefs) => {
    state.prefs = prefs;
    if (prefs.theme && prefs.theme !== state.theme) {
      state.theme = prefs.theme;
      applyTheme();
    }
    renderMessages(true);
  });
  el.composerHint.textContent = defaultHint();
  if (el.deliveryToggle) {
    el.deliveryToggle.querySelector("span").textContent = state.delivery === "queue" ? "Queue" : "Steer";
    el.deliveryToggle.classList.toggle("queue", state.delivery === "queue");
  }

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

  // A launcher can open the app already connected: ?base=...&secret=...
  // The query is stripped immediately so the password does not sit in the
  // address bar or in history after the first paint.
  const params = new URLSearchParams(location.search);
  const qBase = params.get("base");
  const qSecret = params.get("secret");
  if (qBase && qSecret) {
    history.replaceState(null, "", location.pathname);
    el.connectScreen.hidden = false;
    showScreen("sessions");
    renderSessionSkeleton();
    try {
      await connect(qBase, qSecret);
      return;
    } catch (err) {
      console.warn("link connect failed", err);
      showScreen("connect");
      el.connectError.hidden = false;
      el.connectError.textContent = err?.message || "That link could not connect.";
      el.connectUrl.value = qBase;
      el.connectSecret.value = "";
      return;
    }
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
