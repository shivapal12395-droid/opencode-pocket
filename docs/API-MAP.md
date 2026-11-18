# Feature → API map

What the installed OpenCode server can actually do, what Pocket has to do itself, and
what is honestly impossible. Every row below was probed against the running server on
this device (`OpenCode v2.3.0`, `runtime-v2.3.0-r1`), not read from documentation.

Probe method: `GET`/`POST`/`PUT`/`DELETE` against `http://127.0.0.1:8098` (embedded
runtime, proxied same-origin by `PocketHttpServer`) with the server's Basic auth, from
the app's own WebView over DevTools. Scripts live outside the repo, in
`%LOCALAPPDATA%\Temp\ocp-test\`.

## How to read this

| Column | Meaning |
| --- | --- |
| Feature | The thing a user asks for |
| Source | Where the answer comes from |
| Method | The real call |
| Verdict | **supported** / **pocket** (Pocket must implement it) / **unsupported** (server cannot) / **blocked** (needs a precondition the user controls) |

## 1. Providers, models, credentials

| Feature | Source | Method | Verdict |
| --- | --- | --- | --- |
| Provider list | server | `GET /api/provider` | supported (returns `[]` on a keyless server even though models exist — reachability must be read from the model list, see below) |
| Models this server can run | server | `GET /api/model` | supported — 12 models when keyless, 19 after a Groq key, 12 again after removal (probed) |
| Reachability of one provider | server | `GET /api/model` filtered by `providerID` | supported — this is the truth the catalog uses |
| Connectable integrations | server | `GET /api/integration` | supported |
| Saved credentials | server | `GET /api/credential` | supported |
| Save an API key | server | `POST /api/integration/{id}/connect/key` `{key,label}` | supported (204) |
| OAuth (device code) | server | `POST /api/integration/{id}/connect/oauth`, then `GET /api/integration/{id}/connect/oauth/{attemptID}` | supported |
| Delete a credential | server | `DELETE /api/credential/{id}` | supported |
| Create a **new provider** | — | no endpoint | **unsupported** — `PUT /api/experimental/config` only accepts `shell`; providers are added in `opencode.jsonc` on the server |
| Default model | server | `GET /api/model/default` | supported |

## 2. MCP

| Feature | Source | Method | Verdict |
| --- | --- | --- | --- |
| List servers + status | server | `GET /api/mcp` | supported (`[]` when nothing is configured - a real empty state). Each item is `{name, status:{status,error}, integrationID}`: **no config is returned** |
| Resources + templates | server | `GET /api/mcp/resource` | supported - `{resources, templates}`, empty until a server is connected |
| Add a server | server | `PUT /api/experimental/mcp/{name}` `{config:{…}}` | supported - a bare body fails with `Missing key ["config"]`, so the config object is the payload. **Takes ~9-10 s**: the server starts the process before it answers, so the UI must show progress |
| Replace a server's config | server | same `PUT` with the same name | supported - it replaces, it does not duplicate. The old config cannot be read back, so this is a replace, not a pre-filled edit |
| Remove a server | server | `DELETE /api/experimental/mcp/{name}` | supported (404 for an unknown name, i.e. the route is live). Fast once the server has settled |
| Connect | server | `POST /api/experimental/mcp/{name}/connect` | supported, **and it answers 204 even when the connection failed** - read `GET /api/mcp` afterwards for the truth (`pending` while it tries, then `failed` + `error`) |
| Disconnect | server | `POST /api/experimental/mcp/{name}/disconnect` | supported (`disabled`) |
| Transports | server | local (`command`, `environment`) and remote (`url`, `headers`) | supported |
| Observed statuses | server | - | `connected`, `pending`, `failed` (+ `error`), `disabled`, `needs_auth` |
| Config file | workspace | `.config/opencode/` | the directory exists but holds no file on this device, so the server keeps MCP config elsewhere; `GET /api/mcp` is the only window into it |

## 3. Plugins

| Feature | Source | Method | Verdict |
| --- | --- | --- | --- |
| Discover plugins | server | `GET /api/plugin` | supported — 94 entries, each with `source.type` (`builtin`/…) and `state.status` (`active`) |
| Status per plugin | server | same payload | supported |
| Install / remove a plugin | — | `POST /api/plugin` → 404, `DELETE /api/plugin/{id}` → 404 | **unsupported** — plugins come from the server's config/`node_modules`; Pocket must show status only, never an invented marketplace |

## 4. Projects and worktrees

| Feature | Source | Method | Verdict |
| --- | --- | --- | --- |
| Project list | server | `GET /api/project` | supported — fields are `id`, `canonical`, `time`, `sandboxes`; `canonical` is the real directory (`/data/user/0/com.shivapal.opencodepocket/files/opencode-home`) |
| Files in a workspace | server | `GET /api/fs/list?path=&directory=` | supported |
| Read a file | server | `GET /api/fs/read/{path}?directory=` | supported |
| Find files | server | `GET /api/fs/find?query=&limit=` | supported route, but **500** for a plain query on v2.3.0 — treat a failure as a server fault, don't fall back to fake paths |
| Git status / branch | server | `GET /api/vcs/status`, `GET /api/vcs/branch` | supported |
| Git diff | server | `GET /api/vcs/diff?directory=` | supported (400 without a directory) |
| List worktrees | server | `GET /api/worktree?projectID=` | supported (`[]` when none) |
| Create a worktree | server | `POST /api/worktree` `{projectID[,branch]}` | supported; needs a git repo — the current project is not one, and the server says so: *"Cannot create a worktree from …: it is not a git repo"* |
| Remove a worktree | server | `DELETE /api/worktree` (JSON body) | supported route (415 without a JSON body) |

Note for the UI: worktrees belong **inside** a project, not as a sidebar row. The server
keys everything by `projectID`, and `project.canonical` is the directory to show.

## 5. Scheduled tasks

| Feature | Source | Method | Verdict |
| --- | --- | --- | --- |
| Server-side schedules | server | `GET /api/experimental/schedule?sessionID=` | **blocked** — `403 ForbiddenError: Scheduled tasks are disabled; set experimental.schedules in config` |
| Create / pause / resume / delete | server | `POST /api/experimental/schedule`, `…/{id}/pause`, `…/{id}/resume`, `DELETE …/{id}` | routes exist, all gated by the same server flag |
| Reliable scheduling in the app | Android | `WorkManager` + a foreground service for runs that must outlive the app | **pocket** — the only honest option while the flag is off. Must be labelled Pocket-managed, must not use JS timers, and must not show a schedule as active unless the worker actually registers |

## 6. Library, images, settings

| Feature | Source | Method | Verdict |
| --- | --- | --- | --- |
| Library items | Pocket storage + server files | `IndexedDB`/app storage for Pocket-owned notes, snippets, prompts; `/api/fs/*` for real workspace files | **pocket** (no server library endpoint exists) |
| Images in a chat | server messages | attachment parts on `GET /api/session/{id}/message` | supported |
| Generate an image | — | `GET /api/image` → 404, `GET /api/experimental/generate` → 404 | **unsupported** on this runtime — explain that the server has no image provider instead of faking a gallery |
| Settings | Pocket prefs + server config | `localStorage` for Pocket; `GET /api/config` lists config directories | **pocket** for app prefs, supported-read for the server's own config |
| Edit server config | — | `PUT /api/experimental/config` only accepts `shell` | **unsupported** for everything else |

## 7. Sessions and chat (already working, listed for completeness)

| Feature | Method | Verdict |
| --- | --- | --- |
| Session list / search | `GET /api/session`, `?search=` | supported |
| Messages | `GET /api/session/{id}/message?limit=&order=` | supported |
| Older messages (paging) | `GET /api/session/{id}/message?limit=&cursor=` | supported — the cursor encodes its own direction and **`order` must be omitted** (`400 InvalidCursorError: Cursor cannot be combined with order`). With `order=desc` the newest page is returned first and `cursor.next` walks *older*; `cursor.previous` walks back towards the newest |
| Prompt / abort / steer | `POST /api/session/{id}/prompt`, `/abort`, inbox endpoints | supported |
| Live events | `GET /api/event` (SSE, never returns — it is a stream) | supported |
| Agents, skills, commands, references, forms | `GET /api/agent`, `/api/skill`, `/api/command`, `/api/reference`, `/api/form` | supported |
| Usage rollup | `GET /api/experimental/session/stats` | supported |

## 8. What Pocket owns

Anything in the **pocket** column above is Pocket's own responsibility and must be
persisted by Pocket, not pretended to be server state:

- scheduled task definitions, last-run status, retries, and the Android registration
  that backs them;
- library items (notes, snippets, prompts, saved artifacts) and their metadata;
- app preferences, theme, font scale, pinned chats;
- secure credential entry (the key is typed into a masked field and sent only to the
  local server, which stores it — Pocket keeps no copy).

## 9. Known limits on this device, stated plainly

- Scheduled tasks cannot run server-side until `experimental.schedules` is enabled in
  the server config; Pocket-side scheduling is the honest substitute.
- Providers cannot be created from the app; the catalog can only connect providers the
  server already knows about.
- Plugins cannot be installed from the app; only listed with their real status.
- Image generation has no endpoint on this runtime.
- The current project directory is not a git repository, so worktree creation fails
  with the server's own message — a real error, not a dead button.
