# OpenCode Pocket

**A fast, mobile-first web client for [OpenCode](https://opencode.ai) running in Termux.**

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![No dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![OpenCode](https://img.shields.io/badge/opencode-v2.3-6b7280.svg)](https://opencode.ai/docs/api)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8.svg)](manifest.webmanifest)

You already have a coding agent on your phone. The TUI is great with a keyboard, painful on a 6-inch screen. Pocket gives OpenCode a proper mobile interface: thumb-sized targets, streaming answers, a diff viewer, file mentions, one-tap permission approval — and it installs to your home screen like a real app.

No build step. No backend of its own. One static app that talks straight to `opencode serve` on `127.0.0.1:4096`.

<p align="center"><img src="docs/connect.png" width="280" alt="Connecting the phone to OpenCode over the loopback password or a pairing link" /></p>

## Screenshots

| Sessions | Chat | Changes |
| --- | --- | --- |
| <img src="docs/sessions.png" width="240" alt="Session list grouped by workspace" /> | <img src="docs/chat.png" width="240" alt="Streaming chat with tool calls" /> | <img src="docs/changes.png" width="240" alt="Changed files with a unified diff" /> |

| Models | Mention a file | Session menu |
| --- | --- | --- |
| <img src="docs/models.png" width="240" alt="Model picker" /> | <img src="docs/mention.png" width="240" alt="File mention search" /> | <img src="docs/session-menu.png" width="240" alt="Session actions" /> |

| MCP servers | Usage | Dark theme |
| --- | --- | --- |
| <img src="docs/mcp.png" width="240" alt="MCP server status" /> | <img src="docs/usage.png" width="240" alt="Token and spend summary" /> | <img src="docs/chat-dark.png" width="240" alt="Dark theme" /> |

| Streaming | Tool call | A failed turn |
| --- | --- | --- |
| <img src="docs/chat-streaming.png" width="240" alt="Reply streaming in" /> | <img src="docs/chat-tool.png" width="240" alt="Expanded tool call" /> | <img src="docs/failed-turn.png" width="240" alt="Provider failure with the reason and a next step" /> |

## Try the demo

No phone, no server, no account: **[open the demo](https://shivapal12395-droid.github.io/opencode-pocket/?demo=1)**. It runs entirely in your browser with fake sessions, a fake streaming reply, fake diffs — and if you ask it something about *failing*, you'll see the real failure path too. Demo mode exercises the same code as a live server; only the API is swapped.

## Features

### Chat
- **Streaming** — text, reasoning and tool calls render live over SSE.
- **Tool cards** — expand any call for its input, output and exit code; a failed tool shows the error, not just a red dot.
- **Clear failures** — a rejected turn shows the provider's reason, a next step, and how long to wait. Retries appear as they happen.
- **Rewind** — undo the last turn, restoring the files it changed, then keep or drop it.
- **Usage** — tokens and cost under every answer, plus a rollup across all sessions.
- **Attachments** — camera or gallery, compressed before sending.

### Sessions
- Grouped by workspace, searchable, rename, delete, archive.
- **Fork** to branch a conversation, **compact** to summarise context before it fills up.
- **Changes sheet** — every file the session touched, with additions/deletions and the unified patch.
- **Run a command** — hand a shell command to the session and read the output in the transcript.

### Agent control
- **Models** — search the full list, pick a reasoning variant, switch mid-session.
- **Agents** — switch between build / plan / your own.
- **Skills** — list what the workspace offers and load one into the session.
- **Permissions** — Allow once / Always / Deny in a bottom sheet; dismissed requests come back as a banner; review and delete your saved "always allow" rules.
- **@-mentions** — tap `@` (or type it) to search the workspace and drop a file path into your prompt.
- **Slash commands** — `/init`, `/review`, and your own.

### Server view
- **MCP servers** with live status, **providers** and their activation, **workspace files**.
- **PWA** — Add to Home Screen, offline shell, dark / light / system, safe-area aware.
- **Zero dependencies** — vanilla HTML, CSS and JS. No bundler, no framework.

## Setup — everything on the phone

The whole stack lives on your device. Debian runs OpenCode, Termux runs the Pocket UI,
and Chrome (or the installed PWA) is the screen. **No laptop, no cloud, no port forwarding**,
and no internet beyond the model calls you choose to make.

```
phone
  Chrome / installed PWA   http://127.0.0.1:8099   <- Pocket (Node in Termux)
             |
             |  fetch /api/*, same loopback
             v
  opencode serve           http://127.0.0.1:4096   <- OpenCode 2 (Debian inside proot)
```

> **Why the Debian layer?** OpenCode 2 is published for Linux/macOS/Windows only. In plain
> Termux its launcher misdetects Android-arm64 and downloads the Linux-x64 binary, so it
> fails to start. Running it inside `proot-distro` is the working on-device route.

1. **Install Termux** from [F-Droid](https://f-droid.org/en/packages/com.termux/) or the
   [GitHub releases](https://github.com/termux/termux-app/releases). The Play Store build is
   outdated and will not work. Keep ~2 GB free.

2. **Install OpenCode inside Debian** — one line sets up proot-distro, Node 22 and OpenCode 2:

   ```bash
   pkg install -y curl
   curl -fsSL https://raw.githubusercontent.com/MeanderX/opencode-android/main/get.sh | bash
   ```

   Approve the storage-permission dialog. On first use, sign in to a model provider with
   `oc auth login` (or later from inside OpenCode).

3. **Install Pocket.** Note the `nodejs` package — the UI's tiny static server runs in Termux,
   not inside Debian:

   ```bash
   pkg install -y nodejs git
   git clone https://github.com/shivapal12395-droid/opencode-pocket.git
   cd opencode-pocket
   chmod +x start.sh
   ```

4. **Start everything** with one command:

   ```bash
   OPENCODE_CMD="oc ~/projects serve --hostname 127.0.0.1 --port 4096" ./start.sh
   ```

   `~/projects` is created by the installer — passing it first stops `oc` offering to create
   a project called "serve". `start.sh` boots OpenCode through `oc`, waits for the **server
   password**, prints it, and opens Chrome at `http://127.0.0.1:8099`. Paste that password
   into the app (or run `oc pair` in another session and paste the whole link).

5. **Add to Home screen:** Chrome menu → **Add to Home screen**. One tap from then on.

**If the one-liner misbehaves — two terminals, same phone-only result:**

```bash
# session 1: the agent
oc shell
cd ~/projects && opencode serve --hostname 127.0.0.1 --port 4096

# session 2: the UI
cd ~/opencode-pocket && ./start.sh
```

The second command notices the server is already up, skips starting it, and just serves the
UI. Grab the password from session 1, or run `oc pair`.

**Every later launch** is just step 4 again (or the two sessions above). The password changes
on every server restart — paste the new one, or use a fresh `oc pair` link.

> **Android battery:** the phantom-process killer can end a long session. Disable battery
> optimisation for Termux, or run `termux-wake-lock` before starting.
>
> **Security:** `opencode serve` exposes a shell. Here it is bound to `127.0.0.1`, reachable
> only from apps on the phone. Never bind it to `0.0.0.0` on public Wi-Fi or forward it.

### Optional: keep the agent on a second machine

Only if you *want* to — the phone-only path above is the default. With the server on a laptop
on the same Wi-Fi, the phone still runs only the UI:

```bash
# laptop
opencode serve --hostname 0.0.0.0 --port 4096 --cors http://127.0.0.1:8099
opencode pair --url http://192.168.1.20:4096

# phone — serve just the UI, do not start a local agent
cd ~/opencode-pocket && node server.mjs --port 8099
```

In the app set **Server URL** to `http://192.168.1.20:4096` and paste the pairing link.
Replace the IP with the laptop's LAN address. On the phone-only path the Server URL stays
`http://127.0.0.1:4096` — you only change it for this optional setup.

## What it talks to

| Piece | What it does |
| --- | --- |
| `index.html` | App shell + inline SVG icon sprite |
| `assets/app.js` | UI, state, SSE handling, sheets |
| `assets/api.js` | OpenCode HTTP client (`Basic` auth, SSE, feature routes) |
| `assets/markdown.js` | Small dependency-free markdown renderer |
| `assets/mock.js` | In-memory API double for the public demo |
| `sw.js` | Offline app shell |
| `server.mjs` | Zero-dependency static server |
| `start.sh` | Termux one-command launcher |

Auth is `Authorization: Basic base64("opencode:" + password)`. The password can be the one printed by `opencode serve`, or a token from `opencode pair` (`GET /auth/connect/{code}`) — the server accepts both.

Pocket is a static page. It stores the server URL and password in `localStorage` on your device and calls the API directly. There is no Pocket server, no telemetry, no account.

### Routes used

| Surface | Routes |
| --- | --- |
| Sessions | `GET/POST /api/session`, `GET/PATCH/DELETE /api/session/{id}`, `.../prompt`, `.../command`, `.../interrupt`, `.../model`, `.../agent`, `.../fork`, `.../compact`, `.../move`, `.../shell`, `.../view`, `.../revert/*` |
| Transcript | `GET /api/session/{id}/message`, `/context`, `/diff`, `/permission`, `.../permission/{requestID}/reply` |
| Files | `GET /api/fs/find`, `/api/fs/list`, `/api/fs/read/*` |
| Catalogues | `/api/model`, `/api/model/default`, `/api/agent`, `/api/command`, `/api/skill`, `/api/project`, `/api/reference`, `/api/worktree` |
| Server | `/api/info`, `/api/mcp`, `/api/provider`, `/api/permission/saved`, `/api/experimental/session/stats`, `/api/event` |

Sub-resource routes are location-scoped with `location[directory]=<path>`. Passing a JSON-encoded `location` is rejected by the server's query codec, which is why the client builds it parameter by parameter.

### Deliberately not included

Pocket is a client, not a mirror of every route. It leaves out the ones that need a terminal or a desktop: PTY and persistent terminals, artifacts, scheduled jobs, voice sessions, credential and OAuth flows, plugins, and `experimental/generate`. They'd be dead weight on a phone; the TUI and the web console are better homes for them.

## Development

```bash
node server.mjs --port 8099
# edit files, refresh the browser
```

OpenCode's API is still labelled experimental upstream, and message shapes are verified against the server's own schema package. Tested against **v2.3.0**. If a route changes, open an issue with your `opencode --version`.

Useful while hacking:

```bash
opencode serve --port 4123 --print-logs --log-level debug
curl -s localhost:4123/openapi.json -u "opencode:$PASSWORD" > openapi.json
```

Regenerate the app icons after editing `assets/icon.svg`:

```bash
python tools/make_icons.py
```

## Roadmap

- [ ] Session pagination + pull to refresh
- [ ] Push notifications when a background session finishes
- [ ] Share sheet / "open in Pocket"
- [ ] Home-screen widgets for running sessions

PRs welcome — keep it dependency-free. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Hinglish TL;DR

Termux me `./start.sh` chalao → browser khulega → terminal ka **server password** ya `opencode pair` ka link paste karo → Chrome me **Add to Home screen**. Bas — TUI ki keyboard dikkat khatam.

Kaam karne ke liye: chat me likho, `@` dabao file mention karne ke liye, header ke **diff chip** pe tap karo changed files dekhne ke liye, aur `•••` me fork / undo / compact / archive sab hai.

Server restart hua to password badal jayega; app khud bol dega, naya password paste kar dena.

## Credits

The interface is inspired by the clean desktop client at [omnirush.ai](https://omnirush.ai) — workspace-grouped sessions, plain assistant text, inline tool rows, and a single rounded composer. Pocket rebuilds that language for a 390 px screen with zero dependencies.

Feature behaviour and every request/response shape follow the upstream OpenCode source (`packages/schema`), so the client matches the server rather than guessing at it.

## License

MIT. See [LICENSE](LICENSE).
