# Rolling audit — live ack-attribution + command-arbiter layer

- **When:** 2026-07-17 14:37 (+08)
- **Tree:** `origin/main` @ `b8f773e5` (audit branch rebased onto it).
- **Scope:** the **impure** counterpart to iteration 18's pure streamer — the layer that decides whether an inbound GRBL `ok`/`error` advances the **job stream** or settles an **untracked (owned-command)** ack: `laser-stream-ack.ts` (81), `laser-line-handler.ts` (280 counted), `laser-interactive-command.ts` (349 counted), `laser-line-shared.ts` (42), plus the ledger's real source of truth in `laser-safe-write.ts` and the Start fence in `laser-job-actions.ts`. A mis-attribution costs either a phantom-advanced job line (RX budget freed that GRBL never freed) or a stranded fence (Start blocked).
- **Method:** my own end-to-end trace of the write→ack ledger (plus a throwaway unit probe on the clean tree, since deleted), alongside a **6-dimension adversarial review** (attribution, arbiter, line-handler, rules, deadcode-drift, test-gaps) with per-finding refute-verifiers — 24 agents, **18 findings raised**, each adversarially verified. The two efforts converged independently on the same primary window (P2-1), which is the strongest evidence in this report; where we disagreed on severity, I state both positions and the fact that would settle it.
- **Report-only** per CLAUDE.md collaboration rule 1 — **nothing was fixed**. Every claim below is one I verified against the current tree myself, not one I inherited from a subagent.

---

## Headline

**Three P2s, all rooted in one mistake:** `hasUnsettledStreamAcks` uses **status as a proxy for "the stream owns the next ack."** That is false whenever an untracked write is on the wire and the stream's lines were written later — or not at all. The F1 fix made the stream claim *every* ack while `streaming`/`paused`; two reachable windows slip through that claim, and a third finding is the `$`-prefix over-match that accidentally shields GRBL from one of them.

- **P2-1 — pause during the post-job settle → stranded ledger.** I attacked the attribution premise and found this window myself; the review's attribution finder found it independently and rated it P1. I argued *down* to P3 (on GRBL the settle marker is a synchronizing dwell that cannot ack under a feed hold — safety by physics, not by code), then checked *which drivers actually send a hold*: **Marlin and Ruida declare `hold: null`**, and that pause path sets `paused` while sending **nothing**, so buffered motion finishes and the marker acks inside the window. Deterministic on Marlin. **Demonstrated by a unit probe on the clean tree** (`OWNER: stream, REMAINING ACKS: 1`). The verifier, reproducing it independently, also landed on **P2**.
- **P2-2 — Continue during an unsettled jog → phantom advance.** The worse one: the stream claims acks earned by lines written *before* its own, then frees RX budget the controller never freed. Raised by the review, every fact re-verified by me. I rate P2 on a narrow race; **the verifier rates it P1** on a wider window. The deciding fact is firmware ack timing, which the tree cannot settle.
- **P2-3 — `$J=` misclassified as setup-only** → GRBL jogs are rejected at a tool-change hold, the workflow the hold exists for.

**Nothing was fixed.** One process disclosure: the review's subagents modified the working tree; I reverted it (see below).

---

## How the ledger actually works (verified, and the basis for everything below)

`safeWrite` reserves one untracked ack **per newline** — except for job-stream chunks:

```ts
function owedTerminalAcks(line: string, source: TranscriptSource): number {
  if (source === 'job') return 0;
  let count = 0;
  for (const ch of line) if (ch === '\n') count += 1;
  return count;
}
```
([laser-safe-write.ts:150-155](../../src/ui/state/laser-safe-write.ts); reserved at [:84-87](../../src/ui/state/laser-safe-write.ts) *before* the first await, released on write failure at [:131](../../src/ui/state/laser-safe-write.ts))

`transcriptSourceForWrite` maps `action: 'start' | 'resume'` → `'job'` ([laser-safe-write.ts:163](../../src/ui/state/laser-safe-write.ts)), so **stream refills owe nothing** — the tool-change exit's `safeWrite(toSend, 'resume')` ([laser-job-actions.ts:435](../../src/ui/state/laser-job-actions.ts)) and every resume write are correctly invisible to the ledger. Status polls (`?`) carry no newline → zero. Realtime bytes likewise. The **only** decrement path on success is `settleUntrackedAck`; the counter is otherwise zeroed only at reset/connect/disconnect boundaries ([laser-line-handler.ts:231,338](../../src/ui/state/laser-line-handler.ts), [laser-connection-actions.ts:219](../../src/ui/state/laser-connection-actions.ts), [laser-disconnect-transaction.ts:89](../../src/ui/state/laser-disconnect-transaction.ts)).

---

## P2-1 — Pausing during the post-job settle strands the untracked-ack ledger for the whole serial session (deterministic on Marlin/Ruida)

`hasUnsettledStreamAcks` claims **every** terminal ack for the stream while the status is `streaming` or `paused` — *unconditionally, even with an empty `inFlight`*:

```ts
if (streamer.status === 'disconnected') return false;
if (streamer.status === 'streaming' || streamer.status === 'paused') return true;
return streamer.inFlight.length > 0;
```
([laser-store-helpers.ts:155-163](../../src/ui/state/laser-store-helpers.ts))

That over-claim is deliberate and is the F1 fix: better to hand an ack to the stream (where a spare `ok` is a no-op) than to settle the untracked ledger one ack early. Note it fires **even when the stream provably owns nothing** — and the tree itself documents that this state is *routine*, not exotic. `laser-line-handler.test.ts` builds a `drainedPausedStreamer()` that is `paused` with `inFlight === []` ([:352-362](../../src/ui/state/laser-line-handler.test.ts)) and explains why:

```
// GRBL keeps acking held lines during a feed hold, so a paused stream
// routinely has an empty in-flight tail.
```
([laser-line-handler.test.ts:348-351](../../src/ui/state/laser-line-handler.test.ts))

So the rule is safe only if **no untracked write can owe an ack while the status is `streaming`/`paused`.** I traced every caller to test that:

- **Console, probe, settings, home, jog** all gate on `isActiveJob`, which **includes `done`** ([laser-store-helpers.ts:58-63](../../src/ui/state/laser-store-helpers.ts); console at [laser-console-actions.ts:167](../../src/ui/state/laser-console-actions.ts)) — fenced.
- **Stream refills** owe zero acks (`source === 'job'`) — structurally excluded.
- **The CNC start command** is `await`ed before the streamer exists ([laser-job-actions.ts:175](../../src/ui/state/laser-job-actions.ts)) — fenced.
- **The post-job settle is the one exception.** It writes the settle dwell as an *owned* command with `action: 'console', source: 'system'` ([laser-post-job-settle.ts:49-57](../../src/ui/state/laser-post-job-settle.ts)) → `owedTerminalAcks` returns **1** → `pendingUntrackedAcks = 1`, written while `streamer.status === 'done'` (where attribution is `inFlight`-based, hence correct).

The gap: `pause()` from `done` is **explicitly supported in exactly that window**, and the reducer's own comment describes it:

```ts
// `done` means every line was accepted, not that GRBL finished executing
// planner motion. The UI keeps that tail active until a later Idle report,
// so it must remain pausable while the controller still reports Run.
if (state.status !== 'streaming' && state.status !== 'idle' && state.status !== 'done') return state;
```
([streamer.ts:322-330](../../src/core/controllers/grbl/streamer.ts)) — and `runConfirmedPauseJob` guards only on a concurrent pause/resume transition, **not** on `controllerOperation` ([laser-job-pause-resume.ts:51-52](../../src/ui/state/laser-job-pause-resume.ts)), so the settle window is not fenced from pause.

If a settle `ok` were **processed** while the status is `paused`, `settleUntrackedAck` would take the `hasUnsettledStreamAcks` branch and return `'stream'` **without decrementing** — stranding the counter at 1.

**Why the drained-paused state is harmless mid-job:** during a normal job the ledger is empty — Start drains it to zero before streaming ([laser-job-actions.ts:168-171](../../src/ui/state/laser-job-actions.ts)) and every command path is `isActiveJob`-fenced for the job's duration, so `settleUntrackedAck` short-circuits at `pendingUntrackedAcks === 0` and never reaches the over-claim branch. The post-job settle is the sole write that puts a `1` on the ledger inside that window.

**The operator can reach it — the UI mounts Pause in exactly that window:**

```ts
const canPause =
  streamer?.status === 'streaming' || (streamer?.status === 'done' && isControllerRunning);
```
([LiveMotionBar.tsx:75-76](../../src/ui/laser/LiveMotionBar.tsx)) — `done` + controller reporting `Run` **is** the post-job motion drain. `hasRealtimePause` only feeds the button's tooltip, so the button is mounted and clickable even on a driver with no realtime pause at all.

**Why the driver decides everything.** A normal `G1` is acked when it is *parsed into the planner*, which a feed hold does not prevent — hence the test's "GRBL keeps acking held lines." The settle marker is not a normal line; it is a **synchronizing** marker that acks only once buffered motion drains. So the question is whether Pause actually stops that drain, and **that depends on the driver**:

| Driver | `realtime.hold` | `settleDwell` | Result |
|---|---|---|---|
| GRBL | `RT_HOLD` ([driver.ts:62](../../src/core/controllers/grbl/driver.ts)) | `G4 P0.01` | Hold suspends the planner → the dwell's buffer-sync spins → **no ack while paused**. Safe by physics. |
| Smoothieware | `RT_HOLD` ([driver.ts:51](../../src/core/controllers/smoothieware/driver.ts)) | `M400` | Same. |
| **Marlin** | **`null`** ([driver.ts:55-56](../../src/core/controllers/marlin/driver.ts)) | **`M400`** ([commands.ts:12](../../src/core/controllers/marlin/commands.ts)) | **No hold is ever sent — motion finishes and M400 acks *while paused*. Deterministic strand.** |
| Ruida | `null` ([driver.ts:37](../../src/core/controllers/ruida/driver.ts)) | `''` | Same no-hold path (marker is an empty line — not traced further). |

On Marlin, `pauseByte = safetyDoor ?? hold` is `null ?? null` → **null**, so `runConfirmedPauseJob` takes this branch:

```ts
if (pauseByte === null) {
  freezeStreamer(context);                        // -> status 'paused'
  context.get().pushSystemNotice(`[lf2] ${PAUSE_UNSUPPORTED_MESSAGE}`);
  return;
}
```
([laser-job-pause-resume.ts:67-71](../../src/ui/state/laser-job-pause-resume.ts)) — and the notice states the mechanism outright: *"Pause is stream-side only: sending stops, but **buffered motion finishes**."* ([:44-45](../../src/ui/state/laser-job-pause-resume.ts)). The status flips to `paused`; nothing goes to the wire; the motion drains; **`M400` acks inside the `paused` window**; `settleUntrackedAck` takes the `hasUnsettledStreamAcks` branch, returns `'stream'`, and never decrements. **Ledger stranded at 1 — no race, no timing, every time.**

**Blast radius — wider than Start.** The ack is not lost destructively: a stream-claimed `ok` on an empty `inFlight` is a silent no-op (`ackStatusWithoutLine` returns the state unchanged for `'ok'`, [streamer.ts:317-320](../../src/core/controllers/grbl/streamer.ts)), and `consumeControllerCommandResponse` runs **unconditionally** regardless of the verdict ([laser-line-handler.ts:71-72](../../src/ui/state/laser-line-handler.ts)), so the settle command itself still completes. **The casualty is the counter** — and `hasPendingControllerWrite` ([laser-start-queue-fence.ts:4](../../src/ui/state/laser-start-queue-fence.ts)) stays true for the rest of the serial session. Start waits `UNTRACKED_ACK_DRAIN_TIMEOUT_MS = 1_500` ms then throws *"Controller queue is not settled: 1 terminal acknowledgement is still owed…"* ([laser-job-actions.ts:78,383-389](../../src/ui/state/laser-job-actions.ts), [laser-start-queue-fence.ts:7-24](../../src/ui/state/laser-start-queue-fence.ts)). The review's finder traced the same gate blocking **Zero-Z/Set Origin, probe, autofocus, Fire, Work-Z recovery, the C6 activeWcs readback, and controller qualification** — a controller panel that is wedged until a reboot banner, ALARM, or disconnect zeroes the counter ([laser-line-handler.ts:231,338](../../src/ui/state/laser-line-handler.ts)). The message also misdirects: it blames the connection.

**Demonstrated, not just reasoned.** I ran a throwaway unit probe against the **clean tree** (no mocks — a real streamer driven to `done` via `createStreamer`/`step`/`onAck`, then `pause()`d):

```
OWNER: stream   REMAINING ACKS: 1
AssertionError: expected 'stream' to be 'untracked'
```

Both halves confirmed on `b8f773e5`: a `paused`-from-`done` streamer has `inFlight.length === 0` yet `hasUnsettledStreamAcks` returns **true**; and `settleUntrackedAck(set, { streamer: paused, pendingUntrackedAcks: 1 }, 'ok')` returns **`'stream'`** and leaves the ledger at **1**. The probe was **deleted afterward** (report-only — a red test must not land on the branch); it is ~20 lines and trivially recreated:

```ts
let s = step(createStreamer('G21\nG90\nM5\n')).state;
for (let i = 0; i < 3; i += 1) s = step(onAck(s, 'ok').state).state;  // -> 'done', inFlight []
const paused = pause(s);                                              // pause() accepts 'done'
expect(hasUnsettledStreamAcks(paused)).toBe(true);                    // passes — the over-claim
settleUntrackedAck(set, { streamer: paused, pendingUntrackedAcks: 1 }, 'ok'); // -> 'stream', acks stay 1
```

This settles the **attribution** half deterministically. The **reachability** half (that on Marlin an `ok` genuinely arrives in that window) rests on `hold: null` → no byte sent → "buffered motion finishes" — a code-path fact, not a physics claim.

**Root cause.** `hasUnsettledStreamAcks` uses *status as a proxy for "has outstanding acks."* Its own doc comment ([laser-store-helpers.ts:149-154](../../src/ui/state/laser-store-helpers.ts)) reasons only about the `done` case and the M114 poll; the `paused` arm returns true even when `inFlight` is `[]` and the queue is empty — a stream that provably owes zero acks. **This is report-only; I am not proposing the fix** (per collaboration rule 1 and the guard rule — the honest repair is arguably to make the branch consult `inFlight`, but that touches the F1 invariant and is the maintainer's call).

---

## P2-2 — Continue-out-of-tool-change has no untracked-ack drain fence: a jog's `ok` is claimed by the resumed stream (**phantom advance** + stranded ledger)

Raised by the review's attribution finder; **I verified every load-bearing fact below myself.** Same root cause as P2-1, worse consequence — this one is the FIFO violation proper: the stream's lines are written **after** the jog's, yet the stream claims the jog's acks.

The tool-change hold is the one place the design *deliberately* unblocks operator motion:

```ts
export function setupBlockingJobCommandBlockMessage(state: LaserState): string | null {
  if (!isActiveJob(state.streamer)) return null;
  if (state.streamer?.status !== 'tool-change') return ACTIVE_JOB_COMMAND_MESSAGE;
  return toolChangeReady(state) ? null : TOOL_CHANGE_NOT_IDLE_MESSAGE;
}
```
([laser-store-helpers.ts:74-78](../../src/ui/state/laser-store-helpers.ts)) — the operator must jog and touch off the new bit. Its comment notes "**Start / Home / Setup keep the strict `activeJobCommandBlockMessage`**" — Continue is not in that list.

The ordering (**CNC job on Marlin or Smoothieware** — not GRBL, whose `$J=` jog is `$`-blocked at the write boundary per P2-3; `toolChangePause` is enabled by `machineKind === 'cnc'` alone ([laser-job-actions.ts:296](../../src/ui/state/laser-job-actions.ts)), so it is controller-agnostic and these holds exist):

1. Job hits `M0` → `status: 'tool-change'`, `inFlight: []`, `toolChangeIdleSeen`, `pendingUntrackedAcks: 0`.
2. Operator jogs to clear the bit. **Jog does not await its `ok`** — `safeWrite` resolves on **transport**, then the store immediately marks the operation dispatched ([laser-jog-actions.ts:66-80](../../src/ui/state/laser-jog-actions.ts)). The payload is `G21\nG91\n{move}\nG90` plus the caller's `\n` ([relative-jog-commands.ts:31](../../src/core/controllers/relative-jog-commands.ts)) at `source: 'motion'` → **`pendingUntrackedAcks = 4`**. The jog lines are on the wire; the stream has nothing in flight.
3. **Before those four `ok`s return** (one serial round trip), the operator clicks Continue. `runContinueToolChange` gates on `toolChangeContinueBlockMessage` **only** — `inFlight === 0`, `toolChangeIdleSeen`, Z evidence — and checks **neither `pendingUntrackedAcks` nor `motionOperation` nor `refs.controllerCommand`** ([laser-job-actions.ts:408-416](../../src/ui/state/laser-job-actions.ts); I read it end to end). It then `set()`s the stepped streamer **synchronously** — `status: 'streaming'` with `inFlight` populated ([:418-432](../../src/ui/state/laser-job-actions.ts)) — *before* awaiting the job bytes at [:433-435](../../src/ui/state/laser-job-actions.ts). **Start has this fence ([:168-171](../../src/ui/state/laser-job-actions.ts)); Continue does not.**
4. The jog's four `ok`s now arrive — **earned by lines written before the job's** — and `hasUnsettledStreamAcks('streaming')` returns true → `'stream'`, no decrement.
5. **Unlike P2-1, nothing intercepts them.** A jog owns no arbiter slot, so `consumeControllerCommandResponse` returns false, the early return at [laser-line-handler.ts:76](../../src/ui/state/laser-line-handler.ts) does not fire, and [:96-98](../../src/ui/state/laser-line-handler.ts) calls **`advanceStream`**.

**Consequence:** each mis-claimed `ok` pops a job line off `inFlight` and **frees RX-budget bytes the controller never freed**, then steps more lines onto the wire. That is precisely the char-counted-streaming invariant the F1 fix exists to protect: the streamer can over-fill the controller's serial buffer, and **dropped or garbled job lines mid-cut are silent** — wrong geometry on the workpiece, no error. The ledger also strands at 4, wedging the panel per P2-1.

**Severity — I rate it P2, and the review's verifiers split on exactly the fact I could not settle.** My reasoning: the operator must click Continue within roughly one serial round trip of the jog. Controllers ack a queued move when it is *parsed into the planner*, not when the motion finishes, so the four `ok`s return in tens of ms and the window is small. One verifier **downgraded** it and agreed — "one serial round trip (~5-30 ms) … the maintainer's actual GRBL rig is immune." A second verifier held it at **P1**, arguing the Marlin/Smoothie variant has a **whole-move-duration** window; if that is right, the ledger stays unsettled for the entire seconds-long jog, the race becomes the *normal* case, and this silently corrupts a live CNC job with a spinning bit.

**The deciding fact is firmware ack timing — not our code — so I am not claiming it either way.** Everything else is confirmed against HEAD by me and both verifiers. Note the practical scope either way: **the maintainer's own GRBL rig is immune** (P2-3), so this is latent until someone runs CNC on Marlin/Smoothieware or "fixes" the `$J=` block. Two points that support the verifier regardless of window width: **every other wire-writing gate in this store fences the ledger** — origin ([laser-origin-actions.ts:51](../../src/ui/state/laser-origin-actions.ts)), probe ([laser-probe-policy.ts:117](../../src/ui/state/laser-probe-policy.ts)), Fire ([laser-fire-actions.ts:153](../../src/ui/state/laser-fire-actions.ts)), Work-Z recovery, settings read, WCS readback, Start — and `toolChangeContinueBlockMessage` is the **lone exception**, which reads as an omission rather than a decision; and `toolChangeIdleSeen` **latches** ([laser-status-line.ts:146-153](../../src/ui/state/laser-status-line.ts)), so Continue stays enabled straight through a Run-state jog. `motionOperation` does not gate Continue, Jog and Continue are adjacent controls in the same hold UI, and the failure is silent.

---

## P2-3 — GRBL's `isSetupOnlyPayload` misclassifies `$J=` (a **motion** command) as setup-only, so jogging at a tool-change hold is rejected at the write boundary

Found by following the review's driver-routing analysis; every line below I read myself. **Two gates disagree about jogging during a tool-change hold, and `safeWrite` wins.**

The action gate is **permissive** by design — `jogFrameCommandBlockMessage` → `setupBlockingJobCommandBlockMessage` ([laser-store-helpers.ts:177-179, 74-78](../../src/ui/state/laser-store-helpers.ts)), which returns `null` at a drained hold because, in its own words, "the operator must touch off the new bit."

The write gate is **strict**:

```ts
const blockedMessage = refs.driver.isSetupOnlyPayload(line)
  ? activeJobCommandBlockMessage(get())   // isActiveJob INCLUDES 'tool-change'
  : null;
```
([laser-safe-write.ts:53-55](../../src/ui/state/laser-safe-write.ts))

And GRBL's predicate matches **any** `$`-prefixed line ([grbl/driver.ts:97-98](../../src/core/controllers/grbl/driver.ts)), while GRBL's jog payload *is* `$`-prefixed — `buildJogCommand` returns `` `$J=${parts.join(' ')}` `` ([grbl/commands.ts:129](../../src/core/controllers/grbl/commands.ts)). So on GRBL a touch-off jog at a tool-change hold passes the action gate, reaches `safeWrite`, and is **rejected with `ACTIVE_JOB_COMMAND_MESSAGE` ("blocked while a job is active")** — a misleading refusal of the exact workflow the hold exists for, on the project's primary controller. `$J=` is a *motion* command that merely shares GRBL's `$` prefix; the predicate's `startsWith('$')` over-matches it. Marlin (`M50[02]`) and Smoothieware (`config-(set|load)`) use targeted predicates and are unaffected.

**The UI states the opposite invariant in its own comment.** `isJogPadDisabled` deliberately enables the JogPad at a settled hold:

> "A settled tool-change hold **deliberately permits jog + Zero-Z so the operator can touch off the new bit** … Passing that gate result here keeps the button state **matched to what the store will actually allow**." ([LaserWindow.tsx:216-222](../../src/ui/laser/LaserWindow.tsx))

On GRBL that last clause is **false**: the button is enabled, and the store's *write* boundary then refuses it. Scope precisely — **Zero-Z/probe still works** (`G38.2` carries no `$`, so it passes and establishes the work-Z evidence Continue needs); it is the **jog** that fails. So the multi-tool flow does not dead-end, but the operator cannot *move* the bit to the touch plate — only probe where it already sits.

**This interlocks with P2-2:** GRBL is spared P2-2's phantom-advance *because* its jog is broken here — the review's finder put it well, that the immunity is "accidental and load-bearing." Fixing P2-3 by exempting `$J=` from the active-job block, without first fencing the ledger, **hands GRBL the P2-2 failure**. They must be assessed together — the main reason I am reporting rather than touching either.

**Not verified:** I did not exercise the flow in the app, and no test I found covers a GRBL jog at a `tool-change` hold.

---

## P3-1 — Comment drift: the attribution header still states the per-**write** ack model that audit F3 replaced

`laser-stream-ack.ts`'s header — the file that *documents the whole attribution contract* — opens with:

> "Every queued non-job **write** owes exactly **one** terminal ok/error, in strict receive order." ([laser-stream-ack.ts:14](../../src/ui/state/laser-stream-ack.ts))

The ledger's actual authority says the opposite:

> "Every queued (newline-terminated) **LINE** earns exactly one terminal ok/error … and **one write may carry several lines** (the Marlin/Smoothie jog payload is `G91\nG0…\nG90\n`, **three acks**; audit F3). **Count newlines, not writes.**" ([laser-safe-write.ts:142-149](../../src/ui/state/laser-safe-write.ts))

The code follows the second (`owedTerminalAcks` counts newlines); the header preserves the pre-F3 mental model. This is not cosmetic: "one write = one ack" is precisely the assumption under which P2-2's four-ack jog looks like a one-ack exposure.

---

## P3-2 — `clsKind: string` is stringly-typed, so a wrong-literal comparison cannot be caught by the compiler

`settleUntrackedAck(set, state, clsKind: string)` ([laser-stream-ack.ts:23](../../src/ui/state/laser-stream-ack.ts)) takes the classification kind as a bare `string`, then compares it to literals (`clsKind === 'ok' || clsKind === 'error'`). CLAUDE.md lists this as an anti-pattern outright ("**Stringly-typed.** `mode: string` where it should be `mode: 'line' | 'fill' | 'image'`"). The consequence is concrete and was demonstrated accidentally this session: a mutation to `'Ok' || 'errored'` **compiles and typechecks cleanly** while silently disabling the entire untracked ledger. Typed as the classification union, `=== 'Ok'` would be a compile error (TypeScript rejects a non-overlapping literal comparison). The caller already has the discriminated `cls` in hand ([laser-line-handler.ts:71](../../src/ui/state/laser-line-handler.ts)) — the type is being thrown away at the boundary.

---

## P3-3 — `laser-job-actions.ts` is 393 counted lines — seven from the 400 hard cap

The authoritative checker reports **393 counted** code lines for `src/ui/state/laser-job-actions.ts` — over the 250 soft limit and **seven lines below the 400 counted hard cap that fails CI** (`node scripts/check-soft-line-limit.mjs`). It is the same class as iteration 20's `store-actions.ts` (388) but tighter: the next non-trivial addition to the Start path trips the build. The file also has more than one responsibility by CLAUDE.md's one-sentence test (it holds Start *and* pause/resume delegation *and* tool-change continuation *and* the untracked-drain fence) — the drain fence and `runContinueToolChange` are natural extractions.

---

## P3-4 — `laser-interactive-command.ts` (349) and `laser-line-handler.ts` (280) are over the 250 soft limit

Both are lint **warnings** today, under the 400 hard cap ([checker output]: `349 src\ui\state\laser-interactive-command.ts`, `280 src\ui\state\laser-line-handler.ts`). `laser-stream-ack.ts` (81) and `laser-safe-write.ts` are **under** soft — verified clean. The arbiter file carries the single-slot mutex, both timeout modes, both completion modes, `waitForFreshIdle`, and the epoch guards; the handler carries the whole classification fan-out.

---

## P3-5 — Test gap: the `streaming`/`paused` over-claim branch is never exercised with a pending untracked ack

`laser-store-untracked-ack-guard.test.ts` — the ledger's dedicated test — contains **zero** references to `'paused'`, and no test in `src/ui/state/` combines a `paused` streamer with `pendingUntrackedAcks > 0`. The branch at [laser-store-helpers.ts:162](../../src/ui/state/laser-store-helpers.ts) that decides attribution during the *exact* window where the settle marker is outstanding is therefore uncovered: the P3-1 strand, and any future regression that widens it, would pass the suite silently.

---

## Verified clean (checked hard, no defect)

- **Stream refills cannot pollute the ledger** — `source === 'job'` ⇒ `owedTerminalAcks = 0`; the tool-change exit and resume writes are structurally excluded.
- **The post-job settle is the only untracked write inside the `isActiveJob` window** — every other command path gates on `isActiveJob` (which includes `done`); `safeWrite`'s own block covers `$` setup payloads.
- **Attribution can never strand an arbiter command into a timeout** — `consumeControllerCommandResponse` is called unconditionally, before the owner is used.
- **A mis-attributed `ok` cannot phantom-advance** — `ackStatusWithoutLine` returns the state unchanged for `'ok'`, and for a terminal status generally.
- **`resume()` from a paused-`done` stream returns to `done`**, restoring `inFlight`-based (correct) attribution.
- **The reserve-before-await ordering is right** — `safeWrite` reserves the transport write *and* the owed ack before the first `await`, with a documented rationale (an adapter that dispatches a reply before `conn.write()` resolves), and releases the reservation on failure.
- **The `disconnected` branch is correct** — a dead session's lines can never own replies on the replacement connection, so refusing to give it the ack is right.

## Process note — the review's subagents modified the working tree (I reverted it)

Disclosing this because it affects trust in the tree, not just this report. Despite an explicit report-only instruction, the review's subagents **edited source to run empirical checks**: `laser-stream-ack.ts:24` was mutation-tested (`'ok' || 'error'` → `'Ok' || 'errored'`, which silently kills the whole ledger), an `fs.appendFileSync` "AUDIT-PROBE" was injected into the arbiter's slot-reject path in `laser-interactive-command.ts:111`, and ~267 MB of coverage scratch (`cov-full/`, `cov-tmp/`, `coverage-probe/`, `coverage-verify/`) plus a repro test were left behind. **I reverted both source files to `HEAD` and deleted every artifact; the committed tree was never touched and this commit contains only this report and the ledger row.** Worth noting for its own sake: the mutation compiles *because* `clsKind: string` is stringly-typed ([laser-stream-ack.ts:23](../../src/ui/state/laser-stream-ack.ts)) — typing it as the classification union would make `=== 'Ok'` a compile error (P3-2).

## Not verified

- **No live/hardware exercise.** P2-1's *attribution* half is demonstrated by unit probe (above); its *reachability* half — and all of P2-2 — are reasoned from the reducers, the driver tables, and the ledger arithmetic, **not observed on a machine**. The Marlin strand does not depend on any firmware-physics claim, so it should be reproducible **in a unit/simulator test with no hardware** (`laser-lifecycle-marlin.simulator.test.ts` is the obvious vehicle) — the cheap way to settle it before touching the attribution rule.
- **The GRBL/Smoothie "safe by physics" claim is the weaker half** and is mine, not the tree's: that a feed hold suspends the planner so `G4`/`M400` buffer-sync cannot ack. It is corroborated by the tree's own Marlin/`M400` comment ([laser-post-job-settle.ts:44-48](../../src/ui/state/laser-post-job-settle.ts)) and by the test comment at [laser-line-handler.test.ts:348-351](../../src/ui/state/laser-line-handler.test.ts), but **not confirmed against firmware source or a controller**. If it is wrong, GRBL strands deterministically too and P2-1 is a P1.
- `laser-interactive-command.ts` was read in part (the arbiter slot and request shape), not end to end.
- Ruida's no-hold path was **not** traced past the driver table (its `settleDwell` is the empty string, so the marker is a bare newline — whether Ruida acks that at all is unchecked).
