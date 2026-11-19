# Main chat: stop, reconcile, activity, question, scroll

Five reported bugs, each traced to a cause in the code, fixed in the smallest
component that owned it, and covered by a test that fails on the old behaviour.
The web layer runs on deterministic fixtures (`suite-14`, 17 checks); the device
layer runs the same journeys against the real daemon (`device-chat-fixes`).

Everything below was run. Sections marked **blocked** were not.

---

## What the real server actually does (measured, not assumed)

Two probes against the daemon on the phone decided the design:

**Interrupt** (`POST /api/session/:id/interrupt`, HTTP 200 `{interrupted:true}`),
captured mid-stream:

```
+  80ms  session.text.ended        (the partial text)
+  80ms  session.reasoning.ended
+  80ms  session.step.streamed
+  80ms  session.step.failed       error {type:"aborted", message:"Step interrupted"}
+  80ms  session.execution.interrupted
```

- there is **no `session.idle` event**; the turn ends with `execution.interrupted`,
- the transcript gains an `idle` message with `outcome: "interrupted"`,
- the assistant message keeps the partial text and carries `error.type = "aborted"`,
- a tool that was mid-flight is finalized as `error` with the same `aborted` type,
- a prompt queued behind the turn **stays in the inbox** and does not run.

**Queued prompt after a stop** stayed in `GET /inbox` and started zero
executions for 12 seconds. **Text vs. ask**: the real `question` tool is stored in
the transcript as a `tool` part named `question` — so an answered question does
not need a form card to stay in history.

---

## 1. Stop must actually stop

**Reproduction** (old build): send a long prompt, tap Stop while text streams.
The composer returned to Send almost at once, but the header flickered back to
"Thinking" a moment later, and a tool kept spinning. Offline, Stop only showed a
toast and the turn kept running; when the connection returned nothing was sent.

**Root cause**

- `interrupt()` refused to do anything when `state.online` was false, and never
  remembered the intent, so a reconnect could not retry it.
- Nothing told the header it was stopping; `state.stopping` was invisible.
- A step/execution event arriving after the stop set `busy` again, because there
  was no way to tell the stopped turn from the next one.
- Any `step.failed` was rendered as a red failure — including the server's
  `aborted` step, i.e. the user's own Stop looked like a crash.
- A tool left `running` by the server kept a spinner forever once the turn ended.

**Fix** (`assets/app.js`)

- `interrupt()` sets phase `stopping` (header "Stopping…"), ignores a second tap
  while a request is in flight (8 s safety unlock), and when offline records
  `stopPending` instead of lying.
- `recoverAfterReconnect()` sends a pending stop before trusting anything else.
- `promptSeq` / `stopConfirmedSeq`: a late `execution.started`, `step.started` or
  `retry.scheduled` from a stopped turn is ignored; the next prompt increments the
  sequence and events flow again.
- `step.failed` with `error.type === "aborted"` marks the message `interrupted`
  instead of `error`; `renderAssistant` shows no failure card for it.
- `toolStatus()` reports a tool that is still `running` after the turn ended (or
  an `aborted` error) as `interrupted`; `renderTool` renders "Stopped" with a stop
  icon, and `activitySummary` does not count it as failed.
- `verifyTurn({afterStop:true})` (2.5 s after the request) asks the server; if it
  is still running, the composer goes back to Stop and a toast says
  "The server is still running this turn — a tool may not be interruptible".
- `session.execution.interrupted` reloads the inbox and forms, so a queued prompt
  is visible and not silently executed.

**Tests**

| Test | What it proves |
| --- | --- |
| `suite-14` 1 | 138 chars streamed → double-tapped Stop → one interrupt request, "Stopping…", server `aborted`, 276 chars kept, 0 failure cards, Interrupted row |
| `suite-14` 2 | tool running → Stop → 1 tool "Stopped", 0 spinners |
| `suite-14` 2b | a tool that ignores the interrupt: the UI says so and keeps Stop mode until the server really ends |
| `suite-14` 3 | a new prompt immediately after Stop runs exactly once |
| `suite-14` 3b | a prompt queued behind the stopped turn stays queued and never runs by itself |
| `suite-14` 11 | socket dies → Stop → "Stop pending" → reconnect → the stop is sent and confirmed |
| `device-chat-fixes` 1 | real model: 549 chars streamed → Stop → "Stopping…" seen → server aborted, 658 chars kept, 0 failures |
| `device-chat-fixes` 2 | real shell tool running → Stop → 1 stopped tool, 0 spinners, 0 failed, daemon idle |

---

## 2. The response must appear immediately

**Reproduction**: a completed answer stayed missing until the next prompt; the
old activity caption could also sit on a finished turn while the transcript was
still the streamed copy.

**Root cause**: `session.text.ended` updated the live copy and re-rendered, but
nothing re-read the server; `session.step.failed` set `busy = false` and rendered
without refreshing at all; the terminal refresh was a 250 ms debounce that every
later event could keep pushing back. A missed terminal event left the composer in
Stop mode until the 45 s stale watch — which never re-armed itself.

**Fix**

- `text.ended` schedules a transcript re-read (500 ms) and a `verifyTurn` of its
  own at 2.5 s if the turn still looks busy.
- `execution.succeeded/failed/interrupted` refresh at 80 ms instead of 250 ms.
- `step.failed` refreshes 120 ms later and reloads the inbox.
- `armStaleWatch()` re-arms while the turn is still open, so a lost `idle` can
  never leave the composer in Stop mode for the session.

**Tests**

| Test | What it proves |
| --- | --- |
| `suite-14` 4 | the answer is fully on screen while the composer is still in Stop (terminal event delayed 6 s), then Send |
| `suite-14` 5 | no terminal event at all: the composer releases in under 9 s and UI text equals server text |
| `suite-14` 6 | multiple assistant steps: one panel, both tools, answer last |
| `device-chat-fixes` 1 | the real partial answer's tail is on screen after the interrupt |

---

## 3. The Worked panel has one fixed position

**Reproduction**: with several assistant steps per request, the panel appeared
under the step that happened to hold the first tool, so it moved between the
answer's paragraphs as steps arrived. A tool-only step rendered as its own
message *only* to host the panel.

**Root cause**: `renderAssistant` injected `turn.items` at the position of the
first tool/reasoning part inside a message; `renderMessages` then assigned the
panel to one message id.

**Fix**: the panel is now a row of its own. `renderMessages` computes
`panelAt` = the turn's user message and emits, for every turn with tools or
reasoning, exactly one panel immediately after that user message (or at the top
of a window that starts mid-turn). Assistant bodies render text only; a
tool-only step renders nothing. Placement is therefore user → panel → answer for
every turn, live and historical.

**Tests**

| Test | What it proves |
| --- | --- |
| `suite-9` (rewritten) | a mid-turn window: the cut-off turn's panel leads, the loaded turn's panel is between its user message and its answer; 8 tool cards all inside panels; 0 step-only rows |
| `suite-14` 6 | one panel for two assistant steps, between user and answer, "Worked for 3s · 3 steps" |
| `suite-14` 7 | 10 consecutive turns: user → panel → answer every time, one tool per panel, no merging |
| `suite-14` 16 | portrait → landscape → portrait during streaming: panel count unchanged |
| `device-chat-fixes` 4 | real tool turn: one panel (2 tools), between user and answer |

---

## 4. Ask Question cleanup

**Reproduction**: after answering, the form stayed at the bottom of the
transcript as a compact card — below every later message, because settled forms
were kept in `state.forms` and re-appended on each render (and `loadForms`
re-added them from the local copy).

**Root cause**: `settleForm()` only changed `status`; `loadForms()` explicitly
kept non-pending entries; the renderer always appended `state.forms` at the end.

**Fix**

- `state.forms` holds **pending forms only**. `settleForm()` removes the entry;
  submit and dismiss call it as soon as the server accepts.
- Submitting or dismissing re-reads the transcript; the question itself is
  already there as a `question` tool part inside the turn's activity panel (as
  the real server stores it), so history keeps it without a card.
- `form.replied` / `form.cancelled` are idempotent: a duplicate finds nothing and
  does nothing. A duplicate is exercised in the test.
- `form.created` no longer forces a render or a scroll; it raises the jump pill
  and a toast instead of yanking a reader.

**Tests**

| Test | What it proves |
| --- | --- |
| `suite-14` 8 | answer → card gone in <100 ms, duplicate `form.replied` is a no-op, still gone after reopening |
| `suite-14` 8b | dismiss → card gone in <100 ms, turn closes with the dismissal answer |
| `suite-1` (updated) | submit → card closes → follow-up answer appears |
| `device-chat-fixes` 3 | real question tool: answered, card gone, question kept in 1 activity panel, gone after reopen |

---

## 5. Scroll follow

**Reproduction**: answering a question moved a reader who had scrolled up;
streaming could also shift the reading position when content above changed
(diagram drawn, panel caption rewrapped).

**Root cause**: `renderMessages(force)` used one flag for "render now" and
"scroll to the bottom"; form flows passed `true` and then called
`scrollToBottom(true)`. A rebuild also restored a raw `scrollTop`, which no
longer points at the same message when heights change above the viewport.

**Fix**

- Forced scrolling is only used for the user's own actions (sending a prompt,
  opening a session, jump-to-latest). Form settle no longer forces anything.
- `renderMessages` anchors the message under the top edge: it records the node
  and its offset before the rebuild and realigns it afterwards.
- `drawDiagramInPlace()` does the same around a Mermaid render, because drawing
  a diagram above the reader changes the height there.
- A reader at the bottom still follows the stream; scrolling up shows the
  jump-to-latest pill, and only that button (or scrolling back down) resumes
  following.

**Tests**

| Test | What it proves |
| --- | --- |
| `suite-14` 9 | reader 1200 px up: answering a question leaves the anchored message at the same pixel (−835 → −835) |
| `suite-14` 10 | while streaming: anchor moves 1 px, jump pill appears, jump reaches the end |
| `suite-14` 16 | landscape/portrait: no overflow, composer visible, panel count unchanged |
| `device-chat-fixes` 5 | real daemon: 600-number scrollback, streaming turn, anchor stays within 12 px, jump works |

---

## Regression runs

| Layer | Command | Result |
| --- | --- | --- |
| Web | `suite-1 … suite-14` | **178 checks, 0 failed** |
| Device | `device-chat-fixes` (real daemon, RMX5003) | **6 checks, 0 failed** |
| Device (earlier, same build lineage) | `device-live`, `device-reinstall`, `device-fresh-install`, `device-render`, `device-stress` | see `CHAT-RELIABILITY-REPORT.md`; not re-run for this five-bug pass except where listed |

`suite-9` and `suite-1` were updated because the contract changed on purpose
(one panel per turn as its own row; a settled form closes instead of staying).
In both cases the assertions were made **stronger**, not weaker: suite-9 now
also proves there are no step-only rows and that every tool card is inside a
panel; suite-1 proves the card closes and the follow-up arrives.

## Blocked / not claimed

- No 2-hour or 24-hour soak was run for this pass.
- The Android text-selection long-press still needs a physical gesture (same
  limitation as the previous pass).
- `device-stress` (rotation with the keyboard, process death, PSS) was not
  re-run; only the rotation layout is covered here, in the web suite.

## Acceptance

| Metric | Result |
| --- | --- |
| Total tests (this pass) | **184** — 178 web checks across 14 suites + 6 device checks on the real daemon |
| Passed | **184** |
| Failed | **0** |
| Blocked | **3** — 2 h/24 h soak (not run), physical selection-toolbar long-press (needs a finger), `device-stress` re-run (not requested here) |
| Longest conversation exercised | 133 messages (`ses_demo_stress`) with stop, forms, streaming and paging |
| Longest soak | not run this pass (previous pass: 15.1 min / 198 turns) |
| Real-model long task | `hy4-flash-free` (1M context / 65k output), 371–658 chars kept after a real interrupt |
| Network loss during Stop | pass (web; device covered by the earlier `device-live` daemon-kill run) |
| Session integrity | 0 duplicate ids, 0 duplicate bubbles, server transcript equals the UI's copy in every stop/reconcile test |
| Critical unresolved bugs | **0 known** in the five reported areas |

