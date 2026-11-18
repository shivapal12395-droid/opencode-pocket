# Main chat — reliability report

Extreme-usage pass over the main chat: long conversations, streaming chaos,
long agent runs, network failure, Android lifecycle, scroll/UI, performance,
session integrity. This is what was actually run, what it measured, and what is
still blocked. Nothing here is claimed from a fixture alone where a real daemon
test exists, and nothing is claimed as passed that did not run.

Layers, fixtures and how to run them: `docs/TESTING.md`.

---

## Tagged state

| # | Area | Status |
| --- | --- | --- |
| 1 | Long conversation (133 messages, all content types) | **verified** (web) |
| 2 | Extreme streaming (12 cases) | **verified** (web) — 1 product fix |
| 3 | Very long agent execution | **verified** (web) + earlier device run |
| 4 | Network failure chaos | **verified** (web) + earlier device run |
| 5 | Android lifecycle (rotation, keyboard, background, process death) | **blocked** — phone disconnected mid-session |
| 6 | UI and scroll stress | **verified** (web); selection-toolbar gesture **blocked** |
| 7 | Performance and memory | **verified** (web) — 1 product fix |
| 8 | Session integrity | **verified** (web) + earlier device run |
| 9 | Test architecture | **done** (`docs/TESTING.md`) |
| 10 | Continuous soak | **verified 15.1 min + 6 min re-run**; 2 h and 24 h **not run** |
| 11 | Regression policy | followed; 3 fixes, each with a regression test |
| 12 | Acceptance gate | see the table at the end |

---

## Product fixes this pass produced

### 1. Duplicate frames doubled the text (streaming)

The client applied every frame it received. A reconnecting stream, a
double-subscribed reader or a flaky proxy can deliver the same frame twice, and
text deltas are appended, so one duplicate doubles a word. Every server event
carries an `id` (`evt_…`), so `handleEvent` now keeps a bounded set of applied
ids (800) and ignores a repeat.

Regression: `suite-13` "Duplicate frames never double the text" (peak length
never exceeds the final text) and "Shuffled frames converge".

### 2. Drafts leaked between conversations and died with the process

The composer was one global textarea: a draft typed in one conversation followed
you into the next, and a process death lost it. Drafts are now stored per session
(`ocp.draft:<id>`), saved debounced on input and immediately on background/page
hide, restored when the session opens, cleared when it is sent.

Regression: `suite-13` "Drafts are per conversation and survive a switch",
"A sent message clears its draft".

### 3. The diagram observer kept discarded nodes alive

The transcript is rebuilt wholesale on every event, so a diagram that had not
scrolled into view yet got a new node each time — and the IntersectionObserver
kept watching every discarded one. Now stale targets are unobserved before new
ones are added.

Regression: `suite-13` "A streamed rebuild does not keep discarded diagrams
alive" (observed set 0 → 0 across 40 rebuilds).

### Test-side bugs found and fixed (they were hiding real signal)

- **The mock gave every event the same id.** `emit()` used a counter it never
  incremented. Nine suite-13 failures turned out to be one fixture bug; the
  dedupe fix above exposed it. The mock now assigns a unique id per event, like
  the server does.
- **The soak counted repeated bubble text as duplication.** It sends the same
  handful of prompts, so identical text is expected. The metric now checks what
  actually matters: repeated message ids, never-replaced optimistic bubbles, and
  the UI's answer equalling the server's.

---

## What each area measured

### 1. Long conversations

`ses_demo_stress` — **133 messages**, 65 requests: short prompts, very long
answers (14-paragraph prose), TS code blocks, tables, nested lists, inline and
display KaTeX, a Mermaid diagram every fifth turn, tool calls, shell rows.

| Check | Result |
| --- | --- |
| Every message present after paging (80 per page) | 52 rows first page → **130 rows**, 130 unique ids |
| Ordered | ascending by message index, no gaps |
| Rendering | 130 rows, 5 111 DOM nodes, ~29 000 px tall, one scroll round trip 1 326 ms |
| Composer after the load | still accepts text, mode `send` |
| Horizontal overflow | document 390 px == viewport 390 px, nothing outside a code/table container |
| Activity panels | 65 panels for 65 requests, none live while idle, none inside an answer body |
| Draft | per conversation, restored on switch |
| Reopen ×3 (with paging) | JS heap 31 → 23 MB |

### 2. Extreme streaming

| Case | Result |
| --- | --- |
| One-character chunks (150 growth steps, 1 009 chars) | UI text == server text, all probes on screen |
| Rapid 14-char chunks | same |
| One 5 kB chunk | same (2 growth steps — nothing to stream) |
| Empty / malformed frames (43 growth steps) | same, no corruption |
| Unicode, Hindi, emoji, RTL, zero-width | source == server (347 chars), 6/6 probes |
| Same frame twice (same id) | peak 1 011 ≤ final 1 011 — the duplicate was ignored |
| Scrambled frame order | converges to the server text, one closing line |
| Socket dies mid-answer | 270 chars kept, banner shown, Retry → reconciled to 1 007 chars exactly once |

### 3. Long agent execution

Multi-step turns (reasoning + tools in two assistant messages), stop during a
turn, continue/retry after an output limit: `suite-9`, `suite-12`, `suite-13`
(one panel per request, answers separate, no live panel when idle). On the
device, `device-live` ran a real turn and a real Stop against the daemon earlier
in the same day (`hy4-flash-free` is now wired into `device-stress` for the long
run; that suite is blocked, see below).

### 4. Network failure

Web: banner → finite retries → manual Retry → session recovered from the server;
ambiguous prompt never re-sent automatically; reads retry, writes never do;
stream budget is finite. Device (earlier today, same build lineage):
`device-live` killed the daemon mid-turn and observed `1/8 … 7/8` then "stopped
retrying", followed by recovery with 5 sessions intact.

### 5. Android lifecycle — BLOCKED

`test/device-stress.cjs` is written and ready (rotation, keyboard, 45 s
background, process death, PSS + JS heap, real hy4 long answer) but **has not
run**: `adb devices` returned empty partway through this session — the phone
disconnected. These items are blocked, not passed.

What *is* proven without the phone: drafts survive a session switch and are
persisted to `localStorage` on input, on background and on page hide, so a
process death cannot lose them. That is code plus web tests, not a device
observation.

### 6. UI and scroll

No horizontal overflow on a 133-message transcript; scrolling up during a stream
keeps the reader in place (0 px drift) and shows jump-to-latest; jump-to-latest
reaches the end; code blocks, tables and diagrams stay inside their containers;
viewers, copy buttons and the print/export paths are covered by `suite-11` and
`device-render`. The stray Android selection toolbar has a code fix (chrome not
selectable, orphaned selections pruned) — the physical long-press confirmation is
still blocked, because neither `adb shell input swipe` nor CDP
`Input.dispatchTouchEvent` makes WebView start a selection.

### 7. Performance and memory

| Measurement | Result |
| --- | --- |
| 133-message transcript | 5 111 DOM nodes, 29 000 px, scroll round trip 1 326 ms |
| Heap across 3 reopen cycles (with paging) | 31 → 23 MB (no growth) |
| Diagram observer after 40 rebuilds | 0 stale targets retained |
| Soak, 15.1 min / 198 turns / 29 samples | JS heap first 24 MB, peak 49 MB, last 44 MB, oscillating with GC |
| Soak DOM nodes | stable ≈ 5 900–6 300, no monotonic growth |
| Soak round failures / console errors | 0 / 0 |

The soak's heap curve oscillates rather than climbing; the reopen-cycle numbers
are flat-to-down. No unbounded growth was observed in the tested workload on the
web layer. **Device PSS was not sampled** (phone disconnected).

### 8. Session integrity

Server ids, message persistence, reopening, switching, forking, compaction,
rewind, export/import, backup/restore, runtime restart: `suite-8`, `suite-10`,
`suite-12`. Reinstall recovery is proven separately and only by actually doing it:
`device-reinstall` (uninstall → install → restore via the system file picker →
all original ids back) and `device-fresh-install` (no engine on disk → 119 MB
downloaded from the repo release → SHA verified → daemon up → backup offered →
restored). Both ran earlier today; they need a re-run on the current build
(same blocked reason).

### 10. Soak

| Run | Duration | Rounds/turns | Samples | Memory | Integrity |
| --- | --- | --- | --- | --- | --- |
| 1 | **15.1 min** (requested 15) | 198 | 29 | heap 24 → peak 49 → 44 MB | source == server in every sample; 0 round failures; 0 console errors |
| 2 | **6.0 min** (re-verify with the corrected metric) | 80 | 12 | heap 24 → peak 37 → 29 MB | **clean in every sample**: 0 duplicate ids, 0 un-replaced bubbles, newest user message shown exactly once, source == server |

Round 1's "integrity violated" was the metric, not the app: it counted repeated
bubble *text* as duplication, and the soak deliberately sends the same few
prompts. Round 2 measures ids, optimistic bubbles and source-vs-server instead.

What the soak does per round: a prompt (short, long, multi-step, or a chaos
burst on every fifth), a scroll up and back, a session switch to the 133-message
transcript and back, and a 30-second sample of heap, DOM nodes, message ids and
answer integrity.

A 2-hour soak and a 24-hour soak have **not** been run. The device soak has not
been run either.

---

## Acceptance gate

| Metric | Result |
| --- | --- |
| Total tests (this pass) | **161** web checks across 13 suites (144 existing + **17 new** in suite-13) |
| Passed | **161** (suite-13: 17/17, every other suite re-run green) |
| Failed | **0** |
| Blocked | **4 items** — device-stress suite (rotation/keyboard/background/process death/PSS), device soak, selection-toolbar physical long-press, re-run of the 4 device suites on the current build |
| Longest tested conversation | **133 messages** (`ses_demo_stress`); 360-message session used for paging |
| Longest soak test | **15.1 minutes**, 198 turns (2 h and 24 h: not run) |
| Peak memory | web: JS heap **49 MB** peak / 44 MB at the end of the 15-minute soak; 6 345 DOM nodes peak; device PSS **not measured** |
| Network recovery | **pass** (web: banner → bounded retries → manual Retry → reconciled; device: daemon kill → recovery, earlier today) |
| Session integrity | **pass** (web suites; device reinstall + fresh install proven earlier today) |
| Critical unresolved bugs | **0 known in the chat path** — with the caveat that the Android lifecycle block is untested, so it cannot be called clean |
| High-severity | 0 known; 4 blocked items above are the honest gap |

Fixes landed with this pass: duplicate-frame dedupe, per-session persisted
drafts, diagram-observer leak. Each has a regression test in `suite-13`.
