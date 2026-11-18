# OpenCode features vs OpenCode Pocket

A feature-by-feature audit of the official OpenCode clients and of this client.
Compiled against **OpenCode v2.3.0** (the version running on the phone), the
server's own OpenAPI document (139 paths, `GET /api/…`), and the official docs at
[opencode.ai/docs](https://opencode.ai/docs).

Last updated: 2026-11-17.

Legend: **yes** = works end to end · **part** = works but narrower than official ·
**no** = not implemented.

---

## 1. The surfaces

| Surface | What it is | Official | Pocket |
| --- | --- | --- | --- |
| Terminal TUI | Full-screen terminal client, diffs in the timeline, tabs, command palette | yes | n/a (Pocket is the GUI) |
| `opencode mini` | Replies print into your own shell scrollback | yes | n/a |
| `opencode run` | One-shot prompt for scripts/CI, `--format json`, `--auto` | yes | n/a |
| Desktop app | macOS/Windows/Linux GUI: tabs, review panel, built-in browser, GUI plugins | yes | **part** - web UI with the core chat loop |
| Web UI | Served by the same server, password protected, pairing link + QR | yes | **yes** (this project) |
| Mobile app | iOS beta / Android: steer sessions, voice calls, spoken results | yes | **part** - no voice, no pairing QR |
| SDK / JS client | `@opencode/sdk`, `opencode api`, REST + SSE | yes | n/a (Pocket *is* a client) |
| ACP | Agent Client Protocol for editor integrations | yes | n/a |
| Plugins | Server, TUI, GUI (sidebar panels), RPC | yes | **no** |

Pocket deliberately replaces the desktop/web client, not the server. Everything
below is judged by "can I do it from a phone with this UI".

---

## 2. Chat and transcript

| Feature | Official behaviour | Pocket |
| --- | --- | --- |
| Streaming text | SSE deltas, live caret | **yes** |
| Reasoning / thought process | Collapsible reasoning blocks | **yes** |
| Tool calls | One row per call, expandable input/output/exit code | **yes** |
| Activity summary row | TUI/desktop collapse a run of tools+thoughts into one row; verbosity `low`/`medium`/`high` | **yes** - one row per run, live counter, verbosity in Preferences |
| Diffs in the timeline | Each edit shows as a diff inline as it lands | **part** - diff chip + changes sheet; no inline diff per edit |
| Inline line comments | Desktop review panel: comment on any line, sent back to the agent | **no** |
| Failures | Provider reason, next step, wait time, retries as they happen | **yes** - `session.retry.scheduled` and `session.step.failed` render live |
| Interrupt | Stop a running turn | **yes** - one request, confirmed against the server when no `idle` arrives, and the composer returns to Send |
| Steer while running | Enter steers the active session | **yes** (sending a prompt mid-run) |
| Thinking vs Working | n/a - the TUI prints a spinner | **yes** - "Thinking" while the model works with no tool running, "Working" only while a tool is executing, one activity panel per request that becomes "Worked for Ns · N steps" when the turn closes |
| Connection loss mid-turn | n/a (the TUI is the server) | **yes** - a banner names the retry count, the budget is finite (8 attempts), and after it is spent a manual Retry appears; the transcript, session and pending prompt survive. A prompt that was sent over a dropped socket is never re-sent automatically: it gets Check server / Send again / Discard |
| Queue a prompt | TUI `Ctrl+X Enter`; server keeps an inbox per session | **yes** - Steer/Queue chip, queue strip, cancel and re-aim |
| Agent asks a question | `question` tool → a form with choices; blocks until answered | **yes** - inline card: choices, free text, multiselect, booleans, conditional fields |
| Attachments | File picker, paste, drag; text/PNG/JPEG/GIF/WebP/PDF up to 20 MiB | **part** - camera/gallery images only, resized client-side |
| @-mentions | `@path`, with `#20-45` line ranges | **part** - path search yes, line ranges no |
| Slash commands | Discovered from `.opencode/commands`, `$ARGUMENTS`, `$1..$n`, `!`shell blocks | **yes** |
| Shell mode | `!` at the start of a prompt runs it in the session | **part** - via the "Run a command" sheet, not `!` in the composer |
| Usage per answer | Tokens, cache, cost under the turn | **yes** |
| Markdown | Code, tables, lists, copy buttons | **yes** |
| Mermaid | Rendered, maximisable for pan/zoom | **yes** - drawn lazily when it scrolls into view, full-screen viewer with the source, and the two mistakes models make most often are repaired instead of failing: reserved class names (`:::end`) are renamed, and flowchart `note` lines (sequence syntax) are set aside with a line that says so |
| Todo list | `todowrite` tool renders as a live checklist | **yes** - progress panel at the top of the chat with a checkmark per step |
| Subagent runs | Child session, report arrives back in the parent | **part** - child sessions appear in the list, no linkage in the transcript |

---

## 3. Sessions

| Feature | Official | Pocket |
| --- | --- | --- |
| List, search, group by workspace/project | yes | **yes** |
| Rename / archive / unarchive / delete | yes | **yes** |
| Tabs (several sessions at once) | yes (desktop + TUI) | **no** |
| Recent sessions sidebar, pins, reorder | yes (desktop, experimental) | **no** |
| Read / unread + inbox badges | yes | **yes** - unread dot from `time.viewed`, cleared by `POST /api/session/{id}/view` when the conversation is opened |
| Inbox (queued prompts, delivered work) | yes | **yes** - queue-only strip above the composer, steer ↔ queue switch, cancel, `PATCH`/`DELETE /api/session/{id}/inbox` |
| Failed-run indicator on a tab | yes | **yes** - `.session-failed` dot driven by `outcome` |
| Archived sessions | hidden from the list | **yes** - hidden by default, an `Archived (n)` filter in the list header brings them back for unarchive |
| Fork a session | yes | **yes** (`POST /api/session/{id}/fork`) |
| Compact context | yes - also automatic, `keep.tokens`, `buffer`, background mode | **part** - manual only, automatic is server-side |
| Undo / revert | `/undo` stages a rollback, `/redo` cancels, next prompt commits | **yes** (stage → keep/drop, banner) |
| Jump to message | Search prompts inside a session, jump | **yes** - search sheet, scroll + highlight |
| Export / import | `session export` (JSON, `--sanitize`), `session import` | **yes** - export from the session menu, import from Settings |
| Move a session / worktrees | Move to another directory, create/list/remove worktrees | **part** - `GET /api/worktree` used for display only |
| Session info / metadata | yes | **yes** (info sheet: model, agent, tokens, cost, archived) |
| Synthetic messages | Client can inject a note into the transcript | **no** - `POST /api/session/{id}/synthetic` unused |

---

## 4. Models, agents and configuration

| Feature | Official | Pocket |
| --- | --- | --- |
| Model list + picker | All providers, search, reasoning variant (`#high`) | **yes** - only providers this server serves models for; a provider without a key offers its connect flow instead of its models |
| Switch model mid-session | yes | **yes** |
| Agent picker | build / plan / general / explore + custom (`Shift+Tab` cycles) | **yes** |
| Skills | `SKILL.md` discovery, `/skills`, load by ID, `@skill-id` | **yes** (list + activate) |
| Saved permissions | "Allow always" rules, reviewable and deletable | **yes** |
| Permission prompt | Allow once / always / reject, reject with feedback | **part** - no reject-with-feedback text |
| Permission scanner behaviour | Compound commands checked per subcommand | server-side (n/a) |
| Policies | Org-level hard deny (provider/tool/mcp/skill/plugin), managed files | server-side (n/a) |
| Config editing | `opencode.jsonc`, `PATCH /api/experimental/config`, shell/config read | **no** |
| Instructions (`AGENTS.md`, globs, URLs) | Loaded automatically; per-session entries visible | **no** - `…/instructions/entries` unused |
| References | Named external dirs/repos as context | **part** - `GET /api/reference` used for the mention/list only |
| Providers + activation | List providers, models, auth state | **yes** (read) |
| Provider login / accounts | `auth login`, credentials, switch account, OAuth | **yes** - Connections sheet: keys, OAuth start/finish, command login, credential activate/delete |
| Web search | `websearch` tool + provider choice policy | server-side; **no** UI indicator |
| Warming | Keep model cache warm | server-side (n/a) |
| Formatters / LSP | Run after edits | server-side (n/a) |
| Themes | Many built-in themes, light/dark follows terminal | **yes** (AMOLED / Dark / Light / Auto) |
| Keybinds / command palette | Fully remappable; `Ctrl+P` palette | **part** - no palette, fixed gestures |

---

## 5. Files and change review

| Feature | Official | Pocket |
| --- | --- | --- |
| Changed-files sheet | Every path the session touched, +/− counts | **yes** |
| Unified patch per file | yes | **yes** |
| Split / inline view, collapse | yes | **part** - collapsible cards, no split view |
| Comment on a diff line | yes (desktop review panel) | **no** |
| File tree / workspace browser | Desktop sidebar | **part** - `fs/list` + `fs/read` for mentions |
| Markdown preview with frontmatter | yes | **no** |
| VCS panel | Branch, base, status, diff, init | **part** - branch + dirty count in the chat header; no per-file diff panel |
| Built-in browser | Agent drives a real browser pane next to the chat | **no** (phone: the system browser) |
| Terminal pane | Real PTY inside the app | **no** - `/api/pty`, `/api/shell` unused |

---

## 6. Platform, integration and plumbing

| Feature | Official | Pocket |
| --- | --- | --- |
| Password / Basic auth | `opencode` + generated password, `OPENCODE_PASSWORD` | **yes** |
| Pairing | One-time link + QR, 5-minute expiry, 30-day cookie | **part** - deep link `?base=&secret=` (no QR scan) |
| Remote access | `opencode pair --remote` via OpenTunnel | **no** (phone-local by design) |
| Multi-device | Start on desktop, pick up on phone | **part** - same server, sessions shared |
| Offline shell | n/a (desktop app is local) | **yes** (service worker) |
| Installable app | Native desktop/mobile app | **part** - PWA today, native wrapper planned |
| MCP servers | List, add/remove, connect/disconnect, OAuth sign-in, resources | **yes** - list, connect, disconnect, remove |
| MCP resources | `opencode_list_mcp_resources` / read | **part** - read-only catalog of resources and templates |
| Plugins (server / TUI / GUI / RPC) | Install, list, update; GUI plugins add sidebar panels | **no** |
| Integrations | `/connect` accounts (Console, providers, web search) | **no** |
| Credentials | `auth export/import`, multiple accounts | **no** |
| Usage stats | `opencode stats`, per-day/model/cost/project, JSON | **part** - session stats + rollup, no date ranges |
| Usage limits | `GET /api/experimental/usage/limits` | **no** |
| Scheduled runs | `POST /api/experimental/schedule` | **no** |
| Voice | Mobile app: call a session, spoken answers | **no** |
| Image generation | `experimental_image_generate` tool, background job | **part** - result shows as a tool card only |
| Artifacts | `GET/POST /api/experimental/artifacts` | **no** |
| Background shells | `POST /api/shell`, output polling | **no** |
| Client-side MCP | `experimental/client-mcp` | **no** |

---

## 7. What the server offers that this UI does not touch

The v2.3.0 server exposes **139 REST paths**. Pocket calls **67** of them (~48%).

Used: session CRUD, messages, prompt (steer and queue), command, interrupt, model,
agent, view, diff, context, fork, compact, revert (stage/commit/clear), shell
(in-session), skill list + activate, reference, mcp list, provider list,
permission get/reply, saved permissions list/delete, worktree list, default
model, stats, fs find/list/read, event stream, info, project, plus this
earlier additions: **forms, inbox, export/import, vcs status/branch**, and
this release's: **integration list + key/OAuth/command connect flows,
credential create/activate/rename/delete, MCP connect/disconnect/add/remove,
MCP resource catalog**.

Not used, grouped:

- **Sessions**: `synthetic`, `move`, `background`, `active`, `message/{id}`,
  `experimental/session/{id}/wait`, `.../log`.
- **Workspace**: `vcs` (full), `vcs/base`, `vcs/diff`, `vcs/init`, `config`,
  `config/shell`, `experimental/config`, `location`, `location/reload`,
  `project/{id}` (patch), `experimental/fs/write`, `.../fs/watch`.
- **Execution surfaces**: `pty*`, `shell*`, `experimental/session/{id}/terminal`,
  `experimental/persistent-pty*`.
- **Extensibility**: `plugin`, `plugin/gui`, `plugin/check`, `plugin/update`,
  `rpc/{id}/{method}`, `experimental/client-mcp` (the server-side MCP
  register and the `integration/wellknown` hint remain untouched).
- **Generation / media**: `experimental/generate`, `/image`, `/text`,
  `/decisions`, `experimental/artifacts*`, `experimental/media/{hash}`.
- **Accounts / limits**: `experimental/usage/limits`, `websearch`,
  `websearch/provider`, `experimental/voice/*`, `experimental/schedule*`,
  `experimental/migration/v1`, `pair`, `auth/connect/{code}`, `debug/*`.

## 8. Event coverage

Handled: `server.connected`, session lifecycle (`created|deleted|renamed|
archived|unarchived|moved|metadata.updated`), `session.model.selected|agent.selected`,
`session.execution.started|succeeded|failed|interrupted`, `session.idle`,
`session.step.started|ended|failed`, `session.retry.scheduled`,
`session.text.started|delta|ended`, `session.reasoning.started|delta|ended`,
`session.tool.input.started|called|success|failed`, `session.usage.updated`,
`session.revert.staged|cleared|committed`, `session.shell.ended`,
`session.compaction.started`, `permission.asked`,
`form.created|replied|cancelled`, and every `session.inbox.*` event
(`enqueued`, `updated`, `delivered`, `cancelled`) which refreshes the queue strip.

`session.todo.updated` now drives a progress panel at the top of the chat,
and `integration.updated` / `credential.switched` are observed by reopening
the Connections sheet.

Still unhandled:

1. `session.instructions.updated` - instruction changes never refresh.
2. Provider/agent catalog changes while the app is open.

## 9. Suggested order of work

**Landed across the last four releases**: forms, inbox/queue and delivery
semantics, activity timeline with verbosity, message actions, artifacts (code,
HTML, document, diagram, diff), the preferences studio, find-in-conversation,
unread and failed-run dots, session export/import, branch chip, retry and
step-failed events, the markdown engine rewrite, provider authentication,
MCP write paths and the task checklist.

**P1 - daily use on a phone**

1. A tab switcher for parallel sessions (the server already supports it).
2. Terminal pane (PTY) and background shells.

**P2 - parity polish**

3. Config sheet (default model, permissions editor, instructions view).
4. GUI plugin panels, image-generation previews.
5. Native app shell: foreground service + boot receiver (see README).

## 10. First-open experience, sidebar and local history

| Feature | Pocket |
| --- | --- |
| Default workspace | **yes** - created inside app storage (built-in runtime) or Termux home; remembered, changeable, never silently switched |
| Default model | **yes** - prefers `opencode/big-pickle`, validated against the live catalog; falls back with a warning, never silently to another model |
| First-open chat | **yes** - opens a session immediately with a welcome state and six starter prompts that submit real prompts |
| Left sidebar | **yes** - drawer on phones, persistent column at ≥900px; search, new chat, workspaces, pinned, recents, settings, providers, connection |
| Sidebar navigation items | **yes** - every row opens the thing it names: Images (attached photos), Library (artifacts of the open conversation), Customize (8 config areas), Projects (server project list), Worktrees (per project, start a session in one), Scheduled tasks (per session), Plugins (the real `/api/plugin` list) |
| Local history | **yes** - IndexedDB copy of sessions and messages, written on every load; offline fallback when the server is down; never auto-expired. Demo mode is isolated in its own database and `ocp.demo.` keys, so a fake transcript can never appear later as a "saved copy" of a real conversation |
| Rendering (Aurora-derived) | **yes** - callouts, KaTeX, highlight.js, tables/tasks/footnotes, frontmatter, lazy Mermaid with a full-screen viewer, image lightbox, self-contained HTML export and the Android print dialog; all verified inside the installed app on the phone (`test/device-render.cjs`) |
| History reconciliation | **yes** - upstream sessions win; local-only copies are kept when a session disappears upstream |
| Long conversations | **yes** - the transcript pages: the first page is the newest 80 messages and "Load earlier messages" walks back through the server's cursor without moving the reader's place (the cursor carries its own direction, so a paged request sends no `order`) |
| Server data backup | **yes** - "Back up server data" writes a zip of the runtime's own store (sessions, settings, provider logins; not the project) to `Downloads/OpenCodePocket`, including the SQLite WAL, so the newest turns survive |
| Restore after reinstall | **yes** - the app offers a restore when it finds an empty install, and "Choose a backup file…" picks one from Downloads; the runtime's own data is moved aside (never deleted), unsafe archive paths are refused, and the original session ids come back. The daemon is killed first: a restore that leaves it running keeps serving the old database |
| Token-limit continuation | **yes** - a mid-turn `finish: "length"` is OpenCode continuing in smaller steps and is shown as such; a run that *ended* cut off gets a card with Continue (one user-triggered prompt, rendered as "Continued after the output limit" rather than a fake user bubble) and Retry. Nothing is re-sent automatically |
| Explicit deletion | **yes** - server delete removes the local copy too; "Delete local copy" is separate and confirmed |
| Export / import | **yes** - versioned JSON backup including messages |
| Encrypted backup | **no** - the export is plain JSON, protected only by where the user stores it |
| Presentation | **yes** - destinations a sidebar row leads to (Customize, Providers, catalog, Plugins, MCP, Projects, Worktrees, Scheduled, Library, Images, Settings, Connections, account, stats, commands) take the whole app area with a back header and no grab handle; sheets that interrupt a chat (permission, rename, model pick, chat menu) keep the bottom-sheet form |
| Provider catalog | **yes** - live models.dev catalog (324 providers at the time of writing), brand-coloured logos, search; a card is READY with the server's real model count only when that provider's models are actually being served, and an unconnected provider offers its connect flow instead of model rows |
| Providers sheet | **yes** - lists the providers this server can run, each with the number of models it serves; a saved-but-silent provider says so. Demo mode mirrors this (OpenCode + OpenAI reachable, Anthropic not) |
| Custom provider | **no** - v2.3.0's `PATCH /api/experimental/config` only accepts `shell`; providers must be added to `opencode.jsonc` on the server |
| Custom MCP | **yes** - add remote (URL/headers) and local (command/env) servers via `PUT /api/experimental/mcp/{server}`, replace an existing server's config, connect/disconnect, remove behind a confirmation, and read what the connected servers expose. Status is whatever the server reports: a server that fails keeps its row with the real error (`getaddrinfo ENOTFOUND …`, `MCP server process exited with code 2`), and `POST …/connect` answers 204 even when it failed, so the sheet re-reads the list and never claims success. Writing config makes the server start that process first (~10s on the device), so the form says "Saving..." and removal shows progress instead of a dead button. The saved configuration cannot be read back through the API, and the replace form says so. |
| Commands | **yes** - server catalog in a searchable palette; action commands (`/new`, `/clear`, `/models`, `/agents`, `/export`, `/help`) run in-app, everything else is sent to the server unchanged |
| Startup supervisor | **yes** - one daemon owner outside the Activity; health check before start, stale-port handling, bounded retries, stable UI port, same-origin proxy routing |
| First-run install screen | **yes** - the launch screen names the stage it is in and shows real download progress ("Downloading the OpenCode engine · 20 of 118 MB", 0-100% bar), then "Verifying", "Unpacking", "Starting", "Loading your workspace"; a failure shows the reason and retries on tap |
| Activity grouping | **yes** - one panel per user request, collapsed by default, full width, all tool steps from every assistant message in that turn; thought steps merge into one "Thought process" block instead of one row per step |
| Bundled typography | **yes** - Inter and JetBrains Mono ship inside the APK, so Android theme fonts (handwriting, condensed, etc.) can no longer replace the app's type; user font scaling still applies to prose and bubbles alike; the native launch screen loads its own copy of the same face |
| Landscape | **yes** - a phone turned sideways fills the screen (the desktop phone-frame no longer applies on touch), with the transcript held to a readable measure |
| Bundled runtime DNS | **yes** - Android has no `/etc/resolv.conf`, so the musl loader is patched to read `./resolv.conf` from the app's runtime home; this removes the fresh-install `EAI_AGAIN` failure |
| Pocket APK updater | **yes** - GitHub Releases check, SHA-256 + signing-certificate verification, system installer, progress and notes |
| OpenCode engine updater | **part** - engine version and restart are in-app; updating a Termux installation is still the official `opencode upgrade` command inside Debian. The embedded engine is updated with the app |
| Parallel session tabs | **yes** - up to 6 open sessions as a tab strip over the transcript; switch, close, and persist across restarts |
| PTY terminal | **part** - one-shot shell command from the session menu; persistent PTY endpoints exist upstream but need a WebSocket client |
| Line-level diff comments | **no** - no upstream endpoint in v2.3.0's OpenAPI |
| Config editor | **no** - `PATCH /api/experimental/config` only accepts `shell` in v2.3.0 |
| OpenCode account sign-in | **yes** - `POST /api/integration/opencode/connect/oauth` with the `device` method: the sheet shows the real code and expiry, opens `opencode.ai/console` in the browser, polls the attempt until approved, then reports the connection from `/api/integration/opencode`; API-key method and sign-out included |
| Instructions viewer | **yes** - `/api/experimental/session/{id}/instructions/entries` |
| Plugins | **yes** - `/api/plugin` list with source and state; each entry is what the server actually loaded |
| Scheduled tasks | **yes** - create (every/at/cron), list, pause, resume, remove via `/api/experimental/schedule`; the server's `experimental.schedules` flag is reported as a plain note when it is off |
| Voice input | **yes** - Web Speech where the WebView provides it; otherwise reported honestly |
| Image-generation previews | **no** - `/api/experimental/generate/image` is not wired |

---

## 11. Reading the answer: markdown, diagrams, math and export

The transcript renders model output as a document. This section records what is
implemented, what is intentionally not, and where the bounds are.

| Capability | Pocket |
| --- | --- |
| Headings, paragraphs, nested lists, blockquotes, rules | **yes** - markdown-it, GFM line breaks |
| Tables | **yes** - wrapped so a wide table scrolls sideways instead of squeezing |
| Task lists | **yes** - checkbox drawn in the app's style; a finished item is filled with the accent |
| Footnotes | **yes** - reference, separator and back-link |
| GitHub callouts | **yes** - `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`, with the octicon and the accent/warn/danger edge |
| Frontmatter | **yes** - leading YAML becomes a small metadata card instead of raw text |
| Syntax highlighting | **yes** - highlight.js with 33 languages and the aliases a model actually writes (`js`, `ts`, `sh`, `yml`, `py`, …); AMOLED-tuned token colours with a light-theme set |
| Code block controls | **yes** - language chip, line numbers for long plain blocks, wrap toggle, full-screen open, copy; wrap state survives a live rebuild |
| Inline and block math | **yes** - KaTeX (`$…$`, `$$…$$`), horizontally scrollable display blocks, error-tolerant on incomplete input |
| Mermaid diagrams | **yes** - drawn lazily through an IntersectionObserver, themed from the app palette, cached by source + theme so a transcript rebuild replays instead of redrawing; a broken diagram leaves its source with the reason; >30 KB source is not drawn |
| Diagram viewer | **yes** - full screen with a Diagram / Source toggle |
| Image viewer | **yes** - tap an image in the transcript or an artifact for full screen; Escape and the back gesture close it |
| Raw HTML in a reply | **no, by design** - `html: false`; a reply is text, never markup |
| Sanitising | **yes** - every render passes DOMPurify (no `script`, `iframe`, `form`, `object`, `embed`, `style`; `javascript:` links rejected before sanitising) |
| Typographer | **off, by design** - quotes and dashes stay exactly as the model wrote them |
| Streaming | **yes** - incomplete fences and half-written math stay readable; the transcript is rebuilt only when its signature changes, and rendered blocks are cached by source text |
| Large answers | **bounded** - 165 KB of markdown renders in ~100 ms in Chromium on this machine; the cache makes a rebuild effectively free; diagrams are capped and drawn only when near the viewport |
| Export HTML | **yes** - one self-contained file: dark reading view on screen, light print sheet for paper, MathML math (no font pack), table of contents when there are 3+ headings, no scripts |
| Print / Save as PDF | **yes** - system print dialog. Native app: an offscreen laid-out WebView feeds `PrintManager`, so "Save as PDF" produces a real PDF; browser: an offscreen iframe with the same document. When neither surface exists the HTML is saved and the reason is shown |
| Export from an artifact | **yes** - document artifacts get the same two actions |
| Export of a whole session | **part** - the session menu exports JSON and Markdown; HTML/PDF are per answer/artifact |
| VS Code integration | **not applicable** - no editor in a phone client; the parts Aurora used for that (scroll sync, theme inheritance, commands) were not ported |
| Offline rendering | **yes** - all rendering libs are local files (`assets/vendor/`); no CDN, no network for math or diagrams |

---

## Sources

- <https://opencode.ai/docs/> and its subpages: tools, permissions, agents, skills,
  commands, snapshots, compaction, attachments, policies, config, cli/tui,
  cli/commands, cli/web
- <https://opencode.ai/desktop>, <https://opencode.ai/terminal>, <https://opencode.ai/mobile>,
  <https://opencode.ai/product>
- The server's OpenAPI document, `GET /api/…` (139 paths) from the installed v2.3.0
- `assets/api.js` and `assets/app.js` in this repository, for the Pocket column