# Testing

Four layers, from cheapest to most real. Everything runs from the repo root, and
every layer is honest about what it does *not* prove.

```
node server.mjs --port 8099            # the web layers need this

node test/suite-1.cjs  … suite-13.cjs  # A/B/C  (browser + Node, deterministic fixtures)
node test/soak.cjs --minutes=15        # C      (sustained session, measurements)

adb forward tcp:9227 localabstract:webview_devtools_remote_$(app pid)
node test/device-live.cjs              # D      (real daemon, real WebView)
node test/device-stress.cjs            # D      (rotation, keyboard, process death, memory)
node test/device-render.cjs            # D      (the Aurora-derived renderer)
node test/device-reinstall.cjs         # D      (uninstall -> reinstall -> restore)
node test/device-fresh-install.cjs     # D      (first run, engine download from the repo)
```

## A. Unit-ish (Node, no DOM)

| Suite | Covers |
| --- | --- |
| `suite-12` transport half | `ApiError.retryable/offline`, reads retry / writes never retry, cursor requests omit `order` |
| `suite-12` stream half | `streamEvents` finite budget, `failed` status, `retryNow()` restart |
| `suite-4` | IndexedDB history store, save/export/clear, demo isolation |
| `suite-13` | draft lifecycle, event-id dedupe effect, message `source == server` equality |

## B. Integration (the app against a server shape)

| Suite | Covers |
| --- | --- |
| `suite-9`, `suite-10` | live-turn activity, permissions, forms, inbox, session flows |
| `suite-12` | finish reasons, ambiguous prompts, paging, reconnect reconciliation |
| `suite-13` | chaos streaming: duplicate / empty / shuffled / one-char / huge / dropped-socket frames |
| `device-live` | the real daemon: real turn, Stop, backup, daemon kill → restart |

## C. Chat UI end-to-end (browser, deterministic fixtures)

| Suite | Covers |
| --- | --- |
| `suite-11` | rich markdown: callouts, KaTeX, highlight, Mermaid, lightbox, exports, print |
| `suite-13` | a 133-message conversation, paging, integrity, overflow, scroll behaviour, panels, memory across reopens |
| `soak.cjs` | sustained: repeated turns, chaos bursts, scrolling, session switching, sampled heap/nodes/integrity |

## D. Android device

| Suite | Covers |
| --- | --- |
| `device-live` | installed APK, real daemon, banner → manual Retry → recovery |
| `device-stress` | rotation, keyboard, background/foreground, process death, PSS + JS heap, a real long answer on `hy4-flash-free` |
| `device-render` | the renderer the app actually ships |
| `device-reinstall` | backup → uninstall → install → restore with original ids |
| `device-fresh-install` | first run with no engine on disk: download, SHA, unpack, daemon |

## Fixtures

`assets/mock.js` is the deterministic server. Reliability tests use it because a
failure has to be reproducible; the device suites use the real daemon because a
fixture cannot prove interoperability.

Reliability fixtures added for this work:

| Fixture | What it is |
| --- | --- |
| `chaos duplicate` | every text frame delivered twice with the same event id |
| `chaos empty` | empty deltas and frames without a `delta` field |
| `chaos shuffle` | frames delivered in a scrambled order |
| `chaos onechar` / `rapid` / `huge` | 1-char, 14-char and 5 kB chunks |
| `chaos break` | the socket dies mid-answer; the server still finishes the turn |
| `chaos unicode` | Hindi, emoji, combining marks, RTL, zero-width |
| `ses_demo_long` | 360 trivial messages, for paging |
| `ses_demo_stress` | 133 mixed messages: code, tables, nested lists, math, diagrams, tool calls, shell rows, very long answers |
| `ses_demo11` / `ses_demo12` | diagrams that use a reserved class name / flowchart notes |

Every event the mock emits now carries its own id, because the client
deduplicates frames by id — the same way the real server behaves.

## Rules the suites follow

- **Condition-based waits.** `waitIdle()` polls the composer's mode; no fixed
  sleep decides a pass.
- **Isolation.** A suite that can wedge the socket reloads the page first, so one
  case cannot corrupt the next (found the hard way: a dropped socket in one chaos
  case starved every later turn).
- **Invariants, not snapshots.** "the UI's own text equals the server's text",
  "one panel per request", "no duplicate ids", "no horizontal overflow",
  "heap growth under N MB" — these hold at any point in a stream.
- **No weakened assertions.** Where a check was wrong (comparing rendered text to
  raw markdown, or requiring many growth steps from a single 5 kB frame), the
  assertion was fixed to measure the real property, and the reason is in the
  test.

## What is not covered here

- A 24-hour soak has never been run.
- Device rotation/keyboard/process-death tests need the phone attached; when it is
  not, those items are *blocked*, never reported as passed.
- The Android selection toolbar needs a physical long-press: neither `adb shell
  input swipe` nor CDP `Input.dispatchTouchEvent` makes WebView start a text
  selection, so it cannot be asserted from a script.
