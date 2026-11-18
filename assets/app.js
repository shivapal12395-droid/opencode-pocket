import { Api, ApiError, normalizeBase, resolveSecret } from "./api.js";
import { renderMarkdown, escapeHtml } from "./markdown.js";
import { formCardHtml, buildAnswer, missingRequired, applyFormConditions, readFormValues } from "./forms.js";
import { getPrefs, setPref, onPrefs, applyPrefs, ACCENTS, DEFAULTS, densityLabel, verbosityLabel, verbosityHint, scaleLabel } from "./prefs.js";
import { detectArtifacts, artifactCardHtml, artifactBodyHtml } from "./artifacts.js";
import * as History from "./history.js";
import { buildStandaloneHtml, exportName, printDocument } from "./export.js";

/* ---------------------------------------------------------------- utils */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const icon = (name, cls = "") => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Preferences and small UI state in localStorage.
 *
 * Demo mode gets its own prefix: a demo tab or `lastSessionID` pointing at
 * `ses_demo*` used to survive into the real app, which then tried to open a
 * conversation that does not exist on the server.
 */
let storePrefix = "ocp.";
const store = {
  useDemoNamespace() {
    storePrefix = "ocp.demo.";
  },
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(storePrefix + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(storePrefix + key, JSON.stringify(value));
    } catch {}
  },
  del(key) {
    try {
      localStorage.removeItem(storePrefix + key);
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
  // "thinking" until a tool actually runs, then "working"; idle when the turn ends.
  phase: "idle",
  sending: false,
  stopping: false,
  // set when a prompt was sent but no answer came back: it may or may not have
  // reached the server, so it is never resent automatically.
  pendingPrompt: null,
  net: { status: "online", attempt: 0, max: 8, error: null },
  lastEventAt: 0,
  staleTimer: 0,
  attachments: [],
  permissions: [],
  sseStop: null,
  online: false,
  demo: false,
  lastModel: store.get("lastModel", null),
  theme: store.get("theme", "system"), // system dark -> amoled
  enterToSend: store.get("enterToSend", false),
  sheetOpen: false,
  sheetClosing: false,
  artifactClosing: false,
  showArchived: store.get("showArchived", false),
  lastWorkspace: store.get("lastWorkspace", ""),
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
  todos: [],
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
  el.archivedToggle = $("#archived-toggle");
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
  el.netBanner = $("#net-banner");
  el.netText = $("#net-text");
  el.netRetry = $("#net-retry");
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
  el.todoPanel = $("#todo-panel");
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
  el.sheetBack = $("#sheet-back");
  el.toast = $("#toast");
  el.lightbox = $("#lightbox");
  el.lightboxBody = $("#lightbox-body");
  el.lightboxClose = $("#lightbox-close");
  el.lightboxSource = $("#lightbox-source");
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

/* ------------------------------------------------------- left sidebar */

function sidebarOpen() {
  const s = $("#sidebar");
  const b = $("#sidebar-backdrop");
  if (!s || !b) return;
  s.hidden = false;
  b.hidden = false;
  history.pushState({ sidebar: true }, "");
  requestAnimationFrame(() => {
    s.classList.add("open");
    b.classList.add("open");
  });
  renderSidebar();
  haptic(6);
}

function sidebarClose() {
  const s = $("#sidebar");
  const b = $("#sidebar-backdrop");
  if (!s || s.hidden) return;
  s.classList.remove("open");
  b.classList.remove("open");
  setTimeout(() => {
    if (s.classList.contains("open")) return;
    s.hidden = true;
    b.hidden = true;
  }, 240);
}

function pinnedIds() {
  return store.get("pinnedSessions", []);
}

function renderSidebar() {
  const filter = ($("#side-filter")?.value ?? "").toLowerCase().trim();
  const sessions = (state.sessions ?? []).filter((s) => !s.time?.archived);
  const pinned = new Set(pinnedIds());
  const workspaces = [...new Set(sessions.map((s) => s.location?.directory).filter(Boolean))];
  const active = state.session?.location?.directory || state.lastWorkspace || workspaces[0] || "";
  const sideItem = (s) => `<div class="side-item${state.session?.id === s.id ? " active" : ""}" data-side-session="${escapeHtml(s.id)}">
      <span class="si-label">${escapeHtml(s.title?.trim() || "Untitled")}</span>
      ${s.outcome === "failed" || s.outcome === "error" ? '<span class="si-dot"></span>' : ""}
    </div>`;

  const ws = $("#side-workspaces");
  if (ws) ws.innerHTML = workspaces
    .map((d) => `<div class="side-item${d === active ? " active" : ""}" data-side-workspace="${escapeHtml(d)}">
      <span class="si-label">${escapeHtml(basename(d) || d)}</span></div>`)
    .join("") || '<div class="side-item">No workspaces yet</div>';

  const pin = $("#side-pinned");
  if (pin) pin.innerHTML = sessions.filter((s) => pinned.has(s.id) && (!filter || s.title?.toLowerCase().includes(filter)))
    .map(sideItem).join("") || '<div class="side-item">Pin a chat to see it here</div>';

  const rec = $("#side-recents");
  if (rec) rec.innerHTML = sessions.filter((s) => !pinned.has(s.id) && (!filter || s.title?.toLowerCase().includes(filter)))
    .slice(0, 40).map(sideItem).join("") || '<div class="side-item">No recent chats</div>';

  const conn = $("#side-conn");
  if (conn) conn.innerHTML = `<i></i> ${state.online ? "Connected" : "Connecting…"}`;
}

function bindSidebar() {
  $("#open-sidebar")?.addEventListener("click", sidebarOpen);
  $("#chat-sidebar")?.addEventListener("click", sidebarOpen);
  $("#side-collapse")?.addEventListener("click", sidebarClose);
  $("#sidebar-backdrop")?.addEventListener("click", sidebarClose);
  $("#side-new")?.addEventListener("click", () => {
    sidebarClose();
    openNewSession();
  });
  $("#side-filter")?.addEventListener("input", renderSidebar);
  $("#side-chat")?.addEventListener("click", () => {
    sidebarClose();
    openNewSession();
  });
  $("#side-avatar")?.addEventListener("click", () => {
    sidebarClose();
    openAccountSheet();
  });

  $("#sidebar")?.addEventListener("click", async (e) => {
    const ses = e.target.closest("[data-side-session]");
    if (ses) {
      const s = state.sessions.find((x) => x.id === ses.dataset.sideSession);
      sidebarClose();
      if (s) await openSession(s);
      return;
    }
    const w = e.target.closest("[data-side-workspace]");
    if (w) {
      state.lastWorkspace = w.dataset.sideWorkspace;
      store.set("lastWorkspace", state.lastWorkspace);
      renderSidebar();
      toast(`Workspace · ${basename(state.lastWorkspace) || state.lastWorkspace}`);
      return;
    }
    const btn = e.target.closest("[data-side]");
    if (!btn) return;
    const action = btn.dataset.side;
    sidebarClose();
    if (action === "settings") return openSettings();
    if (action === "providers") return openAuthSheet();
    if (action === "images") return openImagesSheet();
    if (action === "customize") return openCustomizeSheet();
    if (action === "worktrees") return openWorktreesSheet();
    if (action === "projects") return openProjectsSheet();
    if (action === "tasks") return openSchedulesSheet();
    if (action === "plugins") return openPluginsSheet();
    if (action === "library") return openLibrarySheet();
    if (action === "explore") return openFindSheet();
  });
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

  // The native WebView shell caches the same credentials so a cold start can
  // reconnect without asking again. Ignored in the browser and in demo mode.
  try {
    window.PocketNative?.saveConfig?.(resolved.base, resolved.secret);
  } catch {}

  await enterApp();
}

/**
 * Drop anything a demo run left in the real preferences.
 *
 * Demo state is namespaced now, but an install that ran the demo before that
 * still has `ses_demo*` in "last session" and in the tab strip, and opening one
 * against the real server answers 404. One pass is enough.
 */
function purgeDemoState() {
  if (state.demo) return;
  const last = store.get("lastSessionID", null);
  if (typeof last === "string" && last.startsWith("ses_demo")) store.del("lastSessionID");
  const tabs = store.get("sessionTabs", []);
  if (Array.isArray(tabs) && tabs.some((id) => String(id).startsWith("ses_demo"))) {
    store.set("sessionTabs", tabs.filter((id) => !String(id).startsWith("ses_demo")));
  }
}

async function enterApp() {
  purgeDemoState();
  showScreen("sessions");
  setConnection("online", "Connected");
  renderSessionSkeleton();
  startEvents();

  // Only an answered request can prove the account is empty. A runtime that is
  // still starting must not be mistaken for a wiped install.
  let listed = false;
  try {
    await refreshSessions(true);
    listed = true;
  } catch (err) {
    handleError(err, "Could not load sessions");
  }

  // A fresh install has no sessions but may still have a backup in Downloads.
  // Offer it once, never restore on its own — and do not create a new session
  // behind the sheet, so the choice is not made for the user.
  if (listed && maybeOfferBackupRestore()) return;

  // Never leave a returning user on a blank screen, and never leave a brand
  // new install with nothing to do: restore the last session, or create one
  // in the default workspace.
  const lastID = store.get("lastSessionID");
  const last = state.sessions.find((s) => s.id === lastID) || state.sessions[0];
  if (last) {
    await openSession(last).catch(() => {});
    return;
  }
  const dir = window.PocketNative?.workspaceDir?.() || state.lastWorkspace;
  if (dir) {
    try {
      await ensureModels();
      const res = await state.api.createSession({ directory: dir, model: state.lastModel || undefined });
      if (res?.data) {
        await openSession(res.data);
      }
    } catch {
      // Stay on the session list; the New session button is still there.
    }
  }
}

function startEvents() {
  stopEvents();
  state.sseStop = state.api.streamEvents(handleEvent, applyNetStatus);
  // Reconnect when returning to the app. The listener outlives an individual
  // stream so a stream that gave up (or started while the app was
  // backgrounded) still gets a chance on resume.
  if (!state.visibilityHooked) {
    state.visibilityHooked = true;
    document.addEventListener("visibilitychange", onVisibility);
  }
}

function stopEvents() {
  state.sseStop?.();
  state.sseStop = null;
}

/** One place decides what the connection state means for the UI. */
function applyNetStatus(status, info = {}) {
  state.net = {
    status,
    attempt: info.attempt ?? 0,
    max: info.maxAttempts ?? 8,
    error: info.error ?? null,
  };

  if (status === "online") {
    const wasOffline = !state.online;
    state.online = true;
    hideNetBanner();
    setConnection(state.busy ? "busy" : "online", state.busy ? "Working" : "Connected");
    // The transcript may have moved on while the socket was down. Re-read it
    // once instead of trusting a stale window of events.
    if (wasOffline) recoverAfterReconnect();
    return;
  }

  const wasOnline = state.online;
  state.online = false;
  if (status === "failed") {
    setConnection("offline", "Connection lost");
    showNetBanner("Connection lost. Pocket stopped retrying.", { retry: true });
  } else if (status === "offline") {
    const attempt = Math.min(info.attempt ?? 1, info.maxAttempts ?? 8);
    setConnection("offline", "Reconnecting...");
    showNetBanner(`Connection lost — retrying (${attempt}/${info.maxAttempts ?? 8})`);
  } else {
    // connecting / reconnecting
    setConnection(state.busy ? "busy" : "offline", "Connecting...");
    if (!wasOnline) showNetBanner("Connecting...");
  }
}

function showNetBanner(text, { retry = false } = {}) {
  if (!el.netBanner) return;
  el.netText.textContent = text;
  el.netRetry.hidden = !retry;
  el.netBanner.hidden = false;
}

function hideNetBanner() {
  if (el.netBanner) el.netBanner.hidden = true;
}

/** User-triggered retry: never automatic, never a loop. */
function retryConnection() {
  showNetBanner("Reconnecting...");
  if (state.sseStop?.retryNow) state.sseStop.retryNow();
  else if (state.api) startEvents();
}

/** Reconcile the open screen with the server after a reconnect. */
async function recoverAfterReconnect() {
  if (!state.api) return;
  try {
    if (state.screen === "chat" && state.session) {
      await loadMessages();
      loadForms();
      loadInbox();
      if (state.busy) await verifyTurn();
    } else {
      await refreshSessions(false);
    }
  } catch {
    /* the next event or resume will try again */
  }
  if (state.pendingPrompt) checkPendingPrompt({ quiet: true }).catch(() => {});
}

/**
 * Ask the server whether the open session is still running.
 *
 * Events are the fast path, but a phone that was killed, backgrounded or
 * disconnected can miss the `session.idle`. Without this check the composer
 * would stay in "Stop" mode forever on a turn that already finished.
 */
async function verifyTurn() {
  if (!state.api || !state.session) return null;
  const sid = state.session.id;
  let res;
  try {
    res = await state.api.getSession(sid);
  } catch {
    return null;
  }
  const s = res?.data;
  if (!s || state.session?.id !== sid) return null;
  state.session = { ...state.session, ...s };
  const running = (s.time?.busy ?? 0) > (s.time?.idle ?? 0);
  if (running) {
    if (!state.busy) {
      setBusy(true);
      setPhase("thinking");
    }
  } else if (state.busy) {
    setBusy(false);
    state.lastAssistantId = null;
    await loadMessages().catch(() => {});
  }
  return running;
}

async function onVisibility() {
  if (document.visibilityState !== "visible" || !state.api) return;
  // The socket is very likely dead after a background spell, so re-open it
  // rather than waiting for a failure to notice.
  if (state.sseStop?.retryNow) state.sseStop.retryNow();
  else startEvents();
  if (state.screen === "sessions") refreshSessions(true).catch(() => {});
  else if (state.session) {
    loadMessages().catch(() => {});
    if (state.busy) verifyTurn().catch(() => {});
  }
}

/* ---------------------------------------------------------------- session list */

async function refreshSessions(showSkeleton = false) {
  if (!state.api || state.sessionsLoading) return;
  state.sessionsLoading = true;
  if (showSkeleton) renderSessionSkeleton();
  try {
    const res = await state.api.listSessions({ search: state.search, limit: 50 });
    const remote = res?.data ?? [];
    const local = await History.getSessions().catch(() => []);
    const ids = new Set(remote.map((s) => s.id));
    const q = state.search.toLowerCase();
    // Demo transcripts live on the same origin, so an earlier demo run used to
    // leave ses_demo* in the recovery cache and the real app then opened them,
    // 404ed, and showed a fake "server offline" copy. Demo data never belongs
    // in the real history: drop it (once) and stop writing it below.
    if (!state.demo) {
      for (const s of local) {
        if (/^ses_demo/.test(s.id)) History.deleteSession(s.id).catch(() => {});
      }
    }
    // Keep local-only copies of sessions deleted upstream until the user
    // explicitly deletes them, and apply the same search filter to them.
    state.sessions = [
      ...remote,
      ...local.filter(
        (s) =>
          !ids.has(s.id) &&
          (state.demo || !/^ses_demo/.test(s.id)) &&
          !s.time?.archived &&
          (!q || (s.title ?? "").toLowerCase().includes(q) || (s.location?.directory ?? "").toLowerCase().includes(q))
      ),
    ];
    if (!state.demo) History.putSessions(remote).catch(() => {});
    state.sessionsCursor = res?.cursor?.next ?? null;
    renderSessions();
    renderSidebar();
    renderTabs();
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
  const all = state.sessions;
  const archived = all.filter((s) => s.time?.archived);
  // Nothing archived left to show: don't stay in a mode whose toggle is gone.
  if (!archived.length && state.showArchived) {
    state.showArchived = false;
    store.set("showArchived", false);
  }
  const list = state.showArchived ? all : all.filter((s) => !s.time?.archived);
  el.archivedToggle.hidden = archived.length === 0;
  if (el.archivedToggle) {
    el.archivedToggle.textContent = state.showArchived ? `Hide archived (${archived.length})` : `Archived (${archived.length})`;
    el.archivedToggle.classList.toggle("on", state.showArchived);
  }
  if (!list.length) {
    el.sessionList.innerHTML = `<div class="empty">${icon("terminal")}<b>${
      state.showArchived ? "No sessions yet" : archived.length ? "Everything here is archived" : "No sessions yet"
    }</b>${
      state.search
        ? "Try a different search."
        : archived.length && !state.showArchived
          ? "Tap Archived to see them."
          : 'Tap "New session" to start your first task.'
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
              const archived = !!s.time?.archived;
              return `
                <div class="session-row${state.session?.id === s.id ? " active" : ""}${unread ? " unread" : ""}${
                  archived ? " archived" : ""
                }" data-id="${escapeHtml(s.id)}">
                  <button class="session-main" data-open="${escapeHtml(s.id)}">
                    <span class="session-title">${escapeHtml(title)}</span>
                    ${archived ? '<span class="session-archived">Archived</span>' : ""}
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
  // The native shell saves straight to Downloads; blob anchors are unreliable
  // inside a WebView, so prefer the bridge when it is present.
  try {
    if (window.PocketNative?.saveText) {
      window.PocketNative.saveText(name, text, type);
      return;
    }
  } catch {}
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

/* ------------------------------------------------------------ export
 * The answer is exported as the document it reads like in the chat, not as the
 * raw transcript markup, and without the tool chatter that belongs to the app.
 */

function documentTitleOf(markdown, fallback = "OpenCode answer") {
  const heading = String(markdown).match(/^\s*#{1,3}\s+(.+)$/m);
  if (heading) return heading[1].replace(/[*_`]/g, "").trim().slice(0, 80) || fallback;
  const first = String(markdown)
    .split(/\r?\n/)
    .map((l) => l.replace(/^[>\s*#-]+/, "").trim())
    .find((l) => l.length > 2);
  return (first ?? fallback).slice(0, 80);
}

function documentMeta(m) {
  const when = m?.time?.created ? new Date(m.time.created).toLocaleString() : new Date().toLocaleString();
  const session = state.session?.title?.trim() || "OpenCode session";
  return `${session} · ${when}`;
}

function saveAnswerHtml(markdown, m) {
  const title = documentTitleOf(markdown, state.session?.title || "OpenCode answer");
  const html = buildStandaloneHtml({
    title,
    markdown,
    meta: documentMeta(m),
    origin: state.base && !state.demo ? state.base : "",
  });
  downloadText(exportName(title, "html"), html, "text/html");
  return html;
}

async function printMarkdownDoc(markdown, { title, meta, origin }) {
  const result = await printDocument({ title, markdown, meta, origin });
  if (result.via === "none") {
    // Honest fallback: keep the document, say why the dialog did not open.
    downloadText(exportName(title, "html"), result.html, "text/html");
    toast("Printing is not available here — saved the HTML (" + (result.reason || "no print surface") + ")");
  }
  return result;
}

async function printAnswer(markdown, m) {
  return printMarkdownDoc(markdown, {
    title: documentTitleOf(markdown, state.session?.title || "OpenCode answer"),
    meta: documentMeta(m),
    origin: state.base && !state.demo ? state.base : "",
  });
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
  haptic(8);
  await deliverPrompt({ text: user.text, files: [], delivery: "steer" });
  if (!state.pendingPrompt) toast("Asked again");
}

/** A finished answer stopped at the output limit: one manual continuation. */
async function continueAnswer(m) {
  if (!state.session) return;
  if (state.busy) return toast("Wait for this turn to finish");
  if (state.sending) return toast("Still sending the last message");
  if (hasContinuationAfter(m)) return toast("Already continued");
  await deliverPrompt({ text: CONTINUE_PROMPT, files: [], delivery: "steer", synthetic: true });
}

async function retryAnswer(m) {
  const ok = await confirmSheet({
    title: "Retry this answer?",
    note: "The partial answer stays in the transcript. Retry sends the original prompt again as a new run.",
    confirmLabel: "Retry",
    kind: "retry-answer",
  });
  if (!ok) return;
  closeSheet();
  await askAgain(m);
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
        ${isAssistant ? sheetRow({ iconName: "download", title: "Export HTML", sub: "One file, no dependencies", attrs: "data-mact=export-html" }) : ""}
        ${isAssistant ? sheetRow({ iconName: "print", title: "Print / Save as PDF", sub: "Opens the system print dialog", attrs: "data-mact=print" }) : ""}
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
        if (act === "export-html" && isAssistant) {
          const md = markdownOf(m);
          if (!md) return toast("This answer has no text to export");
          saveAnswerHtml(md, m);
        }
        if (act === "print" && isAssistant) {
          const md = markdownOf(m);
          if (!md) return toast("This answer has no text to export");
          await printAnswer(md, m);
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
  if (!busy) state.stopping = false;
  if (el.deliveryToggle) {
    el.deliveryToggle.hidden = !busy;
    el.deliveryToggle.querySelector("span").textContent = state.delivery === "queue" ? "Queue" : "Steer";
    el.deliveryToggle.classList.toggle("queue", state.delivery === "queue");
  }
  setPhase(busy ? state.phase === "idle" ? "thinking" : state.phase : "idle");
  updateSendButton();
  updateChatStatus();
  if (busy) armStaleWatch();
  else clearStaleWatch();
}

/**
 * "Thinking" is the model working before any tool runs; "Working" means a tool
 * is actually executing. They are different states, and the header says which.
 */
function setPhase(phase) {
  state.phase = phase;
  const live = state.busy && phase !== "idle";
  el.chatStatus.hidden = !state.busy;
  el.chatStatus.querySelector("span").textContent = phase === "thinking" ? "Thinking" : "Working";
  el.chatStatus.classList.toggle("thinking", phase === "thinking");
  setConnection(
    live ? "busy" : state.online ? "online" : "offline",
    live ? (phase === "thinking" ? "Thinking" : "Working") : state.online ? "Connected" : "Offline"
  );
}

/**
 * "Working" is only true while a tool is actually executing. Once the last tool
 * in the turn finishes and the model writes again, the header goes back to
 * "Thinking": the two states must never be blurred into one.
 */
function phaseFromTools() {
  if (!state.busy) return;
  const running = state.messages.some(
    (m) => m.type === "assistant" && (m.content ?? []).some((p) => p.type === "tool" && toolStatus(p) === "running")
  );
  setPhase(running ? "working" : "thinking");
}

/** While a turn is open, a periodic check asks the server whether it is still
 *  running. Without it, an app killed mid-run could show "Working" forever. */
function armStaleWatch() {
  clearStaleWatch();
  state.staleTimer = setTimeout(() => {
    state.staleTimer = 0;
    if (!state.busy) return;
    if (!state.online) {
      state.staleTimer = setTimeout(() => armStaleWatch(), 30000);
      return;
    }
    verifyTurn().catch(() => {});
  }, 45000);
}

function clearStaleWatch() {
  if (state.staleTimer) clearTimeout(state.staleTimer);
  state.staleTimer = 0;
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
  store.set("lastSessionID", session.id);
  store.set("lastWorkspace", session.location?.directory ?? state.lastWorkspace);
  addTab(session);
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
  state.forms = [];
  state.inbox = [];
  state.todos = [];
  renderTodos();
  renderInbox();
  resetMessageRender();
  updateRevertBanner();
  updateDiffChip();

  // Opening a session is what clears its unread dot on the server. The route
  // takes the idle timestamp as a number - sending a boolean (or nothing) is
  // rejected with a 400, which is how this call used to fail silently.
  markSessionViewed(session);

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

/**
 * Tell the server this conversation has been seen, so its unread dot clears the
 * way the official clients clear it. `idle` is the timestamp to mark viewed up
 * to, and the route expects a number.
 */
async function markSessionViewed(session) {
  if (!state.api || !session?.id) return;
  const idle = Number(session.time?.idle) || Date.now();
  session.time = { ...(session.time ?? {}), viewed: idle };
  try {
    await state.api.viewSession(session.id, idle);
  } catch {
    // Older servers may not have the route; an unread dot is not worth a toast.
  }
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
    // `cursor.next` is the page of *older* messages: a long task is never cut
    // off at the top of the screen.
    state.messagesCursor = res?.cursor?.next ?? null;
    // Keep an on-device recovery copy. It is never expired or auto-deleted. Demo
    // mode writes to its own database (see history.js), so this never mixes
    // fake transcripts into the real recovery copy.
    History.putSession(state.session).catch(() => {});
    History.putMessages(state.session.id, state.messages).catch(() => {});
    renderMessages(firstLoad);
    // Both are cheap and both block work if ignored: a waiting question, or a
    // prompt still sitting in the queue.
    loadForms();
    loadInbox();
  } catch (err) {
    // Server temporarily unavailable: the local copy keeps the conversation
    // readable instead of showing an empty screen.
    const cached = await History.getMessages(state.session.id).catch(() => []);
    if (cached.length) {
      state.messages = cached.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
      renderMessages(firstLoad);
      toast("Showing saved copy · server offline");
    } else {
      handleError(err, "Could not load messages");
    }
  } finally {
    state.messagesLoading = false;
  }
}

/**
 * Fetch the page of messages before the current window.
 *
 * The API hands out the newest page first, so a long task would otherwise be
 * cut off at the top of the screen with no way back to how it started.
 */
async function loadOlderMessages() {
  if (!state.api || !state.session || !state.messagesCursor) return;
  const cursor = state.messagesCursor;
  const btn = $("[data-load-older]", el.messages);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Loading earlier...";
  }
  state.messagesLoading = true;
  // Hold the reader's place: the page is inserted above the viewport, so the
  // node under the top edge is found now and realigned afterwards.
  const atBottom = isNearBottom();
  const anchor = atBottom
    ? null
    : [...el.messages.querySelectorAll("[data-msg]")].find((n) => n.getBoundingClientRect().bottom > 0) ?? null;
  const anchorId = anchor?.dataset.msg ?? null;
  const anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
  try {
    const res = await state.api.messages(state.session.id, { limit: 80, order: "desc", cursor });
    const older = (res?.data ?? []).slice().reverse();
    state.messagesCursor = res?.cursor?.next ?? null;
    const seen = new Set(state.messages.map((m) => m.id));
    state.messages = [...older.filter((m) => !seen.has(m.id)), ...state.messages];
    History.putMessages(state.session.id, state.messages).catch(() => {});
    renderMessages(false);
    if (atBottom) {
      scrollToBottom(false);
    } else if (anchorId) {
      const node = el.messages.querySelector(`[data-msg="${CSS.escape(anchorId)}"]`);
      if (node) el.messages.scrollTop += node.getBoundingClientRect().top - anchorTop;
    }
  } catch (err) {
    handleError(err, "Could not load earlier messages");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Load earlier messages";
    }
  } finally {
    state.messagesLoading = false;
  }
}

/**
 * Drop a selection whose content no longer exists.
 *
 * The transcript is rebuilt from scratch on every event, so a selection made
 * during a streaming answer can end up anchored to a node that has just been
 * thrown away. Android keeps its floating selection toolbar for that dead
 * selection, which is how a stray Copy/Select-all bar appeared during normal
 * chat. A selection the user can still see is left alone.
 */
function pruneSelection() {
  try {
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    const dead = (n) => n && !document.contains(n);
    if (dead(anchor) || dead(focus)) sel.removeAllRanges();
  } catch {
    /* selection is a nice-to-have, never a crash */
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
  if (status === "pending" || status === "queued") return "pending";
  return status ?? "running";
}

function toolDuration(part) {
  const t = part.state?.time;
  if (!t?.start) return "";
  const end = t.end ?? t.completed ?? (toolStatus(part) === "running" ? Date.now() : null);
  if (!end) return "";
  const ms = Math.max(0, end - t.start);
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(ms < 10_000 ? 1 : 0) + "s";
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
  const name = String(part.name || "").toLowerCase();
  const done = { read: "Read", edit: "Edited", write: "Wrote", patch: "Patched", shell: "Ran", bash: "Ran", grep: "Searched", glob: "Searched", list: "Listed", webfetch: "Fetched", fetch: "Fetched", websearch: "Searched", task: "Ran", question: "Asked" };
  const verb = status === "running" ? "Running" : failed ? "Failed" : done[name] ?? "Ran";
  const noun =
    {
      read: "file",
      edit: "file",
      write: "file",
      patch: "file",
      apply_patch: "patch",
      shell: "shell",
      bash: "shell",
      grep: "files",
      glob: "files",
      list: "files",
      webfetch: "page",
      fetch: "page",
      websearch: "web",
      task: "subagent",
      question: "question",
    }[String(part.name || "").toLowerCase()] ?? String(part.name || "tool");

  return `
    <div class="tool-card" data-tool="${key}">
      <button class="tool-head" data-toggle-tool="${key}">
        <span class="tool-icon">${icon(iconName)}</span>
        <span class="tool-name">${verb} ${escapeHtml(noun)}</span>
        ${summary ? `<span class="tool-summary">${escapeHtml(summary)}</span>` : ""}
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
  let pending = 0;
  for (const { part } of items) {
    if (part.type !== "tool") continue;
    counts.set(toolVerb(part), (counts.get(toolVerb(part)) ?? 0) + 1);
    if (part.state?.status === "error") failed += 1;
    if (toolStatus(part) === "pending") pending += 1;
  }
  const bits = [...counts.entries()].map(([verb, n]) => `${verb} ${n}`);
  if (pending) bits.push(`${pending} waiting`);
  if (failed) bits.push(`${failed} failed`);
  return bits.join(" · ");
}

function activityDuration(items) {
  let total = 0;
  let any = false;
  for (const { part } of items) {
    if (part.type !== "tool") continue;
    const t = part.state?.time;
    if (!t?.start) continue;
    const end = t.end ?? t.completed ?? (toolStatus(part) === "running" ? Date.now() : null);
    if (!end) continue;
    total += Math.max(0, end - t.start);
    any = true;
  }
  return any ? total : 0;
}

function fmtDuration(ms) {
  if (!ms) return "";
  if (ms < 1000) return "1s";
  // Whole seconds: "Worked for 5s" reads like a duration, "5.0s" reads like a
  // stopwatch that is still running.
  if (ms < 60_000) return Math.round(ms / 1000) + "s";
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function renderActivity(items, m, streaming, keyOverride = null, durationMs = 0) {
  const verbosity = state.prefs.verbosity;
  const key = keyOverride ?? `${m.id}:a:${items[0].idx}`;
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

  // A turn stays "live" until the server reports it finished. Requiring a tool
  // to be in `running` state made the panel flash "Worked for 9.3s" in the gaps
  // between steps, while the turn was still streaming.
  const live = !!streaming;
  const steps = tools.length + (reasoning.length ? 1 : 0);
  const dur = durationMs || activityDuration(items);
  const count = `${steps} ${steps === 1 ? "step" : "steps"}`;
  // The live caption follows the same phase as the header: a tool has to be
  // actually running for this to say "Working". Otherwise the panel claimed
  // "Working" while the header said "Thinking".
  const working = live && (state.phase === "working" || tools.some((i) => toolStatus(i.part) === "running"));
  const title = live
    ? `${working ? "Working" : "Thinking"}… · ${count}`
    : dur
      ? `Worked for ${fmtDuration(dur)} · ${count}`
      : `Worked · ${count}`;
  const sub = activitySummary(items);
  // Reasoning arrives as one part per step, which used to put a "Thought
  // process" row between every tool. One merged block reads like a trace
  // instead of a log table.
  const trace = reasoning
    .map((i) => (i.part.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  const traceDone = reasoning.every((i) => i.part.time?.completed);
  const mergedTrace = trace
    ? renderReasoning(
        { type: "reasoning", text: trace, time: traceDone ? { completed: 1 } : undefined, ordinal: "all" },
        `${key}:r`
      )
    : "";
  const body =
    verbosity === "low"
      ? tools.map((i) => renderTool(i.part)).join("")
      : mergedTrace + tools.map((i) => renderTool(i.part)).join("");

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

/* ------------------------------------------------------- welcome state */

const STARTERS = [
  { label: "Build a new feature", prompt: "Add a new feature to this project. First explore the structure, then propose a small, focused implementation and make the change.", icon: "code" },
  { label: "Explain this project", prompt: "Explain what this project does, its main components, and how they fit together. Keep it concise.", icon: "book" },
  { label: "Find and fix bugs", prompt: "Look for likely bugs or edge cases in this project. Report the top issues with file references, then fix the most important one.", icon: "wrench" },
  { label: "Review recent changes", prompt: "Review the recent changes in this workspace. Summarise what changed and flag anything risky.", icon: "diff" },
  { label: "Write tests", prompt: "Identify an important untested path in this project and add focused tests for it.", icon: "check" },
  { label: "Explore project files", prompt: "Explore the project files and give me a quick map of the directory structure and key entry points.", icon: "folder" },
];

function welcomeHtml() {
  const dir = basename(state.session?.location?.directory || workspaceDir() || "") || "workspace";
  const model = state.session?.model;
  const modelLabel = model ? (model.name || `${model.providerID}/${model.id}`) : "Default model";
  return `<div class="welcome">
    <div class="welcome-mark">${icon("spark")}</div>
    <h1>What would you like to build today?</h1>
    <p>${escapeHtml(dir)} <span class="welcome-sep">·</span> ${escapeHtml(modelLabel)}</p>
    <div class="welcome-starters">
      ${STARTERS.map(
        (s) => `<button class="starter" data-starter="${escapeHtml(s.prompt)}">
          <span class="starter-icon">${icon(s.icon)}</span><span>${escapeHtml(s.label)}</span>
        </button>`
      ).join("")}
    </div>
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

function turnDuration(turn, live) {
  if (!turn?.start) return 0;
  // `end` comes from the server's completion/idle time. A restored transcript
  // sometimes has none (older sessions, cached history), and "Worked · 3 steps"
  // with no duration looks broken, so fall back to when the last step arrived.
  const end = live ? Date.now() : turn.end || turn.last || turn.start;
  return Math.max(0, end - turn.start);
}

function renderAssistant(m, opts = {}) {
  const parts = messageParts(m);
  // Two different questions, so two flags. `streaming` is about this message:
  // it is the one the model is writing right now, so it gets the caret and the
  // typing dots. `turnLive` is about the turn: it is still running, so its
  // panel must keep saying "Working..." and the icons and token line must stay
  // off until it ends. Tying both to the same flag made a running turn flash
  // "Worked · 3 steps" between two steps, and put the icons on an intermediate
  // step only to move them again when the next step arrived.
  const streaming = opts.streaming ?? (state.busy && m.id === state.lastAssistantId);
  const turnLive = opts.turnLive ?? (state.busy && m.id === state.lastAssistantId);
  // Only the message that ends the turn carries actions and token counters.
  const showMeta = opts.showMeta !== false;
  const turn = opts.turn ?? null;
  const showActivity = !!opts.showActivity && !!turn?.items?.length;
  let activityShown = false;

  // One activity panel per user request: tool/reasoning parts of every
  // assistant step in this turn live in a single group, rendered once.
  const blocks = [];
  parts.forEach((part, idx) => {
    if (part.type === "tool" || part.type === "reasoning") {
      if (showActivity && !activityShown) {
        activityShown = true;
        blocks.push({
          kind: "activity",
          items: turn.items,
          key: "turn:" + turn.id,
          durationMs: turnDuration(turn, turnLive),
        });
      }
      return;
    }
    blocks.push({ kind: "part", part, idx });
  });

  const html = blocks
    .map((b) => {
      if (b.kind === "activity") return renderActivity(b.items, m, turnLive, b.key, b.durationMs);
      const { part, idx } = b;
      if (part.type === "text") {
        // Whitespace-only text parts are common between tool calls; rendering
        // them as a `.md` block is what produced the dead gaps in the transcript.
        if (!(part.text ?? "").trim()) return "";
        const key = `${m.id}:t:${part.ordinal ?? idx}`;
        const caret = streaming && idx === parts.length - 1 ? `<span class="stream-caret"></span>` : "";
        return `<div class="md" data-part="${escapeHtml(key)}">${renderMarkdown(part.text)}${caret}</div>`;
      }
      return "";
    })
    .join("");

  const hasText = parts.some((p) => p.type === "text" && (p.text ?? "").trim().length > 0);
  const hasArtifacts = artifactCards(m).trim().length > 0;

  // A step that only contains tools/reasoning is not an answer: it belongs in
  // the activity panel, not in its own message with actions and token counters.
  if (!hasText && !m.error && !m.retry && !hasArtifacts) {
    if (!html.trim()) return "";
    return `<div class="msg msg-assistant step-only" data-msg="${escapeHtml(m.id)}">
      <div class="assistant-body">${html}</div>
    </div>`;
  }

  // A failed step keeps its reason on the message (`Assistant.error`), and a provider
  // hiccup shows up as `Assistant.retry` before any content has been written.
  const retry = m.retry
    ? `<div class="assistant-note">${icon("refresh")}Retrying, attempt ${escapeHtml(String(m.retry.attempt))}${
        m.retry.error?.message ? ` · ${escapeHtml(m.retry.error.message)}` : ""
      }</div>`
    : "";
  const failure = m.error ? renderFailure(m.error) : "";
  // Only a *finished* run can be called incomplete: while the turn is open the
  // server is still working, and a mid-turn length stop is its normal signal to
  // continue in smaller steps.
  const partial =
    !state.busy && !turnLive && showMeta && finishIsLimit(m) && !hasContinuationAfter(m) ? limitCard(m) : "";
  const empty =
    !html && !failure && streaming ? `<div class="typing-row"><span class="typing"><i></i><i></i><i></i></span></div>` : "";

  // Icons and the token line belong to a finished turn: while it is running
  // there is nothing to copy or regenerate yet, and showing them on whichever
  // step happens to be latest reads as a flicker.
  const footer = turnLive || !showMeta ? "" : `${usageLine(m)}${followUpsFor(m)}`;

  return `
    <div class="msg msg-assistant" data-msg="${escapeHtml(m.id)}">
      <div class="assistant-body">${html}${retry}${failure}${partial}${empty}</div>
      ${artifactCards(m)}
      ${showMeta && !turnLive ? stamp(m) : ""}
      ${turnLive || !showMeta ? "" : assistantActions(m)}
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
  // The continuation prompt is an instruction from the app, not a message the
  // user typed. Show what happened instead of a fake prompt bubble.
  if (isContinuationText(m.text)) {
    return renderSystem("Continued after the output limit", "spark");
  }
  const files = (m.files ?? [])
    .filter((f) => (f.mime ?? "image/jpeg").startsWith("image/"))
    .map((f) => ({ ...f, src: fileSrc(f) }))
    .filter((f) => f.src);
  return `
    <div class="msg msg-user" data-msg="${escapeHtml(m.id)}">
      <div class="bubble">${escapeHtml(m.text ?? "")}${
        files.length
          ? `<div class="files">${files.map((f) => `<img src="${escapeHtml(f.src)}" alt="${escapeHtml(f.name ?? "attachment")}">`).join("")}</div>`
          : ""
      }</div>
      ${stamp(m)}
      ${userActions(m)}
    </div>`;
}

function renderSystem(text, iconName = "check") {
  return `<div class="msg msg-system"><span class="sys">${icon(iconName)}${escapeHtml(text)}</span></div>`;
}

/* ---------------------------------------------------- output token limit
 * `finish: "length"` is a step-level fact. OpenCode handles it mid-turn by
 * injecting a synthetic instruction ("Your last response hit the output token
 * limit…") and letting the agent split the work, so a length step is not a
 * truncated answer. Only the last answer of a finished turn, with no
 * continuation after it, is presented as partial.
 */
const LIMIT_NOTICE = /output token limit|stop reason:\s*length|hit the output token limit/i;
const CONTINUE_PROMPT =
  "Continue from exactly where your previous message stopped. Do not repeat anything you already wrote, do not apologize, and do not restart the task. Break the remaining work into smaller pieces.";

const isLimitNotice = (text) => LIMIT_NOTICE.test(String(text ?? ""));
const isContinuationText = (text) => String(text ?? "").trim() === CONTINUE_PROMPT;
const finishIsLimit = (m) => m?.finish === "length" || isLimitNotice(m?.error?.message);

function hasContinuationAfter(m) {
  const idx = state.messages.indexOf(m);
  if (idx < 0) return false;
  return state.messages.slice(idx + 1).some(
    (x) =>
      (x.type === "synthetic" && isLimitNotice(x.text)) ||
      (x.type === "user" && isContinuationText(x.text))
  );
}

function renderSynthetic(m) {
  const text = m.description || m.text || "";
  if (isLimitNotice(text)) {
    return `<div class="msg msg-system sys-limit"><span class="sys">${icon("stop")}Output limit hit — the agent is continuing in smaller steps</span></div>`;
  }
  return renderSystem(text, "spark");
}

function pendingPromptCard() {
  const p = state.pendingPrompt;
  if (!p) return "";
  return `<div class="limit-card pending-card">
    <div class="limit-head">${icon("wifi")}<span>Message not confirmed</span></div>
    <p>${escapeHtml(p.error || "The server did not answer.")} It may or may not have received this message, so Pocket will not send it again by itself.</p>
    <div class="limit-actions">
      <button class="btn btn-primary btn-sm" type="button" data-pending="check">Check server</button>
      <button class="btn btn-sm" type="button" data-pending="resend">Send again</button>
      <button class="btn btn-sm" type="button" data-pending="discard">Discard</button>
    </div>
  </div>`;
}

/** Shown only for a turn that ended while still cut off (see renderAssistant). */
function limitCard(m) {
  const id = escapeHtml(m.id);
  return `<div class="limit-card" data-limit-for="${id}">
    <div class="limit-head">${icon("stop")}<span>Answer cut at the output limit</span></div>
    <p>OpenCode keeps a long task going by splitting it into steps, and this turn ended before the task did. Continue asks it to carry on from here without repeating itself; Retry runs the original prompt again as a new turn.</p>
    <div class="limit-actions">
      <button class="btn btn-primary btn-sm" type="button" data-limit="continue" data-msg-id="${id}">Continue</button>
      <button class="btn btn-sm" type="button" data-limit="retry" data-msg-id="${id}">Retry</button>
    </div>
  </div>`;
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
    state.messagesCursor ?? "-",
    state.pendingPrompt?.status ?? "-",
  ];
  for (const f of state.forms) bits.push(f.form?.id ?? "", f.status);
  for (const m of state.messages) {
    bits.push(m.id, m.type);
    if (m.type === "assistant") {
      bits.push(m.finish ?? "");
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

/* ------------------------------------------------ rich transcript extras
 * Diagrams and the viewer live here rather than in markdown.js because both
 * need the live DOM. Two rules keep a phone happy:
 *
 *   - a diagram is drawn only when it scrolls into view, and its SVG is cached
 *     by source text, so rebuilding the transcript while a later answer streams
 *     replays the drawing instead of paying for Mermaid again;
 *   - nothing is drawn while a turn is still writing, because half a diagram is
 *     a parse error, not a preview.
 */

const diagramEngine = { module: null, observer: null, cache: new Map(), notes: new Map() };
const DIAGRAM_CACHE_MAX = 40;
const DIAGRAM_MAX_SOURCE = 30000;

const themeKey = () => document.documentElement.dataset.theme || "amoled";

function diagramObserver() {
  if (diagramEngine.observer) return diagramEngine.observer;
  diagramEngine.observer = new IntersectionObserver(
    (entries) => {
      const batch = entries.filter((x) => x.isIntersecting).map((x) => x.target);
      for (const node of batch) diagramEngine.observer.unobserve(node);
      if (batch.length) drawDiagrams(batch);
    },
    { root: el.messages, rootMargin: "600px 0px" }
  );
  return diagramEngine.observer;
}

/**
 * Mermaid reserves `end` (and a few other words) as keywords. Models very often
 * write `:::end` / `classDef end fill:...`, which is perfectly sensible-looking
 * Mermaid and always fails to parse. Renaming the class keeps the diagram the
 * author clearly meant instead of showing a parse error.
 */
const MERMAID_RESERVED = new Set([
  "end", "graph", "flowchart", "subgraph", "class", "classdef",
  "click", "style", "linkstyle", "direction", "default", "call", "href",
]);

function prepareDiagram(source) {
  const raw = String(source ?? "");
  const isFlowchart = /^\s*(flowchart|graph)\b/i.test(raw);
  let droppedNotes = 0;
  let text = raw;
  // `note right of B:` is sequence/class syntax. In a flowchart it is a parse
  // error, and models put it there constantly. The flow itself is still valid,
  // so the notes are set aside (the source keeps them) instead of losing the
  // whole diagram.
  if (isFlowchart) {
    text = raw
      .split(/\r?\n/)
      .filter((line) => {
        if (/^\s*note(s)?\s+(right|left|over)\b/i.test(line)) {
          droppedNotes += 1;
          return false;
        }
        return true;
      })
      .join("\n");
  }
  return { text: normalizeDiagramSource(text), droppedNotes };
}

function diagramNoteText(count) {
  return count === 1
    ? "Drew the flow without one note: Mermaid notes only exist in sequence diagrams (the note is still in the source)."
    : `Drew the flow without ${count} notes: Mermaid notes only exist in sequence diagrams (they are still in the source).`;
}

function normalizeDiagramSource(source) {
  let text = String(source ?? "");
  const renamed = new Map();
  const rename = (name) => {
    if (!MERMAID_RESERVED.has(String(name).toLowerCase())) return name;
    if (!renamed.has(name)) renamed.set(name, `${name}Node`);
    return renamed.get(name);
  };
  // node ::: class
  text = text.replace(/:::([A-Za-z_][\w-]*)/g, (_m, n) => `:::${rename(n)}`);
  // classDef class ...
  text = text.replace(/(^|\n)([ \t]*classDef[ \t]+)([A-Za-z_][\w-]*)/g, (_m, pre, kw, n) => pre + kw + rename(n));
  // class A,B class
  text = text.replace(/(^|\n)([ \t]*class[ \t]+)([^\n;]+)/g, (_m, pre, kw, body) => {
    const parts = body.trim().split(/\s+/);
    if (parts.length >= 2) parts[parts.length - 1] = rename(parts[parts.length - 1]);
    return pre + kw + parts.join(" ");
  });
  return text;
}

async function drawDiagrams(nodes) {
  const list = nodes.filter((n) => n.isConnected && !n.classList.contains("drawn") && !n.classList.contains("failed"));
  if (!list.length) return;
  let mod;
  try {
    diagramEngine.module ??= import("./vendor/pocket-mermaid.mjs");
    mod = await diagramEngine.module;
  } catch (err) {
    for (const node of list) markDiagramFailed(node, err);
    return;
  }
  for (const node of list) {
    if (!node.isConnected || node.classList.contains("drawn")) continue;
    const source = node.textContent ?? "";
    const prepared = prepareDiagram(source);
    try {
      const svg = await mod.drawOne(node, prepared.text);
      rememberDiagram(source, svg, prepared.droppedNotes);
      if (prepared.droppedNotes) panelNote(node, diagramNoteText(prepared.droppedNotes));
    } catch (err) {
      markDiagramFailed(node, err);
    }
  }
}

async function paintArtifactDiagrams() {
  const nodes = $$("pre.mermaid:not(.drawn):not(.failed)", el.artifactBody);
  if (!nodes.length) return;
  let mod;
  try {
    diagramEngine.module ??= import("./vendor/pocket-mermaid.mjs");
    mod = await diagramEngine.module;
  } catch (err) {
    for (const node of nodes) markDiagramFailed(node, err);
    return;
  }
  for (const node of nodes) {
    if (!node.isConnected) continue;
    const source = node.textContent ?? "";
    const prepared = prepareDiagram(source);
    try {
      const svg = await mod.drawOne(node, prepared.text);
      rememberDiagram(source, svg, prepared.droppedNotes);
      if (prepared.droppedNotes) panelNote(node, diagramNoteText(prepared.droppedNotes));
    } catch (err) {
      markDiagramFailed(node, err);
    }
  }
}

function markDiagramFailed(node, err) {
  node.classList.add("failed");
  panelNote(node, "Could not draw this diagram: " + String(err?.message ?? err).split("\n")[0].slice(0, 120));
}

/** A quiet line under the block, never a thrown error in the transcript. */
function panelNote(node, text) {
  if (node.nextElementSibling?.classList?.contains("mermaid-error")) return;
  const note = document.createElement("span");
  note.className = "mermaid-error";
  note.textContent = text;
  node.after(note);
}

function rememberDiagram(source, svg, droppedNotes = 0) {
  const key = themeKey() + "\u0000" + source;
  diagramEngine.cache.set(key, svg);
  // The "drawn without notes" line has to come back with a cached replay too,
  // otherwise it would disappear on the next transcript rebuild.
  if (droppedNotes) diagramEngine.notes.set(key, droppedNotes);
  else diagramEngine.notes.delete(key);
  if (diagramEngine.cache.size > DIAGRAM_CACHE_MAX) {
    diagramEngine.cache.delete(diagramEngine.cache.keys().next().value);
  }
}

/**
 * Called after every transcript rebuild: replay cached drawings synchronously
 * (no flicker, no work), then watch the rest.
 */
function decorateTranscript() {
  const nodes = $$("pre.mermaid", el.messages);
  if (!nodes.length) return;
  const key0 = themeKey();
  const pending = [];
  for (const node of nodes) {
    const source = node.textContent ?? "";
    const svg = diagramEngine.cache.get(key0 + "\u0000" + source);
    if (svg) {
      node.innerHTML = svg;
      node.__mermaidSource = source; // the viewer's Source toggle needs it
      node.classList.add("drawn");
      const dropped = diagramEngine.notes.get(key0 + "\u0000" + source) ?? 0;
      if (dropped) panelNote(node, diagramNoteText(dropped));
      continue;
    }
    if (source.trim().length > DIAGRAM_MAX_SOURCE) {
      panelNote(node, "This diagram is too large to draw on the device; the source stays visible.");
      continue;
    }
    pending.push(node);
  }
  if (!pending.length) return;
  // Only the message that is still being written is left alone: half a diagram
  // is a parse error. Everything already finished is drawn, even while a later
  // turn streams — the page being busy is not a reason for an older answer to
  // stay as source.
  const liveId = state.busy ? state.lastAssistantId : null;
  const ready = liveId
    ? pending.filter((n) => (n.closest("[data-msg]")?.dataset.msg ?? "") !== liveId)
    : pending;
  if (!ready.length) return;
  const io = diagramObserver();
  for (const node of ready) io.observe(node);
}

/* A theme or accent flip changes the diagram palette, and Mermaid bakes colours
 * into each SVG. Repaint the ones already on screen from their stored source
 * instead of rebuilding the whole transcript. */
function repaintDiagrams() {
  diagramEngine.cache.clear();
  diagramEngine.notes.clear();
  for (const node of $$("pre.mermaid.drawn, pre.mermaid.failed", el.messages)) {
    const source = node.__mermaidSource;
    if (!source) continue;
    node.classList.remove("drawn", "failed");
    node.textContent = source;
    const note = node.nextElementSibling;
    if (note?.classList?.contains("mermaid-error")) note.remove();
  }
  decorateTranscript();
  if (state.artifact && !el.artifact.hidden) renderArtifact();
}

const paletteKey = () =>
  themeKey() + ":" + getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();

/* code blocks: a wrapped block stays wrapped when the transcript rebuilds */function codeBlockKey(block) {
  const msg = block.closest("[data-msg]");
  const scope = msg ?? el.messages;
  return (msg?.dataset.msg ?? "-") + ":" + [...scope.querySelectorAll(".code-block")].indexOf(block);
}

function restoreCodeBlocks(keys) {
  if (!keys.size) return;
  for (const block of $$(".code-block", el.messages)) {
    if (keys.has(codeBlockKey(block))) block.classList.add("wrap");
  }
}

/* ------------------------------------------------------------- lightbox */

function openLightbox(node) {
  if (!el.lightbox || !el.lightboxBody) return;
  const diagram = node.matches?.("pre.mermaid.drawn");
  el.lightboxBody.className = "lightbox-content" + (diagram ? " diagram" : "");
  el.lightboxBody.innerHTML = "";
  state.lightboxSource = diagram ? node.__mermaidSource ?? "" : "";
  if (diagram) {
    const svg = node.querySelector("svg");
    if (!svg) return;
    el.lightboxBody.appendChild(svg.cloneNode(true));
  } else {
    const img = document.createElement("img");
    img.src = node.currentSrc || node.src;
    img.alt = node.alt || "";
    el.lightboxBody.appendChild(img);
  }
  if (el.lightboxSource) {
    el.lightboxSource.hidden = false;
    el.lightboxSource.textContent = "Source";
    el.lightboxSource.dataset.mode = "svg";
  } else {
    el.lightboxSource.hidden = true;
  }
  el.lightbox.classList.add("open");
  el.lightbox.setAttribute("aria-hidden", "false");
  haptic(6);
}

function toggleLightboxSource() {
  if (!el.lightboxSource || !state.lightboxSource) return;
  const showSource = el.lightboxSource.dataset.mode !== "source";
  el.lightboxSource.dataset.mode = showSource ? "source" : "svg";
  el.lightboxSource.textContent = showSource ? "Diagram" : "Source";
  el.lightboxBody.className = "lightbox-content" + (showSource ? "" : " diagram");
  el.lightboxBody.innerHTML = "";
  if (showSource) {
    const pre = document.createElement("pre");
    pre.className = "lightbox-code";
    pre.textContent = state.lightboxSource;
    el.lightboxBody.appendChild(pre);
  } else {
    const node = $$("pre.mermaid.drawn", el.messages).find((n) => (n.__mermaidSource ?? "") === state.lightboxSource);
    const svg = node?.querySelector("svg");
    if (svg) el.lightboxBody.appendChild(svg.cloneNode(true));
  }
}

function closeLightbox() {
  if (!el.lightbox?.classList.contains("open")) return;
  el.lightbox.classList.remove("open");
  el.lightbox.setAttribute("aria-hidden", "true");
  el.lightboxBody.innerHTML = "";
  state.lightboxSource = "";
  haptic(4);
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
  const wrappedBlocks = new Set($$(".code-block.wrap", el.messages).map(codeBlockKey));

  const chunks = [];

  // Mirrors the SessionMessage.Info union: every variant gets a row, and anything
  // unknown still renders (nothing in a transcript should silently disappear).
  // A failed turn records the same error twice — on the assistant step and on the
  // closing idle marker — so remember what has already been shown and skip the repeat.
  // Build one activity bucket per user request. OpenCode emits several
  // assistant messages per turn (one per step); grouping by message produced a
  // "Worked for N steps" panel under every step. The bucket fixes that.
  //
  // The bucket index has to be the *same* number the render loop below uses for
  // that message, so it is recorded per message instead of recomputed. A loaded
  // window often starts mid-turn (the API returns the last N messages), and the
  // two loops used to count a leading assistant run differently: the buckets
  // ran from 0, the render loop from -1, so every turn after the first user
  // message read its predecessor's bucket. The activity panel then matched no
  // message (the work vanished from the transcript) and the token/action row
  // landed on the wrong step.
  const turns = [];
  const turnIndex = new Map();
  let turnCursor = -1;
  for (const m of state.messages) {
    if (m.type === "user" || turnCursor < 0) {
      turnCursor = Math.max(0, turnCursor + 1);
      turns[turnCursor] = { id: turnCursor, items: [], activityMessageId: null, metaMessageId: null, start: 0, end: 0, last: 0 };
    }
    turnIndex.set(m, turnCursor);
    const bucket = turns[turnCursor];
    const created = m.time?.created ?? 0;
    if (bucket && created) {
      if (!bucket.start || created < bucket.start) bucket.start = created;
      if (created > bucket.last) bucket.last = created;
      const finished = m.time?.completed ?? (m.type === "idle" ? created : 0);
      if (finished && finished > bucket.end) bucket.end = finished;
    }
    if (m.type === "assistant") {
      messageParts(m).forEach((part, idx) => {
        if (part.type === "tool" || part.type === "reasoning") {
          turns[turnCursor].items.push({ part, idx });
          if (!turns[turnCursor].activityMessageId) turns[turnCursor].activityMessageId = m.id;
        }
      });
      // Actions and the token line belong to the answer that ends the turn.
      // Repeating them after every narration step made one reply look like
      // three separate messages, each with its own counters.
      const hasAnswer = messageParts(m).some((p) => p.type === "text" && (p.text ?? "").trim());
      if (hasAnswer) turns[turnCursor].metaMessageId = m.id;
    }
  }

  // Long sessions arrive one page at a time; earlier pages stay one tap away
  // instead of being silently unreachable.
  if (state.messagesCursor && state.messages.length) {
    chunks.push(
      `<div class="load-older-row"><button class="btn btn-sm" type="button" data-load-older>Load earlier messages</button></div>`
    );
  }

  let shownFailure = null;
  for (const m of state.messages) {
    const turn = turns[turnIndex.get(m)] ?? null;
    const lastTurn = !!turn && turn.id === turns.length - 1;
    if (m.type === "user") {
      shownFailure = null;
      chunks.push(renderUser(m));
    } else if (m.type === "assistant") {
      if (m.error) shownFailure = m.error.message ?? "";
      chunks.push(
        renderAssistant(m, {
          turn,
          showActivity: !!turn && turn.activityMessageId === m.id,
          turnLive: lastTurn && state.busy,
          streaming: state.busy && m.id === state.lastAssistantId,
          showMeta: !turn || !turn.metaMessageId || turn.metaMessageId === m.id,
        })
      );
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
    else if (m.type === "synthetic" && m.text) chunks.push(renderSynthetic(m));
    else if (m.type === "system" && m.text) chunks.push(renderSystem(m.description || m.text, "spark"));
    else if (m.type === "agent-switched") chunks.push(renderSystem(`Agent · ${m.agent ?? ""}`, "spark"));
    else if (m.type === "model-switched") chunks.push(renderSystem(`Model · ${m.model?.id ?? ""}`, "spark"));
    else if (m.type === "location-switched") chunks.push(renderSystem("Workspace changed", "folder"));
  }
  // Forms sit at the end of the transcript: they block the turn that produced
  // them, so they have to be impossible to miss.
  for (const entry of state.forms) {
    if (!entry?.form) continue;
    chunks.push(formCardHtml(entry.form, { status: entry.status, answer: entry.answer, values: entry.values }));
  }
  if (state.pendingPrompt?.status === "unknown") chunks.push(pendingPromptCard());

  if (!chunks.length) {
    el.messages.innerHTML = welcomeHtml();
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
  pruneSelection();
  for (const n of $$(".tool-card", el.messages)) if (openTools.has(n.dataset.tool)) n.classList.add("open");
  for (const n of $$(".reasoning", el.messages)) if (openReasoning.has(n.dataset.reasoning)) n.classList.add("open");
  for (const n of $$(".activity", el.messages)) if (openActivity.has(n.dataset.activity)) n.classList.add("open");
  restoreCodeBlocks(wrappedBlocks);
  decorateTranscript();

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
  // Re-sending form.created for a form already on screen must not wipe what the
  // user has picked so far.
  if (i >= 0) state.forms[i] = { ...state.forms[i], form };
  else state.forms.push({ form, status: "pending", answer: null, values: {} });
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
    const next = list.map((form) => {
      const local = state.forms.find((f) => f.form?.id === form.id);
      // Keep a local answer/selection if this form is still pending on screen.
      return local ? { ...local, form } : { form, status: "pending", answer: null, values: {} };
    });
    // The server only returns forms that are still *waiting*. An answered form
    // is a record of what was asked and what was chosen, so it stays in the
    // transcript until another session is opened.
    for (const local of state.forms) {
      if (local.status !== "pending" && !next.some((f) => f.form?.id === local.form?.id)) next.push(local);
    }
    state.forms = next;
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

  const missing = missingRequired(card, entry.form, entry.values);
  if (missing) {
    toast(`Answer "${missing.title || missing.key}" first`);
    return;
  }
  const answer = buildAnswer(card, entry.form, entry.values);
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
  // Only queued work belongs in the strip. A "steer" prompt joins the running
  // turn immediately, so showing it as waiting would be a lie.
  const items = (state.inbox ?? []).filter((x) => x && x.id && (x.delivery ?? "queue") === "queue");
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
  pruneSelection();
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
    const wasOffline = !state.online;
    applyNetStatus("online");
    if (!wasOffline) {
      if (state.screen === "chat") scheduleMessageRefresh(200);
      else refreshSessions(false).catch(() => {});
    }
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
      setPhase("thinking");
      break;
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
    case "session.idle":
      setBusy(false);
      state.lastAssistantId = null;
      scheduleMessageRefresh(250);
      // A prompt that was ambiguous may have landed; the reload above is the
      // moment the truth exists on disk.
      setTimeout(() => {
        if (state.pendingPrompt) checkPendingPrompt({ quiet: true }).catch(() => {});
      }, 700);
      break;
    case "session.todo.updated": {
      // The checklist is published whole, not incrementally. Keep the last list
      // per session so switching away and back restores it.
      state.todos = Array.isArray(data.todos) ? data.todos : [];
      renderTodos();
      break;
    }
    case "session.retry.scheduled": {
      // The provider hiccuped and the server is waiting to try again. Showing it
      // prevents a silent pause that looks like a hang.
      const m = ensureAssistant(data.assistantMessageID, data);
      m.retry = { attempt: data.attempt ?? 1, error: data.error };
      setBusy(true);
      setPhase("thinking");
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
      if (m) {
        m.finish = data.finish;
        // A length stop is normal mid-turn: OpenCode continues with smaller
        // steps. Keep the fact (the renderer decides what to show), and let the
        // idle event be the only thing that completes the turn.
        if (finishIsLimit(m)) renderMessages();
      }
      break;
    }
    case "session.step.started": {
      state.lastAssistantId = data.assistantMessageID;
      ensureAssistant(data.assistantMessageID, { ...data, started: data.started });
      setBusy(true);
      if (state.phase === "idle") setPhase("thinking");
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
      setPhase("working");
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
      setPhase("working");
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
      phaseFromTools();
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
      phaseFromTools();
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

  if (text.startsWith("/") && executeCommand(el.input.value)) return;

  if (!text && state.busy) {
    await interrupt();
    return;
  }
  if (!text && !state.attachments.length) return;
  if (state.sending) {
    toast("Still sending the last message");
    return;
  }

  // While a turn is running the server accepts two meanings for a prompt: join
  // the run (steer) or wait for it (queue). The composer exposes the choice.
  const delivery = state.busy ? state.delivery : "steer";
  const files = attachmentsPayload();
  el.input.value = "";
  autoGrow();
  state.attachments = [];
  renderAttachments();
  updateSendButton();
  await deliverPrompt({ text, files, delivery, command: text.startsWith("/") });
}

const deviceOffline = () => {
  try {
    return navigator.onLine === false;
  } catch {
    return false;
  }
};

/**
 * Every prompt goes through here, so duplicate protection and the "did the
 * server get it?" question have exactly one answer.
 *
 * A dropped connection during POST /prompt is ambiguous: the server may have
 * accepted the message before the socket died. It is therefore never resent
 * automatically. Instead the transcript keeps a card that lets the user check,
 * resend once, or discard.
 */
async function deliverPrompt({ text, files = [], delivery = "steer", synthetic = false, command = false }) {
  if (!state.session || !state.api) return;
  if (state.sending) {
    toast("Still sending the last message");
    return;
  }
  if (!state.online) {
    toast(deviceOffline() ? "You are offline — reconnect first" : "Not connected to the server");
    return;
  }
  const sid = state.session.id;
  const localId = "local_" + Date.now() + Math.random().toString(36).slice(2, 6);
  const record = {
    id: localId,
    sessionID: sid,
    text,
    files,
    delivery,
    synthetic,
    at: Date.now(),
    status: "sending",
    error: "",
  };
  state.pendingPrompt = record;
  state.sending = true;
  if (!synthetic) {
    state.messages.push({
      id: localId,
      type: "user",
      text,
      files: (files ?? []).map((f) => ({ uri: f.uri, name: f.name, mime: "image/jpeg" })),
      time: { created: record.at },
    });
    renderMessages(true);
    scrollToBottom(true);
  }
  setBusy(true);
  setPhase("thinking");
  try {
    if (command && text.startsWith("/")) {
      const match = text.match(/^\/(\S+)\s*([\s\S]*)$/);
      await state.api.command(sid, { name: match?.[1] ?? "help", text: match?.[2] ?? "", files });
    } else {
      await state.api.prompt(sid, { text, files, delivery });
    }
    record.status = "accepted";
    state.pendingPrompt = null;
    haptic(6);
    if (delivery === "queue") {
      toast("Queued — runs after this turn");
      loadInbox().catch(() => {});
    }
    setTimeout(() => {
      if (state.session?.id !== sid) return;
      state.messages = state.messages.filter((m) => m.id !== localId);
      loadMessages().catch(() => {});
    }, 800);
  } catch (err) {
    const ambiguous = !err?.status || err.status === 0 || err.retryable;
    if (!ambiguous) {
      // A clear refusal: the message was not accepted, so undo the bubble and
      // put the text back where the user can fix it.
      state.pendingPrompt = null;
      state.messages = state.messages.filter((m) => m.id !== localId);
      if (!synthetic) {
        el.input.value = text;
        autoGrow();
        updateSendButton();
      }
      setBusy(false);
      renderMessages(true);
      handleError(err, "Message failed");
      return;
    }
    record.status = "unknown";
    record.error = err?.message || "The server did not answer";
    setBusy(false);
    renderMessages(true);
    haptic(18);
  } finally {
    state.sending = false;
    updateSendButton();
  }
}

async function checkPendingPrompt({ quiet = false } = {}) {
  const pending = state.pendingPrompt;
  if (!pending || !state.api) return false;
  await loadMessages().catch(() => {});
  const found = state.messages.some(
    (m) => m.type === "user" && m.text === pending.text && (m.time?.created ?? 0) >= pending.at - 5000
  );
  if (found) {
    state.pendingPrompt = null;
    renderMessages(true);
    if (!quiet) toast("The server received it");
    return true;
  }
  if (!quiet) toast("Not on the server yet");
  return false;
}

async function resendPendingPrompt() {
  const pending = state.pendingPrompt;
  if (!pending || state.sending) return;
  state.pendingPrompt = null;
  state.messages = state.messages.filter((m) => m.id !== pending.id);
  renderMessages(true);
  await deliverPrompt({ text: pending.text, files: pending.files, delivery: pending.delivery, synthetic: pending.synthetic });
}

function discardPendingPrompt() {
  const pending = state.pendingPrompt;
  if (!pending) return;
  state.pendingPrompt = null;
  state.messages = state.messages.filter((m) => m.id !== pending.id);
  renderMessages(true);
  toast("Discarded");
}

async function interrupt() {
  if (!state.session) return;
  if (state.stopping) return;
  if (!state.online) {
    toast("Can't reach the server to stop — reconnect and try again");
    return;
  }
  state.stopping = true;
  const sid = state.session.id;
  try {
    await state.api.interrupt(sid);
    haptic(14);
    toast("Stopping…");
    // If no idle arrives, ask the server whether the run is still open.
    setTimeout(() => {
      if (state.session?.id === sid && state.busy) verifyTurn().catch(() => {});
    }, 6000);
  } catch (err) {
    state.stopping = false;
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
/**
 * A sheet that belongs to a conversation used to do nothing at all when no
 * session was open: the row was there, the tap was swallowed, and the app looked
 * broken. Say why, and offer the way forward.
 */
function needsSession(title, reason) {
  openSheet({
    kind: "needs-session",
    title,
    body: (root) => {
      root.innerHTML = `<p class="sheet-note">Start a session first — ${escapeHtml(reason)}</p>
        <button class="btn btn-primary btn-block" id="need-session-new" style="margin-top:14px">New session</button>`;
      root.addEventListener("click", (e) => {
        if (!e.target.closest("#need-session-new")) return;
        closeSheet();
        openNewSession();
      });
    },
  });
}

function openFindSheet() {
  if (!state.session) return needsSession("Find", "search runs over the conversation you have open.");
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
  paintArtifactDiagrams();
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
  state.artifactClosing = false;
  el.artifact.hidden = false;
  renderArtifact();
  haptic(8);
  history.pushState({ artifact: true }, "");
}

function closeArtifact(fromPop = false) {
  // The DOM is the source of truth for "is it visible". If a history step was
  // consumed elsewhere, state.artifact can be null while the panel is still up;
  // hiding it is always the right outcome.
  const visible = el.artifact && !el.artifact.hidden;
  if (!fromPop) {
    // Same async-history guard as the sheet: one pop per close.
    if ((!state.artifact && !visible) || state.artifactClosing) return;
    state.artifactClosing = true;
    history.back();
    return;
  }
  if (!state.artifact && !visible && !state.artifactClosing) return;
  state.artifactClosing = false;
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
        ${a.doc ? sheetRow({ iconName: "download", title: "Export HTML", sub: "One file, no dependencies", attrs: "data-aact=export-html" }) : ""}
        ${a.doc ? sheetRow({ iconName: "print", title: "Print / Save as PDF", sub: "Opens the system print dialog", attrs: "data-aact=print" }) : ""}
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
        if (act === "export-html" && a.doc) {
          const title = a.title || documentTitleOf(a.doc);
          const html = buildStandaloneHtml({ title, markdown: a.doc, meta: artifactSubtitle(a) });
          downloadText(exportName(title, "html"), html, "text/html");
        }
        if (act === "print" && a.doc) {
          const title = a.title || documentTitleOf(a.doc);
          printMarkdownDoc(a.doc, { title, meta: artifactSubtitle(a) });
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
  if (!state.session) return needsSession("Mention a file", "the file list comes from the workspace of the session you are in.");
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
        // An empty query is not an empty screen: show a short list so the
        // sheet is useful the moment it opens, then narrow as you type.
        list.innerHTML = '<p class="sheet-note">' + (query ? "Searching..." : "Loading files...") + "</p>";
        let hits = [];
        try {
          hits = await state.api.findFiles(query, { directory: workspaceDir(), limit: query ? 60 : 20 });
        } catch (err) {
          if (mine === token) list.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Search failed") + "</p>";
          return;
        }
        if (mine !== token) return;
        if (!hits.length) {
          list.innerHTML = query
            ? '<p class="sheet-note">No files match \u201c' + escapeHtml(query) + "\u201d.</p>"
            : '<p class="sheet-note">Start typing to search this workspace.</p>';
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

      if (initial) input.value = initial;
      search(initial);
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
  if (!state.session) return needsSession("Skills", "a skill loads its instructions into the session you are in.");
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

/* ------------------------------------------------------- account connections
 * The server owns credentials; Pocket only shows what it can connect and posts
 * the answer. Nothing here stores a key, and nothing here is sent anywhere but
 * the local server. The OAuth attempt is a two-step dance: start it, open the
 * URL in the browser, then confirm with the pasted code.
 */

const methodLabel = (m) => {
  if (m.label) return m.label;
  if (m.type === "key") return "API key";
  if (m.type === "oauth") return "Sign in with a browser";
  if (m.type === "command") return "Connect with a command";
  if (m.type === "env") return "Uses environment variables";
  if (m.type === "external") return "Connect externally";
  return m.type ?? "Connect";
};

const connectedLabel = (conn) => {
  if (!conn) return "";
  if (conn.type === "credential") return "Connected";
  if (conn.type === "env") return "From the host environment";
  return conn.type ?? "Connected";
};

/* ------------------------------------------------- provider catalog (models.dev) */

const PROVIDER_COLORS = {
  opencode: "#f5f5f5", anthropic: "#d97757", openai: "#10a37f", google: "#4285f4",
  "google-vertex": "#4285f4", deepseek: "#4d6bfe", openrouter: "#6366f1", groq: "#f55036",
  mistral: "#ff7000", xai: "#ffffff", cerebras: "#7c3aed", togetherai: "#e11d48",
  huggingface: "#ffd21e", lmstudio: "#20b2aa", "amazon-bedrock": "#ff9900",
  azure: "#0078d4", "github-copilot": "#ffffff", "cloudflare-workers-ai": "#f6821f",
};

let catalogPromise = null;
function providerCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch("https://models.dev/api.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("catalog unavailable"))))
      .catch((e) => { catalogPromise = null; throw e; });
  }
  return catalogPromise;
}

const freeModels = (p) => Object.entries(p?.models ?? {}).filter(([, m]) => {
  const c = m?.cost;
  return c && Number(c.input ?? 0) === 0 && Number(c.output ?? 0) === 0;
});

async function openProviderCatalog() {
  openSheet({
    kind: "catalog",
    title: "Provider catalog",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading models.dev catalog...</p>';
      let catalog;
      let avail = { active: new Set(), byId: new Map() };
      try {
        [catalog, avail] = await Promise.all([providerCatalog(), providerAvailability()]);
      } catch {
        root.innerHTML = '<p class="sheet-note">Could not load the provider catalog (offline). Saved connections still work.</p>';
        return;
      }
      const ids = Object.keys(catalog).sort((a, b) => {
        const ca = avail.active.has(a) ? 1 : 0;
        const cb = avail.active.has(b) ? 1 : 0;
        if (ca !== cb) return cb - ca; // connected providers first
        const fa = freeModels(catalog[a]).length;
        const fb = freeModels(catalog[b]).length;
        return fb - fa || catalog[a].name.localeCompare(catalog[b].name);
      });
      // Cards report what this server can reach, not what exists in the world.
      const card = (id) => {
        const p = catalog[id];
        const free = freeModels(p);
        const color = PROVIDER_COLORS[id] ?? "#9aa0a6";
        const ready = avail.active.has(id);
        const live = avail.models.filter((m) => m.providerID === id);
        const saved = !ready && avail.configured.has(id);
        const sub = ready
          ? live.length + " model" + (live.length === 1 ? "" : "s") + " ready on this server"
          : saved
            ? "Saved, but the server serves no models for it"
            : "Needs a key or sign-in";
        return "<button class=\"catalog-card" + (ready ? " connected" : "") + "\" data-catalog=\"" + escapeHtml(id) + "\">" +
          "<img src=\"https://models.dev/logos/" + encodeURIComponent(id) + ".svg\" alt=\"\" style=\"color:" + escapeHtml(color) + "\" />" +
          "<span class=\"catalog-text\"><span class=\"catalog-name\">" + escapeHtml(p.name ?? id) + "</span>" +
          "<span class=\"catalog-sub\">" + escapeHtml(sub) + "</span></span>" +
          (ready ? "<span class=\"catalog-free\">READY</span>" : free.length ? "<span class=\"catalog-free ghost\">FREE</span>" : "") +
          "</button>";
      };
      root.innerHTML = "<div class=\"sheet-search\"><div class=\"search-box\">" + icon("search") +
        "<input class=\"search-input\" id=\"catalog-search\" placeholder=\"Search providers\" autocomplete=\"off\" /></div></div>" +
        "<p class=\"sheet-note\" style=\"margin:8px 2px 10px\">Models appear once the provider is connected. READY means this server can run it now.</p>" +
        "<div id=\"catalog-list\" class=\"catalog-list\">" + ids.map(card).join("") + "</div>" +
        "<div id=\"catalog-models\" class=\"catalog-models\" hidden></div>";
      const list = $("#catalog-list", root);
      const models = $("#catalog-models", root);
      $("#catalog-search", root).addEventListener("input", (e) => {
        const q = e.target.value.toLowerCase().trim();
        list.innerHTML = ids.filter((id) => !q || (catalog[id].name ?? id).toLowerCase().includes(q)).map(card).join("");
      });
      list.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-catalog]");
        if (!btn) return;
        const id = btn.dataset.catalog;
        const p = catalog[id];
        const name = p.name ?? id;
        // Not ready: offer the real connection flow instead of a model the
        // server cannot serve.
        if (!avail.active.has(id)) {
          const hasFlow = !!avail.byId.get(id);
          models.hidden = false;
          models.innerHTML =
            "<p class=\"sheet-note\">" + escapeHtml(name) + (avail.configured.has(id)
              ? " has a saved key, but this server serves no models for it. Reconnect or check the key."
              : " is not connected, so its models are not available to this server yet.") + "</p>" +
            (hasFlow
              ? "<button class=\"btn btn-primary btn-block\" data-catalog-connect=\"" + escapeHtml(id) + "\">Connect " + escapeHtml(name) + "</button>"
              : "<p class=\"sheet-note\">This provider is configured outside Pocket - add its key where OpenCode runs.</p>");
          models.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return;
        }
        // Ready: list the models the server actually handed out, not the
        // catalog's idea of the provider.
        const rows = avail.models
          .filter((m) => m.providerID === id)
          .map((m) =>
            "<button class=\"sheet-item\" data-catalog-model=\"" + escapeHtml(id + "/" + m.id) + "\">" +
            "<span class=\"si-text\"><span class=\"si-title\">" + escapeHtml(m.name ?? m.id) + "</span>" +
            "<span class=\"si-sub\">" + escapeHtml(m.id) + (m.limit?.context ? " · " + Math.round(m.limit.context / 1000) + "k ctx" : "") + "</span></span></button>")
          .join("");
        models.hidden = false;
        models.innerHTML = "<p class=\"sheet-note\">" + escapeHtml(name) + " · " + avail.models.filter((m) => m.providerID === id).length + " models on this server</p>" + rows;
        models.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      models.addEventListener("click", async (e) => {
        const connect = e.target.closest("[data-catalog-connect]");
        if (connect) {
          closeSheet();
          setTimeout(() => openAuthSheet(connect.dataset.catalogConnect), 200);
          return;
        }
        const btn = e.target.closest("[data-catalog-model]");
        if (!btn) return;
        const ref = btn.dataset.catalogModel;
        // Only models the server actually lists may become the default.
        let live = [];
        try {
          live = (await ensureModels()) ?? [];
        } catch (_) {
          /* fall through with an empty list */
        }
        const [prov, ...rest] = ref.split("/");
        const wantID = rest.join("/");
        const ok = live.some((m) => m.providerID === prov && m.id === wantID);
        if (!ok) {
          toast("Connect " + prov + " first - its models are not on this server");
          return;
        }
        store.set("defaultModel", ref);
        if (state.session) await state.api.switchModel(state.session.id, ref).catch(() => {});
        toast("Default model · " + ref);
        closeSheet();
      });
    },
  });
}

/* ------------------------------------------------------- session tabs */

function tabs() {
  return store.get("sessionTabs", []) ?? [];
}

function setTabs(list) {
  store.set("sessionTabs", list.slice(0, 6));
  renderTabs();
}

function renderTabs() {
  const box = $("#session-tabs");
  if (!box) return;
  const list = tabs();
  box.hidden = list.length < 2;
  if (box.hidden) { box.innerHTML = ""; return; }
  box.innerHTML = list
    .map((id) => {
      const s = state.sessions.find((x) => x.id === id);
      if (!s) return "";
      const active = state.session?.id === id;
      return `<button class="session-tab${active ? " active" : ""}" data-tab="${escapeHtml(id)}">
        <span>${escapeHtml((s.title || "Untitled").slice(0, 22))}</span>
        <i data-tab-close="${escapeHtml(id)}" aria-label="Close tab">×</i>
      </button>`;
    })
    .join("");
}

function addTab(session) {
  const list = tabs().filter((id) => id !== session.id);
  list.unshift(session.id);
  setTabs(list);
}

function closeTab(id) {
  const list = tabs().filter((x) => x !== id);
  setTabs(list);
  if (state.session?.id === id) {
    const next = list[0] ? state.sessions.find((s) => s.id === list[0]) : null;
    if (next) openSession(next);
    else closeChat(false);
  }
}

/* --------------------------------------------------- images + worktrees */

function openImagesSheet() {
  openSheet({
    kind: "images",
    title: "Images",
    body: (root) => {
      if (!state.session) {
        root.innerHTML = `<p class="sheet-note">Start a session first — photos you attach live in the messages that carried them.</p>`;
        return;
      }
      // Photos you attached, straight from the transcript. Generated pages and
      // diagrams are artifacts, and they live in Library.
      const shots = [];
      for (const m of state.messages ?? []) {
        if (m.type !== "user") continue;
        for (const f of m.files ?? []) {
          const src = fileSrc(f);
          if (!src) continue;
          if (f.mime && !/^image\//.test(f.mime) && !src.startsWith("data:image")) continue;
          shots.push({ src, name: f.name || "Image" });
        }
      }
      root.innerHTML = shots.length
        ? `<div class="image-grid">${shots
            .map(
              (s) =>
                `<a class="image-thumb" href="${escapeHtml(s.src)}" target="_blank" rel="noopener">${icon("image")}<span>${escapeHtml(s.name)}</span></a>`
            )
            .join("")}</div>`
        : `<p class="sheet-note">No images in this conversation yet. Attach one from the composer; generated pages and diagrams appear in Library.</p>
           <div class="prefs-foot"><button class="btn btn-ghost" id="image-attach">Attach an image</button></div>`;
      root.addEventListener("click", (e) => {
        if (e.target.closest("#image-attach")) {
          closeSheet();
          $("#btn-attach")?.click();
        }
      });
    },
  });
}

/** Every artifact this conversation produced: pages, diagrams, diffs, code, docs. */
function openLibrarySheet() {
  if (!state.session) return needsSession("Library", "artifacts belong to the conversation that produced them.");
  openSheet({
    kind: "library",
    title: "Library",
    body: (root) => {
      const items = state.artifacts ?? [];
      if (!items.length) {
        root.innerHTML = `<p class="sheet-note">Nothing in the library yet. When the agent writes a file, a page, a diagram or a long document, it lands here as well as in the transcript.</p>`;
        return;
      }
      const iconFor = { html: "image", diagram: "image", diff: "diff", code: "code", doc: "book" };
      root.innerHTML = `<div class="sheet-list">${items
        .map(
          (a) => `<button class="sheet-item" data-lib-open="${escapeHtml(a.id)}">
            <span class="si-icon">${icon(iconFor[a.kind] ?? "file")}</span>
            <span class="si-text"><span class="si-title">${escapeHtml(a.title || a.kind)}</span>
            <span class="si-sub">${escapeHtml(a.kind)}${a.language ? " · " + escapeHtml(a.language) : ""}${a.lines ? " · " + a.lines + " lines" : ""}</span></span>
          </button>`
        )
        .join("")}</div>`;
      root.addEventListener("click", (e) => {
        const b = e.target.closest("[data-lib-open]");
        if (!b) return;
        const art = (state.artifacts ?? []).find((x) => x.id === b.dataset.libOpen);
        if (art) {
          closeSheet();
          openArtifact(art);
        }
      });
    },
  });
}

/** Projects the server knows about, with a way into each one. */
async function openProjectsSheet() {
  openSheet({
    kind: "projects",
    title: "Projects",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading projects...</p>';
      let list = [];
      try {
        list = await ensureProjects();
      } catch (err) {
        root.innerHTML = `<p class="sheet-note">${escapeHtml(err.message || "Could not load projects")}</p>`;
        return;
      }
      list = [...list].sort((a, b) => (b.time?.active ?? 0) - (a.time?.active ?? 0));
      if (!list.length) {
        root.innerHTML = '<p class="sheet-note">No projects yet. A project appears here once a session runs in one of its workspaces.</p>';
        return;
      }
      const count = (dir) => (state.sessions ?? []).filter((s) => s.location?.directory === dir).length;
      root.innerHTML = `<div class="sheet-list">${list
        .map(
          (p) => `<button class="sheet-item" data-project="${escapeHtml(p.canonical ?? "")}">
            <span class="si-icon">${icon("folder")}</span>
            <span class="si-text"><span class="si-title">${escapeHtml(basename(p.canonical ?? "") || "project")}</span>
            <span class="si-sub">${escapeHtml(p.canonical ?? "")} · ${count(p.canonical)} chats</span></span>
          </button>`
        )
        .join("")}</div>`;
      root.addEventListener("click", (e) => {
        const b = e.target.closest("[data-project]");
        if (!b || !b.dataset.project) return;
        // Open the new-session sheet pointed at this workspace.
        store.set("lastDir", b.dataset.project);
        closeSheet();
        setTimeout(() => openNewSession(), 220);
      });
    },
  });
}

async function openWorktreesSheet() {
  openSheet({
    kind: "worktrees",
    title: "Worktrees",
    body: async (root) => {
      // Worktrees are per project. The open session names one; otherwise use the
      // most recently active project instead of sending `projectID=undefined`.
      let projectID = state.session?.projectID ?? null;
      let projectDir = state.session?.location?.directory ?? "";
      if (!projectID) {
        try {
          const projects = [...(await ensureProjects())].sort((a, b) => (b.time?.active ?? 0) - (a.time?.active ?? 0));
          projectID = projects[0]?.id ?? null;
          projectDir = projects[0]?.canonical ?? projectDir;
        } catch (_) {
          /* the empty state below is the honest answer */
        }
      }
      if (!projectID) {
        root.innerHTML = '<p class="sheet-note">No project yet. Worktrees belong to a project, so start a session in a workspace first.</p>';
        return;
      }
      root.innerHTML = '<p class="sheet-note">Loading worktrees…</p>';
      try {
        const list = await state.api.worktrees(projectID);
        root.innerHTML = list.length
          ? `<p class="sheet-note">${escapeHtml(projectDir || "project")}</p><div class="sheet-list">` +
            list
              .map((w) => {
                const dir = w.path ?? w.directory ?? "";
                const name = w.name || basename(dir) || w.branch || "worktree";
                return `<button class="sheet-item" data-wt-open="${escapeHtml(dir)}"${dir ? "" : " disabled"}>
                <span class="si-icon">${icon("branch")}</span>
                <span class="si-text"><span class="si-title">${escapeHtml(name)}</span>
                <span class="si-sub">${escapeHtml(w.branch || dir || "")}${w.dirty ? " · uncommitted changes" : ""}</span></span>
              </button>`;
              })
              .join("") +
            "</div>"
          : `<p class="sheet-note">No worktrees for ${escapeHtml(basename(projectDir) || "this project")} yet.</p>`;
        root.addEventListener("click", (e) => {
          const b = e.target.closest("[data-wt-open]");
          if (!b || !b.dataset.wtOpen) return;
          // A worktree is a workspace: open the new-session sheet pointed at it.
          store.set("lastDir", b.dataset.wtOpen);
          closeSheet();
          setTimeout(() => openNewSession(), 220);
        });
      } catch (err) {
        root.innerHTML = `<p class="sheet-note">${escapeHtml(err.message || "Could not load worktrees")}</p>`;
      }
    },
  });
}

function openCustomizeSheet() {
  openSheet({
    kind: "customize",
    title: "Customize",
    body: (root) => {
      root.innerHTML = `<p class="sheet-note">OpenCode's own configuration, not a parallel copy.</p>
        <div class="sheet-list">
          ${sheetRow({ iconName: "cpu", title: "Models", sub: "Default, per-session, variants", attrs: "data-cust=models" })}
          ${sheetRow({ iconName: "key", title: "Providers", sub: "Catalog, connections, custom", attrs: "data-cust=providers" })}
          ${sheetRow({ iconName: "spark", title: "Agents", sub: "Build, plan, general, explore", attrs: "data-cust=agents" })}
          ${sheetRow({ iconName: "shield", title: "Permissions", sub: "Saved allow rules", attrs: "data-cust=permissions" })}
          ${sheetRow({ iconName: "book", title: "Skills", sub: "Available instructions", attrs: "data-cust=skills" })}
          ${sheetRow({ iconName: "code", title: "Commands", sub: "Server command registry", attrs: "data-cust=commands" })}
          ${sheetRow({ iconName: "file", title: "Instructions", sub: "AGENTS.md entries", attrs: "data-cust=instructions" })}
          ${sheetRow({ iconName: "settings", title: "Appearance", sub: "Theme, accent, text, code", attrs: "data-cust=appearance" })}
        </div>`;
      root.addEventListener("click", (e) => {
        const b = e.target.closest("[data-cust]");
        if (!b) return;
        const what = b.dataset.cust;
        if (what === "models") return openModelSheet();
        if (what === "providers") return openProviderCatalog();
        if (what === "agents") return openAgentSheet();
        if (what === "permissions") return openSavedPermissionsSheet();
        if (what === "skills") return openSkillSheet();
        if (what === "commands") return openCommandPalette();
        if (what === "instructions") return openInstructionsSheet();
        if (what === "appearance") return openPrefsStudio();
      });
    },
  });
}

/* --------------------------------------------------- schedules, instructions, plugins */

async function openSchedulesSheet() {
  openSheet({
    kind: "schedules",
    title: "Scheduled tasks",
    body: async (root) => {
      if (!state.session) {
        root.innerHTML = '<p class="sheet-note">Scheduled tasks run inside a session. Open one first, then schedule a prompt against it.</p>';
        return;
      }
      root.innerHTML = '<p class="sheet-note">Loading schedules…</p>';
      let list = [];
      try {
        const res = await state.api.schedules(state.session.id);
        list = res?.data ?? res ?? [];
      } catch (err) {
        root.innerHTML = `<p class="sheet-note">${escapeHtml(err.message || "Could not load schedules")}</p>`;
        return;
      }
      const rows = (list ?? [])
        .map((s) => {
          const active = /active|scheduled|running/i.test(String(s.status));
          const when = s.when?.every ? `every ${s.when.every}` : s.when?.cron ? `cron ${s.when.cron}` : s.when?.at ? `at ${s.when.at}` : "—";
          return `<div class="sched-row">
            <div class="sched-main"><b>${escapeHtml(s.name || "Scheduled prompt")}</b>
            <span>${escapeHtml(when)} · ${escapeHtml(String(s.status ?? ""))}${s.nextDueAt ? " · next " + new Date(s.nextDueAt).toLocaleString() : ""}</span>
            <em>${escapeHtml(String(s.prompt ?? s.action?.prompt ?? "").slice(0, 90))}</em></div>
            <div class="sched-actions">
              <button data-sched-toggle="${escapeHtml(s.id)}" data-active="${active}">${active ? "Pause" : "Resume"}</button>
              <button data-sched-delete="${escapeHtml(s.id)}">Remove</button>
            </div></div>`;
        })
        .join("") || '<p class="sheet-note">No schedules yet.</p>';

      root.innerHTML = `<div class="sheet-list">${rows}</div>
        <div class="sched-new">
          <div class="prefs-head">New schedule</div>
          <label class="field"><span class="label">Name</span><input class="input" id="sched-name" placeholder="Nightly review"></label>
          <div class="seg" id="sched-kind"><button data-k="every" class="on">Every</button><button data-k="at">At</button><button data-k="cron">Cron</button></div>
          <label class="field"><span class="label" id="sched-when-label">Duration (e.g. 2 hours)</span><input class="input" id="sched-when" placeholder="2 hours"></label>
          <label class="field"><span class="label">Prompt</span><input class="input" id="sched-prompt" placeholder="Review the open changes"></label>
          <button class="btn btn-primary btn-block" id="sched-create" style="margin-top:8px">Create schedule</button>
        </div>`;

      let kind = "every";
      $("#sched-kind", root).addEventListener("click", (e) => {
        const b = e.target.closest("[data-k]");
        if (!b) return;
        kind = b.dataset.k;
        for (const n of $$("#sched-kind button", root)) n.classList.toggle("on", n === b);
        $("#sched-when-label", root).textContent =
          kind === "every" ? "Duration (e.g. 2 hours)" : kind === "at" ? "When (ISO date/time)" : "Cron expression";
        $("#sched-when", root).placeholder =
          kind === "every" ? "2 hours" : kind === "at" ? "2026-11-18T09:00:00+05:30" : "0 9 * * *";
      });
      root.addEventListener("click", async (e) => {
        const toggle = e.target.closest("[data-sched-toggle]");
        if (toggle) {
          try {
            if (toggle.dataset.active === "true") await state.api.pauseSchedule(toggle.dataset.schedToggle);
            else await state.api.resumeSchedule(toggle.dataset.schedToggle);
            openSchedulesSheet();
          } catch (err) { handleError(err, "Could not change schedule"); }
          return;
        }
        const del = e.target.closest("[data-sched-delete]");
        if (del) {
          try { await state.api.deleteSchedule(del.dataset.schedDelete); openSchedulesSheet(); }
          catch (err) { handleError(err, "Could not remove schedule"); }
          return;
        }
        if (e.target.closest("#sched-create")) {
          if (!state.session) return toast("Open a session first");
          const prompt = $("#sched-prompt", root).value.trim();
          const value = $("#sched-when", root).value.trim();
          if (!prompt || !value) return toast("Prompt and timing are required");
          const when = kind === "every" ? { every: value } : kind === "at" ? { at: value } : { cron: value };
          try {
            await state.api.createSchedule({
              sessionID: state.session.id,
              name: $("#sched-name", root).value.trim() || "Scheduled prompt",
              when,
              prompt,
            });
            toast("Schedule created");
            openSchedulesSheet();
          } catch (err) { handleError(err, "Could not create schedule"); }
        }
      });
    },
  });
}

async function openInstructionsSheet() {
  openSheet({
    kind: "instructions",
    title: "Instructions",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading instructions…</p>';
      if (!state.session) { root.innerHTML = '<p class="sheet-note">Open a session first.</p>'; return; }
      try {
        const res = await state.api.instructions(state.session.id);
        const entries = res?.data ?? res ?? [];
        root.innerHTML = entries.length
          ? entries.map((e) => `<div class="instr-card"><b>${escapeHtml(e.key || e.name || "Instructions")}</b>
              <span>${escapeHtml(e.source ?? "")}${e.tokens ? " · " + e.tokens + " tokens" : ""}</span>
              <pre>${escapeHtml(String(e.content ?? "").slice(0, 4000))}</pre></div>`).join("")
          : '<p class="sheet-note">No instructions for this session.</p>';
      } catch (err) {
        root.innerHTML = `<p class="sheet-note">${escapeHtml(err.message || "Could not load instructions")}</p>`;
      }
    },
  });
}

async function openPluginsSheet() {
  openSheet({
    kind: "plugins",
    title: "Plugins",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading plugins…</p>';
      try {
        const res = await state.api.plugins();
        const list = res?.data ?? res ?? [];
        root.innerHTML = list.length
          ? `<div class="sheet-list">` + list.map((p) => `<div class="sheet-item"><span class="si-icon">${icon("plug")}</span><span class="si-text">
              <span class="si-title">${escapeHtml(p.id)}</span>
              <span class="si-sub">${escapeHtml(p.source?.type ?? "plugin")}${p.state?.status ? " · " + escapeHtml(String(p.state.status)) : ""}</span></span></div>`).join("") + `</div>`
          : '<p class="sheet-note">This server reports no plugins.</p>';
      } catch (err) {
        root.innerHTML = `<p class="sheet-note">${escapeHtml(err.message || "Could not load plugins")}</p>`;
      }

      root.insertAdjacentHTML("beforeend", '<div class="prefs-foot"><button class="btn btn-ghost" id="plugins-mcp">MCP servers</button></div>');
      root.addEventListener("click", (e) => {
        if (!e.target.closest("#plugins-mcp")) return;
        closeSheet();
        setTimeout(() => openMcpSheet(), 200);
      });
    },
  });
}

/* -------------------------------------------------------- updates */

function openUpdatesSheet() {
  const native = window.PocketNative;
  openSheet({
    kind: "updates",
    title: "Updates",
    body: (root) => {
      const installed = native?.updateState ? JSON.parse(native.updateState()).installed : "web";
      const engineVersion = state.info?.version ?? "—";
      root.innerHTML = `
        <div class="updates-card">
          <div class="updates-head"><span>Pocket app</span><b>${escapeHtml(installed)}</b></div>
          <div class="updates-sub" id="apk-latest">Not checked</div>
          <div class="updates-notes" id="apk-notes" hidden></div>
          <div class="updates-actions">
            <button class="btn btn-ghost" id="apk-check">Check</button>
            <button class="btn btn-primary" id="apk-download" hidden>Download</button>
            <button class="btn btn-primary" id="apk-install" hidden>Install</button>
          </div>
          <div class="updates-progress" id="apk-progress" hidden><i></i></div>
        </div>
        <div class="updates-card">
          <div class="updates-head"><span>OpenCode engine</span><b>${escapeHtml(engineVersion)}</b></div>
          <div class="updates-sub">${state.demo ? "Demo mode" : escapeHtml(native?.runtimeInfo ? JSON.parse(native.runtimeInfo()).mode : "web")} runtime</div>
          <div class="updates-actions">
            <button class="btn btn-ghost" id="engine-restart">Restart OpenCode</button>
            <button class="btn btn-ghost" id="engine-help">Update command</button>
          </div>
        </div>
        ${native ? "" : '<p class="sheet-note">App updates need the Android app. The engine version is read from your server.</p>'}`;

      $("#apk-check", root)?.addEventListener("click", () => {
        if (!native?.checkApkUpdate) return toast("Only in the Android app");
        const r = JSON.parse(native.checkApkUpdate());
        $("#apk-latest", root).textContent = r.available
          ? `Latest: ${r.latest}`
          : `Latest: ${r.latest || r.installed} · ${r.message}`;
        if (r.notes) {
          const n = $("#apk-notes", root);
          n.hidden = false;
          n.textContent = r.notes.slice(0, 1200);
        }
        if (r.available) {
          $("#apk-download", root).hidden = false;
          $("#apk-download", root).onclick = () => {
            if (!native.downloadApkUpdate()) return toast("Download did not start");
            $("#apk-progress", root).hidden = false;
            const bar = $("#apk-progress i", root);
            const poll = setInterval(() => {
              const st = JSON.parse(native.updateState());
              bar.style.width = st.progress + "%";
              if (!st.busy) {
                clearInterval(poll);
                $("#apk-latest", root).textContent = st.status;
                if (st.progress >= 100) $("#apk-install", root).hidden = false;
              }
            }, 700);
          };
        }
      });
      $("#apk-install", root)?.addEventListener("click", () => {
        const ok = native?.installApkUpdate?.();
        toast(ok ? "Opening the installer" : "Update could not be installed");
      });
      $("#engine-restart", root)?.addEventListener("click", () => {
        const ok = native?.restartRuntime?.();
        toast(ok ? "Restarting OpenCode…" : "Only in the Android app");
      });
      $("#engine-help", root)?.addEventListener("click", () => {
        const mode = native?.runtimeInfo ? JSON.parse(native.runtimeInfo()).mode : "termux";
        openSheet({
          kind: "engine-update",
          title: "Update OpenCode",
          body: (r2) => {
            r2.innerHTML = mode === "embedded"
              ? `<p class="sheet-note">The bundled engine ships inside the Pocket app. Install the app update above, then tap Restart OpenCode.</p>`
              : `<p class="sheet-note">Run this inside Termux. Pocket does not run Debian commands itself.</p>
                 <pre class="tool-pre">oc shell
opencode upgrade
exit</pre>
                 <p class="sheet-note">Then run <b>Restart OpenCode</b>. Sessions, config and credentials are kept.</p>`;
          },
        });
      });
    },
  });
}

/* -------------------------------------------------------- connections */

async function openAuthSheet(focus = null) {
  openSheet({
    kind: "auth",
    title: focus ? "Connect" : "Connections",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading providers and saved credentials…</p>';
      let list = [];
      let creds = [];
      try {
        [list, creds] = await Promise.all([state.api.integrations(), state.api.credentials()]);
      } catch (err) {
        root.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Could not load connections") + "</p>";
        return;
      }
      if (!list.length) {
        root.innerHTML = '<p class="sheet-note">This server reports no connectable integrations. Its providers may use keys from the host environment.</p>';
        return;
      }
      // Opened from the catalog for one provider: show only that provider's
      // methods, so the path from "Needs a key" to "connected" is one tap.
      if (focus) {
        const one = list.find((x) => x.id === focus);
        if (!one) {
          root.innerHTML = '<p class="sheet-note">This provider is not connectable from this server. Add its key where OpenCode runs.</p>';
          return;
        }
        list = [one];
        el.sheetTitle.textContent = "Connect " + (one.name || one.id);
      }
      const credById = new Map(creds.map((c) => [c.id, c]));
      const byIntegration = new Map();
      for (const c of creds) {
        const k = c.integrationID;
        if (!byIntegration.has(k)) byIntegration.set(k, []);
        byIntegration.get(k).push(c);
      }

      const paint = () => {
        root.innerHTML =
          '<p class="sheet-note">Sign in to use more models. Keys stay on your server; Pocket never stores them.</p><div class="sheet-list">' +
          list
            .map((it) => {
              const conns = it.connections ?? [];
              const saved = byIntegration.get(it.id) ?? [];
              const status = conns.length ? conns.map(connectedLabel).join(", ") : "Not connected";
              const methods = (it.methods ?? [])
                .filter((m) => ["key", "oauth", "command", "external"].includes(m.type))
                .map(
                  (m, i) =>
                    `<button class="sheet-item auth-method" data-auth-method="${escapeHtml(it.id)}" data-method="${i}">` +
                    `<span class="si-icon">${icon(m.type === "oauth" ? "shield" : m.type === "command" ? "terminal" : "key")}</span>` +
                    `<span class="si-text"><span class="si-title">${escapeHtml(methodLabel(m))}</span></span>` +
                    `<span class="auth-go">Connect</span></button>`
                )
                .join("");
              const savedRows = saved
                .map(
                  (c) =>
                    `<div class="auth-cred"><span class="si-text">` +
                    `<span class="si-title">${escapeHtml(c.label || "Credential")}${c.active ? ' <span class="auth-active">active</span>' : ""}</span>` +
                    `<span class="si-sub">${escapeHtml(c.value?.type ?? "")}</span></span>` +
                    `<span class="auth-cred-actions">` +
                    (c.active
                      ? ""
                      : `<button data-cred-activate="${escapeHtml(c.id)}" aria-label="Activate">${icon("check")}</button>`) +
                    `<button data-cred-delete="${escapeHtml(c.id)}" aria-label="Delete">${icon("trash")}</button>` +
                    `</span></div>`
                )
                .join("");
              return (
                `<div class="auth-provider"><div class="auth-provider-head">` +
                `<span class="si-text"><span class="si-title">${escapeHtml(it.name || it.id)}</span>` +
                `<span class="si-sub">${escapeHtml(status)}</span></span></div>` +
                methods +
                savedRows +
                `</div>`
              );
            })
            .join("") +
          "</div>";

        root.querySelectorAll("[data-auth-method]").forEach((btn) => {
          btn.onclick = () => {
            const it = list.find((x) => x.id === btn.dataset.authMethod);
            const m = it?.methods?.[Number(btn.dataset.method)];
            if (it && m) startAuthMethod(it, m, paint);
          };
        });
        root.querySelectorAll("[data-cred-activate]").forEach((btn) => {
          btn.onclick = async () => {
            try {
              await state.api.activateCredential(btn.dataset.credActivate);
              toast("Credential activated");
              paint();
            } catch (err) {
              handleError(err, "Could not activate");
            }
          };
        });
        root.querySelectorAll("[data-cred-delete]").forEach((btn) => {
          btn.onclick = async () => {
            try {
              await state.api.deleteCredential(btn.dataset.credDelete);
              creds = creds.filter((c) => c.id !== btn.dataset.credDelete);
              byIntegration.set(
                btn.dataset.credDelete,
                (byIntegration.get(btn.dataset.credDelete) ?? []).filter((c) => c.id !== btn.dataset.credDelete)
              );
              // rebuild the grouping from the remaining credentials
              byIntegration.clear();
              for (const c of creds) {
                if (!byIntegration.has(c.integrationID)) byIntegration.set(c.integrationID, []);
                byIntegration.get(c.integrationID).push(c);
              }
              toast("Credential removed");
              paint();
            } catch (err) {
              handleError(err, "Could not remove");
            }
          };
        });
      };

      const startAuthMethod = async (integration, method, done) => {
        if (method.type === "key") {
          const form = method.form ?? [];
          const fields = form.map((f) => ({
            key: f.key,
            label: f.title || f.key,
            placeholder: f.placeholder || "",
            secret: true,
          }));
          // Most key integrations need one field; if the server sends no form,
          // fall back to a plain key input.
          if (!fields.length) fields.push({ key: "key", label: "API key", placeholder: "sk-…", secret: true });
          openSheet({
            kind: "key",
            title: `Connect ${integration.name || integration.id}`,
            body: (r) => {
              r.innerHTML =
                `<p class="sheet-note">The key is sent only to your local OpenCode server, which stores it. Pocket does not keep a copy.</p>` +
                fields
                  .map(
                    (f) =>
                      `<label class="field"><span class="field-label">${escapeHtml(f.label)}</span>` +
                      `<input class="input" data-key-field="${escapeHtml(f.key)}" type="password" placeholder="${escapeHtml(f.placeholder)}" autocomplete="off" spellcheck="false"></label>`
                  )
                  .join("") +
                `<label class="field"><span class="field-label">Label (optional)</span><input class="input" id="key-label" placeholder="e.g. personal"></label>` +
                `<div class="permission-actions"><button class="btn btn-ghost" data-cancel>Cancel</button>` +
                `<button class="btn btn-primary" data-save>Connect</button></div>`;
              r.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => closeSheet()));
              r.querySelector("[data-save]").onclick = async () => {
                const values = {};
                for (const f of fields) {
                  const v = r.querySelector(`[data-key-field="${CSS.escape(f.key)}"]`)?.value?.trim();
                  if (v) values[f.key] = v;
                }
                const key = values.key ?? Object.values(values)[0];
                if (!key) {
                  toast("Enter a key");
                  return;
                }
                const label = r.querySelector("#key-label")?.value?.trim() || null;
                try {
                  await state.api.connectKey(integration.id, key, { label, answer: Object.keys(values).length > 1 ? values : null });
                  toast("Connected");
                  closeSheet();
                  await refreshModelsAfterConnect(integration.name || integration.id);
                  setTimeout(() => openAuthSheet(), 240);
                } catch (err) {
                  handleError(err, "Could not connect");
                }
              };
            },
          });
          return;
        }

        if (method.type === "oauth") {
          try {
            const attempt = await state.api.connectOAuth(integration.id, method.id, {});
            const data = attempt?.data ?? attempt ?? {};
            const url = data.url;
            const aid = data.attemptID;
            if (!url || !aid) throw new Error("The server did not return a sign-in URL");
            window.open(url, "_blank", "noopener,noreferrer");
            openSheet({
              kind: "oauth",
              title: `Sign in to ${integration.name || integration.id}`,
              body: (r) => {
                r.innerHTML =
                  `<p class="sheet-note">${escapeHtml(data.instructions || "Open the browser window, sign in, then paste the code here.")}</p>` +
                  `<label class="field"><span class="field-label">Code from the browser</span>` +
                  `<input class="input" id="oauth-code" autocomplete="off" spellcheck="false" placeholder="Paste the code"></label>` +
                  `<div class="permission-actions"><button class="btn btn-ghost" data-cancel>Cancel</button>` +
                  `<button class="btn btn-primary" data-done>Finish</button></div>`;
                r.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => {
                  state.api.cancelOAuth(integration.id, aid).catch(() => {});
                  closeSheet();
                }));
                r.querySelector("[data-done]").onclick = async () => {
                  const code = r.querySelector("#oauth-code").value.trim();
                  try {
                    await state.api.completeOAuth(integration.id, aid, code || null);
                    toast("Signed in");
                    await refreshModelsAfterConnect(integration.name || integration.id);
                    closeSheet();
                    setTimeout(() => openAuthSheet(), 240);
                  } catch (err) {
                    handleError(err, "Could not finish sign-in");
                  }
                };
              },
            });
          } catch (err) {
            handleError(err, "Could not start sign-in");
          }
          return;
        }

        if (method.type === "command") {
          try {
            const res = await state.api.connectCommand(integration.id, method.id, {});
            const data = res?.data ?? res ?? {};
            toast(data.instructions || "Run the command on your server to connect");
            done();
          } catch (err) {
            handleError(err, "Could not start");
          }
          return;
        }

        if (method.type === "external") {
          toast("This provider is configured outside Pocket, on the host.");
        }
      };

      paint();
    },
  });
}

/* --------------------------------------------------------------- MCP actions
 * The existing sheet only listed servers. These controls use the real write
 * routes, and the resource catalog is read-only.
 */

/* ---------------------------------------------------------------- account
 * Signing in with your own OpenCode Console account is a device-code OAuth
 * flow: the server starts an attempt, prints a URL and a code, and the browser
 * approves it. The credential lives on the OpenCode server in this phone's app
 * storage, never in the web layer.
 */

const OPENCODE_INTEGRATION = "opencode";
const OPENCODE_SERVER = "https://opencode.ai/console";

function accountCode(instructions) {
  const m = String(instructions ?? "").match(/([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)/);
  return m ? m[1] : "";
}

function openAccountSheet() {
  // The polling attempt lives outside the sheet body so closing the sheet can
  // always cancel it, whichever way the sheet is dismissed.
  let poll = 0;
  let attemptID = null;
  const stop = () => {
    if (poll) clearInterval(poll);
    poll = 0;
  };
  const cancelAttempt = () => {
    stop();
    if (attemptID) state.api.cancelOAuth(OPENCODE_INTEGRATION, attemptID).catch(() => {});
    attemptID = null;
  };

  openSheet({
    kind: "account",
    title: "OpenCode account",
    onClose: cancelAttempt,
    body: (root) => {
      const signedOut = async () => {
        stop();
        root.innerHTML = '<p class="sheet-note">Checking this server...</p>';
        let conns = [];
        let saved = [];
        try {
          const info = await state.api.integration(OPENCODE_INTEGRATION);
          conns = info?.connections ?? [];
          const creds = await state.api.credentials();
          saved = (creds ?? []).filter((c) => c.integrationID === OPENCODE_INTEGRATION);
        } catch (err) {
          root.innerHTML = `<p class="sheet-note">${escapeHtml(err.message || "Could not read the account state")}</p>`;
          return;
        }
        const live = conns[0] ?? saved[0] ?? null;
        if (live) {
          const label = live.label || live.name || live.id || "OpenCode account";
          const kind = live.type ? String(live.type) : live.method ? String(live.method) : "account";
          root.innerHTML = `
            <div class="account-card">
              <div class="account-avatar">${icon("spark")}</div>
              <div class="account-text">
                <b>${escapeHtml(label)}</b>
                <span>Signed in · ${escapeHtml(kind)}</span>
              </div>
            </div>
            <p class="sheet-note">Requests use this account's credits. The credential is stored by the OpenCode server in this phone's app storage.</p>
            <div class="sheet-list">
              ${sheetRow({ iconName: "cpu", title: "Models", sub: "What this account can reach", attrs: "data-acct=models" })}
              ${sheetRow({ iconName: "trash", title: "Sign out", sub: "Remove the account from this server", danger: true, attrs: "data-acct=out" })}
            </div>`;
          return;
        }
        root.innerHTML = `
          <div class="account-card">
            <div class="account-avatar">${icon("spark")}</div>
            <div class="account-text">
              <b>Not signed in</b>
              <span>Running on the free default models</span>
            </div>
          </div>
          <p class="sheet-note">Sign in with your own OpenCode Console account to run on your plan's models and credits. The browser one-time code is approved on opencode.ai; nothing is stored in this app.</p>
          <button class="btn btn-primary btn-block" data-acct="login" style="margin-top:12px">Log in to OpenCode</button>
          <div class="sheet-list" style="margin-top:12px">
            ${sheetRow({ iconName: "key", title: "Use an API key", sub: "Service account key instead of sign-in", attrs: "data-acct=key" })}
            ${sheetRow({ iconName: "key", title: "All connections", sub: "Other providers and saved keys", attrs: "data-acct=conns" })}
          </div>
          <p class="sheet-note" style="margin-top:12px">Approve at <b>opencode.ai/console</b> — the code below is yours alone.</p>`;
      };

      const waiting = (data) => {
        const code = accountCode(data.instructions);
        const expires = data.time?.expires ? new Date(data.time.expires) : null;
        root.innerHTML = `
          <p class="sheet-note">${escapeHtml(data.instructions || "Enter the code on the OpenCode site.")}</p>
          <div class="device-code">${escapeHtml(code || "—")}</div>
          <button class="btn btn-primary btn-block" data-acct="open">Open opencode.ai/console</button>
          <p class="sheet-note" style="margin-top:14px" id="acct-wait"><span class="typing"><i></i><i></i><i></i></span> Waiting for approval${
            expires ? ` · code valid until ${expires.toLocaleTimeString()}` : ""
          }</p>
          <div class="permission-actions">
            <button class="btn btn-ghost" data-acct="cancel">Cancel</button>
          </div>`;
      };

      const fail = (message) => {
        stop();
        root.innerHTML = `<p class="sheet-note">${escapeHtml(message)}</p>
          <button class="btn btn-primary btn-block" data-acct="login" style="margin-top:12px">Try again</button>`;
      };

      const finish = async (data) => {
        stop();
        // The attempt id is enough for a retry, but the credential is what the
        // model picker reads, so confirm it exists before claiming success.
        let conns = [];
        try {
          const info = await state.api.integration(OPENCODE_INTEGRATION);
          conns = info?.connections ?? [];
        } catch (_) {
          /* fall through to the status message */
        }
        if (!conns.length) {
          fail(data?.error?.message || "Approval finished but the server reports no connection. Try again.");
          return;
        }
        haptic(12);
        refreshModelsAfterConnect("OpenCode account").catch(() => {});
        toast("Signed in to OpenCode");
        signedOut();
      };

      const startLogin = async () => {
        stop();
        root.innerHTML = '<p class="sheet-note">Asking the server for a sign-in code...</p>';
        try {
          const res = await state.api.connectOAuth(OPENCODE_INTEGRATION, "device", {
            label: "Pocket",
            answer: { server: OPENCODE_SERVER },
          });
          const data = res?.data ?? res ?? {};
          attemptID = data.attemptID;
          if (!data.url || !attemptID) throw new Error("The server did not return a sign-in code");
          waiting(data);
          let polls = 0;
          poll = setInterval(async () => {
            polls++;
            try {
              const cur = await state.api.oauthAttempt(OPENCODE_INTEGRATION, attemptID);
              const d = cur?.data ?? cur ?? {};
              const status = String(d.status ?? "");
              if (status && !/pending|waiting|started/i.test(status)) {
                if (/fail|error|denied|expired/i.test(status)) {
                  fail(d.error?.message || `Sign-in ${status}`);
                } else {
                  await finish(d);
                }
              } else if (polls > 240) {
                fail("This code expired. Start again for a fresh one.");
              }
            } catch (err) {
              fail(err.message || "Lost contact with the server while waiting");
            }
          }, 2500);
        } catch (err) {
          fail(err.message || "Could not start sign-in");
        }
      };

      const apiKey = () => {
        openSheet({
          kind: "account-key",
          title: "API key",
          body: (r) => {
            r.innerHTML =
              `<p class="sheet-note">Paste an OpenCode Console service-account key. It is sent to the local OpenCode server, which stores it.</p>` +
              `<label class="field"><span class="field-label">API key</span>` +
              `<input class="input" id="acct-key" autocomplete="off" spellcheck="false" placeholder="sk-..."></label>` +
              `<div class="permission-actions"><button class="btn btn-ghost" data-cancel>Cancel</button>` +
              `<button class="btn btn-primary" data-save>Save key</button></div>`;
            r.addEventListener("click", async (e) => {
              if (e.target.closest("[data-cancel]")) return closeSheet();
              if (!e.target.closest("[data-save]")) return;
              const key = r.querySelector("#acct-key").value.trim();
              if (!key) return toast("Enter a key first");
              try {
                await state.api.connectKey(OPENCODE_INTEGRATION, key, { label: "Pocket" });
                toast("Key saved");
                closeSheet();
                setTimeout(() => openAccountSheet(), 220);
              } catch (err) {
                handleError(err, "Could not save the key");
              }
            });
          },
        });
      };

      const signOut = () => {
        openSheet({
          kind: "account-out",
          title: "Sign out?",
          body: (r) => {
            r.innerHTML = `<p class="sheet-note">The OpenCode account is removed from this server. Chats stay; new requests fall back to the free default models.</p>
              <div class="permission-actions">
                <button class="btn btn-ghost" data-cancel>Cancel</button>
                <button class="btn btn-danger" data-confirm>Sign out</button>
              </div>`;
            r.addEventListener("click", async (e) => {
              if (e.target.closest("[data-cancel]")) return closeSheet();
              if (!e.target.closest("[data-confirm]")) return;
              try {
                // A connection can be backed by a credential (oauth/key) or by an
                // environment variable on the host. Only the first kind can be
                // removed from here, and the sheet says so instead of pretending.
                const [creds, info] = await Promise.all([
                  state.api.credentials(),
                  state.api.integration(OPENCODE_INTEGRATION),
                ]);
                const ids = new Set();
                for (const c of creds ?? []) if (c.integrationID === OPENCODE_INTEGRATION) ids.add(c.id);
                for (const c of info?.connections ?? []) {
                  const id = c.credentialID ?? c.id;
                  if (id && c.type !== "env") ids.add(id);
                }
                for (const id of ids) await state.api.deleteCredential(id);
                state.models = null;
                const after = await state.api.integration(OPENCODE_INTEGRATION).catch(() => null);
                const left = after?.connections ?? [];
                if (!ids.size && left.length) {
                  closeSheet();
                  setTimeout(() => {
                    openSheet({
                      title: "Managed outside Pocket",
                      body: (x) => {
                        x.innerHTML = `<p class="sheet-note">This server still reports ${escapeHtml(left[0].type || "a")} credentials for OpenCode. They come from the server's environment (for example OPENCODE_API_KEY), so they have to be changed where OpenCode runs, not from the app.</p>
                          <button class="btn btn-ghost btn-block" data-ok>Got it</button>`;
                        x.addEventListener("click", (ev) => {
                          if (ev.target.closest("[data-ok]")) closeSheet();
                        });
                      },
                    });
                  }, 200);
                  return;
                }
                toast(ids.size ? "Signed out" : "No saved account to remove");
                closeSheet();
                setTimeout(() => openAccountSheet(), 220);
              } catch (err) {
                handleError(err, "Could not sign out");
              }
            });
          },
        });
      };

      root.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-acct]");
        if (!b) return;
        const what = b.dataset.acct;
        if (what === "login") return startLogin();
        if (what === "cancel") {
          cancelAttempt();
          return signedOut();
        }
        if (what === "open") {
          // A device-code URL already carries the code; open it outside the app.
          const url = `${OPENCODE_SERVER}/device?user_code=${encodeURIComponent(accountCode(root.querySelector(".device-code")?.textContent) || "")}`;
          if (window.PocketNative?.openExternal) window.PocketNative.openExternal(url);
          else window.open(url, "_blank", "noopener,noreferrer");
          return;
        }
        if (what === "key") return apiKey();
        if (what === "out") return signOut();
        if (what === "conns") {
          closeSheet();
          setTimeout(() => openAuthSheet(), 200);
          return;
        }
        if (what === "models") {
          closeSheet();
          setTimeout(() => openModelSheet(), 200);
        }
      });

      signedOut();
    },
  });
}

/* --------------------------------------------------------------------- MCP
 * The server owns MCP config; Pocket reads the list and forwards writes. The
 * list is the only honest source of status: POST .../connect answers 204 even
 * when the connection failed, so every action re-reads the list and reports
 * what it says rather than claiming success.
 */

/** Normalised status string for one MCP server, as the server reports it. */
function mcpStatus(server) {
  const raw = server?.status?.status ?? server?.status?.state ?? "unknown";
  return String(raw).toLowerCase();
}

function mcpConnected(server) {
  return /^(connected|active|running|ready)$/.test(mcpStatus(server));
}

/** One line a reader can act on: the real error when there is one. */
function mcpStateLabel(server) {
  const state = mcpStatus(server);
  const err = server?.status?.error;
  if (err) return String(err).replace(/\s+/g, " ").trim();
  if (state === "disabled") return "Disabled";
  if (state === "needs_auth") return "Needs authentication";
  if (state === "pending" || state === "connecting") return "Connecting...";
  if (mcpConnected(server)) return "Connected";
  if (state === "unknown" || state === "not_found") return "No status reported yet";
  return state;
}

/** A server name becomes a path segment, so keep it to something that can be one. */
function validMcpName(name) {
  return /^[A-Za-z0-9._-]{1,64}$/.test(String(name ?? "").trim());
}

const shortText = (v, n = 70) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "\u2026" : t;
};

async function mcpAction(server, action) {
  try {
    if (action === "connect") {
      toast(`Connecting to ${server}...`);
      await state.api.mcpConnect(server);
    } else {
      toast(`Disconnecting ${server}...`);
      await state.api.mcpDisconnect(server);
    }
    // One read serves both the list and the verdict. The calls above answer 204
    // whether or not the connection worked, and asking the server for a status
    // can take a moment while it starts the new process, so the list goes up
    // first and the toast says what the list then showed.
    const servers = await openMcpSheet().catch(() => []);
    const now = (servers ?? []).find((x) => (x.name || x.title) === server);
    if (action === "connect") {
      if (now && mcpConnected(now)) toast(`Connected to ${server}`);
      else toast(shortText(`${server}: ${mcpStateLabel(now ?? {})}`));
    } else if (now && !mcpConnected(now)) {
      toast(`Disconnected from ${server}`);
    } else {
      toast(`${server} is still connected`);
    }
  } catch (err) {
    handleError(err, "Could not " + action + " " + server);
  }
}

/**
 * A sheet that says what is happening while a slow call runs. Writing an MCP
 * server's config makes the server start that process first: PUT took ~9s on
 * the device, and a button that looks dead for that long reads as broken.
 */
function busySheet(title, note) {
  openSheet({
    kind: "busy",
    title,
    body: (root) => {
      root.innerHTML =
        '<div class="empty"><span class="spinner" style="margin:0 auto 12px"></span>' +
        '<p class="sheet-note" style="text-align:center">' + escapeHtml(note ?? "") + "</p></div>";
    },
  });
}

/** Confirmation that reads like a sentence and answers with a boolean. */
function confirmSheet({ title, note, confirmLabel = "Confirm", danger = false, kind = null }) {
  return new Promise((resolve) => {
    openSheet({
      kind,
      title,
      onClose: () => resolve(false),
      body: (root) => {
        root.innerHTML =
          `<p class="sheet-note">${escapeHtml(note ?? "")}</p>` +
          `<div class="permission-actions"><button class="btn btn-ghost" data-cancel>Cancel</button>` +
          `<button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${escapeHtml(confirmLabel)}</button></div>`;
        root.addEventListener("click", (e) => {
          // Neither answer closes the sheet: the caller swaps in whatever comes
          // next. Calling closeSheet() here raced the history entry it pushes,
          // and the popstate landed on the screen the caller had just opened.
          if (e.target.closest("[data-cancel]")) {
            resolve(false);
            return;
          }
          if (e.target.closest("[data-confirm]")) {
            state.sheetOnClose = null;
            resolve(true);
          }
        });
      },
    });
  });
}

async function removeMcpServer(server) {
  const ok = await confirmSheet({
    title: `Remove ${server}?`,
    note: "Deletes this server's configuration on your OpenCode server. Nothing else is touched.",
    confirmLabel: "Remove server",
    danger: true,
    kind: "mcp-remove",
  });
  if (!ok) {
    openMcpSheet();
    return;
  }
  try {
    // DELETE is slow for the same reason PUT is; say so instead of leaving the
    // confirmation on screen looking stuck.
    busySheet("Removing server", `${server} is being removed on your OpenCode server...`);
    await state.api.mcpRemove(server);
    await openMcpSheet();
    toast(`Removed ${server}`);
  } catch (err) {
    handleError(err, "Could not remove " + server);
    openMcpSheet();
  }
}

async function openMcpResources() {
  openSheet({
    kind: "mcp-resources",
    title: "MCP resources",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading...</p>';
      try {
        const cat = await state.api.mcpResources();
        const items = [...(cat.resources ?? []), ...(cat.templates ?? [])];
        root.innerHTML = items.length
          ? '<p class="sheet-note">What the connected servers expose to the agent.</p><div class="sheet-list">' +
            items
              .map(
                (r) =>
                  `<div class="sheet-item"><span class="si-icon">${icon("book")}</span>` +
                  `<span class="si-text"><span class="si-title">${escapeHtml(r.name || r.uri || "Resource")}</span>` +
                  `<span class="si-sub">${escapeHtml(r.uri || r.uriTemplate || "")}</span></span></div>`
              )
              .join("") +
            "</div>"
          : '<p class="sheet-note">No resources: resources are published by connected servers, and none of them is offering any right now. Tools still work - resources are extra.</p>' +
            '<div class="prefs-foot"><button class="btn btn-ghost" data-mcp-back>Back to servers</button></div>';
        root.addEventListener("click", (e) => {
          if (e.target.closest("[data-mcp-back]")) openMcpSheet();
        });
      } catch (err) {
        root.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Could not load resources") + "</p>";
      }
    },
  });
}

/* ------------------------------------------------------------------- todos
 * The server publishes a checklist for longer tasks. Keeping it at the top of
 * the transcript makes progress legible without reading every tool call.
 */

function renderTodos() {
  if (!el.todoPanel) return;
  const items = state.todos ?? [];
  el.todoPanel.hidden = !items.length;
  if (!items.length) {
    el.todoPanel.innerHTML = "";
    return;
  }
  const done = items.filter((t) => /complete|done/i.test(t.status ?? "")).length;
  el.todoPanel.innerHTML =
    `<div class="todo-head">Task progress <span>${done}/${items.length}</span></div>` +
    `<div class="todo-list">` +
    items
      .map((t) => {
        const stateName = String(t.status ?? "pending").toLowerCase();
        const cls = /complete|done/.test(stateName) ? "done" : /progress|running/.test(stateName) ? "active" : "";
        const mark = cls === "done" ? "✓" : cls === "active" ? "◐" : "";
        return `<div class="todo-row ${cls}"><span class="todo-mark">${mark}</span><span>${escapeHtml(t.content || "")}</span></div>`;
      })
      .join("") +
    `</div>`;
}

/**
 * List the MCP servers and return the same list it painted, so a caller can
 * report the outcome without asking the server a second time. Reading the list
 * is not instant right after a change - the server starts the new process - so
 * the sheet goes up first and its promise carries the verdict.
 */
function openMcpSheet() {
  const loading = Promise.resolve()
    .then(() => state.api.mcpServers({ directory: workspaceDir() }))
    .then((list) => list ?? []);
  openSheet({
    kind: "mcp",
    title: "MCP servers",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading...</p>';
      let servers = [];
      try {
        servers = await loading;
      } catch (err) {
        root.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Could not load MCP servers") + "</p>";
        return;
      }
      const up = servers.filter(mcpConnected).length;
      const head = servers.length
        ? `<p class="sheet-note">${servers.length} server${servers.length === 1 ? "" : "s"}, ${up} connected. The configuration lives on your OpenCode server; Pocket reads the list and forwards changes.</p>`
        : "";
      const rows = servers
        .map((s) => {
          const name = s.name || s.title || "";
          const state = mcpStatus(s);
          const isUp = mcpConnected(s);
          return (
            `<div class="mcp-row" data-server="${escapeHtml(name)}">` +
            `<div class="sheet-item"><span class="dot-status" data-s="${escapeHtml(state)}"></span>` +
            `<span class="si-text"><span class="si-title">${escapeHtml(name)}</span>` +
            `<span class="si-sub">${escapeHtml(mcpStateLabel(s))}</span></span></div>` +
            `<div class="mcp-actions">` +
            `<button data-mcp="${isUp ? "disconnect" : "connect"}" data-server="${escapeHtml(name)}">${isUp ? "Disconnect" : "Connect"}</button>` +
            `<button data-mcp="edit" data-server="${escapeHtml(name)}">Replace config</button>` +
            `<button data-mcp="remove" data-server="${escapeHtml(name)}">Remove</button>` +
            `</div></div>`
          );
        })
        .join("");
      root.innerHTML =
        head +
        (servers.length
          ? `<div class="sheet-list">${rows}</div>`
          : '<p class="sheet-note">No MCP server is configured for this project. Add one below - the server keeps it and reports its real status here.</p>') +
        '<div class="prefs-foot"><button class="btn btn-primary" data-mcp-add>Add MCP server</button>' +
        '<button class="btn btn-ghost" data-mcp-resources>Resources</button></div>' +
        '<p class="sheet-note" style="margin-top:10px">Servers added here are written to your OpenCode config. A server that fails to connect keeps its row, with the reason.</p>';
      root.addEventListener("click", (e) => {
        if (e.target.closest("[data-mcp-add]")) return openMcpForm(null);
        if (e.target.closest("[data-mcp-resources]")) return openMcpResources();
        const btn = e.target.closest("[data-mcp]");
        if (!btn) return;
        const name = btn.dataset.server;
        if (btn.dataset.mcp === "edit") return openMcpForm(name);
        if (btn.dataset.mcp === "remove") return removeMcpServer(name);
        return mcpAction(name, btn.dataset.mcp);
      });
    },
  });
  return loading;
}

/** Add a server, or replace the configuration of one that exists. */
function openMcpForm(server = null) {
  const editing = !!server;
  openSheet({
    kind: "mcp-add",
    title: editing ? `Replace ${server} config` : "Add MCP server",
    body: (root) => {
      root.innerHTML = `<p class="sheet-note">${
        editing
          ? `The server does not expose a saved configuration, so this replaces it in full. The name stays <b>${escapeHtml(server)}</b>.`
          : "Remote is an HTTP endpoint. Local is a command your server runs. The server owns the config and reports the real status."
      }</p>
        <div class="seg" id="mcp-kind"><button data-k="remote" class="on">Remote</button><button data-k="local">Local</button></div>
        <label class="field"><span class="label">Name</span><input class="input" id="mcp-name" placeholder="my-server" value="${
          editing ? escapeHtml(server) : ""
        }"${editing ? " disabled" : ""}></label>
        <div id="mcp-remote">
          <label class="field"><span class="label">URL</span><input class="input" id="mcp-url" placeholder="https://example.com/mcp"></label>
          <label class="field"><span class="label">Headers (JSON, optional)</span><input class="input" id="mcp-headers" placeholder='{"Authorization":"Bearer ..."}'></label>
        </div>
        <div id="mcp-local" hidden>
          <label class="field"><span class="label">Command + args</span><input class="input" id="mcp-command" placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"></label>
          <label class="field"><span class="label">Environment (JSON, optional)</span><input class="input" id="mcp-env" placeholder='{"KEY":"value"}'></label>
        </div>
        <button class="btn btn-primary btn-block" id="mcp-save" style="margin-top:12px">${
          editing ? "Replace configuration" : "Add server"
        }</button>
        <button class="btn btn-ghost btn-block" id="mcp-cancel" style="margin-top:8px">Cancel</button>`;
      let kind = "remote";
      $("#mcp-kind", root).addEventListener("click", (e) => {
        const b = e.target.closest("[data-k]");
        if (!b) return;
        kind = b.dataset.k;
        for (const n of $$("#mcp-kind button", root)) n.classList.toggle("on", n === b);
        $("#mcp-remote", root).hidden = kind !== "remote";
        $("#mcp-local", root).hidden = kind !== "local";
      });
      $("#mcp-cancel", root).addEventListener("click", () => openMcpSheet());
      const parse = (v) => {
        if (!v?.trim()) return { ok: true, value: {} };
        try {
          const value = JSON.parse(v);
          if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
          return { ok: true, value };
        } catch {
          return { ok: false };
        }
      };
      $("#mcp-save", root).addEventListener("click", async () => {
        const name = ($("#mcp-name", root).value || server || "").trim();
        if (!validMcpName(name)) return toast("Use letters, numbers, dots, dashes or underscores");
        const headers = parse($("#mcp-headers", root).value);
        const env = parse($("#mcp-env", root).value);
        const url = ($("#mcp-url", root).value || "").trim();
        const command = ($("#mcp-command", root).value || "").trim().split(/\s+/).filter(Boolean);
        if (kind === "remote" && !/^https?:\/\//i.test(url)) return toast("Enter an http(s) URL");
        if (kind === "local" && !command.length) return toast("Enter a command");
        if (!headers.ok || !env.ok) return toast("Headers and environment must be JSON objects");
        const config =
          kind === "remote"
            ? { type: "remote", url, headers: headers.value }
            : { type: "local", command, environment: env.value };
        const save = $("#mcp-save", root);
        const label = save.textContent;
        save.disabled = true;
        save.textContent = editing ? "Replacing..." : "Saving...";
        try {
          await state.api.mcpAdd(name, config);
          haptic(10);
          // The list goes up first: reading it right after a change can take a
          // moment, and the form must not sit there looking stuck.
          const servers = await openMcpSheet().catch(() => []);
          const now = (servers ?? []).find((x) => (x.name || x.title) === name);
          toast(shortText(`${editing ? "Replaced" : "Added"} ${name}: ${now ? mcpStateLabel(now) : "no status reported"}`));
        } catch (err) {
          // Keep the form (and what was typed) when the write fails.
          save.disabled = false;
          save.textContent = label;
          handleError(err, "Could not save MCP server");
        }
      });
    },
  });
}

function openProvidersSheet() {
  openSheet({
    kind: "providers",
    title: "Providers",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading...</p>';
      let avail;
      try {
        avail = await providerAvailability();
      } catch (err) {
        root.innerHTML = '<p class="sheet-note">' + escapeHtml(err.message || "Could not load providers") + "</p>";
        return;
      }
      // Only providers this server can actually run: those whose models it
      // hands out, plus any it has a saved key/sign-in for. The catalog holds
      // the full world; this list holds what is reachable.
      const byModel = new Map();
      for (const m of avail.models) {
        if (!byModel.has(m.providerID)) byModel.set(m.providerID, 0);
        byModel.set(m.providerID, byModel.get(m.providerID) + 1);
      }
      const named = new Map();
      for (const p of avail.providers) if (p?.id) named.set(p.id, p);
      const rows = [];
      const seen = new Set();
      for (const id of avail.active) {
        seen.add(id);
        const it = avail.byId.get(id);
        rows.push({
          id,
          name: named.get(id)?.name || it?.name || id,
          state: "ready",
          how: byModel.get(id) + " model" + (byModel.get(id) === 1 ? "" : "s"),
        });
      }
      for (const id of avail.configured) {
        if (seen.has(id)) continue;
        seen.add(id);
        const it = avail.byId.get(id);
        rows.push({
          id,
          name: named.get(id)?.name || it?.name || id,
          state: "silent",
          how: "saved, no models served",
        });
      }
      if (!rows.length) {
        root.innerHTML =
          '<p class="sheet-note">No provider is connected yet, so this server has no models to run. Add a key or sign in to one.</p>' +
          '<button class="btn btn-primary btn-block" data-provider-connect style="margin-top:12px">Connect a provider</button>';
        root.addEventListener("click", (e) => {
          if (!e.target.closest("[data-provider-connect]")) return;
          closeSheet();
          setTimeout(() => openAuthSheet(), 200);
        });
        return;
      }
      root.innerHTML =
        '<p class="sheet-note">Providers this OpenCode can run right now, with how many models it serves for each. A provider appears here after its key or sign-in is added.</p><div class="sheet-list">' +
        rows
          .map(
            (p) =>
              '<div class="sheet-item"' + (p.state === "silent" ? ' data-silent="1"' : "") + '><span class="si-icon">' + icon("plug") + "</span>" +
              '<span class="si-text"><span class="si-title">' + escapeHtml(p.name) + "</span>" +
              '<span class="si-sub">' + escapeHtml(p.id) + " · " + escapeHtml(String(p.how)) + "</span></span>" +
              (p.state === "silent" ? '<span class="si-sub">retry</span>' : "") +
              "</div>"
          )
          .join("") +
        "</div>" +
        '<div class="prefs-foot"><button class="btn btn-ghost" data-provider-connect>Connect another provider</button></div>';
      root.addEventListener("click", (e) => {
        if (!e.target.closest("[data-provider-connect]")) return;
        closeSheet();
        setTimeout(() => openAuthSheet(), 200);
      });
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

/**
 * Kinds that are destinations rather than glances: they take the whole app area
 * with a back header, the way a page is expected to behave on a phone. Sheets
 * that interrupt a chat (a permission, a rename, a model pick) stay sheet-sized.
 */
const PAGE_KINDS = new Set([
  "settings", "customize", "catalog", "providers", "plugins", "mcp", "mcp-resources", "mcp-add",
  "projects", "worktrees", "schedules", "library", "images", "stats", "instructions", "updates",
  "engine-update", "prefs", "commands", "auth", "account",
]);

function openSheet({ title, body, onClose, kind = null }) {
  clearTimeout(state.sheetCloseTimer);
  state.sheetKind = kind;
  const isPage = PAGE_KINDS.has(kind);
  el.sheet.classList.toggle("page", isPage);
  el.sheetBack.hidden = !isPage;
  // Every body() call attaches its own delegated click listener. Reusing one
  // root would keep those closures alive, so a tap in a later sheet would also
  // fire the handlers of every sheet opened before it (archiving the session
  // from three menus ago, for example). A fresh host per open keeps the sheet
  // as isolated as it looks.
  const paint = () => {
    el.sheetBody.innerHTML = "";
    const host = document.createElement("div");
    host.className = "sheet-host";
    el.sheetBody.append(host);
    body(host);
    el.sheetBody.scrollTop = 0;
    return host;
  };
  if (state.sheetOpen) {
    // Swap content of the open sheet without pushing another history entry.
    el.sheetTitle.textContent = title;
    paint();
    state.sheetOnClose = onClose;
    return;
  }
  el.sheetTitle.textContent = title;
  paint();
  el.sheet.hidden = false;
  el.scrim.hidden = false;
  state.sheetOpen = true;
  state.sheetClosing = false;
  state.sheetOnClose = onClose;
  requestAnimationFrame(() => {
    el.sheet.classList.add("open");
    el.scrim.classList.add("open");
  });
  history.pushState({ sheet: true }, "");
}

function closeSheet(fromPop = false) {
  if (!fromPop) {
    // history.back() is asynchronous: a second tap on the X (or two calls in a
    // row) would pop twice and take the conversation with it.
    if (!state.sheetOpen || state.sheetClosing) return;
    state.sheetClosing = true;
    history.back();
    return;
  }
  // A popstate may arrive after the close was already requested; it still has
  // to finish the job and clear the in-flight flag.
  if (!state.sheetOpen && !state.sheetClosing) return;
  state.sheetClosing = false;
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

const DEFAULT_MODEL = { providerID: "opencode", id: "big-pickle" };

async function ensureModels() {
  if (state.models) return state.models;
  state.models = await state.api.models();
  const wanted = store.get("defaultModel", `${DEFAULT_MODEL.providerID}/${DEFAULT_MODEL.id}`);
  const [prov, ...rest] = String(wanted).split("/");
  const id = rest.join("/");
  const found = (state.models ?? []).find(
    (m) => m.providerID === prov && m.id === id && m.enabled !== false
  );
  if (found && !state.lastModel) {
    state.lastModel = found;
    store.set("lastModel", found);
  } else if (!found && !state.lastModel && !state.demo) {
    // Keep the preference, but never replace it with an unrelated model.
    toast("Preferred model unavailable · choose a model");
  }
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

/**
 * What this server can actually reach right now.
 *
 * `active` is the truth and comes from the live model list: a provider is only
 * usable if the server hands out models for it. That endpoint is what a key or
 * sign-in changes, and it is empty for a provider that is configured but not
 * serving anything. `configured` is the softer signal (a provider row, a saved
 * credential, a live connection) used to explain a saved-but-silent provider.
 * The models.dev catalog knows every provider in the world; a model is only
 * selectable when its provider is in `active`.
 */
async function providerAvailability() {
  const safe = (p) => p.catch(() => []);
  const [models, providers, integrations, creds] = await Promise.all([
    safe(ensureModels()),
    safe(state.api.providers({ directory: workspaceDir() })),
    safe(state.api.integrations()),
    safe(state.api.credentials()),
  ]);
  const active = new Set();
  for (const m of models ?? []) if (m?.providerID && m.enabled !== false) active.add(m.providerID);
  const configured = new Set();
  for (const p of providers ?? []) if (p?.id) configured.add(p.id);
  for (const c of creds ?? []) if (c?.integrationID) configured.add(c.integrationID);
  for (const it of integrations ?? []) if ((it?.connections ?? []).length) configured.add(it.id);
  const byId = new Map();
  for (const it of integrations ?? []) byId.set(it.id, it);
  return {
    active,
    configured,
    providers: providers ?? [],
    integrations: integrations ?? [],
    models: models ?? [],
    byId,
  };
}

/** After a key or login lands, the model list changes on the server. */
async function refreshModelsAfterConnect(label) {
  state.models = null;
  let models = [];
  try {
    models = (await ensureModels()) ?? [];
  } catch (_) {
    return;
  }
  const providers = new Set(models.map((m) => m.providerID));
  toast(
    label
      ? `${label} connected · ${providers.size} provider${providers.size === 1 ? "" : "s"}, ${models.length} models`
      : `${models.length} models available`
  );
  setChatHeader();
}

async function openModelSheet() {
  if (!state.session) return needsSession("Model", "the model and its variants are chosen per session.");
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
      const providers = new Set(list.map((m) => m.providerID));
      root.innerHTML = `
        <div class="sheet-search"><div class="search-box">${icon("search")}<input class="search-input" id="model-search" placeholder="Search ${list.length} models" autocomplete="off"></div></div>
        <p class="sheet-note">${list.length} models from ${providers.size} connected provider${providers.size === 1 ? "" : "s"}. Models from providers without a key are not listed.</p>
        <div class="sheet-list" id="model-list"></div>
        <div class="prefs-foot"><button class="btn btn-ghost" id="model-connect">Connect a provider</button></div>`;
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
              const color = PROVIDER_COLORS[m.providerID] ?? "#9aa0a6";
              const logo = `https://models.dev/logos/${encodeURIComponent(m.providerID)}.svg`;
              return `<button class="sheet-item model-row${selected ? " selected" : ""}" data-model="${escapeHtml(m.providerID)}|${escapeHtml(m.id)}">
                <span class="model-logo"><img src="${logo}" alt="" style="color:${escapeHtml(color)}" onerror="this.style.display='none'" /></span>
                <span class="si-text"><span class="si-title">${escapeHtml(m.name || m.id)}</span>
                <span class="si-sub">${escapeHtml(m.providerID)} · ${escapeHtml(m.id)}${m.limit?.context ? ` · ${Math.round(m.limit.context / 1000)}k ctx` : ""}</span></span>
                ${selected ? `<span class="si-check">${icon("check")}</span>` : ""}
              </button>`;
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
      root.querySelector("#model-connect")?.addEventListener("click", () => {
        closeSheet();
        setTimeout(() => openAuthSheet(), 200);
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
  if (!state.session) return needsSession("Agent", "an agent runs inside a session, so pick one after starting a chat.");
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
          ${pinnedIds().includes(session.id)
            ? sheetRow({ iconName: "book", title: "Unpin chat", sub: "Remove from the sidebar's pinned list", attrs: "data-action=unpin" })
            : sheetRow({ iconName: "book", title: "Pin chat", sub: "Keep it at the top of the sidebar", attrs: "data-action=pin" })}
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
        if (action === "pin" || action === "unpin") {
          const ids = new Set(pinnedIds());
          if (action === "pin") ids.add(session.id); else ids.delete(session.id);
          store.set("pinnedSessions", [...ids]);
          closeSheet();
          renderSidebar();
          toast(action === "pin" ? "Pinned" : "Unpinned");
          return;
        }
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
          // Deleting from the server is an explicit user action: remove the
          // local recovery copy too, so the session does not reappear.
          History.deleteSession(session.id).catch(() => {});
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
  // Resolve the preferred default against the live catalog before creating a
  // session; otherwise a new chat could silently get an unrelated model.
  await ensureModels().catch(() => {});
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
              : window.PocketNative?.workspaceDir
                ? sheetRow({
                    iconName: "folder",
                    title: "Pocket workspace",
                    sub: window.PocketNative.workspaceDir(),
                    attrs: `data-dir="${escapeHtml(window.PocketNative.workspaceDir())}"`,
                  })
                : `<p class="sheet-note">No known workspaces yet - enter a path below.</p>`
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

/* ------------------------------------------- server data: backup / restore
 * The runtime's own store is authoritative history and it lives in app-private
 * storage, which Android deletes on uninstall. These paths move a copy out to
 * Downloads and back, and they never run on their own.
 */

function nativeBackups() {
  try {
    return JSON.parse(window.PocketNative?.listRuntimeBackups?.() ?? "[]");
  } catch {
    return [];
  }
}

function prettyBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

async function backupServerData() {
  if (!window.PocketNative?.backupRuntime) return toast("Backing up needs the app (not a browser)");
  const raw = window.PocketNative.backupRuntime();
  let res = {};
  try {
    res = JSON.parse(raw || "{}");
  } catch {}
  if (!res.ok) return toast(res.error || "Backup failed");
  haptic(8);
  toast(`Backed up ${res.entries} files to ${res.where ?? "Downloads"}`);
}

async function restoreBackup(name) {
  if (!window.PocketNative?.restoreRuntimeBackup) return toast("Restoring needs the app (not a browser)");
  toast("Restoring…");
  const raw = window.PocketNative.restoreRuntimeBackup(name);
  let res = {};
  try {
    res = JSON.parse(raw || "{}");
  } catch {}
  if (!res.ok) return handleError(new ApiError(res.error || "Restore failed", 0), "Could not restore");
  haptic(12);
  toast("Restored — reloading");
  window.PocketNative.restartAfterRestore?.();
}

/**
 * Restore from a file the user picks.
 *
 * A backup made before a reinstall cannot be listed afterwards — Android drops
 * an app's Downloads rows when it is uninstalled — but the file is still there.
 */
function pickBackupFile() {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".zip,application/zip";
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0];
    if (!file) return;
    if (!window.PocketNative?.restoreRuntimeFromBase64) return toast("Restoring needs the app (not a browser)");
    toast("Reading the backup…");
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      }
      const res = JSON.parse(window.PocketNative.restoreRuntimeFromBase64(file.name, btoa(bin)) || "{}");
      if (!res.ok) return handleError(new ApiError(res.error || "Restore failed", 0), "Could not restore");
      haptic(12);
      toast("Restored — reloading");
      window.PocketNative.restartAfterRestore?.();
    } catch (err) {
      handleError(err, "Could not restore that file");
    }
  });
  picker.click();
}

function openServerBackups() {
  const backups = nativeBackups();
  openSheet({
    title: "Server backups",
    body: (root) => {
      root.innerHTML =
        `<p class="sheet-note">Restoring replaces the runtime's sessions, settings and logins with the backup. The data in use now is moved aside, never deleted.</p>` +
        backups
          .map(
            (b) => `<button class="sheet-item" data-restore="${escapeHtml(b.name)}">
              <span class="si-icon">${icon("download")}</span>
              <span class="si-text"><span class="si-title">${escapeHtml(b.name.replace(/^opencode-backup-/, "").replace(/\.zip$/, ""))}</span>
              <span class="si-sub">${prettyBytes(b.bytes)} · ${escapeHtml(new Date(b.at || 0).toLocaleString())}</span></span>
            </button>`
          )
          .join("") +
        `<button class="sheet-item" data-pick-backup>
          <span class="si-icon">${icon("folder")}</span>
          <span class="si-text"><span class="si-title">Choose a backup file…</span>
          <span class="si-sub">From Downloads, e.g. after a reinstall</span></span>
        </button>`;
      root.addEventListener("click", async (e) => {
        if (e.target.closest("[data-pick-backup]")) {
          closeSheet();
          pickBackupFile();
          return;
        }
        const btn = e.target.closest("[data-restore]");
        if (!btn) return;
        const ok = await confirmSheet({
          title: "Restore this backup?",
          note: "The runtime restarts and Pocket reloads with the restored sessions.",
          confirmLabel: "Restore",
          kind: "restore-backup",
        });
        if (!ok) return;
        closeSheet();
        restoreBackup(btn.dataset.restore);
      });
    },
  });
}

/** Offered once per launch, and only when there is nothing to lose. */
function maybeOfferBackupRestore() {
  if (state.demo || state.backupOffered || state.sessions.length) return false;
  if (!window.PocketNative?.listRuntimeBackups) return false;
  state.backupOffered = true;
  const backups = nativeBackups();
  const newest = backups[0];
  openSheet({
    title: "Nothing here yet",
    body: (root) => {
      const known = newest
        ? `A Pocket backup from ${escapeHtml(new Date(newest.at || 0).toLocaleString())} is in Downloads.`
        : `If you saved a Pocket backup before reinstalling, it is still in Downloads.`;
      root.innerHTML = `<p class="sheet-note">No sessions were found on this device. ${known} Restoring brings the conversations back with their original ids — nothing is deleted either way.</p>
      <div class="permission-actions"><button class="btn btn-ghost" data-cancel>Not now</button>
      <button class="btn btn-ghost" data-pick>Choose a file…</button>
      ${newest ? `<button class="btn btn-primary" data-confirm>Restore ${escapeHtml(newest.name.replace(/^opencode-backup-/, "").replace(/\.zip$/, ""))}</button>` : ""}</div>`;
      root.addEventListener("click", (e) => {
        if (e.target.closest("[data-cancel]")) return closeSheet();
        if (e.target.closest("[data-pick]")) {
          closeSheet();
          pickBackupFile();
          return;
        }
        if (!e.target.closest("[data-confirm]")) return;
        closeSheet();
        restoreBackup(newest.name);
      });
    },
  });
  return true;
}

function openSettings() {
  openSheet({
    kind: "settings",
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
          ${
            window.PocketNative?.runtimeMode
              ? `<div class="setting-row" id="runtime-mode-row">
                   <div class="setting-text"><div class="setting-title">Runtime</div>
                     <div class="setting-sub">Built-in runs OpenCode inside the app · Termux uses your existing setup</div></div>
                   <button class="btn btn-ghost" id="runtime-mode" style="height:38px;padding:0 12px;font-size:12.5px"></button>
                 </div>`
              : ""
          }
          ${sheetSettingRow("download", "Updates", "Pocket app and OpenCode engine", "open-updates")}
          ${
            window.PocketNative?.backupRuntime
              ? `${sheetSettingRow("download", "Back up server data", "Sessions, settings and logins to Downloads", "server-backup")}
                 ${sheetSettingRow("download", "Restore server backup", "Bring back sessions after a reinstall", "server-restore")}`
              : ""
          }
          ${sheetSettingRow("download", "Import a session", "From a JSON export", "import-session")}
          ${sheetSettingRow("download", "Export local history", "Backup every saved conversation", "history-export")}
          ${sheetSettingRow("download", "Import local history", "Restore a Pocket backup", "history-import")}
          ${sheetSettingRow("trash", "Delete local copy", "Only saved chats on this device", "history-clear")}
          ${sheetSettingRow("shield", "Permissions", "Rules that skip the approval sheet", "saved-permissions")}
          ${sheetSettingRow("key", "Connections", "Provider logins and saved keys", "open-auth")}
          ${sheetSettingRow("spark", "OpenCode account", "Sign in with your own account", "open-account")}
          ${sheetSettingRow("spark", "Provider catalog", "models.dev · logos, free models", "provider-catalog")}
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

      const modeBtn = $("#runtime-mode", root);
      if (modeBtn) {
        const mode = window.PocketNative.runtimeMode();
        modeBtn.textContent = mode === "embedded" ? "Built-in" : "Termux";
      }

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
        if (e.target.closest("#runtime-mode")) {
          const next = window.PocketNative.runtimeMode() === "embedded" ? "termux" : "embedded";
          window.PocketNative.setRuntimeMode(next);
          e.target.closest("#runtime-mode").textContent = next === "embedded" ? "Built-in" : "Termux";
          toast(next === "embedded" ? "Built-in runtime · reopen the app" : "Termux runtime · reopen the app");
        }
        if (e.target.closest("#edit-conn")) {
          closeSheet();
          setTimeout(openConnectionSheet, 220);
        }
        if (e.target.closest("#history-export")) {
          const data = await History.exportWithMessages();
          downloadText(`opencode-pocket-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
          toast("Local history exported");
          return;
        }
        if (e.target.closest("#history-import")) {
          const picker = document.createElement("input");
          picker.type = "file";
          picker.accept = "application/json,.json";
          picker.addEventListener("change", async () => {
            const file = picker.files?.[0];
            if (!file) return;
            try {
              const n = await History.importAll(JSON.parse(await file.text()));
              toast(`Restored ${n} conversations`);
              refreshSessions(false).catch(() => {});
            } catch (err) {
              handleError(err, "Could not restore backup");
            }
          });
          picker.click();
          return;
        }
        if (e.target.closest("#history-clear")) {
          openSheet({
            title: "Delete local history?",
            body: (root) => {
              root.innerHTML = `<p class="sheet-note">Removes the saved copies on this device. Server sessions are not touched.</p>
                <div class="permission-actions"><button class="btn btn-ghost" data-cancel>Cancel</button>
                <button class="btn btn-danger" data-confirm>Delete local copy</button></div>`;
              root.addEventListener("click", async (ev) => {
                if (ev.target.closest("[data-cancel]")) return closeSheet();
                if (!ev.target.closest("[data-confirm]")) return;
                await History.clearAll();
                closeSheet();
                toast("Local history deleted");
              });
            },
          });
          return;
        }
        if (e.target.closest("#open-updates")) {
          openUpdatesSheet();
          return;
        }
        if (e.target.closest("#server-backup")) {
          backupServerData();
          return;
        }
        if (e.target.closest("#server-restore")) {
          openServerBackups();
          return;
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
        if (e.target.closest("#open-auth")) {
          openAuthSheet();
          return;
        }
        if (e.target.closest("#open-account")) {
          openAccountSheet();
          return;
        }
        if (e.target.closest("#provider-catalog")) {
          openProviderCatalog();
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

// Commands whose execution is an action, not a chat prompt. The rest are
// submitted as real prompts to the server, which expands arguments/shell
// blocks according to its own security model.
const ACTION_COMMANDS = {
  new: () => openNewSession(),
  clear: () => { state.messages = []; renderMessages(true); toast("Cleared view"); },
  models: () => openModelSheet(),
  agents: () => openAgentSheet(),
  export: () => state.session && exportSession(state.session),
  help: () => openCommandPalette(),
};

function executeCommand(raw) {
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(raw.trim());
  if (!match) return false;
  const name = match[1].toLowerCase();
  const args = match[2] ?? "";
  const action = ACTION_COMMANDS[name];
  if (action) {
    el.input.value = "";
    autoGrow();
    updateSendButton();
    action();
    return true;
  }
  // /init, /review, /compact, /undo, /connect and custom commands are real
  // upstream commands: send them verbatim so the server handles them.
  return false; // caller falls through to normal send
}

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
        el.composerHint.textContent = `/${matches[0].name} — ${matches[0].description ?? ""} · tap / for all`;
      } else {
        el.composerHint.textContent = defaultHint();
      }
    })
    .catch(() => {});
}

async function openCommandPalette() {
  openSheet({
    kind: "commands",
    title: "Commands",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading commands…</p>';
      let commands = [];
      try { commands = await ensureCommands(); } catch { commands = []; }
      const q = ($("#command-search", root)?.value ?? "").toLowerCase().trim();
      const list = commands.filter((c) => !q || `${c.name} ${c.description ?? ""}`.toLowerCase().includes(q));
      root.innerHTML = `<div class="sheet-search"><div class="search-box">${icon("search")}
          <input class="search-input" id="command-search" placeholder="Search commands" autocomplete="off" /></div></div>
        <div class="sheet-list" id="command-list">${
          list.map((c) => `<button class="sheet-item" data-run-command="${escapeHtml("/" + c.name)}">
            <span class="si-icon">${icon("code")}</span>
            <span class="si-text"><span class="si-title">/${escapeHtml(c.name)}</span>
            <span class="si-sub">${escapeHtml(c.description ?? "")}</span></span></button>`).join("")
          || '<p class="sheet-note">No commands available on this server.</p>'
        }</div>`;
      const repaint = () => {
        const q2 = $("#command-search", root).value.toLowerCase().trim();
        const l = commands.filter((c) => !q2 || `${c.name} ${c.description ?? ""}`.toLowerCase().includes(q2));
        $("#command-list", root).innerHTML = l.map((c) => `<button class="sheet-item" data-run-command="${escapeHtml("/" + c.name)}">
          <span class="si-icon">${icon("code")}</span>
          <span class="si-text"><span class="si-title">/${escapeHtml(c.name)}</span>
          <span class="si-sub">${escapeHtml(c.description ?? "")}</span></span></button>`).join("");
      };
      $("#command-search", root).addEventListener("input", repaint);
      $("#command-list", root).addEventListener("click", (e) => {
        const btn = e.target.closest("[data-run-command]");
        if (!btn) return;
        el.input.value = btn.dataset.runCommand + " ";
        closeSheet();
        el.input.focus();
      });
      $("#command-search", root).focus();
    },
  });
}

function defaultHint() {
  if (matchMedia("(pointer: fine)").matches) return "Enter to send · Shift+Enter for newline";
  return "";
}

/* ---------------------------------------------------------------- errors */

function handleError(err, fallback) {
  console.error(err);
  if (err instanceof ApiError && err.status === 401) {
    // The built-in runtime rotates its password every time it restarts, so a
    // 401 in the app usually means "the daemon came back with a new secret",
    // not "the user is logged out". Adopt the secret the shell already has
    // before falling back to the connect screen.
    const cfg = (() => {
      try {
        return JSON.parse(window.PocketNative?.getConfig?.() ?? "{}");
      } catch {
        return {};
      }
    })();
    if (cfg.base && cfg.secret && (cfg.secret !== state.secret || cfg.base !== state.base)) {
      state.base = cfg.base;
      state.secret = cfg.secret;
      state.api = new Api(cfg.base, cfg.secret);
      store.set("base", cfg.base);
      store.set("secret", cfg.secret);
      setConnection("online", "Connected");
      startEvents();
      toast("Reconnected to the runtime");
      return;
    }
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
  bindSidebar();
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

  $("#session-tabs")?.addEventListener("click", async (e) => {
    const close = e.target.closest("[data-tab-close]");
    if (close) {
      closeTab(close.dataset.tabClose);
      return;
    }
    const tab = e.target.closest("[data-tab]");
    if (!tab) return;
    const s = state.sessions.find((x) => x.id === tab.dataset.tab);
    if (s && s.id !== state.session?.id) await openSession(s);
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

  el.archivedToggle?.addEventListener("click", () => {
    state.showArchived = !state.showArchived;
    store.set("showArchived", state.showArchived);
    renderSessions();
    haptic(6);
  });

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
    if (e.target.closest("[data-load-older]")) {
      loadOlderMessages();
      return;
    }
    const starter = e.target.closest("[data-starter]");
    if (starter) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(el.input, starter.dataset.starter);
      el.input.dispatchEvent(new Event("input", { bubbles: true }));
      el.input.focus();
      return;
    }
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

    // images and drawn diagrams open in the full-screen viewer
    const figure = e.target.closest("pre.mermaid.drawn, .files img, .md img");
    if (figure) {
      openLightbox(figure);
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

    // partial answer actions (output token limit)
    const limitBtn = e.target.closest("[data-limit]");
    if (limitBtn) {
      const m = state.messages.find((x) => x.id === limitBtn.dataset.msgId);
      if (m) {
        if (limitBtn.dataset.limit === "continue") continueAnswer(m);
        else retryAnswer(m);
      }
      return;
    }

    const pendingBtn = e.target.closest("[data-pending]");
    if (pendingBtn) {
      const act = pendingBtn.dataset.pending;
      if (act === "check") checkPendingPrompt();
      else if (act === "resend") resendPendingPrompt();
      else discardPendingPrompt();
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
        // Persist the pick in the model *before* any re-render can replace this
        // card; the transcript rebuilds on every streaming event.
        entry.values = readFormValues(card, entry.form, entry.values);
        applyFormConditions(card, entry.form, entry.values);
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
    if (entry) {
      entry.values = readFormValues(card, entry.form, entry.values);
      applyFormConditions(card, entry.form, entry.values);
    }
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
    openSheet({
      kind: "attach",
      title: "Add to chat",
      body: (root) => {
        root.innerHTML = `<div class="sheet-list">
          <button class="sheet-item" data-attach="camera"><span class="si-icon">${icon("image")}</span><span class="si-text"><span class="si-title">Camera</span><span class="si-sub">Take a photo</span></span></button>
          <button class="sheet-item" data-attach="photos"><span class="si-icon">${icon("image")}</span><span class="si-text"><span class="si-title">Photos</span><span class="si-sub">Choose an image</span></span></button>
          <button class="sheet-item" data-attach="files"><span class="si-icon">${icon("file")}</span><span class="si-text"><span class="si-title">Files</span><span class="si-sub">Attach a file</span></span></button>
        </div>`;
        root.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-attach]");
          if (!btn) return;
          const kind = btn.dataset.attach;
          closeSheet();
          setTimeout(() => {
            const picker = document.createElement("input");
            picker.type = "file";
            if (kind === "camera") {
              picker.accept = "image/*";
              picker.capture = "environment";
            } else if (kind === "photos") {
              picker.accept = "image/*";
              picker.multiple = true;
            } else {
              picker.accept = "image/*";
              picker.multiple = true;
            }
            picker.addEventListener("change", () => addFiles(picker.files));
            picker.click();
          }, 200);
        });
      },
    });
  });
  el.attachStrip.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-attach]");
    if (!btn) return;
    state.attachments.splice(Number(btn.dataset.removeAttach), 1);
    renderAttachments();
    updateSendButton();
  });

  el.composerHint?.addEventListener("click", () => {
    if (el.input.value.startsWith("/")) openCommandPalette();
  });
  el.btnMention.addEventListener("click", () => openMentionSheet());
  $("#btn-voice")?.addEventListener("click", () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast("Voice input is not available in this WebView");
      return;
    }
    try {
      const rec = new SR();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = false;
      rec.onresult = (e) => {
        const text = e.results?.[0]?.[0]?.transcript ?? "";
        if (!text) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(el.input, (el.input.value ? el.input.value + " " : "") + text);
        el.input.dispatchEvent(new Event("input", { bubbles: true }));
        el.input.focus();
      };
      rec.onerror = () => toast("Voice input failed");
      rec.start();
      toast("Listening…");
    } catch {
      toast("Voice input is not available");
    }
  });
  el.chatDiff.addEventListener("click", () => openChangesSheet());
  el.revertBanner.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-revert]");
    if (btn) resolveRevert(btn.dataset.revert === "keep");
  });

  // sheet
  el.scrim.addEventListener("click", () => closeSheet(false));
  el.sheetClose.addEventListener("click", () => closeSheet(false));
  el.sheetBack.addEventListener("click", () => closeSheet(false));

  // image / diagram viewer
  el.lightbox?.addEventListener("click", (e) => {
    if (e.target === el.lightbox) closeLightbox();
  });
  el.lightboxClose?.addEventListener("click", () => closeLightbox());
  el.lightboxSource?.addEventListener("click", () => toggleLightboxSource());
  el.artifactBody?.addEventListener("click", (e) => {
    const img = e.target.closest("img");
    if (img) openLightbox(img);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.lightbox?.classList.contains("open")) closeLightbox();
  });

  // settings
  $("#open-settings").addEventListener("click", openSettings);
  el.connDot.addEventListener("click", () => {
    if (state.online) toast("Connected");
    else {
      retryConnection();
      toast("Reconnecting…");
    }
  });

  el.netRetry?.addEventListener("click", retryConnection);

  // artifact workspace
  el.artifactBack?.addEventListener("click", () => closeArtifact(false));
  el.artifactMore?.addEventListener("click", artifactActions);
  el.artifactTabs?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-atab]");
    if (!b) return;
    state.artifactTab = b.dataset.atab;
    renderArtifact();
  });

  // Back unwinds the topmost surface. A sheet can be opened from inside the
  // artifact workspace (its action menu), so the sheet must be checked first —
  // otherwise one history.back() closed the artifact and left the sheet behind.
  window.addEventListener("popstate", () => {
    const side = $("#sidebar");
    if (side && !side.hidden && side.classList.contains("open")) {
      sidebarClose();
    } else if (el.lightbox?.classList.contains("open")) closeLightbox();
    else if (state.sheetOpen || state.sheetClosing) closeSheet(true);
    else if (state.artifact || state.artifactClosing) closeArtifact(true);
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
  state.paletteKey = paletteKey();
  bindEvents();
  onPrefs((prefs) => {
    const paletteBefore = state.paletteKey;
    state.prefs = prefs;
    if (prefs.theme && prefs.theme !== state.theme) {
      state.theme = prefs.theme;
      applyTheme();
    }
    state.paletteKey = paletteKey();
    if (paletteBefore && paletteBefore !== state.paletteKey) repaintDiagrams();
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
    // Demo state is isolated: its own IndexedDB (never the real recovery copy)
    // and its own localStorage prefix (never the real last-session or tabs).
    History.useDemoNamespace();
    store.useDemoNamespace();
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
