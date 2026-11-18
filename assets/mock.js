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
  { providerID: "opencode", id: "big-pickle", name: "Big Pickle", type: "chat", enabled: true, variants: [], limit: { context: 1_000_000, output: 384_000 }, status: "active" },
  {
    providerID: "opencode",
    id: "deepseek-v4.1-flash-free",
    name: "DeepSeek V4.1 Flash Free",
    type: "chat",
    enabled: true,
    variants: [],
    limit: { context: 1_000_000, output: 384_000 },
    status: "active",
  },
  { providerID: "opencode", id: "glm-5.3-flash-free", name: "GLM 5.3 Flash Free", type: "chat", enabled: true, variants: [], limit: { context: 200_000, output: 65_000 }, status: "active" },
  { providerID: "openai", id: "gpt-6-sol", name: "GPT-6 Sol", type: "chat", enabled: true, variants: [], limit: { context: 400_000, output: 32_000 }, status: "active" },
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

// One session was opened after its last turn, one was not: the list needs both
// states to look right.
SESSIONS.find((s) => s.id === "ses_demo2").time.viewed = now() - 5 * hour;
/* ---- extra demo sessions: artifacts, long code, diagrams, documents ------
   These exist so the public demo exercises the same surfaces a real session
   does: a full HTML page, a real file, a diagram and a structured document. */

const DEMO_PAGE = `<main class="settings">
  <h1>Appearance</h1>
  <label class="row">
    <span>Theme</span>
    <select id="theme">
      <option value="amoled">Black</option>
      <option value="dark">Dark</option>
      <option value="light">Light</option>
    </select>
  </label>
  <label class="row">
    <span>Text size</span>
    <input id="size" type="range" min="0.9" max="1.3" step="0.05" value="1" />
  </label>
  <button id="save">Save</button>
  <output id="status"></output>
</main>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #000; color: #ededf0; font: 15px/1.5 system-ui, sans-serif; }
  .settings { padding: 24px 18px; display: grid; gap: 14px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  select, input[type="range"] { accent-color: #4f8dfd; }
  button { background: #4f8dfd; color: #fff; border: 0; border-radius: 10px; padding: 11px; font: inherit; }
  output { color: #8d8d96; font-size: 13px; }
</style>
<script>
  const status = document.getElementById("status");
  document.getElementById("save").addEventListener("click", () => {
    status.textContent = "Saved " + document.getElementById("theme").value;
  });
<\/script>`;

const DEMO_MODULE = `import { createHash } from "node:crypto";

export interface UploadResult {
  key: string;
  bytes: number;
  checksum: string;
}

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Stores a file in the media bucket and returns a content-addressed key.
 * Small enough to stay readable, strict enough to trust under load.
 */
export async function upload(
  bucket: MediaBucket,
  name: string,
  body: Uint8Array,
): Promise<UploadResult> {
  if (body.byteLength === 0) throw new Error("empty upload: " + name);
  if (body.byteLength > MAX_BYTES) throw new Error("upload too large: " + name);

  const checksum = createHash("sha256").update(body).digest("hex");
  const key = \`uploads/\${checksum.slice(0, 2)}/\${checksum}\`;

  await bucket.put(key, body, {
    contentType: guessType(name),
    cacheControl: "public, max-age=31536000, immutable",
  });

  return { key, bytes: body.byteLength, checksum };
}

export function guessType(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}`;

const DEMO_DIAGRAM = `flowchart TD
  A[Prompt] --> B{Inbox}
  B -- steer --> C[Running turn]
  B -- queue --> D[Waiting]
  D --> C
  C --> E[Tool calls]
  E --> F{Needs an answer?}
  F -- yes --> G[Form]
  G --> C
  F -- no --> H[Answer]
  H --> I[Idle]`;

const DEMO_DOC = `# Release checklist

Every release runs the same loop, in this order, so nothing ships half-checked.

## Before tagging

- Freeze the branch and announce it in the channel
- Run the full test suite on the release commit, not on a merge commit
- Re-read the diff of every dependency bump
- Confirm the changelog names user-visible changes, not commits

## Tagging

- Create an annotated tag with the version and a one-line summary
- Push the tag and wait for the build to publish all platform artifacts
- Verify the install command on a clean machine before announcing

## After release

- Watch the error rate for an hour, with the alert threshold lowered
- Reply in the issue tracker to everyone who reported a fixed bug
- Write down what slowed this release down, while it is still fresh`;

// A transcript that exercises the whole rendering stack: callouts, math, a
// diagram, highlighted code, tasks, footnotes, a table and an image. It is the
// fixture suite-11 reads, and it is what the demo shows when someone asks for
// "markdown".
const DEMO_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAAA4CAYAAAACRf2iAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAIlSURBVHhe7ZfLkcIwEEQJdEMhDS7EwJUESICjU6CKILRllzHjcY9kjOX21vZUvYv1QZqnH4fjT0qCx8F/ENsiAWQkgIwEkJEAMhJARgLISAAZCSAjAWQkgIwEkJEAMhJARgLISAAZCSAjAWQkgIwEkJEAMhJARgLISAAZCSCzSMDpmsrxSOkE2tbGjq05T8v3Rj0BfdyO0/Y12VJAc59++5TqAtIKg/yELQQMv7HC3L4W8Lzmy9u4gD5qUV3A2UxsrwJabo93HSSgeRdn6w3YifeBfjsSMFoU4H663E15H348qE4XoL+5VBGQ2wG+zAfqL5x4G27ySEAp+WgxvMJKDMcB+pzL1wKKYbfpMaWnKbIXtE3C6OiwK99M1CYjWundd7dzcqva9hPu4L0dQaWwg48m22HlmInZNqMXla1vxIwEuBXrk98yiPfJNIke7cq/IgAdJXaVZ5NhytG3HOHYULLcjgzDtt2bAJToiFIy0bYvtfGEAtCuAxc7jP8iAJWjbzm8gOaKj6qOJclc0ibDpgJWvQMCOZNLuDDeoY8Zr6ncOJeyqQC/5aNX0CjRwStotNJNIqLEIVktVrCdS1Q/uvyXsq0AnzgQk52Re3/3YRMUCcgdHXP/B4T1vxCxuYAXk0n4leZBFyY4AkIB7pL3xxmSHI4HvJ7CugUWCRDrIQFkJICMBJCRADISQEYCyEgAGQkgIwFkJICMBJCRADISQEYCyEgAGQkgIwFkJICMBJCRADISQEYCyPwC3vl+OPtPLhUAAAAASUVORK5CYII=";

const RICH_ANSWER = `## Session refresh

The redirect is fine; the cookie is not. The token is written without an expiry, so it dies with the process.

> [!WARNING]
> Restart the dev server after changing the cookie options, or the old flow keeps answering.

| Field | Value |
| --- | --- |
| \`httpOnly\` | \`true\` |
| \`sameSite\` | \`lax\` |
| Expiry | 30 days |

- [x] read \`src/auth/session.ts\`
- [ ] set a 30-day expiry
- [ ] test after 20 minutes

The lifetime follows $T_{exp} = 30\\,d$ and the refresh curve is:

$$
r = \\frac{n}{1 + n \\cdot e^{-k(x - x_0)}}
$$

\`\`\`mermaid
flowchart LR
  A[Login] --> B{Cookie?}
  B -- yes --> C[Refresh]
  B -- no --> D[Redirect]
\`\`\`

\`\`\`ts
await cookies.set("refresh", token.refresh, {
  httpOnly: true,
  sameSite: "lax",
  maxAge: 60 * 60 * 24 * 30,
});
\`\`\`

![the refreshed logo](${DEMO_IMAGE})

**नमस्ते** — the Hindi text has to survive untouched. A claim needs a source[^1].

[^1]: the session notes in \`docs/API-MAP.md\``;

MESSAGES.ses_demo10 = [
  {
    id: "msg_d10u",
    type: "user",
    text: "Session logout ho raha hai 20 minute baad. Explain with the flow and what to change.",
    files: [],
    time: { created: now() - 50 * min },
  },
  {
    id: "msg_d10a",
    type: "assistant",
    model: MODEL,
    agent: "build",
    time: { created: now() - 50 * min, completed: now() - 49 * min },
    tokens: { input: 21_300, output: 940, cache: { read: 15_200, write: 0 } },
    cost: 0.0033,
    content: [
      { type: "reasoning", text: "Explain the refresh path, then show the cookie change.", ordinal: 0 },
      { type: "text", text: RICH_ANSWER, ordinal: 1 },
    ],
  },
  { id: "msg_d10i", type: "idle", outcome: "succeeded", time: { created: now() - 49 * min + 1_000 } },
];

MESSAGES.ses_demo7 = [
  {
    id: "msg_d7u",
    type: "user",
    text: "Build me a tiny settings page I can drop into the app. Black background, one select, one slider, a save button.",
    files: [],
    time: { created: now() - 3 * hour },
  },
  {
    id: "msg_d7a",
    type: "assistant",
    model: MODEL,
    agent: "build",
    time: { created: now() - 3 * hour, completed: now() - 3 * hour + 40_000 },
    tokens: { input: 12400, output: 720, cache: { read: 9100, write: 0 } },
    cost: 0.0021,
    content: [
      {
        type: "text",
        text: "Here's a self-contained page: no build step, no dependencies, and the theme select writes straight to `localStorage` so it survives a reload.",
        ordinal: 0,
      },
      tool("call_d7", "write", { filePath: "public/settings.html" }, "wrote 28 lines"),
      {
        type: "text",
        text: "```html\n" + DEMO_PAGE + "\n```\n\nOpen it directly — the preview tab in the artifact view runs it in a sandboxed frame.",
        ordinal: 1,
      },
    ],
  },
  { id: "msg_d7i", type: "idle", outcome: "succeeded", time: { created: now() - 3 * hour + 41_000 } },
];

// Shaped like a real loaded window. The server returns the last N messages, so a
// window can start in the middle of a turn: this one opens on a tool-only step
// from a turn whose user message is no longer loaded. The bucket pass and the
// render pass have to agree on that message's turn number, or the leading run
// shifts every later turn by one and the activity panels disappear.
MESSAGES.ses_demo9 = [
  {
    id: "msg_d9pre",
    type: "assistant",
    model: MODEL,
    agent: "build",
    time: { created: now() - 2 * hour, completed: now() - 2 * hour + 9_000 },
    content: [
      { type: "reasoning", text: "The window opened mid-turn: this step belongs to a request that is no longer in the loaded range.", ordinal: 0 },
      tool("call_d9pre", "shell", { command: "rg -n 'fs/find' src" }, "src/http/fs.ts:88"),
    ],
  },
  {
    id: "msg_d9u",
    type: "user",
    text: "Turn jo kar sakte ho karo — broken ripgrep ka workaround, stale pty dirs ki safai, aur report file.",
    files: [],
    time: { created: now() - 105 * min },
  },
  {
    id: "msg_d9s1",
    type: "assistant",
    model: MODEL,
    agent: "build",
    time: { created: now() - 105 * min, completed: now() - 104 * min },
    content: [
      { type: "reasoning", text: "Back up the runtime rootfs before touching anything in it.", ordinal: 0 },
      tool("call_d9a", "shell", { command: "cp -a rootfs rootfs.bak" }, "backed up"),
      tool("call_d9b", "shell", { command: "ls -la rootfs/bin | head" }, "total 42"),
    ],
  },
  {
    id: "msg_d9s2",
    type: "assistant",
    model: MODEL,
    agent: "build",
    time: { created: now() - 103 * min, completed: now() - 102 * min },
    content: [
      { type: "reasoning", text: "Write the shim now, then confirm the endpoint stops 500ing.", ordinal: 0 },
      tool("call_d9c", "execute", { code: "write rg shim" }, "shim written"),
      tool("call_d9d", "shell", { command: "curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:4098/api/fs/find?query=test'" }, "200"),
      tool("call_d9e", "shell", { command: "find . -name service.lock | wc -l" }, "219"),
    ],
  },
  { id: "msg_d9c", type: "compaction", status: "completed", reason: "auto", time: { created: now() - 101 * min } },
  {
    id: "msg_d9s3",
    type: "assistant",
    model: MODEL,
    agent: "build",
    time: { created: now() - 100 * min, completed: now() - 99 * min },
    content: [
      { type: "reasoning", text: "Report what was cleaned and what is still open.", ordinal: 0 },
      { type: "text", text: "`/api/fs/find` ab 200 de raha hai. Ab bache hue patterns test karta hoon.", ordinal: 1 },
      tool("call_d9f", "shell", { command: "curl -s 'http://127.0.0.1:4098/api/fs/find?query=*.md'" }, "no files found"),
    ],
  },
  { id: "msg_d9i", type: "idle", outcome: "succeeded", time: { created: now() - 99 * min + 2_000 } },
  {
    id: "msg_d9an",
    type: "assistant",
    model: MODEL,
    agent: "build",
    time: { created: now() - 98 * min, completed: now() - 96 * min },
    tokens: { input: 41_200, output: 1_180, cache: { read: 30_400, write: 0 } },
    cost: 0.0041,
    content: [
      { type: "reasoning", text: "Summarise the three fixes and what is still blocked.", ordinal: 0 },
      {
        type: "text",
        text: "## Kya theek hua\n\n| Cheez | Hal |\n| --- | --- |\n| ripgrep | musl build ka shim, `fs/find` 200 |\n| PTY dirs | 219 stale dirs hata diye |\n| health report | `app_report.md` update |\n\nBaaki do cheezein server ke config par depend karti hain, is liye unhein Pocket se theek nahi kiya ja sakta.",
        ordinal: 1,
      },
      tool("call_d9g", "grep", { pattern: "persistentPty", path: "src" }, "src/pty/daemon.ts:41"),
    ],
  },
  { id: "msg_d9i2", type: "idle", outcome: "succeeded", time: { created: now() - 95 * min } },
];

MESSAGES.ses_demo8 = [
  {
    id: "msg_d8u",
    type: "user",
    text: "Add a content-addressed upload helper, and sketch how a prompt moves through the inbox.",
    files: [],
    time: { created: now() - 4 * hour },
  },
  {
    id: "msg_d8a",
    type: "assistant",
    model: MODEL,
    agent: "build",
    time: { created: now() - 4 * hour, completed: now() - 4 * hour + 55_000 },
    tokens: { input: 18600, output: 1260, cache: { read: 14000, write: 0 } },
    cost: 0.0034,
    content: [
      {
        type: "text",
        text: "Two parts: the upload helper keys objects by their SHA-256 so identical files dedupe for free, and the flow sketch shows where a prompt can wait.",
        ordinal: 0,
      },
      tool("call_d8", "read", { filePath: "src/media/bucket.ts" }, "export interface MediaBucket {"),
      {
        type: "text",
        text: "```ts\n" + DEMO_MODULE + "\n```\n\nAnd the path a prompt takes, including the form branch that waits for a human:",
        ordinal: 1,
      },
      { type: "text", text: "```mermaid\n" + DEMO_DIAGRAM + "\n```", ordinal: 2 },
      {
        type: "text",
        text: "## Upload helper\n\n| Concern | How it is handled |\n| --- | --- |\n| Duplicates | keyed by SHA-256, so identical bytes dedupe |\n| File names | original name kept as metadata only |\n| Too large | rejected before the upload starts |\n\n## Inbox branch\n\nA queued prompt waits for the run to finish; a steer joins it immediately.",
        ordinal: 3,
      },
      { type: "text", text: DEMO_DOC, ordinal: 4 },
    ],
  },
  { id: "msg_d8i", type: "idle", outcome: "succeeded", time: { created: now() - 4 * hour + 56_000 } },
];

SESSIONS.push(
  {
    id: "ses_demo7",
    projectID: "prj_web",
    agent: "build",
    model: MODEL,
    title: "Build a settings page",
    location: { directory: DIRS.web },
    time: { created: now() - 3 * hour, updated: now() - 3 * hour, idle: now() - 3 * hour },
  },
  {
    id: "ses_demo8",
    projectID: "prj_api",
    agent: "build",
    model: MODEL,
    title: "Upload helper and inbox flow",
    location: { directory: DIRS.api },
    time: { created: now() - 4 * hour, updated: now() - 4 * hour, idle: now() - 4 * hour },
  },
  {
    id: "ses_demo9",
    projectID: "prj_api",
    agent: "build",
    model: MODEL,
    title: "Backend health check",
    location: { directory: DIRS.api },
    time: { created: now() - 2 * hour, updated: now() - 95 * min, idle: now() - 95 * min },
  },
  {
    id: "ses_demo10",
    projectID: "prj_api",
    agent: "build",
    model: MODEL,
    title: "Session refresh and cookie expiry",
    location: { directory: DIRS.api },
    time: { created: now() - 50 * min, updated: now() - 49 * min, idle: now() - 49 * min },
  }
);

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
    // pending forms, keyed by id: { form, sessionID }
    this.formMap = new Map();
    // queued prompts per session (delivery: "queue")
    this.inboxMap = new Map();
    // sessions with a turn in flight
    this.busySessions = new Set();
    // newest run per session; an older turn finishing must not clear it
    this.runSeq = 0;
    this.runs = new Map();
    // the run a waiting form belongs to
    this.formRuns = new Map();
    // pending permission requests, keyed by request id
    this.permissionMap = new Map();
    this.permissionRuns = new Map();
  }

  beginRun(sid) {
    const token = ++this.runSeq;
    this.runs.set(sid, token);
    this.busySessions.add(sid);
    return token;
  }

  /** True when this turn is still the newest one for the session. */
  endRun(sid, token) {
    if (this.runs.get(sid) !== token) return false;
    this.busySessions.delete(sid);
    this.drainQueue(sid);
    return true;
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

  /* ---- seen: opening a session clears its unread dot on the server ---- */

  async viewSession(id, idle) {
    const s = this.sessionList.find((x) => x.id === id);
    if (!s) return { ok: false };
    s.time = { ...(s.time ?? {}), viewed: Number(idle) || now() };
    return { ok: true };
  }

  async updateSession(id, patch) {
    const s = this.sessionList.find((x) => x.id === id);
    if (!s) return { data: {} };
    if (patch.title) {
      s.title = patch.title;
      s.time.updated = now();
      this.emit("session.renamed", { sessionID: id, title: patch.title });
    }
    // Archive is a client-visible flag on the session, not a delete. The server
    // keeps returning it; the list hides it unless archived ones are asked for.
    if (patch.archived !== undefined) {
      if (patch.archived) s.time.archived = now();
      else delete s.time.archived;
      s.time.updated = now();
      this.emit("session.updated", { sessionID: id, archived: !!patch.archived });
    }
    return { data: clone(s) };
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

  /* ---- forms: the question tool pauses the turn until it is answered ---- */

  async forms(sessionID = null) {
    return [...this.formMap.values()]
      .filter((f) => !sessionID || f.form.sessionID === sessionID)
      .map((f) => clone(f.form));
  }

  async replyForm(sessionID, formID, answer) {
    const entry = this.formMap.get(formID);
    const token = this.formRuns.get(formID);
    this.formMap.delete(formID);
    this.formRuns.delete(formID);
    this.emit("form.replied", { id: formID, sessionID, answer });
    // The turn continues with the answer the user picked.
    const shown = Object.values(answer ?? {})
      .map((v) => (Array.isArray(v) ? v.join(", ") : String(v)))
      .join(", ");
    this.later(() => this.finishWith(sessionID, `Thanks — going with **${shown}**.`, token), 220);
    return { ok: true };
  }

  async cancelForm(sessionID, formID) {
    const token = this.formRuns.get(formID);
    this.formMap.delete(formID);
    this.formRuns.delete(formID);
    this.emit("form.cancelled", { id: formID, sessionID });
    this.later(() => this.finishWith(sessionID, "Dismissed the question, so I stopped there.", token), 200);
    return { ok: true };
  }

  /* ---- inbox: prompts waiting for the running turn ---- */

  async inbox(sessionID) {
    return clone(this.inboxMap.get(sessionID) ?? []);
  }

  async setInboxDelivery(sessionID, inboxID, delivery) {
    const items = this.inboxMap.get(sessionID) ?? [];
    const item = items.find((x) => x.id === inboxID);
    if (item) {
      item.delivery = delivery;
      this.emit("session.inbox.updated", { sessionID, inboxID, delivery });
    }
    return { ok: true };
  }

  async cancelInbox(sessionID, inboxID) {
    this.inboxMap.set(sessionID, (this.inboxMap.get(sessionID) ?? []).filter((x) => x.id !== inboxID));
    this.emit("session.inbox.cancelled", { sessionID, inboxID });
    return { ok: true };
  }

  async permissions() {
    return { data: [...this.permissionMap.values()].map((p) => clone(p.request)) };
  }

  async replyPermission(sessionID, requestID, decision) {
    const entry = this.permissionMap.get(requestID);
    this.permissionMap.delete(requestID);
    this.emit("permission.replied", { sessionID, requestID, decision });
    const token = entry ? this.permissionRuns.get(requestID) : undefined;
    this.permissionRuns.delete(requestID);
    this.later(
      () =>
        this.finishWith(
          sessionID,
          decision === "reject" ? "Okay — I won't run it." : "Approved. Running it now.",
          token
        ),
      200
    );
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

  async vcsStatus() {
    return { data: [{ path: "src/auth/session.ts", status: "M" }, { path: "src/http/rate-limit.ts", status: "A" }] };
  }

  async vcsBranch() {
    return { branch: "fix/session-ttl" };
  }

  async exportSession(id) {
    return {
      info: clone(this.sessionList.find((s) => s.id === id) ?? {}),
      messages: clone(this.messageMap[id] ?? []),
    };
  }

  async request() {
    return { ok: true };
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

  async viewSession(id) {
    const s = this.sessionList.find((x) => x.id === id);
    if (s) s.time.viewed = now();
    // A long task keeps a checklist; publish it once when the session opens.
    if (id === "ses_demo8") {
      this.later(() => this.emit("session.todo.updated", {
        sessionID: id,
        todos: [
          { content: "Read the media bucket interface", status: "complete" },
          { content: "Implement content-addressed upload", status: "complete" },
          { content: "Sketch the inbox flow", status: "in_progress" },
          { content: "Add a regression test", status: "pending" },
        ],
      }), 700);
    }
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

  /* ---- MCP: the server's list is the only source of status ---- */

  mcpSeed() {
    // A demo server is reachable when it points somewhere reachable from the
    // phone; the rest fail, which is what the real server reports too.
    this.mcpServersCache = this.mcpServersCache ?? [
      { name: "blender-mcp", status: { status: "connected" }, reachable: true },
      { name: "playwright", status: { status: "connected" }, reachable: true },
      { name: "tinyfish", status: { status: "connected" }, reachable: true },
      { name: "audio", status: { status: "failed", error: "MCP server process exited with code 2" }, reachable: false },
      { name: "godot", status: { status: "disabled" }, reachable: true },
    ];
    return this.mcpServersCache;
  }

  async mcpServers() {
    return clone(this.mcpSeed().map(({ name, status, integrationID }) => ({ name, status, integrationID })));
  }

  async mcpAdd(name, config) {
    // Writing config makes the real server start that process before it answers
    // (about 9s on the device), so the demo takes a moment too: the progress
    // state is part of what has to be visible.
    await new Promise((r) => setTimeout(r, 500));
    const list = this.mcpSeed();
    const reachable = config?.type === "local" ? true : /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(config?.url ?? "");
    const next = reachable
      ? { name, status: { status: "connected" }, reachable: true }
      : { name, status: { status: "failed", error: "ECONNREFUSED: Unable to connect. Is the computer able to access the url?" }, reachable: false };
    // PUT replaces: the same name is the same server.
    const at = list.findIndex((x) => x.name === name);
    if (at >= 0) list[at] = next;
    else list.push(next);
    return { ok: true };
  }

  async mcpConnect(server) {
    const s = this.mcpSeed().find((x) => x.name === server);
    // The real route answers 204 whether or not the connection worked, so a
    // failed server stays failed here too and the caller has to re-read.
    if (s) s.status = s.reachable
      ? { status: "connected" }
      : { status: "failed", error: "ECONNREFUSED: Unable to connect. Is the computer able to access the url?" };
    return { ok: true };
  }

  async mcpDisconnect(server) {
    const s = this.mcpSeed().find((x) => x.name === server);
    if (s) s.status = { status: "disabled" };
    return { ok: true };
  }

  async mcpRemove(server) {
    await new Promise((r) => setTimeout(r, 500));
    this.mcpServersCache = this.mcpSeed().filter((x) => x.name !== server);
    return { ok: true };
  }

  async mcpResources() {
    if (!this.mcpSeed().some((x) => x.status?.status === "connected")) return { resources: [], templates: [] };
    return {
      resources: [
        { uri: "file:///project/README.md", name: "README.md" },
        { uri: "file:///project/AGENTS.md", name: "AGENTS.md" },
      ],
      templates: [{ uriTemplate: "file:///project/{path}", name: "Project files" }],
    };
  }

  async schedules() {
    this.scheduleCache = this.scheduleCache ?? [];
    return clone(this.scheduleCache);
  }

  async createSchedule(payload) {
    this.scheduleCache = this.scheduleCache ?? [];
    const item = {
      id: "sch_" + this.seq++,
      sessionID: payload.sessionID,
      name: payload.name ?? "Scheduled prompt",
      when: payload.when ?? { every: "1 hour" },
      tz: "Asia/Kolkata",
      action: { type: "prompt", prompt: payload.prompt },
      status: "active",
      runCount: 0,
      nextDueAt: Date.now() + 3600_000,
      time: { created: now(), updated: now() },
    };
    this.scheduleCache.push(item);
    return { data: clone(item) };
  }

  async pauseSchedule(id) {
    const s = this.scheduleCache?.find((x) => x.id === id);
    if (s) s.status = "paused";
    return { data: clone(s ?? {}) };
  }

  async resumeSchedule(id) {
    const s = this.scheduleCache?.find((x) => x.id === id);
    if (s) s.status = "active";
    return { data: clone(s ?? {}) };
  }

  async deleteSchedule(id) {
    this.scheduleCache = (this.scheduleCache ?? []).filter((x) => x.id !== id);
    return { ok: true };
  }

  async instructions() {
    return { data: [{ key: "AGENTS.md", source: "project", tokens: 240, content: "# Agent instructions\n\nBe concise and verify changes." }] };
  }

  async plugins() {
    return {
      data: [
        { id: "opencode.tool.input.repair", source: { type: "builtin" }, state: { status: "ready" } },
        { id: "opencode.notify.desktop", source: { type: "builtin" }, state: { status: "idle" } },
        { id: "pocket-format-on-save", source: { type: "local" }, state: { status: "ready" } },
      ],
    };
  }

  async providers() {
    // Real servers list only what they can run: OpenCode's free catalog plus
    // anything with a saved credential. Anthropic and Google stay unconnected
    // in the demo on purpose.
    return [
      { id: "opencode", name: "OpenCode", activation: "enabled" },
      { id: "openai", name: "OpenAI", activation: "auto" },
    ];
  }

  /* ---- provider connections and credentials (demo doubles) ---- */

  async integrations() {
    return [
      {
        id: "opencode",
        name: "OpenCode Console",
        methods: [
          { type: "key", label: "API key (service account)" },
          { type: "env", names: ["OPENCODE_API_KEY"] },
          {
            id: "device",
            type: "oauth",
            label: "OpenCode Console account",
            form: [{ key: "server", hidden: true, type: "string", format: "uri", default: "https://opencode.ai/console" }],
          },
        ],
        connections: [],
      },
      {
        id: "anthropic",
        name: "Anthropic",
        methods: [
          { type: "oauth", id: "claude", label: "Sign in with Claude" },
          { type: "key", label: "API key", form: [{ key: "key", title: "API key", placeholder: "sk-ant-…" }] },
        ],
        connections: [],
      },
      {
        id: "openai",
        name: "OpenAI",
        methods: [
          { type: "oauth", id: "chatgpt", label: "Sign in with ChatGPT" },
          { type: "key", label: "API key", form: [{ key: "key", title: "API key", placeholder: "sk-…" }] },
        ],
        connections: [{ type: "credential", credentialID: "cred_demo1" }],
      },
      {
        id: "google",
        name: "Google",
        methods: [{ type: "key", label: "API key", form: [{ key: "key", title: "API key" }] }],
        connections: [],
      },
      {
        id: "ollama",
        name: "Ollama",
        methods: [{ type: "env", names: ["OLLAMA_HOST"] }],
        connections: [{ type: "env", name: "OLLAMA_HOST" }],
      },
    ];
  }

  async integration(id) {
    const list = await this.integrations();
    const it = list.find((x) => x.id === id) ?? null;
    if (!it) return null;
    // The demo account signs in and out like the real one.
    if (id === "opencode") return { ...it, connections: this.opencodeConn ? [this.opencodeConn] : [] };
    return it;
  }

  async credentials() {
    return [
      {
        id: "cred_demo1",
        integrationID: "openai",
        label: "Personal",
        active: true,
        value: { type: "key", key: "sk-demo" },
      },
    ];
  }

  async connectKey(id, key) {
    this.toast?.("Connected " + id);
    return { ok: true };
  }

  async connectOAuth(id, methodID) {
    if (id === "opencode" && methodID === "device") {
      this.oauthPolls = 0;
      return {
        data: {
          attemptID: "con_demo_" + this.seq++,
          url: "https://opencode.ai/console/device?user_code=DEMO-CODE&client_id=opencode-cli",
          instructions: "Enter code: DEMO-CODE",
          mode: "auto",
          time: { created: now(), expires: now() + 10 * min },
        },
      };
    }
    return {
      data: {
        attemptID: "attempt_" + this.seq++,
        url: "https://example.invalid/oauth/demo",
        instructions: "Demo mode: no real browser sign-in happens. Any code finishes the flow.",
        mode: "auto",
        paste: true,
        time: { created: now(), expires: now() + 10 * min },
      },
    };
  }

  async completeOAuth() {
    return { ok: true };
  }

  async cancelOAuth() {
    return { ok: true };
  }

  async connectCommand(id, methodID) {
    return { data: { attemptID: "cmd_" + this.seq++, instructions: "Run `opencode auth login` in Termux." } };
  }

  async activateCredential(id) {
    return { ok: true };
  }

  async deleteCredential(id) {
    if (String(id).startsWith("conn_demo")) this.opencodeConn = null;
    return { ok: true };
  }

  async oauthAttempt(id, attemptID) {
    if (String(attemptID ?? "").startsWith("con_demo_")) {
      this.oauthPolls = (this.oauthPolls ?? 0) + 1;
      if (this.oauthPolls >= 2) {
        this.opencodeConn = { id: "conn_demo", type: "oauth", label: "Pocket", method: "device" };
        return { data: { status: "complete", time: { created: now(), expires: now() + 10 * min } } };
      }
      return { data: { status: "pending", time: { created: now(), expires: now() + 10 * min } } };
    }
    return { data: { status: "pending", time: { created: now(), expires: now() + 10 * min } } };
  }

  async commandAttempt() {
    return { data: { attemptID: "cmd_demo", time: { created: now(), expires: now() + 10 * min } } };
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
    return [
      { id: "wt_main", name: "main", branch: "main", path: DIRS.web, dirty: false },
      { id: "wt_fix", name: "fix/session-ttl", branch: "fix/session-ttl", path: DIRS.api, dirty: true },
    ];
  }

  async defaultModel() {
    return clone(MODEL);
  }

  async stats() {
    return { range: { from: now() - 30 * day, to: now() }, sessions: 284, subagents: 12, prompts: 3868, steps: 9241, tokens: { input: 185_662_416, output: 4_120_988, reasoning: 902_140, cache: { read: 61_204_331, write: 3_119_204 } }, cost: 0.96, tools: { total: 5120 }, activeDays: 41, streak: 6, activity: [], models: [] };
  }

  async commands() {
    return [
      { name: "init", description: "Create an AGENTS.md for this project" },
      { name: "review", description: "Review the current changes" },
    ];
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
    // Nothing is running after a stop: bump the run token so a stale finish
    // callback can never mark this session idle twice.
    this.runs.set(id, ++this.runSeq);
    this.busySessions.delete(id);
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

  prompt(id, { text, files, delivery = "steer" }) {
    const sid = id;

    // A queued prompt waits for the running turn, which is what the composer's
    // Steer/Queue chip asks for.
    if (delivery === "queue" && this.busySessions.has(sid)) {
      const inboxID = "msg_inbox_" + this.seq++;
      const item = {
        id: inboxID,
        sessionID: sid,
        type: "user",
        payload: { text },
        delivery: "queue",
        time: { created: now() },
      };
      this.inboxMap.set(sid, [...(this.inboxMap.get(sid) ?? []), item]);
      this.emit("session.inbox.enqueued", { sessionID: sid, inboxID, item });
      return { data: clone(item) };
    }

    if (/\b(fail|error|rate.?limit|429)\b/i.test(text)) return this.failTurn(sid, text);

    // The question tool: a form blocks the turn until it is answered.
    if (/\b(ask|question|choose|which)\b/i.test(text)) return this.openForm(sid, text);

    // Anything destructive asks for approval first, like the real permission gate.
    if (/\b(deploy|force.?push|rm -rf)\b/i.test(text)) return this.openPermission(sid, text);

    // The rich-markdown answer: streamed in chunks, so an unfinished code fence
    // and a half-written math block are both on screen for most of the turn.
    if (/\b(rich|markdown|render|diagram|math)\b/i.test(text)) return this.streamRich(sid, text);

    // Deterministic multi-step turn: two assistant messages in one request,
    // emitted step by step so the activity panel can be observed live (and so
    // the demo looks like a real turn instead of an instant paste).
    if (/multi-step/i.test(text)) {
      const u = { id: "msg_u_" + this.seq++, type: "user", text, files: [], time: { created: now() } };
      const a1 = "msg_a_" + this.seq++;
      const a2 = "msg_a_" + this.seq++;
      // The shells live in the stored transcript too: a real server keeps what
      // it streams, and the client reloads the session on idle.
      const a1m = { id: a1, type: "assistant", model: MODEL, agent: "build", content: [], time: { created: now() } };
      const a2m = { id: a2, type: "assistant", model: MODEL, agent: "build", content: [], time: { created: now() } };
      this.messageMap[sid] = [...(this.messageMap[sid] ?? []), u, a1m, a2m];
      const token = this.beginRun(sid);
      const ev = (name, data) => this.emit(name, { sessionID: sid, agent: "build", model: MODEL, ...data });

      this.later(() => ev("session.execution.started", {}), 200);
      this.later(() => {
        ev("session.step.started", { assistantMessageID: a1, started: now() });
        a1m.content.push({ type: "reasoning", text: "The session logic lives in src/auth/session.ts. Read it before editing.", ordinal: 0 });
        ev("session.reasoning.ended", {
          assistantMessageID: a1, ordinal: 0,
          text: "The session logic lives in src/auth/session.ts. Read it before editing.",
        });
        a1m.content.push({ type: "tool", id: "call_ms1", name: "read", executed: false, state: { status: "running", input: { filePath: "src/auth/session.ts" } } });
        ev("session.tool.called", { assistantMessageID: a1, id: "call_ms1", name: "read", input: { filePath: "src/auth/session.ts" } });
      }, 400);
      this.later(() => {
        const part = a1m.content.find((p) => p.type === "tool" && p.id === "call_ms1");
        if (part) part.state = { status: "completed", input: part.state.input, content: [{ type: "text", text: "read 120 lines" }], metadata: { status: "completed", exit: 0, truncated: false } };
        if (part) part.executed = true;
        ev("session.tool.success", {
          assistantMessageID: a1, id: "call_ms1", executed: true,
          content: [{ type: "text", text: "read 120 lines" }],
          metadata: { status: "completed", exit: 0, truncated: false },
        });
      }, 900);
      this.later(() => {
        a1m.content.push({ type: "text", text: "I read the session code. Now I will update it.", ordinal: 1, time: { completed: now() } });
        ev("session.text.ended", { assistantMessageID: a1, ordinal: 1, text: "I read the session code. Now I will update it." });
        ev("session.step.ended", { assistantMessageID: a1 });
      }, 1300);
      this.later(() => {
        ev("session.step.started", { assistantMessageID: a2, started: now() });
        a2m.content.push({ type: "reasoning", text: "The cookie is written without an expiry, so it dies with the process.", ordinal: 0 });
        ev("session.reasoning.ended", {
          assistantMessageID: a2, ordinal: 0,
          text: "The cookie is written without an expiry, so it dies with the process.",
        });
        a2m.content.push({ type: "tool", id: "call_ms2", name: "edit", executed: false, state: { status: "running", input: { filePath: "src/auth/session.ts" } } });
        ev("session.tool.called", { assistantMessageID: a2, id: "call_ms2", name: "edit", input: { filePath: "src/auth/session.ts" } });
      }, 1600);
      this.later(() => {
        const part = a2m.content.find((p) => p.type === "tool" && p.id === "call_ms2");
        if (part) part.state = { status: "completed", input: part.state.input, content: [{ type: "text", text: "applied 1 edit" }], metadata: { status: "completed", exit: 0, truncated: false } };
        if (part) part.executed = true;
        ev("session.tool.success", {
          assistantMessageID: a2, id: "call_ms2", executed: true,
          content: [{ type: "text", text: "applied 1 edit" }],
          metadata: { status: "completed", exit: 0, truncated: false },
        });
      }, 2100);
      this.later(() => {
        a2m.content.push({ type: "text", text: "Both steps are done.", ordinal: 1, time: { completed: now() } });
        ev("session.text.ended", { assistantMessageID: a2, ordinal: 1, text: "Both steps are done." });
        ev("session.step.ended", { assistantMessageID: a2 });
        ev("session.execution.succeeded", {});
      }, 2600);
      this.later(() => {
        a1m.tokens = { input: 3200, output: 42, reasoning: 210, cache: { read: 2800, write: 0 } };
        a1m.cost = 0.0004;
        a1m.time = { ...a1m.time, completed: now() };
        a2m.tokens = { input: 3400, output: 58, reasoning: 180, cache: { read: 3100, write: 0 } };
        a2m.cost = 0.0005;
        a2m.time = { ...a2m.time, completed: now() };
        if (this.endRun(sid, token)) this.emit("session.idle", { sessionID: sid });
      }, 2900);
      return { data: { id: u.id, sessionID: sid, type: "user", payload: { text }, delivery: "steer", time: { created: now() } } };
    }
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

    const runToken = this.beginRun(sid);
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
      this.endRun(sid, runToken);
    }, at + 120);

    return { data: { id: userMsg.id, sessionID: sid, type: "user", payload: { text }, delivery: "steer", time: { created: now() } } };
  }

  /** Streams the rich fixture in small chunks: fences and math arrive broken. */
  streamRich(sid, text) {
    const userMsg = { id: "msg_u_" + this.seq++, type: "user", text, files: [], time: { created: now() } };
    const assistantId = "msg_a_" + this.seq++;
    const assistant = {
      id: assistantId,
      type: "assistant",
      model: MODEL,
      agent: "build",
      content: [{ type: "text", text: "", ordinal: 0 }],
      time: { created: now() },
    };
    this.messageMap[sid] = [...(this.messageMap[sid] ?? []), userMsg, assistant];
    const runToken = this.beginRun(sid);

    this.later(() => this.emit("session.execution.started", { sessionID: sid }), 120);
    this.later(() => {
      this.emit("session.step.started", { sessionID: sid, assistantMessageID: assistantId, agent: "build", model: MODEL, started: now() });
      this.emit("session.text.started", { sessionID: sid, assistantMessageID: assistantId, ordinal: 0 });
    }, 260);

    let at = 320;
    let acc = "";
    for (const chunk of RICH_ANSWER.match(/[\s\S]{1,13}/g) ?? []) {
      acc += chunk;
      const snapshot = acc;
      this.later(() => {
        assistant.content[0].text = snapshot;
        this.emit("session.text.delta", { sessionID: sid, assistantMessageID: assistantId, ordinal: 0, delta: chunk });
      }, at);
      at += 17;
    }
    this.later(() => {
      assistant.time.completed = now();
      assistant.tokens = { input: 18_400, output: 900, cache: { read: 12_100, write: 0 } };
      assistant.cost = 0.0029;
      this.emit("session.text.ended", { sessionID: sid, assistantMessageID: assistantId, ordinal: 0, text: RICH_ANSWER });
      this.emit("session.step.ended", { sessionID: sid, assistantMessageID: assistantId, finish: "stop" });
      this.emit("session.execution.succeeded", { sessionID: sid });
      this.messageMap[sid].push({ id: "msg_i_" + this.seq++, type: "idle", outcome: "succeeded", time: { created: now() } });
      this.emit("session.idle", { sessionID: sid });
      this.endRun(sid, runToken);
    }, at + 160);

    return { data: { id: userMsg.id, sessionID: sid, type: "user", payload: { text }, delivery: "steer", time: { created: now() } } };
  }

  /** A destructive tool call waits for approval, like the real permission gate. */
  openPermission(sid, text) {
    const requestID = "per_" + this.seq++;
    const request = {
      id: requestID,
      sessionID: sid,
      action: "bash",
      resources: ["./deploy.sh production"],
      message: "The agent wants to run this command in your workspace.",
      metadata: { command: "./deploy.sh production" },
      time: { created: now() },
    };
    const userMsg = { id: "msg_u_" + this.seq++, type: "user", text, files: [], time: { created: now() } };
    this.messageMap[sid] = [...(this.messageMap[sid] ?? []), userMsg];
    this.permissionMap.set(requestID, { request, sessionID: sid });
    this.permissionRuns.set(requestID, this.beginRun(sid));
    this.later(() => this.emit("permission.asked", { permission: request, sessionID: sid }), 500);
    return { data: { id: userMsg.id, sessionID: sid, type: "user", payload: { text }, delivery: "steer", time: { created: now() } } };
  }

  /** Pauses the turn and asks through a form, exactly like the question tool. */
  openForm(sid, text) {
    const formID = "frm_" + this.seq++;
    const form = {
      id: formID,
      sessionID: sid,
      title: "Which approach should I take?",
      metadata: {},
      fields: [
        {
          key: "approach",
          type: "string",
          title: "Approach",
          description: "Both keep the public API the same.",
          required: true,
          options: [
            { value: "patch", label: "Patch the cookie write", description: "Smallest change, ships today" },
            { value: "refresh", label: "Add a refresh flow", description: "More code, no expiry surprises" },
            { value: "skip", label: "Leave it for now", description: "I'll just document it" },
          ],
          custom: true,
        },
        {
          key: "tests",
          type: "boolean",
          title: "Add a regression test?",
          default: true,
        },
        {
          key: "files",
          type: "multiselect",
          title: "Touch these files",
          options: [
            { value: "src/auth/session.ts", label: "session.ts" },
            { value: "src/auth/cookies.ts", label: "cookies.ts" },
          ],
          minItems: 0,
        },
        {
          key: "note",
          type: "string",
          title: "Anything else?",
          when: [{ key: "approach", op: "eq", value: "refresh" }],
          placeholder: "Only asked when you pick the refresh flow",
        },
      ],
    };
    const userMsg = { id: "msg_u_" + this.seq++, type: "user", text, files: [], time: { created: now() } };
    this.messageMap[sid] = [...(this.messageMap[sid] ?? []), userMsg];
    this.formMap.set(formID, { form, sessionID: sid });
    this.formRuns.set(formID, this.beginRun(sid));
    this.later(() => this.emit("session.execution.started", { sessionID: sid }), 200);
    this.later(() => this.emit("form.created", { form }), 600);
    return { data: { id: userMsg.id, sessionID: sid, type: "user", payload: { text }, delivery: "steer", time: { created: now() } } };
  }

  /** Closes a turn with a short answer (used after a form reply). */
  finishWith(sid, text, runToken) {
    const token = runToken ?? this.runs.get(sid);
    const assistantId = "msg_a_" + this.seq++;
    const assistant = {
      id: assistantId,
      type: "assistant",
      model: MODEL,
      agent: "build",
      content: [{ type: "text", text, ordinal: 0 }],
      time: { created: now(), completed: now() },
      tokens: { input: 4200, output: 48, cache: { read: 3100, write: 0 } },
      cost: 0.0009,
    };
    this.messageMap[sid] = [...(this.messageMap[sid] ?? []), assistant];
    this.emit("session.text.started", { sessionID: sid, assistantMessageID: assistantId, ordinal: 0 });
    this.emit("session.text.ended", { sessionID: sid, assistantMessageID: assistantId, ordinal: 0, text });
    this.messageMap[sid].push({ id: "msg_i_" + this.seq++, type: "idle", outcome: "succeeded", time: { created: now() } });
    this.emit("session.execution.succeeded", { sessionID: sid });
    this.emit("session.idle", { sessionID: sid });
    this.endRun(sid, token);
  }

  /** Runs whatever was queued while the session was busy. */
  drainQueue(sid) {
    const items = this.inboxMap.get(sid) ?? [];
    if (!items.length) return;
    const [next, ...rest] = items;
    this.inboxMap.set(sid, rest);
    this.emit("session.inbox.delivered", { sessionID: sid, inboxID: next.id, item: next });
    this.later(() => this.prompt(sid, { text: next.payload?.text ?? "", delivery: "steer" }), 260);
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
    const runToken = this.beginRun(sid);
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
      this.endRun(sid, runToken);
    }, 1900);
    return { data: { id: userMsg.id, sessionID: sid, type: "user", payload: { text }, delivery: "steer", time: { created: now() } } };
  }

  command(id, { name, text }) {
    return this.prompt(id, { text: `/${name} ${text ?? ""}`.trim() });
  }
}

