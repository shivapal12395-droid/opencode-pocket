# Acceptance report — long tasks, finish reasons, connection loss, reinstall

Seven defects, at the root cause, with the evidence that was actually run. Tested on
the connected phone (`Realme RMX5003`, `com.shivapal.opencodepocket`, debug APK built
from this tree) against the real embedded OpenCode `v2.3.0`, plus the web suites in
Node + Chrome. Nothing here is claimed from a mock alone.

Date: 2026-11-18. Server: embedded `runtime-v2.3.0-r1`.

---

## How it was verified

| Suite | What it drives | Result |
| --- | --- | --- |
| `test/suite-1..10.cjs` | the existing feature surface (113 checks) | 113 passed, 0 failed, no console errors |
| `test/suite-11.cjs` | rich transcript, streaming, exports, print (14 checks) | 14 passed, 0 failed |
| `test/suite-12.cjs` | **new** — finish reasons, connection loss, ambiguous prompts, Thinking/Working, Stop, paging, transport retries (13 checks) | 13 passed, 0 failed |
| `test/device-live.cjs` | **new** — the installed APK's own WebView over CDP, against the real daemon: identity, a real turn, Stop, a real backup, daemon kill → banner → restart recovery | 5 passed, 0 failed |
| `test/device-reinstall.cjs` | **new** — real `adb uninstall` + `install`, fresh-install offer, restore from the system file picker, original ids, transcript opens. The engine bundle is put back in place on purpose, so this suite never depends on the phone's network | 9 passed, 0 failed |
| `test/device-fresh-install.cjs` | **new** — the real first run: uninstall, install, and let the app **download the engine from the repo's GitHub release itself** (progress, SHA, unpack, daemon), then offer and restore the backup | 6 passed, 0 failed |
| `test/device-render.cjs` | **new** — the renderer adopted from [Aurora Preview](THIRD-PARTY.md) inside the installed APK: callouts, KaTeX inline + block, highlight.js, tables, tasks, footnote, Hindi, image lightbox, lazy Mermaid + full-screen viewer, self-contained HTML export into Downloads, the Android print service | 7 passed, 0 failed |

Total: **141 web checks + 27 device checks, 0 failures.**

Reproduce:

```
node server.mjs --port 8099                 # web suites need this
node test/suite-1.cjs … test/suite-12.cjs

adb forward tcp:9223 localabstract:webview_devtools_remote_<app pid>
node test/device-live.cjs                   # app running, real daemon
node test/device-reinstall.cjs              # destructive: uninstalls the app
node test/device-fresh-install.cjs          # destructive: uninstall + a real 124 MB engine download
```

---

## 1. Output token limit — answers looked incomplete

**Reproduction.** Send a long task to the free model. The agent writes past its output
limit.

**Root cause.** Two halves. The server does the right thing — it records
`finish: "length"`, injects a synthetic instruction ("Your last response hit the output
token limit… Break the remaining work into smaller pieces") and continues in another
step. Pocket read `finish` in `session.step.ended` and then never used it, so the
partial step rendered as though it were the answer, and the turn's real shape was
invisible.

**Fix.** `assets/app.js`: `finish` is kept on the message; the renderer treats a
length stop as *normal mid-turn*, shows a one-line note for the synthetic instruction
("Output limit hit — the agent is continuing in smaller steps"), and only shows a
"Continue / Retry" card when the run has actually **ended** cut off (not busy, no
continuation after it). Continue sends one explicit prompt and renders it as
"Continued after the output limit" instead of faking a user bubble; the card is
withdrawn once a continuation exists. Nothing loops, nothing is re-sent automatically.

**Evidence.** `suite-12`: "A length stop mid-turn is continued, not called partial"
(1 note, 0 cards, second step rendered); "A run that ended cut off offers Continue and
Retry"; "Continue sends exactly one prompt and is labelled, not faked" (1 note, no fake
bubble, card withdrawn, one new answer). Device: `device-live` real turn completed.

## 2. Network loss — leave and come back safely

**Reproduction.** Drop the connection during a turn (on the device: kill the daemon
under the app, which is the same socket dying).

**Root cause.** `Api.streamEvents` retried forever with no ceiling and no status the UI
understood (`streamEvents` reported only "online"/"offline"). `Api.request` threw
`ApiError("Request timed out", 0)` on abort with no way to tell a drop from a refusal.
The composer had no ambiguous-send state, so a prompt that may have landed was either
lost or could be sent twice.

**Fix.** `assets/api.js`: `ApiError.retryable` / `.offline`; `request` retries **reads**
only (2 attempts, jittered, capped) and never a write; `streamEvents` has a finite
budget (8 attempts, exponential with jitter, `navigator.onLine`-aware), reports
`connecting | online | offline | failed`, stops when the budget is spent and exposes
`retryNow()`. `assets/app.js`: `applyNetStatus` drives a banner ("Connection lost —
retrying (n/8)") that becomes a manual Retry when the budget is spent; reconnect
re-reads the open session/forms/inbox and asks the server whether the turn is still
running (`verifyTurn`); a 45 s stale watch covers a missed `idle`; `deliverPrompt` gives
every prompt one code path with duplicate protection and, on an ambiguous failure, a
"Message not confirmed" card (Check server / Send again / Discard) — never an automatic
re-send. Cancelled or already-aborted requests are surfaced, not swallowed.

**Evidence.** Device (`device-live`): the daemon was killed mid-turn → banner appeared
at once, counted up `1/8 … 7/8` over ~37 s, then "Connection lost. Pocket stopped
retrying." with the Retry button visible; the session list and transcript were intact;
restart recovered 5 sessions. A second probe of the same path recorded every step
(`Connection lost — retrying (2/8)` → `(7/8)` → `stopped retrying`, `retry: true`).
`suite-12`: banner/limit/manual Retry, "Retry recovers the session the server actually
finished" (the turn completed while the socket was down and the app reconciled from the
server), "An ambiguous prompt is not resent automatically" (1 copy, composer idle),
"Discard removes it", "Reads retry, writes never do", "A cursor request is sent without
order", "A stream that gives up reports failed, and Retry restarts it".

## 3. Reinstall — sessions must come back

**Reproduction.** Make a backup, `adb uninstall`, `adb install`, open the app.

**Root cause (three, all found by testing it for real).**
1. The runtime's store is app-private, so uninstall deletes it — there was no way to
   get it out or back.
2. **Android removes an app's MediaStore rows on uninstall.** The backup file stays in
   `Downloads/OpenCodePocket`, but `listRuntimeBackups()` found nothing afterwards.
3. **Stopping the Android service does not stop the daemon process it spawned.** A
   restore replaced the database on disk while the old daemon still had the old file
   open, served it, and `ensure()` then reused that process — the restore silently did
   nothing. `restartRuntime()` had the same hole, which is why the UI port could drift
   to 8098 after an "in-cart restart".

**Fix.** `PocketBridge.kt`: `backupRuntime()` zips `opencode-home` (minus the project
workspace; **including `opencode.db-wal/-shm`**, because WAL mode keeps the newest turns
there) into `Downloads/OpenCodePocket`; `listRuntimeBackups()`; `restoreRuntimeBackup()`
and `restoreRuntimeFromBase64()` (the file-picker path, which is the one that works
after a reinstall); restore moves the current data aside — never deletes — and refuses
unsafe archive paths. `EmbeddedRuntime.killAll()` kills the daemon itself (its native
handle is not kept), and both restore and `restartRuntime()` use it.
`assets/app.js`: "Back up server data" / "Restore server backup" / "Choose a backup
file…", and an offer sheet shown only when the *server answered with zero sessions* on
an install with nothing to lose — it never restores on its own, and it no longer creates
a session behind the sheet. `RefreshSessions` stays the authority: the server's history
wins, the IndexedDB copy is only a fallback and hold-out copy.

**Evidence.** Device (`device-reinstall`): safety copy of the app data + engine bundle
first; 4 real sessions → backup (81 files, 2.5 MB) → `adb uninstall` (data confirmed
gone) → `adb install` → engine bundle restored in place so no 124 MB download was needed
→ fresh install shows **0 sessions** and offers the backup instead of restoring it →
"Choose a file…" through the **real system file picker** → **all 4 original session ids
present**, and a restored session opens with its transcript (8 messages, socket up).
Earlier in the same work, the pre-fix path reproduced the bug exactly: restore reported
`{"ok":true,"files":81}` and the app still showed the old data until the daemon was
restarted by hand.

**Evidence, first run (`device-fresh-install`).** The same cycle with **no engine on the
device at all**, so the app had to fetch it from the repo's release: 119 MB down in
130 s (progress sampled every 2 s: 0.1 → 7.8 → 17.0 → 34.4 → 54.3 → 79.0 → 101.2 MB),
`downloaded 124541879 bytes` → `SHA verified` → `extract exit=0` → `chmod exit=0` →
`daemon ready on 4098`. The fresh install then showed **0 sessions** and offered the
backup, and the picker restore brought back **all 3 original ids**. The log after the
restore shows the fix working: `killed daemons: 13991`, then a new daemon on 4098.

## 4. Thinking vs Working

**Reproduction.** Watch the header during a turn.

**Root cause.** One boolean. `setBusy(true)` always wrote "Working", so the model
thinking and a tool executing looked identical.

**Fix.** `assets/app.js`: a real phase (`thinking` / `working` / `idle`) driven by
events — `execution.started`/`step.started` → Thinking, an actual `tool.called` →
Working, and back to Thinking when the last tool in the turn finishes
(`phaseFromTools`). One activity panel per user request (already grouped) becomes
"Worked for Ns · N steps" when the turn closes. Reasoning stays collapsed behind its
own toggle; chain-of-thought is never dumped into the transcript.

**Evidence.** `suite-12`: "Thinking and Working are separate states, one panel per
turn" (states observed: Thinking → Working; panel survives). Device: `device-live` real
turn reported the Thinking state live; `suite-9` (live multi-step) still passes, and no
running turn flashes a finished panel.

## 4b. The renderer adopted from Aurora Preview (verified on the phone)

The transcript renderer's shape comes from **Aurora Preview** (MIT,
`github.com/Abhishekkumar2021/aurora-preview`): the markdown-it plugin set, the
DOMPurify pass, the frontmatter card, the code-block toolbar, the lightbox and the
self-contained HTML export — see `docs/THIRD-PARTY.md`. It was already covered by the
browser suites (`suite-11`, 14 checks); `test/device-render.cjs` now drives the real
WebView of the installed APK and checks each adopted piece on the phone:

| Checked on device | Result |
| --- | --- |
| Bundled pipeline, no CDN | `pocket-md.mjs` + local `katex.css`, **0 external requests** |
| GitHub callouts | 1 warning callout with its icon and title |
| KaTeX | 1 inline + 1 block, raw TeX gone |
| highlight.js | 13 tokens, copy/fullscreen toolbar present |
| Tables / tasks / footnotes | 4 rows / 3 tasks (1 done) / footnote ref + note |
| Hindi text | intact after render |
| Mermaid | drawn lazily on scroll (443×126 px, 4 nodes), opens full-screen with a Source toggle |
| Image lightbox | opens and closes |
| Export HTML | `Session-refresh-…html` in `Downloads` (12 KB): doctype, MathML, callout CSS, `@media print`, no `<script>`, Hindi intact |
| Print / Save as PDF | native bridge → `com.android.printspooler` print UI on top |

**Diagram fixes that came out of looking at the device screen.** The transcript was
showing raw Mermaid for three reasons, all fixed:

1. *Only the live message may stay as source.* `decorateTranscript` used to skip **every**
   diagram while any turn was running, so an older answer's diagram stayed as a code block
   whenever a later turn was writing. Now only the message being written is deferred.
2. *Reserved class names.* Models constantly write `:::end` / `classDef end …`; `end` is a
   Mermaid keyword, so the diagram failed to parse. The client renames reserved class
   identifiers consistently (`end` → `endNode`) before drawing.
3. *Flowchart notes.* `note right of B:` is sequence-diagram syntax; inside a flowchart it
   is a parse error, and it was the next failure on the same conversation. The flow around
   it is valid, so the notes are set aside, the diagram draws, and a quiet line says
   "Drew the flow without N notes … (they are still in the source)".

Result on the user's own conversation: **9 of 9 diagrams drawn, 0 failed** (before: 2
drawn, 2 failed, the rest stuck as source). `suite-12` covers all three (a finished diagram
drawing while a later turn streams, the reserved word, the notes line).

**A real defect this uncovered.** Demo transcripts live on the same origin as the app,
and they were written to the *same* IndexedDB and the *same* `ocp.*` localStorage keys.
After a demo run, the real app found `ses_demo*` in the recovery cache and in the saved
tab list, tried to open it against the real server (404 on `/view`, `/message`,
`/permission`, `/diff`), and then showed the fake transcript with a "Showing saved copy —
server offline" toast. Fix: demo mode now uses its own IndexedDB
(`opencode-pocket-history-demo`) and its own `ocp.demo.` prefix, and the real app purges
any `ses_demo*` ids a previous install left behind (cache, `lastSessionID`, tabs).
`suite-12` checks the cache stays clean; `device-render` checks the real app comes back
with 0 demo ids and no fake offline notice.

## 5. Stray Android selection toolbar

**Reproduction.** Long-press while chatting (report: the selection bar appears without
one being wanted).

**Root cause (found in the code).** Two causes, both structural. The whole document was
selectable, so a long press on the header, a chip, the activity row or the composer
started a text selection with the system's floating toolbar. And the transcript is
rebuilt from scratch on every event, so a selection made during a streaming answer
outlives its own text: Android keeps the floating bar for a selection whose anchor node
no longer exists.

**Fix.** `assets/app.css`: chrome (buttons, title, session tabs, activity heads, inbox
chips, status lines, the banner) is `user-select: none` + `-webkit-touch-callout: none`,
while message content stays fully selectable (Copy and Select all untouched).
`assets/app.js`: `pruneSelection()` clears a selection only when its anchor/focus node
is no longer in the document, called after a transcript rebuild and after a streaming
repaint.

**Status: fixed in code, device gesture check still open.** The web suites cover the
rules, but the on-device confirmation needs a physical long press: `adb shell input
swipe` (same point, 900 ms) and CDP `Input.dispatchTouchEvent` were both tried and
neither triggers WebView text selection, so no synthetic input can prove it. Please
long-press a message (a selection should appear) and the header (nothing should) — that
is the last 5-second check.

## 6. Failure-mode tests

New, in the repo:

- `test/suite-12.cjs` — the browser-level failure modes (13 checks, above).
- `test/device-live.cjs` — the real device: identity, real turn, Stop, real backup,
  daemon kill → banner → restart recovery (5 checks).
- `test/device-reinstall.cjs` — the destructive cycle: safety copy, backup, uninstall,
  reinstall, fresh-install behaviour, restore via the system picker, ids, transcript
  (9 checks).
- `test/device-fresh-install.cjs` — first run with no engine on disk: the app's own
  download from the repo release, SHA verification, unpack, daemon start, then the
  backup offer and restore (6 checks).
- Demo fixtures for all of it in `assets/mock.js` (`token limit`, `cut off`,
  `go offline`, `unreachable`, `ses_demo_long` with 360 messages, paged `messages()`).

From the requested list: disconnect during thinking / during tool execution (banner +
recovery), restore after several minutes (reconcile + stale watch), API timeout
(`retryable`, reads retried, writes not), DNS failure (`TypeError` → offline path),
output token limit, partial streaming, process killed mid-generation, restart with a
pending request, duplicate retry prevention, runtime stopped (daemon kill), complete
uninstall/reinstall, session DB rediscovery, backup/restore, multiple consecutive
conversations (suites 1–11), long-running tool calls (suite 9's live multi-step turn).

## 7. What is still open (stated plainly)

| Item | Status |
| --- | --- |
| Selection toolbar, physical long-press confirmation | **blocked** — needs a real finger; synthetic input cannot start WebView selection |
| `MediaStore` rows are dropped on uninstall | **known limit, worked around** — the file picker restores after a reinstall; the in-app list only shows backups from the current install. Documented in `docs/FEATURES.md` |
| UI port can move (8099 → 8098) after an in-app restart | **mitigated** — `restartRuntime()` now really restarts the daemon; the app follows the port it actually bound. A restart still costs one socket bind |
| Uncommitted WAL data in a backup | **handled** — `opencode.db-wal`/`-shm` are included, so SQLite replays them on reopen |
| Server-side schedules (403), `/api/fs/find` (500), PTY (permission denied) | unchanged upstream limits, already documented in `docs/API-MAP.md` |
