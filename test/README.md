# Feature test suites

Two Playwright suites that drive the real client against the demo API. They are
the receipt for the feature list in the README: every row is something the UI
actually did in a browser, not something it is supposed to do.

| Suite | Checks | Covers |
| --- | --- | --- |
| `suite-1.cjs` | 24 | sessions list/search/unread, markdown + tables, activity timeline, message actions, todos, VCS chip, find-in-conversation, artifacts (code/diagram/doc/HTML/diff), scroll-to-bottom, forms (incl. conditional fields and the answered record), queue/steer + inbox, preferences, connections, MCP, export |
| `suite-2.cjs` | 26 | changes sheet + patches, session info, skills, undo/keep, compact, copy transcript, rename, model and agent pickers, slash hints, `@` mentions, image attachments, answer menu (copy/markdown/save/share), permission request + allow, new session, theme switch (light/black), providers, usage, saved permissions, import refusal in demo, archive/unarchive + filter, delete confirm, fork |
| `suite-3.cjs` | 8 | left sidebar (open/close/backdrop/filter), session list inside it, workspace list, welcome state and its six starters, Big Pickle as the default model |
| `suite-4.cjs` | 4 | local history store, saving on session open, JSON export, confirmed local deletion |
| `suite-5.cjs` | 4 | live models.dev catalog, brand-coloured logos, provider search, free models including Big Pickle |
| `suite-6.cjs` | 3 | add custom remote and local MCP servers |

## Run

```bash
# 1. the repo's own static server
node server.mjs --port 8099

# 2. playwright-core (only dependency, no browser download needed)
npm install --no-save playwright-core

# 3. the suites
node test/suite-1.cjs
node test/suite-2.cjs
```

Environment:

- `CHROME` — path to a Chrome/Chromium binary. Defaults to the Windows Chrome
  path; on Linux use `CHROME=$(which google-chrome) node test/suite-1.cjs`.
- `POCKET_URL` — defaults to `http://127.0.0.1:8099`.

Both suites open `?demo=1`, so they never touch a real OpenCode server and never
need a password. Each check prints `PASS`/`FAIL` with a one-line reason and the
process exits non-zero if anything failed. Console errors and uncaught page
errors are collected and printed at the end; a clean run reports `ERRORS: none`.

## What the demo cannot cover

The demo double (`assets/mock.js`) answers from memory. These paths still need a
real server and are marked as such in `docs/FEATURES.md`:

- provider OAuth round trips and command logins (the sheet and flows are
  exercised, the provider's own redirect is not)
- importing a session (the button is wired; demo mode refuses honestly)
- real git diffs and worktrees
- MCP servers that actually start a process

The suites fail on a missing element instead of skipping it, so a regression in
any of the above surfaces shows up as a red line rather than silence.
