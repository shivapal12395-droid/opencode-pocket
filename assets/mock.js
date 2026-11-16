/**
 * In-memory OpenCode API double, used by the public demo (?demo).
 * Nothing here talks to a server.
 */

const now = () => Date.now();
const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;

const DIRS = {
  web: "/home/you/work/pocket-web",
  api: "/home/you/work/api-server",
  notes: "/home/you/notes",
};

const MODEL = { providerID: "opencode", id: "deepseek-v4.1-flash-free", variant: "default" };

const SESSIONS = [
  {
    id: "ses_demo1",
    projectID: "prj_web",
    agent: "build",
    model: MODEL,
    title: "Fix the expired session redirect",
    location: { directory: DIRS.web },
    time: { created: now() - 2 * hour, updated: now() - 6 * min, idle: now() - 6 * min },
  },
  {
    id: "ses_demo2",
    projectID: "prj_web",
    agent: "build",
    model: MODEL,
    title: "Add streaming permission sheet",
    location: { directory: DIRS.web },
    time: { created: now() - 6 * hour, updated: now() - 52 * min, idle: now() - 52 * min },
  },
  {
    id: "ses_demo3",
    projectID: "prj_web",
    agent: "plan",
    model: MODEL,
    title: "Polish the dark theme",
    location: { directory: DIRS.web },
    time: { created: now() - 2 * day, updated: now() - 1 * day, idle: now() - 1 * day },
  },
  {
    id: "ses_demo4",
    projectID: "prj_api",
    agent: "build",
    model: MODEL,
    title: "Rate limit the webhook endpoint",
    location: { directory: DIRS.api },
    time: { created: now() - 4 * hour, updated: now() - 28 * min, idle: now() - 28 * min },
  },
  {
    id: "ses_demo5",
    projectID: "prj_api",
    agent: "build",
    model: MODEL,
    title: "Postgres migration for usage logs",
    location: { directory: DIRS.api },
    time: { created: now() - 3 * day, updated: now() - 2 * day, idle: now() - 2 * day },
  },
  {
    id: "ses_demo6",
    projectID: "prj_notes",
    agent: "build",
    model: MODEL,
    title: "Summarize the launch notes",
    location: { directory: DIRS.notes },
    time: { created: now() - 5 * day, updated: now() - 4 * day, idle: now() - 4 * day },
  },
];

const tool = (id, name, input, output, status = "completed") => ({
  type: "tool",
  id,
  name,
  executed: false,
  state: {
    status,
    input,
    content: output ? [{ type: "text", text: output }] : [],
    metadata: { status, exit: 0, truncated: false },
  },
  time: { created: now() - 3 * min, ran: now() - 3 * min, completed: now() - 2 * min },
});

const MESSAGES = {
  ses_demo1: [
    {
      id: "msg_d1u",
      type: "user",
      text: "The app logs me out after 15 minutes. Can you find out why?",
      files: [],
      time: { created: now() - 9 * min },
    },
    {
      id: "msg_d1a1",
      type: "assistant",
      model: MODEL,
      agent: "build",      cost: 0.0184,
      tokens: {
        input: 128400,
        output: 1842,
        reasoning: 610,
        cache: { read: 96200, write: 0 },
      },
      time: { created: now() - 8 * min, completed: now() - 7 * min },
      content: [
        {
          type: "reasoning",
          text: "15 minutes is the access-token TTL. If the refresh cookie is missing, every request after that fails and the middleware redirects to /login.",
          ordinal: 0,
          time: { completed: now() - 8 * min },
        },
        {
          type: "text",
          text: "That TTL matches the access token exactly. I'll check how the session cookies are written.",
          ordinal: 0,
        },
        tool("call_d1", "read", { filePath: "src/auth/session.ts" }, "export async function setSession(token, rememberMe) {\n  await cookies.set('access', token.access, { maxAge: 60 * 15 })\n  if (rememberMe) {\n    await cookies.set('refresh', token.refresh, { maxAge: 60 * 60 * 24 * 30 })\n  }\n}"),
        {
          type: "text",
          text: "Found it. `setSession()` always writes the access token, but the **refresh token** is only written inside the `rememberMe` branch:\n\n```ts\nif (rememberMe) {\n  await cookies.set(\"refresh\", token.refresh, { maxAge: 60 * 60 * 24 * 30 })\n}\n```\n\nSo a normal login gets a 15-minute access token with no way to refresh it.",
          ordinal: 1,
        },
        tool("call_d2", "edit", { filePath: "src/auth/session.ts", oldString: "if (rememberMe) {\n  await cookies.set(\"refresh\"", newString: "await cookies.set(\"refresh\"" }, "Applied 1 edit to src/auth/session.ts"),
        {
          type: "text",
          text: "Fixed. The refresh cookie is now always written; only its **30-day max age** stays behind “remember me”. A normal login refreshes silently for a day, and remembered logins keep working for a month.",
          ordinal: 2,
        },
      ],
    },
    { id: "msg_d1i", type: "idle", outcome: "succeeded", time: { created: now() - 6 * min } },
  ],
  ses_demo2: [
    {
      id: "msg_d2u",
      type: "user",
      text: "Add a bottom sheet for permission requests instead of the browser confirm.",
      files: [],
      time: { created: now() - 55 * min },
    },
    {
      id: "msg_d2a",
      type: "assistant",
      model: MODEL,
      agent: "build",
      time: { created: now() - 54 * min, completed: now() - 52 * min },
      content: [
        {
          type: "text",
          text: "Done. The sheet has three actions — **Allow once**, **Always**, and **Deny** — and it stays open until the request is answered. If it gets dismissed, a small banner above the composer brings it back.",
          ordinal: 0,
        },
        tool("call_d3", "write", { filePath: "src/ui/permission-sheet.tsx" }, "wrote 214 lines"),
      ],
    },
    { id: "msg_d2i", type: "idle", outcome: "succeeded", time: { created: now() - 52 * min } },
  ],
  ses_demo3: [
    {
      id: "msg_d3u",
      type: "user",
      text: "Can you make the dark theme a little warmer? The slate feels cold.",
      files: [],
      time: { created: now() - 1 * day },
    },
    {
      id: "msg_d3a",
      type: "assistant",
      model: MODEL,
      agent: "plan",
      time: { created: now() - 1 * day, completed: now() - 1 * day },
      content: [
        {
          type: "text",
          text: "I'd shift the neutrals two degrees toward amber and drop the background to `#0b0d10`, keeping contrast above 12:1 for body text. Want me to try it on a branch?",
          ordinal: 0,
        },
      ],
    },
    { id: "msg_d3i", type: "idle", outcome: "succeeded", time: { created: now() - 1 * day } },
  ],
  ses_demo4: [
    {
      id: "msg_d4u",
      type: "user",
      text: "Someone is hammering the webhook endpoint. Add a rate limit.",
      files: [],
      time: { created: now() - 30 * min },
    },
    {
      id: "msg_d4a",
      type: "assistant",
      model: MODEL,
      agent: "build",      cost: 0.0061,
      tokens: {
        input: 42200,
        output: 980,
        reasoning: 204,
        cache: { read: 31000, write: 0 },
      },
      time: { created: now() - 29 * min, completed: now() - 28 * min },
      content: [
        {
          type: "text",
          text: "Added a sliding-window limiter: **60 requests / minute per IP**, with `Retry-After` on 429 and a 10-second burst allowance. Limits live in `src/http/rate-limit.ts` so they're easy to tune.",
          ordinal: 0,
        },
        tool("call_d4", "write", { filePath: "src/http/rate-limit.ts" }, "wrote 96 lines"),
      ],
    },
    { id: "msg_d4i", type: "idle", outcome: "succeeded", time: { created: now() - 28 * min } },
  ],
  ses_demo5: [
    {
      id: "msg_d5u",
      type: "user",
      text: "Draft the migration for the usage log table.",
      files: [],
      time: { created: now() - 2 * day },
    },
    {
      id: "msg_d5a",
      type: "assistant",
      model: MODEL,
      agent: "build",
      time: { created: now() - 2 * day, completed: now() - 2 * day },
      content: [
        {
          type: "text",
          text: "Migration is in `db/migrations/0007_usage_logs.sql`:\n\n```sql\ncreate table usage_logs (\n  id bigserial primary key,\n  session_id text not null,\n  tokens_in int not null default 0,\n  tokens_out int not null default 0,\n  created_at timestamptz not null default now()\n);\ncreate index on usage_logs (session_id, created_at desc);\n```",
          ordinal: 0,
        },
      ],
    },
    { id: "msg_d5i", type: "idle", outcome: "succeeded", time: { created: now() - 2 * day } },
  ],
  ses_demo6: [
    {
      id: "msg_d6u",
      type: "user",
      text: "Summarize the launch notes into three bullets.",
      files: [],
      time: { created: now() - 4 * day },
    },
    {
      id: "msg_d6a",
      type: "assistant",
      model: MODEL,
      agent: "build",
      time: { created: now() - 4 * day, completed: now() - 4 * day },
      content: [
        {
          type: "text",
          text: "- **Faster sessions** — resume is instant, even after a restart\n- **Permission sheet** — approve tools without leaving the chat\n- **Better offline** — the app shell loads without a network",
          ordinal: 0,
        },
      ],
    },
    { id: "msg_d6i", type: "idle", outcome: "succeeded", time: { created: now() - 4 * day } },
  ],
};

const MODELS = [
  { providerID: "opencode", id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free", type: "chat", enabled: true, variants: [], limit: { context: 1_000_000, output: 384_000 }, status: "active" },
  {
    providerID: "anthropic",
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    type: "chat",
    enabled: true,
    variants: [{ id: "low" }, { id: "high" }, { id: "max" }],
    limit: { context: 500_000, output: 64_000 },
    status: "active",
  },
  { providerID: "openai", id: "gpt-6-sol", name: "GPT-6 Sol", type: "chat", enabled: true, variants: [], limit: { context: 400_000, output: 32_000 }, status: "active" },
  { providerID: "google", id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen", type: "chat", enabled: true, variants: [], limit: { context: 1_049_000, output: 65_000 }, status: "active" },
];

const AGENTS = [
  { id: "build", name: "Build", mode: "primary", hidden: false, description: "The default agent. Executes tools and edits files." },
  { id: "plan", name: "Plan", mode: "primary", hidden: false, description: "Read-only agent for planning and research." },
  { id: "explore", name: "Explore", mode: "subagent", hidden: false, description: "Fast search across the repo." },
];

const PROJECTS = [
  { id: "prj_web", canonical: DIRS.web, time: { active: now() - 5 * min } },
  { id: "prj_api", canonical: DIRS.api, time: { active: now() - 30 * min } },
  { id: "prj_notes", canonical: DIRS.notes, time: { active: now() - 4 * day } },
];

const SKILLS = [
  { id: "opencode", name: "OpenCode", description: "How OpenCode itself works", autoinvoke: true, path: "/home/you/.config/opencode/skills/opencode/SKILL.md", content: "# OpenCode\n" },
  { id: "browser", name: "Browser", description: "Drive a real browser with CDP", autoinvoke: false, path: "/home/you/.config/opencode/skills/browser/SKILL.md", content: "# Browser\n" },
  { id: "report", name: "Report", description: "File a bug report with diagnostics", autoinvoke: false, path: "/home/you/.config/opencode/skills/report/SKILL.md", content: "# Report\n" },
];

const SAVED_RULES = [
  { id: "psv_demo1", projectID: "prj_web", action: "read", resource: "*", time: { created: now() - 12 * day, updated: now() - 12 * day } },
  { id: "psv_demo2", projectID: "prj_web", action: "bash", resource: "git *", time: { created: now() - 3 * day, updated: now() - 3 * day } },
];

const DIFFS = [
  {
    file: "src/auth/session.ts",
    status: "modified",
    additions: 6,
    deletions: 4,
    patch: "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,9 +1,11 @@\n export async function setSession(token, rememberMe) {\n-  await cookies.set(\"access\", token.access, { maxAge: 60 * 15 })\n+  await cookies.set(\"access\", token.access, { maxAge: 60 * 15 })\n+  await cookies.set(\"refresh\", token.refresh, { maxAge: 60 * 60 * 24 })\n   if (rememberMe) {\n-    await cookies.set(\"refresh\", token.refresh)\n+    await cookies.set(\"refresh\", token.refresh, { maxAge: 60 * 60 * 24 * 30 })\n   }\n }",
  },
  {
    file: "src/http/rate-limit.ts",
    status: "added",
    additions: 96,
    deletions: 0,
    patch: "--- /dev/null\n+++ b/src/http/rate-limit.ts\n@@ -0,0 +1,6 @@\n+const WINDOW = 60_000\n+const LIMIT = 60\n+\n+export function allow(key, now) {\n+  return hits(key, now) <= LIMIT\n+}",
  },
];

const clone = (v) => JSON.parse(JSON.stringify(v));

export class MockApi {
  constructor() {
    this.sessionList = clone(SESSIONS);
    this.messageMap = clone(MESSAGES);
    this.handlers = [];
    this.timers = new Set();
    this.modelList = clone(MODELS);
    this.agentList = clone(AGENTS);
    this.projectList = clone(PROJECTS);
    this.seq = 100;
    this.diffs = clone(DIFFS);
    this.revert = null;
  }

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  emit(type, data) {
    for (const h of this.handlers) h({ id: "evt_" + this.seq, type, data, created: now() });
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  async info() {
    return { version: "2.3.0", pid: 4242, hostname: "pixel", urls: [], paths: { tmp: "/tmp" } };
  }

  async listSessions({ search = "" } = {}) {
    const q = search.toLowerCase();
    const data = this.sessionList
      .filter((s) => !q || (s.title ?? "").toLowerCase().includes(q) || s.location.directory.toLowerCase().includes(q))
      .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0));
    return { data: clone(data), cursor: { previous: null, next: null } };
  }

  async createSession({ directory, model }) {
    const id = "ses_demo_" + Math.random().toString(36).slice(2, 8);
    const s = {
      id,
      projectID: "prj_new",
      agent: "build",
      model: model ?? MODEL,
      title: "New session",
      location: { directory: directory || DIRS.web },
      time: { created: now(), updated: now() },
    };
    this.sessionList.unshift(s);
    this.messageMap[id] = [];
    this.emit("session.created", { sessionID: id });
    return { data: clone(s) };
  }

  async updateSession(id, patch) {
    const s = this.sessionList.find((x) => x.id === id);
    if (s && patch.title) {
      s.title = patch.title;
      s.time.updated = now();
      this.emit("session.renamed", { sessionID: id, title: patch.title });
    }
    return { data: clone(s ?? {}) };
  }

  async deleteSession(id) {
    this.sessionList = this.sessionList.filter((x) => x.id !== id);
    delete this.messageMap[id];
    this.emit("session.deleted", { sessionID: id });
    return {};
  }

  async messages(id) {
    return { data: clone([...(this.messageMap[id] ?? [])].reverse()), cursor: { previous: null, next: null } };
  }

  async permissions() {
    return { data: [] };
  }

  async replyPermission() {
    return {};
  }

  async models() {
    return clone(this.modelList);
  }

  async agents() {
    return clone(this.agentList);
  }

  async projects() {
    return clone(this.projectList);
  }

  /* the same feature surface as the real client, answered from memory */
  async findFiles(query, { limit = 40 } = {}) {
    const names = [
      "src/auth/session.ts",
      "src/auth/middleware.ts",
      "src/ui/permission-sheet.tsx",
      "src/http/rate-limit.ts",
      "src/http/webhooks.ts",
      "db/migrations/0007_usage_logs.sql",
      "package.json",
      "README.md",
      "docs/launch-notes.md",
    ];
    const q = String(query || "").toLowerCase();
    return names
      .filter((n) => !q || n.toLowerCase().includes(q))
      .slice(0, limit)
      .map((p) => ({ path: p, type: "file" }));
  }

  async listDir() {
    return [{ path: "src", type: "directory" }, { path: "docs", type: "directory" }, { path: "package.json", type: "file" }];
  }

  async readFile(path) {
    return "// " + path + "\n// demo mode: file contents are not fetched\n";
  }

  async sessionDiff() {
    return clone(this.diffs);
  }

  async sessionContext() {
    return [];
  }

  async forkSession(id) {
    const s = this.sessionList.find((x) => x.id === id);
    const forked = { ...clone(s ?? {}), id: "ses_demo_fork", title: (s?.title ?? "Session") + " (fork)" };
    this.sessionList.unshift(forked);
    this.messageMap[forked.id] = clone(this.messageMap[id] ?? []);
    return { data: forked };
  }

  async compactSession(id) {
    this.later(() => this.emit("session.compaction.ended", { sessionID: id, reason: "manual", text: "summary" }), 400);
    return { data: { id: "msg_compact", sessionID: id, type: "compaction", payload: {}, delivery: "steer" } };
  }

  async stageRevert(id, messageID) {
    const revert = { messageID, files: clone(this.diffs) };
    this.revert = revert;
    this.later(() => this.emit("session.revert.staged", { sessionID: id, revert }), 120);
    return { data: revert };
  }

  async commitRevert(id) {
    this.revert = null;
    this.emit("session.revert.committed", { sessionID: id });
    return {};
  }

  async clearRevert(id) {
    this.revert = null;
    this.emit("session.revert.cleared", { sessionID: id });
    return {};
  }

  async viewSession() {
    return {};
  }

  async runShell(id, command) {
    this.messageMap[id] = [...(this.messageMap[id] ?? []), { id: "msg_sh_" + this.seq++, type: "shell", shellID: "shl_demo", command, status: "completed", exit: 0, output: { text: "" }, time: { created: now(), completed: now() } }];
    this.later(() => this.emit("session.shell.ended", { sessionID: id }), 300);
    return {};
  }

  async skills() {
    return clone(SKILLS);
  }

  async activateSkill(id, skillID) {
    const skill = SKILLS.find((s) => s.id === skillID) ?? SKILLS[0];
    this.messageMap[id] = [...(this.messageMap[id] ?? []), { id: "msg_sk_" + this.seq++, type: "skill", skill: skill.id, name: skill.name, text: skill.content, time: { created: now() } }];
    this.later(() => this.emit("session.skill.activated", { sessionID: id, skill: skill.id }), 200);
    return {};
  }

  async references() {
    return [];
  }

  async mcpServers() {
    return [{ name: "blender-mcp", title: "Blender", status: { status: "connected" } }, { name: "playwright", title: "Playwright", status: { status: "connected" } }, { name: "tinyfish", title: "TinyFish", status: { status: "connected" } }, { name: "audio", title: "Audio", status: { status: "failed", error: "MCP server process exited with code 2" } }, { name: "godot", title: "Godot", status: { status: "disabled" } }];
  }

  async providers() {
    return [{ id: "opencode", name: "OpenCode", activation: "enabled" }, { id: "anthropic", name: "Anthropic", activation: "auto" }, { id: "openai", name: "OpenAI", activation: "auto" }, { id: "google", name: "Google", activation: "auto" }, { id: "ollama", name: "Ollama", activation: "disabled" }];
  }

  async savedPermissions() {
    return clone(SAVED_RULES);
  }

  async removeSavedPermission(id) {
    const i = SAVED_RULES.findIndex((r) => r.id === id);
    if (i >= 0) SAVED_RULES.splice(i, 1);
    return {};
  }

  async worktrees() {
    return [];
  }

  async defaultModel() {
    return clone(MODEL);
  }

  async stats() {
    return { range: { from: now() - 30 * day, to: now() }, sessions: 284, subagents: 12, prompts: 3868, steps: 9241, tokens: { input: 185_662_416, output: 4_120_988, reasoning: 902_140, cache: { read: 61_204_331, write: 3_119_204 } }, cost: 0.96, tools: { total: 5120 }, activeDays: 41, streak: 6, activity: [], models: [] };
  }

  async commands() {
    return { data: [{ name: "init", description: "Create an AGENTS.md for this project" }, { name: "review", description: "Review the current changes" }] };
  }

  async switchModel(id, model) {
    const s = this.sessionList.find((x) => x.id === id);
    if (s) {
      s.model = model;
      this.emit("session.model.selected", { sessionID: id, model });
    }
    return { data: clone(s ?? {}) };
  }

  async switchAgent(id, agent) {
    const s = this.sessionList.find((x) => x.id === id);
    if (s) {
      s.agent = agent;
      this.emit("session.agent.selected", { sessionID: id, agent });
    }
    return { data: clone(s ?? {}) };
  }

  async interrupt(id) {
    this.clearTimers();
    this.emit("session.execution.interrupted", { sessionID: id });
    this.later(() => this.emit("session.idle", { sessionID: id }), 200);
    return { interrupted: true };
  }

  streamEvents(onEvent, onStatus) {
    this.handlers.push(onEvent);
    onStatus?.("online");
    setTimeout(() => onEvent({ id: "evt_connect", type: "server.connected", data: {}, created: now() }), 30);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== onEvent);
    };
  }

  prompt(id, { text, files }) {
    const sid = id;
    if (/\b(fail|error|rate.?limit|429)\b/i.test(text)) return this.failTurn(sid, text);
    const userMsg = {
      id: "msg_u_" + this.seq++,
      type: "user",
      text,
      files: (files ?? []).map((f) => ({ uri: f.uri, name: f.name, mime: "image/jpeg" })),
      time: { created: now() },
    };
    const assistantId = "msg_a_" + this.seq++;
    const reply =
      text.startsWith("/")
        ? "That command isn't available in the demo. Ask me a question instead — try “fix the logout bug”."
        : "Here's how I'd approach it:\n\n1. Reproduce the issue locally with `bun run dev`\n2. Add the missing cookie write in `src/auth/session.ts`\n3. Leave the app idle for 20 minutes and confirm the session survives\n\n```ts\nawait cookies.set(\"refresh\", token.refresh, {\n  httpOnly: true,\n  sameSite: \"lax\",\n})\n```\n\nWant me to apply the patch?";

    const assistant = { id: assistantId, type: "assistant", model: MODEL, agent: "build", content: [{ type: "text", text: "", ordinal: 0 }], time: { created: now() } };
    assistant.cost = 0.0037;
    assistant.tokens = { input: 18400, output: 412, reasoning: 96, cache: { read: 12200, write: 0 } };
    this.messageMap[sid] = [...(this.messageMap[sid] ?? []), userMsg, assistant];
    this.emit("session.inbox.enqueued", { sessionID: sid, inboxID: userMsg.id, item: { type: "user", payload: { text }, delivery: "steer" } });

    this.later(() => this.emit("session.execution.started", { sessionID: sid }), 250);
    this.later(() => {
      this.emit("session.step.started", { sessionID: sid, assistantMessageID: assistantId, agent: "build", model: MODEL, started: now() });
      this.emit("session.text.started", { sessionID: sid, assistantMessageID: assistantId, ordinal: 0 });
    }, 450);

    const words = reply.split(/(\s+)/);
    let at = 700;
    let acc = "";
    for (const word of words) {
      acc += word;
      const snapshot = acc;
      this.later(() => {
        assistant.content[0].text = snapshot;
        this.emit("session.text.delta", { sessionID: sid, assistantMessageID: assistantId, ordinal: 0, delta: word });
      }, at);
      at += 22;
    }
    this.later(() => {
      this.emit("session.text.ended", { sessionID: sid, assistantMessageID: assistantId, ordinal: 0, text: reply });
      assistant.time.completed = now();
      this.emit("session.step.ended", { sessionID: sid, assistantMessageID: assistantId, finish: "stop" });
      this.emit("session.execution.succeeded", { sessionID: sid });
      this.messageMap[sid].push({ id: "msg_i_" + this.seq++, type: "idle", outcome: "succeeded", time: { created: now() } });
      this.emit("session.idle", { sessionID: sid });
      const s = this.sessionList.find((x) => x.id === sid);
      if (s) {
        s.title = s.title === "New session" ? text.slice(0, 60) : s.title;
        s.time.updated = now();
      }
    }, at + 120);

    return { data: { id: userMsg.id, sessionID: sid, type: "user", payload: { text }, delivery: "steer", time: { created: now() } } };
  }

/** Walks the same path a rejected provider call takes on a real server. */
  failTurn(sid, text) {
    const error = {
      type: "provider.rate-limit",
      message: "Rate limit reached for demo-provider/fast-1. The plan allows 60 requests per minute.",
      status: 429,
      retryAfterMs: 90_000,
    };
    const userMsg = {
      id: "msg_u_" + this.seq++,
      type: "user",
      text,
      files: [],
      time: { created: now() },
    };
    const assistantId = "msg_a_" + this.seq++;
    const assistant = {
      id: assistantId,
      type: "assistant",
      model: MODEL,
      agent: "build",
      content: [],
      retry: { attempt: 1, at: now(), error },
      time: { created: now() },
    };
    this.messageMap[sid] = [...(this.messageMap[sid] ?? []), userMsg, assistant];
    this.emit("session.inbox.enqueued", { sessionID: sid, inboxID: userMsg.id, item: { type: "user", payload: { text }, delivery: "steer" } });
    this.later(() => this.emit("session.execution.started", { sessionID: sid }), 200);
    this.later(() => {
      this.emit("session.retry.scheduled", { sessionID: sid, assistantMessageID: assistantId, attempt: 1, error });
    }, 500);
    this.later(() => {
      this.emit("session.step.failed", { sessionID: sid, assistantMessageID: assistantId, error });
      assistant.retry = undefined;
      assistant.error = error;
      assistant.finish = "error";
      assistant.time.completed = now();
      this.emit("session.execution.failed", { sessionID: sid, error });
      this.messageMap[sid].push({ id: "msg_i_" + this.seq++, type: "idle", outcome: "failed", error, time: { created: now() } });
      this.emit("session.idle", { sessionID: sid });
      const s = this.sessionList.find((x) => x.id === sid);
      if (s) {
        s.title = s.title === "New session" ? text.slice(0, 60) : s.title;
        s.time.updated = now();
      }
    }, 1900);
    return { data: { id: userMsg.id, sessionID: sid, type: "user", payload: { text }, delivery: "steer", time: { created: now() } } };
  }

  command(id, { name, text }) {
    return this.prompt(id, { text: `/${name} ${text ?? ""}`.trim() });
  }
}

