# Audit Report: Codex commit 9b9aa15 - "fix: harden raster and laser safety flows"

- **Commit:** 9b9aa154d0397e68f888a84424f9d94d9d5dbc34
- **Date:** 2026-06-04 (Thu Jun 4 19:50:49 2026 +0800)
- **Branch:** wip/checkpoint-2026-06-03
- **Author:** Codex / cisgz3a-hub (cisgz3a@gmail.com)
- **Scope:** 20 files changed, +1953 / -84
- **Auditor model:** Claude Opus 4.8
- **Audit date:** 2026-06-04

---

## 1. Verdict

**accept-with-followups**

The change is functionally green and safe to keep: `tsc --noEmit` is at 0 errors, eslint is clean (only a pre-existing boundaries selector-deprecation warning, not from this commit), and the full suite is 1003/1003 across 135 files. It does NOT regress the lead's just-shipped P0-1 (error ack -> terminal `errored`) or P0-3 (follow-up write failure raises `disconnectDuringJobNotice`); the edits to the three files the lead had touched (`laser-line-handler.ts`, `laser-safety-notice.ts`, `laser-store-helpers.ts`) are purely additive and even reuse those notices. The raster budget guards (P0-5/P0-6/P0-7/P0-8) are correctly wired ahead of the expensive work and are exercised by real production-path tests.

It is **not** a clean accept because (a) there are three confirmed correctness/safety gaps that are small but real - `cancelJog` leaks `motionOperation` on write failure, `startJob` raises no safety notice on write failure, and `buildPortClosePatch` omits the `errored` status so a USB drop after a controller error never raises the disconnect banner; and (b) the commit is a process outlier: it batches four-plus roadmap tickets plus a 1116-line roadmap doc into one vaguely-titled commit, writes no ADR for either the new `motionOperation` abstraction or the new disconnect soft-reset/jog-cancel safety contract, and lands a second competing roadmap document alongside the existing one. None of these block keeping the code, but they must be followed up before the ledger records this work as shipped.

---

## 2. What it did well

The engineering quality of the code itself is high. Credit where due:

- **Built on P0-1 / P0-3 correctly, additively.** The edits to `laser-line-handler.ts` only *add* a `motionOperation` observation step inside the existing status branch and clear it on alarm; they do not touch the P0-1 error-terminal path or the P0-3 follow-up-write-failure path. `laser-safety-notice.ts` only adds `'unlock'` to the `LaserSafetyAction` union. `laser-store-helpers.ts` reuses the P0-1 `errored` status (see below) and the P0-3 `disconnectDuringJobNotice()`. No regression to either shipped fix. (Confirmed against `git show 9b9aa15 -- <file>`.)

- **Motion-operation state machine is well-designed and defensive.** `observeMotionStatus` (`src/ui/state/laser-motion-operation.ts:24-39`) tolerates status polling that misses the `Jog`/`Run` window (requires 2 consecutive `Idle` reports to clear), refuses to clear before dispatch completes (`line 30`: `!operation.dispatchComplete` returns the operation unchanged), and resets idle counting on any non-idle status. The lifecycle and "never observed Jog" edge cases are explicitly tested in `laser-store-motion-operation.test.ts`.

- **P0-5 budget guard runs BEFORE `compileJob`.** In `src/ui/laser/start-job-readiness.ts`, `runPreEmitPreflight(project)` is called at line 54, well before `compileJob(...)` at line 104. A 300x300mm raster at 25 lines/mm (7500x7500 = 56M px) is rejected before any luma/S-value buffer is allocated, preventing the renderer freeze the roadmap describes. The Frame path is guarded the same way through `useFrameAction`.

- **P0-6 preview guard runs BEFORE resample/dither/canvas.** `src/ui/workspace/draw-raster-preview.ts:102` returns `null` (the established "skip this raster" signal) when `evaluateRasterBudget(...).kind === 'too-large'`, before the offscreen canvas at line 121 is created. The preview tab stays responsive on an over-budget image.

- **P0-7/P0-8 convert-to-bitmap guard runs BEFORE encode.** `assertWithinBitmapBudget(o)` is the first statement of `assembleBitmap` (`src/ui/raster/vector-to-bitmap.ts:68`), ahead of the `encode(raster)` call at line 71, and throws a clear, dimension-bearing error message.

- **Test quality is genuinely good.** The new tests exercise live production paths, not mock-only fixtures: `start-frame-raster-budget.test.tsx` renders the real component and asserts the guard fires before a mocked `compileJob`; `draw-raster-preview.test.ts` feeds a real over-budget raster and asserts no canvas allocation; `vector-to-bitmap.test.ts` asserts `encode` is never called; `laser-store-motion-operation.test.ts` drives real GRBL status responses through `observeMotionStatus`. This satisfies the wired-into-product gate (T1-120 spirit) for the budget work.

- **Motion write-failure notices ARE covered for the core actions.** The parametrized test in `laser-store.test.ts` (around lines 267-298) covers Home / Unlock / Jog / Cancel jog / Frame / Set origin / Reset origin, asserting each raises a `write-failed` notice with the correct action label. The `safeWrite` refactor (`laser-store.ts:185-218`) centralizes notice-setting so a motion action cannot silently swallow a write failure.

---

## 3. Findings by severity

### P0 - Safety / correctness (must-fix before this is recorded as shipped)

#### P0-A. `buildPortClosePatch` omits `errored` status; a USB drop after a controller error raises no disconnect banner
- **File:** `src/ui/state/laser-store-helpers.ts:80-99` (specifically the check at lines 81-83)
- **What is wrong:** `buildPortClosePatch` recomputes "was a job active" with an inline check that lists only `'streaming'` and `'paused'`:
  ```
  const wasActiveJob =
    state.streamer !== null &&
    (state.streamer.status === 'streaming' || state.streamer.status === 'paused');
  ```
  The sibling helper `isActiveJob` in the same file (line 29) was correctly updated this commit to `['streaming', 'paused', 'errored'].includes(...)`. `buildPortClosePatch` does not use `isActiveJob` and was not updated to match.
- **Why it matters:** Per the P0-1 contract (ADR-041), an `error:N` ack is terminal and the streamer enters `errored`, but GRBL may still be executing the commands already in its 127-byte buffer. If the USB port then drops (the exact scenario the disconnect banner exists for), `wasActiveJob` is `false`, `wasUnsafeActive` is `false` (assuming no in-flight `motionOperation`), and **no `disconnectDuringJobNotice` is raised**. The operator loses the "machine may still be moving, reach for physical controls" warning at the moment it is most warranted. This is a safety-path regression hiding inside otherwise-correct work.
- **Recommended fix:** Make `buildPortClosePatch` consistent with `isActiveJob`. Either call `isActiveJob(state.streamer)` directly, or extend the inline check to include `'errored'`:
  ```
  (state.streamer.status === 'streaming' ||
   state.streamer.status === 'paused' ||
   state.streamer.status === 'errored')
  ```
  Add a regression test in `laser-store.test.ts`: start a job, emit `error:7` (assert `streamer.status === 'errored'` and `safetyNotice === controllerErrorNotice`), then `connection.emitClose()`, and assert `safetyNotice` becomes `disconnectDuringJobNotice`. No such test exists today (line 256 confirms an errored-status assertion, but no port-close-after-error case).

> Note on the surrounding contract change: this commit also newly makes `disconnectStopCommand` (`laser-store-helpers.ts:32-35`) emit `RT_JOG_CANCEL` when `motionOperation !== null` even with no active job, and `RT_SOFT_RESET` for an `errored` job (via the widened `isActiveJob`). That is a *new* real-time-command safety contract on the disconnect path. It is logically sound, but it is undocumented (no ADR) and unverified on hardware - see Process section P-2 and P-5.

---

### P1 - Should-fix

#### P1-A. `cancelJog` does not clear `motionOperation` on write failure; a failed cancel wedges all subsequent motion
- **File:** `src/ui/state/laser-store.ts:341-343`
- **What is wrong:** Unlike `jog` (lines 328-339) and `frame` (lines 345-359), which wrap `safeWrite` in try/catch and clear `motionOperation` in the catch, `cancelJog` is a bare `await safeWrite(...)` followed by `set({ motionOperation: null })`:
  ```
  cancelJog: async () => {
    await safeWrite(set, get, RT_JOG_CANCEL, 'jog');
    set({ motionOperation: null });
  },
  ```
  If `safeWrite` throws (USB drop, timeout), the `set({ motionOperation: null })` line is never reached.
- **Why it matters:** `motionOperation` stays non-null indefinitely. The UI gates conflicting controls on a non-null motion operation, so a failed *cancel* would leave the controls stuck in the busy state, blocking Home/Start/Frame/Autofocus until a full reconnect or page reload. This is the opposite of what a cancel should do under failure. The existing test for "Cancel jog" (`laser-store.test.ts:271`) only asserts the write-failed *notice* is raised; it does not assert `motionOperation === null`, so the gap is invisible to the suite.
- **Recommended fix:** Mirror `jog`/`frame`:
  ```
  cancelJog: async () => {
    try {
      await safeWrite(set, get, RT_JOG_CANCEL, 'jog');
    } finally {
      set({ motionOperation: null });
    }
  },
  ```
  A `finally` is arguably better than `frame`'s catch-rethrow here, because clearing the operation is correct on both success and failure for a cancel. Add an assertion to the Cancel-jog test that `motionOperation` is `null` after a write failure.

#### P1-B. `startJob` raises no safety notice when the initial write fails
- **File:** `src/ui/state/laser-store.ts:368-380`
- **What is wrong:** `startJob`'s catch clears the streamer and rethrows but sets no `safetyNotice`:
  ```
  try {
    await safeWrite(set, get, stepped.toSend);  // no `action` arg -> safeWrite sets no notice
  } catch (err) {
    set({ streamer: null });                    // no safetyNotice set here either
    throw err;
  }
  ```
  By contrast, `pauseJob` (385), `resumeJob` (395), and `stopJob` (420) each set `writeFailedNotice('pause'|'resume'|'stop')` in their catch.
- **Why it matters:** Because `safeWrite` only sets a notice when an `action` argument is supplied (`laser-store.ts:200, 214`), and `startJob` supplies none, a failed job start surfaces only as a thrown error. The caller `LaserWindow.tsx` catches it and shows an alert, but the persistent safety banner - the single user-facing safety channel the rest of the motion/job actions standardize on - is never raised. The start path partially wrote bytes into the GRBL buffer before throwing, so the operator deserves the same banner the other job actions give. This is an inconsistency that reads as a small safety gap, not a stylistic nit.
- **Recommended fix:** Set a notice in `startJob`'s catch (e.g. `set({ safetyNotice: writeFailedNotice('start') })`, adding `'start'` to the `LaserSafetyAction` union), then rethrow. If the intent is genuinely to handle this only at the `LaserWindow` caller, document that decision in the ADR (P-2) and add a comment at the catch explaining why `startJob` deliberately differs from pause/resume/stop. Either way the current silent divergence should not stand undocumented.

#### P1-C. Motion-action callers in `JobControls.tsx` lack `.catch(() => undefined)`, producing unhandled promise rejections
- **File:** `src/ui/laser/JobControls.tsx:72, 75, 126, 298, 311`
- **What is wrong:** Now that motion actions reject (via `safeWrite`) while the banner carries the user-facing error, the fire-and-forget callers leak unhandled rejections. Confirmed call sites:
  - `126`: `onClick={() => void home()}` - no `.catch`
  - `298`: `void frame(bounds, feed);` - no `.catch`
  - `311`: `void autofocus(autofocusCommand).then((result) => {...})` - `.then` but no `.catch`
  - `72`: `void setOrigin().then(() => pushToast(...))` - `.then` but no `.catch`
  - `75`: `void resetOrigin().then(() => pushToast(...))` - `.then` but no `.catch`

  The job controls already do this correctly: `pauseJob().catch(() => undefined)` (206), `resumeJob` (213), `stopJob` (219), `cancelJog` (234). So the pattern is established in the same file - the motion/origin callers just were not brought along.
- **Why it matters:** The operator still sees the safety banner (the functional safety guarantee holds), so this is P1, not P0. But unhandled rejections pollute the console, can trip `unhandledrejection` handlers, and obscure real errors during debugging - exactly the noise the `.catch(() => undefined)` convention exists to suppress.
- **Recommended fix:** Add `.catch(() => undefined)` to all five. E.g. `onClick={() => void home().catch(() => undefined)}`, `void frame(bounds, feed).catch(() => undefined)`, and append `.catch(() => undefined)` after the existing `.then(...)` on `autofocus`, `setOrigin`, and `resetOrigin`.

---

### P2 - Minor

#### P2-A. No test for a partial frame-loop write failure (corner 2 of 5 fails)
- **File:** `src/ui/state/laser-store.test.ts` (the parametrized frame test, ~lines 280-297)
- **What is wrong:** The frame test injects a write function that throws on *every* call, so only the first of the five corner jog lines is ever attempted. There is no test where corner 1 succeeds and corner 2 fails.
- **Why it matters:** This is a coverage gap, **not** a behavioral bug - the code is already correct for partial failure: any throw inside the loop is caught at `laser-store.ts:355-357`, which clears `motionOperation`, and `safeWrite` set the notice before throwing. So severity is P2. The missing test would document the intended "partial send is treated as a full error; motionOperation is cleared so later status reports don't track a half-dispatched frame" behavior.
- **Recommended fix:** Add a test with a call-counting mock that throws on the 2nd `write`, asserting (a) the promise rejects, (b) `safetyNotice` is `write-failed` / `frame`, (c) `motionOperation === null`, and (d) corner 1 *was* sent.

#### P2-B. `isActiveJob` semantic widening (`+ 'errored'`) is correct but undocumented
- **File:** `src/ui/state/laser-store-helpers.ts:28-30`
- **What is wrong:** `isActiveJob` changed from `streaming || paused` to `['streaming', 'paused', 'errored']`. This is intentional and correct per P0-1 (an errored stream is a terminal *unsafe* state that must still trigger the disconnect soft-reset and frequent polling), and it is exported/extracted cleanly this commit. The only issue is that this semantic change to a multi-caller helper (poll-tick at `laser-store.ts:254`, `disconnectStopCommand`) is invisible in the one-line commit message and has no ADR note.
- **Why it matters:** Documentation/traceability only - the behavior is right. P2.
- **Recommended fix:** Note the widening in the P0-1 ADR (ADR-041) or in the new ADR for this commit (P-2). A one-line code comment at line 29 explaining "errored is treated as active for safety (disconnect soft-reset + polling)" would also help.

---

## 4. Process / contract section

This is where the commit most clearly departs from the repo's working contract. The code is good; the bookkeeping is not.

### P-1. Batched multi-ticket commit (four-plus tickets + a 1116-line roadmap) in one changeset
The commit implements, at minimum: **P0-4** (motion-action write-failure safety notices), **P0-5** (Frame / custom-origin Start budget guard), **P0-6** (raster preview budget guard), **P0-7/P0-8** (convert-to-bitmap budget guard), and the **frame/jog motion-operation lifecycle** (the roadmap's frameBusy/stoppable-busy item, here realized as the richer `motionOperation` state machine). On top of that it adds a brand-new **1116-line planning document** (`docs/KARPATHY-LIGHTBURN-MASTER-ROADMAP-2026-06-04.md`), which by itself is 57% of the +1953 insertions. Total: 20 files.

The repo's coupled-unit rule (one logical change per commit; code + failure-mode test + ADR + ledger update; ~5-file upper bound when in doubt) is plainly exceeded. The lead's own P0-1 (4ad2d21) and P0-3 (1a828ac) shipped as separate, single-ticket commits - the established cadence this commit breaks. The roadmap also sequences these tickets deliberately (the budget guards before each other; the motion-lifecycle item is noted as pairing with P0-4's frame write-failure handling). Bundling them obscures which design choice answers which problem and makes the work hard to cherry-pick, revert, or audit per-ticket.

*Caveat on prior framing:* some upstream finding text attributed this to a specific "CLAUDE.md line 49 / one-logical-change-per-commit" clause. The literal line citations do not all hold - the binding source is the roadmap's coupled-unit + ~5-file guidance and the tight-leash collaboration rule, not a numbered CLAUDE.md line. The violation is real regardless of which line is cited.

### P-2. No ADR for the new abstraction or the new disconnect safety contract
DECISIONS.md is **not part of this commit** (confirmed) and ends at **ADR-042**. This commit introduces:
1. a new module/abstraction - `laser-motion-operation.ts` (a 4-field lifecycle state machine), and
2. a new **disconnect-path safety contract** - `disconnectStopCommand` now emits `RT_JOG_CANCEL` for an in-flight motion operation and `RT_SOFT_RESET` for an `errored` job.

Both are exactly the kind of decision the repo requires an ADR for, and the second touches a heightened-bar safety path (real-time command emission on disconnect). No ADR-043+ was written. Future maintainers have no recorded rationale for why motion operations get a distinct lifecycle from streaming jobs, what the state-machine invariants are, or why disconnect must cancel in-flight motion.

### P-3. Vague, body-less commit message
The message is the single line `fix: harden raster and laser safety flows` - no ticket IDs, no ADR reference, no body, no Verification block. It does not even mention that a 1116-line roadmap document was added. Peer commits (4ad2d21 P0-1, 1a828ac P0-3) carry full multi-section bodies. A reader cannot tell from the message which tickets shipped, which are partial (P0-8's async/worker offload is *not* done - see P-6), or how the change was verified.

### P-4. Two competing roadmap documents now coexist
The repo now contains both `docs/REMAINING-WORK-ROADMAP-2026-06-04.md` (pre-existing) and the newly added `docs/KARPATHY-LIGHTBURN-MASTER-ROADMAP-2026-06-04.md` (1116 lines), dated the same day. The new doc even labels itself "planning document only. No production code is changed by this roadmap," yet it ships inside a production `fix:` commit. Having two same-day roadmaps with overlapping ticket namespaces is a drift hazard: the next agent will not know which is authoritative. They should be reconciled into one source of truth (and the planning doc, if kept, should land in its own `docs:` commit).

### P-5. Heightened-bar hardware verification missing
The disconnect soft-reset / `RT_JOG_CANCEL` contract change (P-2 item 2) is a hardware-touching safety change. The repo's safety-path bar requires a "Hardware verification needed" note until confirmed on the Falcon A1 Pro. The commit message carries no such note. Whether `RT_JOG_CANCEL` actually halts an in-flight Frame on the real device, and whether the port then closes cleanly without a half-executed jog line, is untested outside the mocked connection.

### P-6. `laser-store.ts` growth and the incomplete P0-8
- `laser-store.ts` grew by +124 lines this commit and sits near the eslint `max-lines` cap (the rule counts non-blank, non-comment lines; it currently passes, but the headroom is thin - worth watching as motion logic accretes). The extraction into `laser-motion-operation.ts`, `infer-machine-position.ts`, and `laser-store-helpers.ts` is the right instinct and keeps it under the cap for now.
- **P0-8 is only half-done.** The budget *guard* shipped, but the spec's core of P0-8 - moving the synchronous PNG encode off the UI hot path - did not. `buildBitmapFromVector` (`vector-to-bitmap.ts:55`) is still synchronous and calls `encode` (`lumaToBitmap`) synchronously on the main thread; the budget cap (4M px in `raster-budget.ts`) still admits images large enough to stall `toDataURL` for noticeable time. If this commit is taken to "close" P0-8, that is inaccurate; the worker/async offload remains outstanding.

---

## 5. Recommended remediation

Concrete next steps, in priority order:

1. **Fix P0-A (disconnect-after-error banner).** Extend `buildPortClosePatch`'s active-job check to include `'errored'` (or call `isActiveJob`). Add the port-close-after-error regression test. This is the one item with a genuine safety footprint and should land first.
2. **Fix P1-A (`cancelJog` leak).** Wrap its `safeWrite` in `finally { set({ motionOperation: null }); }` and assert the cleared state in the Cancel-jog write-failure test.
3. **Fix P1-B (`startJob` notice) and P1-C (`.catch` handlers).** Either raise a `writeFailedNotice('start')` in `startJob`'s catch or document the deliberate divergence; add `.catch(() => undefined)` to the five `home`/`frame`/`autofocus`/`setOrigin`/`resetOrigin` call sites in `JobControls.tsx`.
4. **Write the missing ADR(s) retroactively** - one for the `motionOperation` abstraction and one (or the same, with a clear section) for the disconnect `RT_JOG_CANCEL` / soft-reset contract, including the `isActiveJob` `errored` widening and the heightened-bar hardware-verification note. Start at ADR-043.
5. **Annotate the ledger to reflect the batch.** Since the work is already committed and green, record in the roadmap/ledger exactly which tickets this single hash satisfies, and explicitly mark **P0-8 as partial** (budget guard only; async encode offload still open). Do not let the ledger claim P0-8 shipped.
6. **Hardware-verify the disconnect soft-reset / jog-cancel** on the Falcon A1 Pro: start a Frame, yank USB mid-frame, confirm the motion halts via `RT_JOG_CANCEL` with no half-executed line, and record the result in the ADR.
7. **Reconcile the two roadmap docs** into a single source of truth; if the Karpathy/LightBurn planning doc is kept, move it to its own `docs:` commit rather than leaving it inside a `fix:` commit.
8. **Add the missing P2-A partial-frame-failure test** when convenient - low effort, documents intended behavior.

For future Codex commits: split per ticket, keep to the ~5-file guidance, write the ADR in the same commit, and use the full commit-message format with ticket IDs and a Verification block.

---

## 6. Appendix: false positives checked and dismissed

The following candidate findings were investigated against the live tree at 9b9aa15 and found to be **not** defects:

- **"P0-4 motion write-failure tests are incomplete / only 2 tests added."** False. The parametrized test in `laser-store.test.ts` (~267-298) covers Home, Unlock, Jog, Cancel jog, Frame, Set origin, and Reset origin, asserting the correct `write-failed` notice per action. Five of these map to the P0-4 required actions exactly.

- **"`laser-store-motion-operation.test.ts` doesn't test Frame/Jog write-failure notice raising."** False as a defect: that coverage exists, but it lives in `laser-store.test.ts` (the parametrized failure test). The motion-operation test file is intentionally scoped to the lifecycle state machine.

- **"startJob has no try/catch on write failure."** False on the literal claim - `startJob` (`laser-store.ts:374-379`) does have a try/catch that clears the streamer and rethrows. The *real* residual issue (no `safetyNotice` set) is captured above as P1-B; the catch itself exists.

- **"laser-store.ts exceeds the 400-line hard cap / extraction is incomplete."** False. The eslint `max-lines` rule skips blank lines and comments; the file passes lint. The extraction into `laser-motion-operation.ts`, `infer-machine-position.ts`, and `laser-store-helpers.ts` is complete and respects the synchronous-dispatch vs async-observation boundary.

- **"P0-1 (error terminal status) is claimed shipped here but streamer.ts wasn't modified."** False / misattributed. P0-1 shipped in 4ad2d21 (which did modify `streamer.ts`) with ADR-041. This commit does not re-ship P0-1; it only reuses the `errored` status in `isActiveJob`. No regression.

- **"Commit message must follow `<type>(<scope>): <ticket id>` per a specific roadmap line."** Partially mis-sourced. The exact line citation in the original finding does not hold; `REMAINING-WORK-ROADMAP` mainly mandates ASCII-only messages via `git commit -F`, and the message is ASCII-clean Conventional-Commits. The substantive problem (no ticket IDs, no body, no Verification block, misleading omission of the roadmap doc) is real and is recorded as P-3, but it is sourced to the coupled-unit rule and observed repo convention, not to a fabricated line number.
