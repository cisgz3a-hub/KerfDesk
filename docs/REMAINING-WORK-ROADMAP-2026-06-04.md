# LaserForge 2.0 - Remaining-Work Roadmap

**Date:** 2026-06-04
**Branch:** wip/checkpoint-2026-06-03
**HEAD:** cdc8f7c
**Pipeline:** Scene -> Job -> Plan -> Output -> Device
**Next free ADR:** ADR-041 (DECISIONS.md at repo root ends at ADR-040)

This document is the working plan a future agent executes from. Every item below was
verified against the live tree at HEAD cdc8f7c (not against an audit doc's stale line
numbers). Where a verdict said "still pending" it was re-read in the actual source before
being written here. Items the live code showed as already done were dropped (see the
appendix) so nobody re-does shipped work.

---

## The Karpathy operating rule (read before touching anything)

Treat this codebase the way you would treat a numerical kernel that controls a physical
machine that can start a fire. The rules, in order:

1. **Verify empirically on real emitted/burned output.** A green test suite is necessary,
   not sufficient. For any g-code change, emit the actual g-code for a concrete case and
   read the specific lines. For any burn-path change, the truth is on the workpiece, not in
   the assertion. The most expensive defect in this project's history (the prior repo's
   T1-97) was a fix shipped against a diagnosis that was wrong on the line it claimed.
2. **Never trust green tests alone.** Tests encode what we already believed. The streamer
   error-handling bug below has a *passing* test that asserts the wrong behavior
   (`streamer.test.ts` "treats error like ok"). Green there means the bug is load-bearing.
3. **Plan before fix.** Write the approach down. If you cannot state the failure mode in one
   sentence and the measurement that would prove it, you are not ready to edit.
4. **Fix only when research backs the claim.** "Probably this" is not a diagnosis. Grep for
   both the definition AND every callsite before forming a hypothesis. Missing a callsite is
   how a "fixed" bug ships with a live caller still hitting the old path.
5. **Read 30+ lines of surrounding context before forming a hypothesis.** The function you
   are about to change almost always has an invariant in a comment 20 lines up (the
   `functional set` R-H2 note in `resumeJob` is a live example - clobber it and you drift
   the 127-byte buffer accounting and lose head control).

If a step in any item below cannot be verified empirically before the fix, that is itself a
finding: stop and say so.

---

## Repo rules every commit in this roadmap must respect

- **One logical change per commit.** The coupled unit is: code change + its failure-mode
  test + the ADR entry in `DECISIONS.md` (new work starts at ADR-041) + the roadmap/ledger
  bookkeeping. A patch missing any leg is incomplete. ~5-file upper bound when in doubt.
- **Strict tier order, lower number first. No skipping.** Finish a partial before starting an
  adjacent item.
- **TS baseline: 0 errors.** `npx tsc --noEmit --pretty false` must return 0. Any TS error is
  a regression your change introduced.
- **0 eslint errors, 0 warnings on touched files.** ESLint caps: `max-lines` 400 per file,
  `max-lines-per-function` 80, `complexity` 12. Several files below are already near the
  400-line cap (`laser-store.ts` is at 487 - it is over because actions are split into
  factory functions; adding to it means extracting, not appending).
- **Module boundaries flow DOWN the pipeline only.** `scene/` cannot import
  `job/`,`plan/`,`output/`; `job/` cannot import `plan/`,`output/`; `plan/` cannot import
  `scene/`,`output/`; `output/` cannot import `scene/`.
- **Pure-core.** No clock, no random, no I/O under `src/core/`. Dither/raster/plan code is
  deterministic: same input, same output.
- **exactOptionalPropertyTypes is on.** Spread optional props conditionally
  (`...(x !== undefined ? { x } : {})`) rather than assigning `undefined`.
- **Wired-into-product gate.** A ticket is Shipped only when a non-test file under `src/` or
  `electron/` consumes the new code AND a test exercises the live production path (not a
  mock-only fixture). "Type exists" or "helper exists, nothing calls it" does not count.
- **ASCII-only commit messages via file + `git commit -F`** on PowerShell 5.x. Use
  `[IO.File]::WriteAllText` (not `Out-File -Encoding utf8`, which writes a BOM that becomes
  `U+FEFF` in the subject line). This entire document is ASCII for the same reason.
- **Safety-path bar.** Changes to `MachineService`, `ExecutionCoordinator`, the GRBL
  controller/streamer, `src/communication/`, `src/core/preflight/`, or any g-code emission
  must cover the failure mode (not just the happy path) and carry a
  "Hardware verification needed" note until confirmed on the user's Falcon A1 Pro.

---

## Recently shipped (excluded from this roadmap - do NOT redo)

These are confirmed in DECISIONS.md and the listed commits. They are the floor this plan
builds on.

**Fill engrave pipeline (ADR-031..035, 038):**
- ADR-031 (47e199b): fill hatch overscan lead-in/out via `expandFillHatchWithOverscan`.
- ADR-032 (c38c11a): bidirectional (serpentine) raster rows after the overscan runtime
  regression.
- ADR-033: skip fill overscan on short hatch runs; emit the runway as a rapid
  (`effectiveOverscanMm`).
- ADR-034 (47e199b): continuous-sweep fill - one G1 per scanline with S0-blanked gaps
  (`groupFillSweeps` + `emitFillGroup`).
- ADR-035 (bf133f5): split a fill scanline at large gaps (>5mm) so the emitter rapids across
  them (`GAP_RAPID_THRESHOLD_MM`).
- ADR-038 (e0679c7): per-layer unidirectional fill option (`Layer.fillBidirectional`).

**Raster engrave + power mode (ADR-036, 037, 039, 040):**
- ADR-036 (4119a39): fill engraving emits M4 dynamic power; `grbl-strategy.ts` tracks an
  `M3|M4|off` mode and flips only on change.
- ADR-037 (a2672cc): image-trace decode cap raised 1024 -> 2048 px.
- ADR-039 (c38c11a): split a raster row at wide white gaps (>5mm) via `activeSpans()`.
- ADR-040 (ddb8e31): shared prepared-output pipeline so preview == save == start == estimate
  (`prepareOutput`).

**Safety + provenance + budget (P0/P1/P2 series):**
- P0-A (eadc19b): provenance header on every g-code export.
- P0-A (b04b698): long blank-feed invariant blocks stale/marking g-code
  (`findLongBlankFeedMoves`).
- P0-B.1 (e930ac3): laser safety-notice state machine.
- P0-B.2 (38f3433): safety-notice banner in the laser panel.
- P1-A.1 (c2329d7): raster pixel-budget guard on Save/Start (`evaluateRasterBudget`).
- P1-A.2 (c87eaaf): live-estimate raster guard + resolution clamp.
- P1-C (ddb8e31): shared prepared-output (preview == burn). Same commit as ADR-040.
- P2-A (50e23f3): PNG/JPEG density (DPI) on image import.
- P2-A (cdc8f7c): revalidate the trace source before committing a trace (`sameTraceSource`).

Origin/preflight foundations (ADR-021, ADR-022) and the perceptual harness (ADR-025/026/028)
are also shipped; the gap for origin work below is purely UI exposure, not core math.

---

## TIER 0 (gate) - Hardware verification backlog

**This is the first gate. No new burn-path work (any P0/P1 raster/fill/emit item below)
starts until these shipped-but-unverified fixes are confirmed on the user's Falcon A1 Pro.**

Every item here changed emitted g-code or the burn timeline and shipped with software tests
only. The contract (CLAUDE.md safety section) requires a hardware confirmation before they
can be trusted as a foundation. A regression in any of them would be a real burn or
mechanical event, and several later items build directly on top of them (e.g. the dithering
expansion in P1 rides on the same raster emit path as ADR-036/039).

How to run this gate generically: connect the Falcon A1 Pro, home it, set a known origin on
scrap, and for each item below emit the g-code from the live app (do not hand-write it),
read the specific lines called out, then burn the named tile and measure with calipers / a
loupe. Capture a photo and the g-code excerpt in `audit/evidence/` so the confirmation is
auditable. Record results in DECISIONS.md against the relevant ADR.

### HV-1: Gap-rapid split on fill scanlines (ADR-035, bf133f5)
- **What shipped:** scanlines split at gaps >5mm; the emitter crosses the gap as a G0 rapid
  with the laser off rather than a slow blanked G1.
- **Empirical verification FIRST:** design a fill shape with an internal void wider than 5mm
  (e.g. a 40mm square ring with a 20mm hole). Emit g-code and confirm: the run into the void
  ends with `M5` or `S0`, the crossing is a `G0` (not `G1`), and a fresh `M4`/`S`-on follows
  on the far side. Confirm no `G1` carries a nonzero S across the void.
- **Burn/measure on Falcon A1 Pro:** burn the ring on masking-taped plywood. Confirm the
  void is clean (no scorch line across it) and the two filled regions are continuous. Time
  the job and compare to the pre-ADR-035 estimate to confirm the rapid actually saved time.
- **Done-criteria:** void unburned, both regions fully filled, g-code shows G0 across gaps.

### HV-2: Bidirectional (serpentine) raster + fill rows (ADR-032, c38c11a)
- **What shipped:** alternate rows reverse direction so the head does not return to row-start
  between passes.
- **Empirical verification FIRST:** emit a small raster (e.g. 20x20mm photo at 10 lines/mm).
  Confirm consecutive rows alternate X direction (row N goes +X, row N+1 goes -X) and that
  each row's S-values are the correct mirror of the pixel order.
- **Burn/measure:** engrave a vertical-gradient test patch. Look for a "zipper"/serration on
  vertical edges (the lag offset between left-to-right and right-to-left firing). Measure the
  horizontal offset of a vertical line between odd and even rows with a loupe; it must be
  sub-0.1mm at the test feed.
- **Done-criteria:** no visible zipper at typical diode feed; edge offset under 0.1mm.

### HV-3: M4 dynamic power for fill (ADR-036, 4119a39)
- **What shipped:** fill groups emit `M4` (dynamic power, scales with feed) instead of `M3`
  (constant). Mode flips only on change; cut-only jobs stay byte-identical.
- **Empirical verification FIRST:** emit a mixed job (one fill layer + one cut layer).
  Confirm exactly one `M4 S0` before the fill block, exactly one `M3 S0` restoring before the
  cut block, and that a cut-only job contains zero `M4`. Confirm a fill-then-raster sequence
  does not emit a redundant second `M5`.
- **Burn/measure:** burn a solid fill rectangle. Under M4 the diode must go dark whenever the
  head is stopped (corners, start/stop). Confirm corners are not over-burned relative to the
  rectangle interior. Compare to a known LightBurn M4 fill of the same rectangle.
- **Done-criteria:** corners not darker than interior; head-stopped == dark; mode flips
  exactly as emitted.

### HV-4: Per-layer unidirectional fill (ADR-038, e0679c7)
- **What shipped:** `Layer.fillBidirectional=false` forces every row to burn the same
  direction (removes the alternating-lag zipper on small text).
- **Empirical verification FIRST:** set a fill layer to unidirectional, emit, and confirm all
  fill rows travel the same X direction and that the return between rows is a `G0` rapid.
- **Burn/measure:** burn small filled text (e.g. 6mm cap height) both bidirectional and
  unidirectional. Confirm the unidirectional version removes the serration visible on the
  bidirectional one, at the cost of measured extra time.
- **Done-criteria:** unidirectional text is visibly cleaner; rows confirmed same-direction.

### HV-5: Raster row split at wide white gaps (ADR-039, c38c11a)
- **What shipped:** a raster row splits at white runs >5mm; the emitter rapids across the
  white instead of feeding through it at S0.
- **Empirical verification FIRST:** emit a raster of an image with a wide white band (e.g.
  two black blocks separated by 15mm of white). Confirm each row ends the first block, `G0`
  rapids across the white, and resumes for the second block - no `G1` through the white.
- **Burn/measure:** engrave it. Confirm the white band is untouched and the job is faster
  than a straight full-width raster of the same bounds.
- **Done-criteria:** white band clean; per-row G0 confirmed; measured time reduction.

### HV-6: Decode cap raised to 2048 px (ADR-037, a2672cc)
- **What shipped:** image-trace decode max edge raised 1024 -> 2048 px for small-feature
  fidelity.
- **Empirical verification FIRST:** import an image whose long edge exceeds 1024px but is
  under 2048px and confirm it is NOT downsampled below its native long edge (inspect decoded
  pixel dims). Import one over 2048px and confirm it clamps to 2048.
- **Burn/measure:** trace + engrave an image with fine detail (e.g. 0.3mm text in the
  source). Confirm the small features survive that would have been lost at the 1024 cap.
- **Done-criteria:** sub-2048 images keep native resolution; fine features render; over-2048
  clamps.

### HV-7: Long blank-feed invariant (P0-A, b04b698)
- **What shipped:** preflight blocks loading/burning g-code that contains long blank-feed
  moves (a `G1` with the laser off over a long distance - the signature of stale or
  wrong-mode g-code), threshold 5mm to match the ADR-035 gap split.
- **Empirical verification FIRST:** this is a guard, so prove it both ways. Construct a job
  that legitimately rapids across a >5mm gap and confirm it passes (the gap is `G0`, not a
  blank `G1`). Then construct/emit a degenerate case with a blank `G1` over >5mm and confirm
  preflight rejects with the blank-feed code.
- **Burn/measure:** no burn needed for the guard itself; this is the one Tier-0 item that is
  verified by emission + preflight only. Note that explicitly when recording.
- **Done-criteria:** legit rapids pass; blank-feed `G1` is rejected; threshold == 5mm
  matches ADR-035.

---

## TIER 1 (P0) - Safety and freeze-the-UI defects

These are correctness defects on paths that can fire the beam in the wrong place, leave it
on, or lock the UI. They take priority over every feature. Do them in the order listed.

### P0-1: GRBL error:N during an active stream is treated as progress, not a job-stop
- **Status:** SHIPPED 2026-06-04 (ADR-041) - sender-side stream termination ('errored' status) + controller-error safety notice; the misleading "treats error like ok" test is inverted. FOLLOW-UP (separate ticket, hardware-gated): GRBL does not halt on error:N by default, so a complete halt + darking a currently-firing laser also needs a real-time feed-hold (!) / soft-reset (0x18) on error to flush GRBL's RX buffer.
- **Problem:** When GRBL rejects a line mid-burn (`error:N` on a setup/motion/modal command),
  the streamer pops the in-flight line and immediately sends the next queued lines exactly as
  it does for an `ok`. The next line can be `M3 S255` (laser on) at a position the controller
  never actually reached, because the move that should have positioned the head was the
  rejected one. User-visible symptom: a rejected command is silently followed by the beam
  firing in the wrong place; the job appears to continue normally. LightBurn treats any
  controller error as immediate job failure.
- **Evidence:** `lightburn-parity-codex-verification-2026-06-03` (LF-CV-001),
  `whole-repo-lightburn-parity-audit-2026-06-04` (P0 Streaming error). Live code:
  `src/ui/state/laser-line-handler.ts:146-149` (`error` branch calls
  `advanceStream(..., 'error')`, structurally identical to the `ok` branch at 151-153);
  `src/core/controllers/grbl/streamer.ts:132-155` (`onAck`: only `kind === 'alarm'` sets
  `status='cancelled'` at line 140-141; `error` falls through and preserves the streaming
  status); the misleading green test at `src/core/controllers/grbl/streamer.test.ts:71-76`
  ("treats error like ok for buffer accounting (still consumes)"). `lastError` is set at
  `laser-line-handler.ts:147` but never read by any UI/action path that stops the job.
- **Plan:** Make a controller error terminal for the stream, mirroring the alarm path.
  In `onAck`, treat `kind === 'error'` like `kind === 'alarm'`: transition to a terminal
  status and stop sending. Decide between reusing `cancelled` and adding a distinct
  `errored` status - a distinct status lets the UI word it as "job failed: controller
  rejected line N" vs the user-initiated stop, which is the LightBurn behavior and the more
  honest message. After `onAck` returns terminal, `advanceStream` must NOT call `step()` to
  push more bytes. Surface the failure as a `safetyNotice` so the operator is told to check
  the machine.
- **Empirical verification FIRST:** before editing, write a focused harness (or extend the
  existing streamer test temporarily) that builds a streamer, sends a chunk, then feeds it an
  `error` ack, and prints the resulting `status` and what `step()` would send next. Confirm
  today it prints `status: 'streaming'` and a non-empty next chunk. That is the bug captured
  as output, not just asserted. Keep that printout in the commit body.
- **Fix (file-by-file):**
  - `src/core/controllers/grbl/streamer.ts`: in `onAck`, compute `nextStatus` so `error`
    (and `alarm`) yield a terminal status; add an `errored` status to `StreamerStatus` and to
    the terminal-state guard in `step()` (the early-return list at lines 94-99). Export any
    new status from the module index.
  - `src/ui/state/laser-line-handler.ts`: in `advanceStream`, after `onAck`, if the acked
    state is terminal due to error, do not `step()`/`safeWrite` the next chunk; instead set
    the streamer to the terminal state. In the `error` branch of `handleLine`, set a
    `safetyNotice` describing the rejected line code.
  - `src/ui/state/laser-safety-notice.ts`: add a notice/action variant for a controller
    error mid-job if the existing set does not cover it.
- **Test:** flip `streamer.test.ts:71-76` to assert error is now terminal (status terminal,
  `step()` returns empty `toSend`). Add a `laser-line-handler.test.ts` test: feed an `error`
  while streaming and assert (a) no follow-up `safeWrite`, (b) `safetyNotice` set, (c)
  streamer terminal. This is the laser-on-after-error failure mode, not the happy path.
- **Hardware-verify?** Yes. On the Falcon A1 Pro, deliberately inject a rejected line into a
  test job (e.g. an unsupported modal) and confirm the stream halts and the beam does not
  fire after the rejection. Hardware verification needed note in the commit.
- **Effort:** M.
- **Done-criteria:** an `error` ack stops the stream, sends no further bytes, raises a
  safety notice; the old "treats error like ok" test is inverted and green; hardware
  confirms halt.

### P0-2: Pause sends only GRBL feed-hold (!) with no laser-off
- **Status:** DEFERRED 2026-06-04 (blocked on hardware) - the fix shape depends on observing whether a GRBL feed-hold darks the diode on the Falcon (M3 vs M4), and coding blind risks breaking feed-hold resume; do this during the Tier-0 HV session. Per user direction, proceeding with code-only P0s (P0-3 onward) first.
- **Problem:** `pauseJob` writes only `RT_HOLD` (`!`). GRBL feed-hold halts motion planning
  but does not disable the spindle/laser, so the beam can remain energized during
  deceleration and while parked at the hold point (especially mid-dwell). User-visible
  symptom: Pause looks like a safety stop but is not - the diode can stay lit on a stationary
  head, which scorches/burns through. The UI even carries a tooltip admitting "Pause is feed
  hold only" - that is documentation, not a safeguard.
- **Evidence:** `lightburn-parity-codex-verification-2026-06-03` (LF-CV-001). Live code:
  `src/ui/state/laser-store.ts:384-393` (`pauseJob` writes only `RT_HOLD`); `RT_HOLD = '!'`
  in `src/core/controllers/grbl/commands.ts:20`; `PAUSE_HOLD_SAFETY_MESSAGE` tooltip at
  `src/ui/laser/JobControls.tsx:21-22,203,220`. The codebase already knows how to dark the
  diode: end-of-job postamble emits `M5` (`grbl-strategy.ts`) and raster emits `S0` during
  deceleration (`emit-raster.ts`).
- **Plan:** Make Pause actually dark the beam. The simplest correct GRBL sequence is feed-hold
  to stop motion, then ensure laser-off. Under M3 (constant power) the beam stays on during a
  hold, so an explicit laser-off is required; under M4 (dynamic) power goes to 0 at 0 feed,
  but Pause must be safe regardless of which mode the active job is in, so do not rely on M4.
  Two viable approaches: (a) `RT_HOLD` then write `M5` (queued, so it runs after the planner
  drains) - but a queued `M5` behind a feed-hold may not execute until resume, which defeats
  the purpose; (b) treat Pause as a real safety stop using a soft-reset path. Research the
  GRBL 1.1 real-time behavior on the Falcon before choosing: the key question is whether the
  diode is actually off during a feed-hold on this firmware. Capture that empirically (HV
  gate gives you the hardware) before writing the fix. If feed-hold does not dark the diode,
  Pause must escalate (e.g. hold + an immediate means of killing spindle, or document that
  Resume is unsafe and convert Pause to Stop semantics). Do not silently change the contract
  of pause/resume without reviewing all callers (CLAUDE.md safety rule).
- **Empirical verification FIRST:** on the Falcon, start a fill job under M3, hit Pause
  mid-stroke, and observe the diode with appropriate eye protection / a phone camera. Record
  whether the beam stays lit on the held, stationary head. This measurement decides approach
  (a) vs (b). Do not write code until this is known - the entire fix shape depends on it.
- **Fix (file-by-file):**
  - `src/ui/state/laser-store.ts`: extend `pauseJob` per the verified approach. Keep the
    `try/catch` -> `safetyNotice` pattern already there. If emitting `M5`, send it through
    `safeWrite` after `RT_HOLD`.
  - `src/ui/laser/JobControls.tsx`: if Pause now guarantees laser-off, update
    `PAUSE_HOLD_SAFETY_MESSAGE` to reflect the real behavior (do not keep a stale warning).
- **Test:** in `laser-store.test.ts`, assert the exact byte sequence `pauseJob` writes
  (`RT_HOLD` then the laser-off command) and that a write failure on either step raises the
  pause `safetyNotice`. Failure-mode focused.
- **Hardware-verify?** Yes - this is the gating measurement. Confirm on the Falcon A1 Pro
  that after Pause the diode is dark on the stationary head, and that Resume cleanly
  continues. Hardware verification needed note.
- **Effort:** M (the code is small; the risk and the required hardware observation make it
  non-trivial).
- **Done-criteria:** Pause leaves the beam dark on a held head (confirmed on hardware);
  Resume continues correctly; the tooltip matches reality; write-failure raises a notice.

### P0-3: Ack-driven follow-up write failure tears down with no safety banner
- **Status:** SHIPPED 2026-06-04 (ADR-042) - the advanceStream catch now raises the disconnect-during-job safety banner, and the gap test asserts the notice. Shared `disconnectDuringJobNotice()` builder dedupes the onClose path.
- **Problem:** When the post-ack write of the next chunk rejects, `advanceStream` marks the
  streamer `disconnected` but raises no `safetyNotice`. GRBL may keep executing the commands
  already in its 120-byte buffer while the UI silently leaves the streaming state with no
  alert. User-visible symptom: the job stops updating, the head keeps moving (buffered
  commands), and nothing tells the operator to hit the physical E-stop. Same class as the
  active-job disconnect path, which DOES raise a notice.
- **Evidence:** `whole-repo-lightburn-parity-audit-2026-06-04` (P0 follow-up write failure);
  `karpathy-whole-repo-audit-2026-06-02` (KF-012); claude change-audit (active-job disconnect
  soft-reset swallowed). Live code: `src/ui/state/laser-line-handler.ts:170-172` - the
  `.catch` sets `disconnectStreamer(...)` only, with no `safetyNotice`. Contrast every other
  write-failure path in `laser-store.ts` (lines 290, 388, 398, 423) which all do
  `set({ safetyNotice: writeFailedNotice(action) })`. The test at
  `laser-line-handler.test.ts:87-107` checks `status === 'disconnected'` but never checks the
  notice, which is why this was never caught.
- **Plan:** Make the ack-driven follow-up write failure raise the same operator-facing safety
  banner the other write failures do. Note (per the verdict): no soft-reset is appropriate
  here, because the write itself failed - there is no live link to send a soft-reset over.
  The banner is the mechanism that tells the operator to use the physical controls. Recovery
  state (in-flight/completed) is already preserved by `disconnect()`, so leave that.
- **Empirical verification FIRST:** before editing, run the existing
  `laser-line-handler.test.ts:87-107` test under a temporary assertion that prints the store
  `safetyNotice` after the simulated follow-up write failure. Confirm it prints `null` today.
  That null is the bug.
- **Fix (file-by-file):**
  - `src/ui/state/laser-line-handler.ts:170-172`: in the `.catch`, set both the disconnected
    streamer and `safetyNotice: writeFailedNotice(<action>)`. The handler does not currently
    import `writeFailedNotice`/`LaserSafetyNotice` - add the import from
    `./laser-safety-notice`. Pick the action label that reads correctly for a mid-stream
    follow-up write (reuse an existing one or add a `stream` variant in
    `laser-safety-notice.ts`).
- **Test:** extend `laser-line-handler.test.ts:87-107` to also assert `safetyNotice` is set
  (non-null, correct action) after the follow-up write rejects. This closes the exact gap
  that hid the defect.
- **Hardware-verify?** No (write-failure path is hard to provoke deterministically on
  hardware and the behavior is a UI banner). Software test is sufficient; note that the
  underlying disconnect-during-job behavior is covered by the existing banner.
- **Effort:** S.
- **Done-criteria:** an ack-driven follow-up write failure sets the safety banner; the
  enhanced test asserts it; no soft-reset is sent on this path (deliberate).

### P0-4: Stop/Home/Frame/Jog/Origin/Autofocus write failures are not surfaced as safety alerts
- **Problem:** Only pause/resume/stop/disconnect raise the `safetyNotice` banner. `home`,
  `jog`, `frame`, `setOriginHere`, `resetOrigin` (and an autofocus write-level drop) have no
  error handling: a failed write that was supposed to move or stop the head silently
  rejects, the UI voids the promise, and the operator gets no instruction to hit the physical
  E-stop. User-visible symptom: e.g. Frame fails partway (second corner write rejects), the
  head is left mid-frame, and nothing warns. This is the general "P0-B safety-alert path"
  that was only partly completed. (Severity here is P1 per the source, but it is grouped with
  the safety-alert work; do it right after P0-3 since they touch the same files and pattern.)
- **Evidence:** `claude-p0-p1-audit-2026-06-03` & `change-audit-2026-06-04`;
  `high-priority-image-burn-roadmap-2026-06-03`; `karpathy-image-to-burn-audit-2026-06-03`
  (F-H3). Live code: `src/ui/state/laser-store.ts` - `home` (313-316), `jog` (341-344),
  `frame` (348-362), `setOriginHere` (444-452), `resetOrigin` (453-457) all `await safeWrite`
  / action with NO `try/catch`. The type already anticipates this:
  `src/ui/state/laser-safety-notice.ts:16-24` lists `'frame'`, `'origin'`, `'jog'`, `'home'`
  in `LaserSafetyAction` but nothing wires them. The banner UI
  (`SafetyNoticeBanner.tsx:11-25`) is ready. `JobControls.tsx` calls these fire-and-forget
  (line 122 `void home()`, 276 `void frame(...)`, 289 `void autofocus(...).then()`).
- **Plan:** Wrap each motion action in the established `try/catch` -> `set({ safetyNotice:
  writeFailedNotice(action) })` -> rethrow pattern (mirror `pauseJob` at 385-390). Map each
  action to its existing `LaserSafetyAction` label (`home`, `jog`, `frame`, `origin` for both
  set/reset). For autofocus, surface a persistent notice if the runner detects a write-level
  failure / connection drop during the command (not just a preflight-failed result). Then fix
  the callers in `JobControls.tsx` to add `.catch(() => undefined)` so the voided promise does
  not produce an unhandled rejection while the banner does the user-facing work.
- **Empirical verification FIRST:** for one representative action (e.g. `frame`), add a
  temporary test that injects a `safeWrite` that rejects on the 2nd corner and prints the
  store `safetyNotice` after. Confirm it prints `null` today. Repeat the printout mentally
  for the others (same structure) - they share the no-catch shape, so one captured failure
  proves the class.
- **Fix (file-by-file):**
  - `src/ui/state/laser-store.ts`: add `try/catch` to `home`, `jog`, `frame`, `setOriginHere`,
    `resetOrigin`; each catch sets the matching `safetyNotice` and rethrows. Note this file is
    487 lines - the actions are already grouped into factory functions
    (`jogActions`,`originActions`); if adding the catches pushes a function over the 80-line
    cap, extract a small helper (e.g. `withSafetyNotice(action, fn)`) rather than inflating
    the factory.
  - `src/ui/state/autofocus-action.ts`: ensure a write-level failure during the autofocus
    sequence returns a result the store turns into a persistent notice (or have the store set
    one in the `finally`/catch around `runAutofocus`).
  - `src/ui/laser/JobControls.tsx`: add `.catch(() => undefined)` to the `home`/`frame`/
    `autofocus` invocations so the banner is the single user-facing channel.
- **Test:** in `laser-store.test.ts` (near the existing pause/resume/stop write-failure tests
  at 168-195), add a write-failure test for each of `home`, `frame`, `jog`, `setOriginHere`,
  `resetOrigin` asserting the correct `safetyNotice` is raised. Add an autofocus
  connection-drop test.
- **Hardware-verify?** No (write-failure injection is a software concern). The motions
  themselves are exercised in HV-3..HV-5 gating burns; this item only adds the alert on
  failure.
- **Effort:** M.
- **Done-criteria:** every motion action raises the correct safety notice on write failure;
  callers no longer leak unhandled rejections; tests cover each action's failure mode.

### P0-5: Frame and custom-origin Start compile/dither the full raster before the budget guard
- **Problem:** Both the Frame action and the custom-origin Start bounds-check call
  `compileJob` directly to compute bounds, BEFORE the raster pixel-budget guard runs. A large
  raster job (e.g. 300x300mm at 25 lines/mm = 7500x7500 = 56M px) allocates the luma +
  S-value buffers inside `compileJob` and can freeze or OOM the renderer before the
  "too-large" rejection ever fires. Save, normal Start, and the live estimate are guarded
  (they go through `prepareOutput` -> `runPreEmitPreflight`); these two paths are not. Frame
  in particular should be a cheap perimeter action and must never compile a raster.
- **Evidence:** `image-trace-bitmap-deep-research-2026-06-04` (P1, two findings);
  `whole-repo-lightburn-parity-audit-2026-06-04` (P1 custom-origin + frame);
  `claude-p0-p1-audit-2026-06-03` (P1-C incomplete). Live code: Frame at
  `src/ui/laser/JobControls.tsx:247` (`compileJob(project.scene, project.device)` with no
  preflight wrapper); custom-origin bounds at `src/ui/laser/start-job-readiness.ts:100`
  (`compileJob(...)` inside `findOriginBoundsIssue`, called at line 54 BEFORE the guarded
  `emitGcode` at 59-64). The guard itself is correct and available:
  `src/io/gcode/prepare-output.ts:35` (`runPreEmitPreflight` first) and
  `src/core/preflight/pre-emit.ts:18-38` (sizes rasters from bounds x lines/mm WITHOUT
  compiling).
- **Plan:** Run the cheap `runPreEmitPreflight` (or `prepareOutput`, which calls it first)
  before any `compileJob` on these two paths. For Frame: it only needs bounds, but bounds of
  an image come from `computeJobBounds(compileJob(...))`. Two options: (a) call
  `runPreEmitPreflight(project)` first and bail with a "too-large" toast before `compileJob`;
  or (b) for Frame, derive bounds without compiling rasters at all (Frame only needs the
  outer rectangle - the image's machine-coord bounds are already computable via
  `rasterBoundsInMachineCoords` used by pre-emit, no dither needed). Option (b) is the more
  correct "Frame is cheap" fix but is larger; option (a) is the minimal guard. Recommend (a)
  for the first commit (closes the freeze), with a note that (b) is a follow-up if Frame perf
  on huge non-raster scenes is still a concern. For custom-origin Start: gate
  `findOriginBoundsIssue` behind `runPreEmitPreflight` (return the budget error before the
  bounds compile), since the budget error should win over the bounds error anyway.
- **Empirical verification FIRST:** construct a project with a 300x300mm raster on an
  image layer at 25 lines/mm. Before the fix, call the Frame code path (or
  `findOriginBoundsIssue`) in a test/REPL and confirm it reaches `compileJob` and allocates
  (you can assert `runPreEmitPreflight(project).ok === false` for the same project to prove
  the budget WOULD have rejected it - that asymmetry is the bug: the guard says no, the path
  compiles anyway).
- **Fix (file-by-file):**
  - `src/ui/laser/JobControls.tsx` (`useFrameAction`, ~line 246): call
    `runPreEmitPreflight(project)` first; if `!ok`, `pushToast(<too-large message>, 'error')`
    and return before `compileJob`. Import from `../../core/preflight`.
  - `src/ui/laser/start-job-readiness.ts` (`prepareStartJob`/`findOriginBoundsIssue`): run
    `runPreEmitPreflight(project)` before `findOriginBoundsIssue`'s `compileJob` (or at the
    top of `prepareStartJob` for the user-origin branch), returning the budget issue as a
    `{ ok:false }` message.
- **Test:** add a `JobControls.test.tsx` test: Frame on an over-budget raster project pushes a
  "too-large" toast and never calls `compileJob` (spy/guard). Add a `start-job-readiness.test`
  test: custom-origin Start on an over-budget raster returns `{ ok:false }` with the budget
  message before any bounds compile.
- **Hardware-verify?** No (UI-freeze prevention; verified by the guard firing in software).
- **Effort:** M.
- **Done-criteria:** Frame and custom-origin Start reject an over-budget raster via the cheap
  guard before any `compileJob`; tests assert no compile on the over-budget path.

### P0-6: Raster Preview decodes/resamples/dithers without the shared raster budget
- **Problem:** `drawRasterPreview` -> `previewCanvasFor` decodes luma, resamples, dithers, and
  builds an offscreen canvas with NO `evaluateRasterBudget` check. An over-budget image
  (commonly one made via Convert to Bitmap) can freeze the UI in Preview mode even though
  Save/Start are protected. User-visible symptom: switching to Preview locks the app on a
  large image. LightBurn's Preview is inspection-only and must never lock the UI.
- **Evidence:** `image-trace-bitmap-deep-research-2026-06-04` (P1);
  `whole-repo-lightburn-parity-audit-2026-06-04` (P1 Raster Preview budget). Live code:
  `src/ui/workspace/draw-raster-preview.ts:85-123` (`previewCanvasFor` does the heavy
  `resampleLumaNearest` + `dither` + `rasterPreviewRgba` + canvas alloc with no budget
  check); `draw-scene.ts:74` calls `drawRasterPreview` unconditionally in preview mode. The
  budget exists at `src/core/preflight/pre-emit.ts:29` (`evaluateRasterBudget`) but is only in
  the Save/Start path, not the preview render path.
- **Plan:** Add an `evaluateRasterBudget(targetWidth, targetHeight)` check inside
  `previewCanvasFor` right after the target dims are computed (lines 93-100) and before the
  decode/resample/dither/canvas work. On `too-large`, return `null` (the function already
  uses `null` to mean "skip this raster", see the degenerate-dims early return at line 91), so
  the preview silently skips the over-budget raster rather than freezing. Optionally surface a
  one-time non-blocking hint that the preview was skipped (not required for the safety fix).
- **Empirical verification FIRST:** in a test, call `previewCanvasFor` with an over-budget
  obj/layer (300x300mm at 25 lines/mm) and confirm it currently proceeds to canvas creation
  (you can assert `evaluateRasterBudget(pw, ph).kind === 'too-large'` for the same dims to
  prove the budget would reject what the preview currently builds).
- **Fix (file-by-file):**
  - `src/ui/workspace/draw-raster-preview.ts`: import `evaluateRasterBudget` from
    `../../core/raster`; in `previewCanvasFor` after computing `targetWidth`/`targetHeight`,
    `if (evaluateRasterBudget(targetWidth, targetHeight).kind === 'too-large') return null;`.
- **Test:** in `draw-raster-preview.test.ts`, add a test that an over-budget raster yields no
  canvas (return null) and triggers no `resampleLumaNearest`/canvas creation (spy or assert
  the cache stays empty). This is the freeze-prevention failure mode.
- **Hardware-verify?** No (pure UI render guard).
- **Effort:** S.
- **Done-criteria:** Preview skips over-budget rasters (returns null), does zero heavy
  allocation for them, and the test proves it.

### P0-7: Convert to Bitmap rasterizes and base64-encodes synchronously on the main thread
- **Problem:** `buildBitmapFromVector` -> `lumaToBitmap` -> `canvas.toDataURL` runs at a fixed
  254 DPI on the UI thread, building a full base64 PNG in memory before any state dispatch. A
  large vector (300x300mm ~= 9M px) freezes the renderer or spikes memory during the encode,
  before the raster budget can even apply (the budget only exists once a RasterImage exists).
  User-visible symptom: clicking Convert to Bitmap on a large vector hangs the app.
- **Evidence:** `image-trace-bitmap-deep-research-2026-06-04` (P1);
  `whole-repo-lightburn-parity-audit-2026-06-04` (P1); `lightburn-build-gap-roadmap-2026-06-04`
  (P1-B worker encode). Live code: synchronous call chain - `ConvertToBitmapButton` onClick
  (Toolbar.tsx ~211-221) -> `buildBitmapFromVector` (`vector-to-bitmap.ts:52-53`) ->
  `assembleBitmap` -> `lumaToBitmap` (`luma-bitmap.ts:38-42`) ->
  `rgbaToPngDataUrl` -> `canvas.toDataURL` (`luma-bitmap.ts:82`). No `toBlob`, no
  `OffscreenCanvas`, no worker; `buildBitmapFromVector` is not async. Contrast the async image
  import in `Toolbar.tsx` (uses `await readFileAsDataUrl`).
- **Plan:** Move the PNG encode off the main thread. Add a worker
  (`src/ui/raster/encode-bitmap-worker.ts`) mirroring the existing
  `src/ui/trace/trace-worker.ts` pattern: it accepts the rasterized RGBA/`VectorRaster` and
  returns `{ dataUrl, lumaBase64 }` (or returns a Blob via `OffscreenCanvas.convertToBlob`
  and the caller turns it into a data URL / object URL). Make `buildBitmapFromVector` async
  (`Promise<RasterImage>`); have the small-raster case fall back to inline encode to avoid
  worker overhead. Update the button onClick to be async and await the result, with a
  progress/cancel affordance for large encodes. Note: the raster budget still applies AFTER
  creation (it gates emit/preview), so moving encode off-thread is the freeze fix; do not try
  to apply the pixel budget mid-encode (the budget is a post-creation gate by design).
- **Empirical verification FIRST:** measure the current synchronous cost. Build a large
  convertible vector (300x300mm, dense geometry), and in the browser (or a perf test) time
  `buildBitmapFromVector` start-to-finish and confirm it blocks the main thread for a
  user-noticeable duration (frame stalls). Capture the timing. Re-measure after the worker
  fix to confirm the main thread is no longer blocked.
- **Fix (file-by-file):**
  - new `src/ui/raster/encode-bitmap-worker.ts`: worker that encodes RGBA -> PNG
    (`OffscreenCanvas`/`convertToBlob` preferred over `toDataURL`).
  - `src/ui/raster/luma-bitmap.ts`: add an async encode (`lumaToBitmapAsync`) that uses the
    worker; keep the sync one for the small/inline fallback and for the existing unit tests.
  - `src/ui/raster/vector-to-bitmap.ts`: make `buildBitmapFromVector` async; keep
    `assembleBitmap` injectable (it already takes `encode` as a parameter) so the pure
    gather+rasterize stays unit-testable without a DOM.
  - `src/ui/common/Toolbar.tsx`: make the Convert to Bitmap onClick async, await the result,
    keep the try/catch -> toast, add a busy/progress indicator and a cancel.
- **Test:** keep the existing `assembleBitmap` unit test (DOM-free, injected encode). Add a
  test that `buildBitmapFromVector` returns a promise and that the button handler awaits it
  (and that a cancel before completion does not dispatch a partial raster). The freeze itself
  is verified by the empirical timing above (note it in the commit; main-thread blocking is
  hard to assert in jsdom).
- **Hardware-verify?** No (pure UI/perf; the resulting bitmap's burn is covered by the
  existing raster emit HV gate).
- **Effort:** L (new worker + async refactor + UI busy state).
- **Done-criteria:** converting a large vector does not block the main thread (measured);
  the bitmap is byte-equivalent to the previous synchronous output; small rasters still encode
  inline; cancel works.

### P0-8: Frame/Jog and Autofocus are long-running motions with no stoppable busy lifecycle
- **Problem:** Autofocus now has a proper busy lease, but Frame still does not. Frame loops
  five `$J=` jogs fire-and-forget with no operation state, so during framing motion: the Stop
  button is not shown (RunningControls only renders when `streamer !== null`), and Home /
  Start / Set Origin / Reset Origin / Autofocus / a second Frame all stay enabled and can
  race the in-flight jogs. User-visible symptom: the head is moving during Frame and the
  operator cannot reliably halt it or is allowed to fire a conflicting command. (Autofocus is
  already fixed per `karpathy-stage1c`; this item is the remaining Frame/Jog half.)
- **Evidence:** `lightburn-build-gap-roadmap-2026-06-04` (P0-C Frame/Jog stoppable);
  `karpathy-whole-repo-audit-2026-06-02` (KF-032). Live code: Autofocus FIXED -
  `laser-store.ts:81` (`autofocusBusy`), `317-335` (lease + finally), `assertAutofocusIdle`
  guard at 232-234 called across motion actions. Frame NOT fixed - no `frameBusy` in the
  `LaserState` type (70-131); `frame()` (348-362) sets no state; RunningControls
  (`JobControls.tsx:37-38,190-223`) only shows Stop/Pause when `streamer !== null`; Frame is
  invoked fire-and-forget at `JobControls.tsx:276` (`void frame(bounds, feed)`).
- **Plan:** Model Frame as an active operation exactly like Autofocus. Add `frameBusy:
  boolean` to `LaserState`. In `frame()`, set `frameBusy: true` before the corner loop and
  clear it in a `finally`. Add `assertFrameIdle(get)` and call it from `home`, `autofocus`,
  `jog`, `startJob`, `setOriginHere`, `resetOrigin`, `disconnect`, and `frame` itself
  (prevent re-entrant Frame). Add a way to stop an in-flight Frame: `cancelJog()` already
  sends `RT_JOG_CANCEL`, which cancels the active `$J=` - surface a Stop control during Frame
  that calls it and clears `frameBusy`. Render Stop during Frame by widening the
  RunningControls condition to "streamer active OR frameBusy". Disable conflicting controls in
  the UI when `frameBusy`. (This item pairs naturally with P0-4's frame write-failure
  handling - the corner loop already needs a try/catch there; do P0-4 first so the
  `finally` that clears `frameBusy` sits cleanly around the same try.)
- **Empirical verification FIRST:** in a test, start `frame()` against a mock `safeWrite` that
  resolves slowly, and during the loop assert today that `home()`/`startJob()` are NOT blocked
  (no `assertFrameIdle`) and that the store exposes no busy flag. That absence is the bug.
- **Fix (file-by-file):**
  - `src/ui/state/laser-store.ts`: add `frameBusy` to the type and initial state; set/clear in
    `frame()` with a `finally`; add `assertFrameIdle` and call it in the listed actions.
    (Watch the 487-line cap - extract if needed.)
  - `src/ui/laser/JobControls.tsx`: widen the running condition so Stop shows during Frame;
    disable Home/Start/Origin/Autofocus and re-Frame while `frameBusy`; wire the Frame-time
    Stop to `cancelJog()`.
  - `src/ui/laser/LaserWindow.tsx`: pass `frameBusy` down to disable controls (mirror how
    `autofocusBusy` is threaded today).
- **Test:** in `laser-store.test.ts` (mirror the autofocus tests ~275-306): Frame blocks
  Home/Start/Jog/SetOrigin/ResetOrigin/Autofocus and a second Frame; `frameBusy` clears on
  completion and on cancel; Stop (cancelJog) during Frame aborts and clears the lease.
- **Hardware-verify?** Yes. On the Falcon A1 Pro, start a Frame, hit Stop mid-perimeter, and
  confirm the head halts promptly and conflicting buttons were disabled throughout. Hardware
  verification needed note.
- **Effort:** M.
- **Done-criteria:** Frame has a busy lease; Stop is shown and works during Frame; all
  conflicting actions are blocked during Frame; hardware confirms a clean mid-frame halt.

---

## TIER 2 (P1) - LightBurn parity features users hit constantly

These are missing capabilities (not safety defects) that force round-trips to other tools or
diverge from LightBurn output. Strict order within the tier; group the raster-emit items
(P1-3..P1-6) so the dither/power changes land together on the same emit path.

### P1-1: Layer (cut) order cannot be controlled; no manual layer create/recolor/reassign
- **Problem:** `scene.layers` is fixed at import order and `compileJob` emits in that order,
  so the operator cannot engrave/fill before cut or otherwise sequence a mixed job the way
  LightBurn's Cuts/Layers Move Up/Down does. There is no `moveLayer` action, no palette, and
  `Layer.id`/`color` are immutable, so shapes cannot be reassigned to a different layer/color
  or new layers created. User-visible symptom: a mixed cut+engrave job always runs in import
  order; common LightBurn workflows (engrave then cut out) are impossible.
- **Evidence:** `LIGHTBURN-PARITY-AUDIT-2026-06-03` (Cut Settings & Layers, two majors);
  `whole-repo-lightburn-parity-audit-2026-06-04` (P1 Layer order);
  `lightburn-parity-codex-verification` (LF-CV-006). Live code:
  `src/core/scene/scene.ts:9` (`readonly layers: ReadonlyArray<Layer>`), `33-50` (only
  `addLayer`/`updateLayer`/`removeLayer`); `compile-job.ts:44`
  (`for (const layer of scene.layers)`); `store.ts:96`
  (`setLayerParam: (..., patch: Partial<Omit<Layer, 'id' | 'color'>>)`);
  `layer.ts:17-18` (`id`/`color` readonly); `CutsLayersPanel.tsx`/`LayerRow.tsx` have no
  create/move/recolor controls.
- **Plan:** Two independently shippable pieces - do ordering first (the higher-value, lower-
  risk half). (a) Ordering: add `moveLayer(scene, layerId, direction|index)` to
  `src/core/scene/scene.ts` (pure array reorder), expose a `moveLayer` action in `store.ts`,
  and add Move Up / Move Down buttons to the Cuts/Layers panel. `compileJob` already iterates
  `scene.layers` in order, so emit order follows for free - verify that the emitted group
  order changes accordingly. (b) Recolor/reassign (separate later commit): relax the
  `Omit<Layer,'id'|'color'>` constraint or add a dedicated `recolorLayer`/`reassignObjects`
  action, plus a palette UI. Keep (b) out of the first commit; it is a bigger surface.
- **Empirical verification FIRST:** build a two-layer scene (cut layer first, fill layer
  second), emit g-code, and record the group order. Then (in a test) call the new `moveLayer`
  to swap them, re-emit, and confirm the fill block now precedes the cut block in the actual
  emitted string. The emitted ordering is the proof, not the array.
- **Fix (file-by-file):**
  - `src/core/scene/scene.ts`: add `moveLayer` (pure).
  - `src/ui/state/store.ts`: add the `moveLayer` action (goes through the history/dirty path
    like other scene mutations).
  - `src/ui/layers/LayerRow.tsx` (or the panel header `CutsLayersPanel.tsx`): Move Up / Move
    Down buttons, disabled at the ends.
- **Test:** `scene.test.ts`: `moveLayer` reorders correctly and is a no-op at the boundary.
  `compile-job` test: reordering layers changes emitted group order. Keep the existing
  guardrail that different fill layers stay separate.
- **Hardware-verify?** No (ordering is deterministic g-code; the burn correctness of each
  layer is already covered by the HV gate).
- **Effort:** M for ordering; recolor/reassign is a separate M-L follow-up.
- **Done-criteria:** layers reorder via UI; emitted group order follows; boundary no-ops;
  tests assert emitted order.

### P1-2: 9-dot Job Origin / Start From modes exist in core but are not exposed in the UI
- **Problem:** Job placement is hardcoded to front-left, so users cannot anchor a job from
  center/corner/current position like LightBurn's Start From (Absolute / Current Position /
  User Origin) + 9-point selector. The math is done (`JobOriginAnchor`, `applyJobOrigin`,
  all 9 anchors, tested); the gap is the UI selector plus threading the chosen anchor through
  preview/frame/start/estimate with per-origin bounds checks. User-visible symptom: every job
  starts from front-left; centering artwork on stock requires manual offsetting.
- **Evidence:** `lightburn-parity-codex-verification-2026-06-03` (LF-CV-004);
  `whole-repo-lightburn-parity-audit-2026-06-04` (P1 Start From/Job Origin);
  `set-origin-user-origin-audit-2026-06-01`; LIGHTBURN-STUDY 8.6. Live code (core done):
  `src/core/job/job-origin.ts:8-17` (9-value `JobOriginAnchor`), `19-22`
  (`JobOriginPlacement`), `34-78` (`applyJobOrigin` + `anchorPoint`), `29-32`
  (`USER_ORIGIN_JOB_PLACEMENT` hardcoded `anchor:'front-left'`). No UI usage anywhere in
  `src/ui` (grep clean); `JobControls.tsx:249` and `start-job-readiness.ts:61` only ever use
  the hardcoded placement; `file-actions.ts` `handleSaveGcode` calls `emitGcode` with no
  `jobOrigin`.
- **Plan:** Add a persistent UI preference for `{ startFrom, anchor }` and thread it through
  every consumer that builds a placement. Store the preference (a new field in `useUiStore`
  or the project, depending on whether it should persist in the saved file - decide and write
  it in the ADR; LightBurn persists it per-document, so the project is the more faithful home,
  but that means a versioned-envelope migration - prefer `useUiStore` for v1 unless the ADR
  chooses document-scoped). Build a 9-point selector component (a 3x3 grid of radio-style
  buttons) plus a Start From mode picker. Thread the selected placement into the
  `JobOriginPlacement` used by `prepareOutput`/`emitGcode` in `start-job-readiness.ts`,
  `JobControls` Frame, `live-job-estimate.ts`, `draw-preview.ts`, and `file-actions.ts`
  Save-Gcode, with per-origin bounds checks (reuse `findOriginBoundsIssue`'s pattern for each
  anchor).
- **Empirical verification FIRST:** for a centered object, emit g-code with anchor
  `front-left` and again with anchor `center`, and diff the coordinates - confirm the object
  is offset by exactly half its bounds between the two. The existing test at
  `start-job-readiness.test.ts:230` already proves `applyJobOrigin` works for one anchor;
  extend the empirical check to confirm each of the 9 anchors moves the emitted coordinates to
  the expected corner/edge/center before wiring UI.
- **Fix (file-by-file):**
  - `src/ui/state/ui-store.ts` (or `project.ts` if document-scoped per ADR): add the
    placement preference + setter.
  - new `src/ui/laser/JobOriginSelector.tsx`: the 3x3 anchor grid + Start From mode.
  - `src/ui/laser/start-job-readiness.ts`, `JobControls.tsx` (Frame),
    `src/ui/laser/live-job-estimate.ts`, `src/ui/workspace/draw-preview.ts`,
    `src/ui/state/file-actions.ts`: replace the hardcoded `USER_ORIGIN_JOB_PLACEMENT` with the
    selected placement; run per-origin bounds checks.
- **Test:** core test covering all 9 anchors with per-origin bounds validation (extend
  `job-origin`/`start-job-readiness` tests). UI test that selecting an anchor changes the
  emitted/previewed placement and that an anchor pushing the job off-bed is rejected.
- **Hardware-verify?** Yes (light). On the Falcon, set anchor=center and Frame a centered
  object on stock; confirm the framed rectangle is centered where expected. Hardware
  verification needed note.
- **Effort:** L (touches every output consumer).
- **Done-criteria:** the 9-point selector + Start From mode are exposed and persisted; all of
  preview/frame/start/estimate/save honor the selection; per-anchor bounds checks reject
  off-bed; hardware confirms a centered frame.

### P1-3: Raster engrave dithering offers only 3 of LightBurn's ~10 modes
- **Problem:** Engrave S-value dithering is limited to threshold / floyd-steinberg / grayscale
  (default floyd-steinberg). Jarvis, Stucki, Atkinson, Ordered (Bayer), Burkes, Sierra
  variants, Blue-noise, Random - the 13-mode set that already exists for the trace path - are
  not available for raster engraving, so engraved photos/logos diverge from LightBurn. (Note:
  do this after the Tier-0 raster HV gate, since it rides the same emit path.)
- **Evidence:** `LIGHTBURN-PARITY-AUDIT-2026-06-03` (Image/raster major); LIGHTBURN-STUDY
  8.6 #5. Live code: raster modes capped at 3 - `src/core/raster/dither.ts:29`
  (`DitherAlgorithm = 'threshold'|'floyd-steinberg'|'grayscale'`); `layer.ts:14`
  (`LayerDitherAlgorithm` same 3); UI dropdown `LayerRow.tsx:305-309` (3 options);
  `compile-job.ts:106` passes `layer.ditherAlgorithm` to `dither()`. Full 13-mode set already
  implemented for trace: `src/core/trace/dither-trace.ts:33-46` (all kernels), but it returns
  RGBA for imagetracerjs, not the Uint16 S-array the engrave path needs.
- **Plan:** Expand the raster dither catalogue to match the trace set, implemented for the
  S-value output. The trace kernels (Jarvis/Stucki/Atkinson/Burkes/Sierra/ordered/blue-noise)
  are the same coefficients; port the kernel tables into `raster/dither.ts` but keep the
  output as Uint16 S-values (do NOT make `raster/` import `trace/` - that would couple two
  core subtrees; copy the public-domain coefficient tables, as `dither-trace.ts` itself notes
  it did from LF1). Respect pure-core: the random/blue-noise modes must use a deterministic
  seeded LCG and a fixed-size cached tile (exactly as `dither-trace.ts` does) so output stays
  reproducible. Expand `LayerDitherAlgorithm`, the dispatcher `switch`, and the UI dropdown.
  Reconsider the default (the LightBurn note suggests Stucki) and record the choice in the
  ADR.
- **Empirical verification FIRST:** pick one new mode (e.g. Stucki) and a small fixed luma
  ramp (e.g. an 8x8 gradient). Compute the expected S-values by hand / from the kernel and
  confirm the ported implementation reproduces them exactly. Then run the same input through
  the trace-path Stucki and confirm the dot PATTERN matches (the values differ - S vs RGBA -
  but the on/off decisions per pixel must align). That cross-check proves the port is faithful
  before exposing all 13.
- **Fix (file-by-file):**
  - `src/core/raster/dither.ts`: expand `DitherAlgorithm` to 13; add the kernel
    implementations producing Uint16 S-values; deterministic LCG + cached tile for
    random/blue-noise; expand the dispatcher.
  - `src/core/scene/layer.ts`: expand `LayerDitherAlgorithm` to match; review the default.
  - `src/ui/layers/LayerRow.tsx`: expand the dropdown to all 13 with short descriptions.
- **Test:** `dither.test.ts`: a value test per new mode against a known small input; the
  determinism test for random/blue-noise (same input -> same output across runs);
  compile-job test that the layer's mode reaches the emit path.
- **Hardware-verify?** Yes. Engrave the same photo with floyd-steinberg vs the new
  default/Stucki and compare tonal quality on wood; confirm no artifacting and that the
  result tracks LightBurn's equivalent mode. Hardware verification needed note.
- **Effort:** L (10 new kernels + UI + determinism).
- **Done-criteria:** all 13 raster modes implemented and selectable; deterministic;
  cross-checked against the trace kernels; hardware confirms engrave quality.

### P1-4: Per-layer Min Power and grayscale Min->Max tonal floor are missing; no M4 vector toggle
- **Problem:** A Layer carries a single power value; `device.minPowerS` ($31) is read but
  never used in emission. Vector cuts always emit `M3` constant power with no speed-based
  corner scaling, and grayscale tone maps black->sMax / white->0 with no min-power floor, so
  corners over-burn and engraves lack tonal depth. There is also no way to put vector cuts on
  GRBL M4 variable mode (LightBurn's default). User-visible symptom: cut corners scorch;
  grayscale engraves crush the highlights; no dynamic-power cutting.
- **Evidence:** `LIGHTBURN-PARITY-AUDIT-2026-06-03` (Min Power / grayscale Min->Max / M3-M4
  majors); LIGHTBURN-STUDY 8.6 #3; DECISIONS ADR-020 Q1. Live code: no `minPower` on
  `Layer` (`layer.ts:16-47`, `LAYER_DEFAULTS:49-62`); `device.minPowerS` defined
  (`device-profile.ts:25`) but unused in `grbl-strategy.ts`/`emit-raster.ts`; vector cuts
  hardcoded M3 (`grbl-strategy.ts:38` preamble `M3 S0`, `219-222` cut restore `M3 S0`);
  grayscale linear with no floor (`dither.ts:78-86`, line 83 maps white to 0);
  `DitherOptions` (`dither.ts:39-48`) has no `sMin`. Raster fill already uses M4
  (`grbl-strategy.ts:214-234`) but vector cuts cannot.
- **Plan:** Three coupled but separable changes - ship them as three commits in order.
  (a) Per-layer Min Power: add `minPower` to `Layer` + defaults, thread through `compileJob`
  to both cut and raster groups, and apply it as the S-floor in emission (cut S-scaling and
  grayscale). (b) Grayscale tonal floor: add `sMin` to `DitherOptions`, change
  `ditherGrayscale` to map white->sMin (not 0) and black->sMax, fed by the layer's minPower.
  (c) M4 vector toggle: add a per-layer `vectorPowerMode: 'M3'|'M4'` (or similar), and in
  `emitJob`'s cut branch emit `M4 S<...>` instead of `M3 S0` when set. Validate edge cases
  (minPower > power, minPower=100). Record the M4-as-default decision in the ADR (LightBurn
  defaults to M4). These are emission changes - they MUST clear the Tier-0 HV gate first and
  each carries its own hardware verification.
- **Empirical verification FIRST:** (a)/(b) emit a grayscale engrave of a white-to-black ramp
  with minPower=15% and confirm the emitted S for the whitest pixels is the minPower floor,
  not 0, and the blackest is sMax. (c) emit a cut layer with `vectorPowerMode:'M4'` and
  confirm the cut block opens with `M4` and that a mixed M4-cut + M4-fill job does not emit a
  redundant mode flip. Read the actual lines.
- **Fix (file-by-file):**
  - `src/core/scene/layer.ts`: add `minPower` and `vectorPowerMode`; defaults; keep the
    `satisfies Omit<Layer,'id'|'color'>` constraint valid.
  - `src/core/job/compile-job.ts`: carry `minPower`/`vectorPowerMode` onto the compiled
    cut/raster groups.
  - `src/core/raster/dither.ts`: add `sMin`; rewrite `ditherGrayscale` to use the floor.
  - `src/core/output/grbl-strategy.ts`: apply the S-floor in cut S-scaling; honor
    `vectorPowerMode` in the cut branch of `emitJob`.
  - `src/ui/layers/LayerRow.tsx`: Min Power field and an M3/M4 toggle for line-mode layers.
- **Test:** `dither.test.ts` grayscale-with-floor value test (white maps to sMin); a
  minPower>power clamp test; `grbl-strategy` tests for an M4 cut block and the cut-after-fill
  state machine under M4. Failure-mode focused (over-burn corners and crushed highlights are
  the modes).
- **Hardware-verify?** Yes (all three). Burn: a grayscale ramp tile to confirm highlight
  detail returns with the floor; a square under M3 vs M4 cut to confirm corner over-burn is
  reduced under M4. Hardware verification needed note.
- **Effort:** L (three coupled emission changes + UI + hardware).
- **Done-criteria:** minPower floors both cut and grayscale S; grayscale maps white->sMin;
  vector cuts can run M4; edge cases clamped; hardware confirms reduced corner burn and
  restored tonal depth.

### P1-5: Raster tonal adjust (Brightness/Contrast/Gamma) does not reach the engrave path
- **Problem:** The B/C/G sliders feed only the trace path. The raster engrave compile decodes
  luma -> resample -> dither with no tonal preprocessing, and `RasterImage` has no
  brightness/contrast/gamma fields. User-visible symptom: operators cannot tune an engrave
  before dithering the way LightBurn's Adjust Image tool does; a flat photo engraves flat.
- **Evidence:** `LIGHTBURN-PARITY-AUDIT-2026-06-03` (Image/raster major); LIGHTBURN-STUDY
  8.6 line 1230. Live code: `AdjustmentControls.tsx:14-28` (B/C/G/Invert exist);
  `trace-options.ts:27-38` (`mergeAdjustments` applies them to TraceOptions only);
  `RasterImage` (`scene-object.ts:124-162`) has no B/C/G fields; `compileRasterGroup`
  (`compile-job.ts:89-123`) takes `sourceLuma` straight from `lumaBase64`, resamples, and
  dithers with no tonal step; `core/trace/index.ts:35-42` exports `adjustBrightness/
  adjustContrast/adjustGamma` but they are used only by the trace path.
- **Plan:** Add brightness/contrast/gamma to the raster engrave pipeline. Decide where the
  values live: per-RasterImage or per-Layer. The compile comment at `compile-job.ts:104-105`
  notes layer settings win over per-image; but B/C/G are properties of the specific image,
  not the cut recipe, so per-RasterImage is the more faithful home (LightBurn's Adjust Image
  is per-image). Add the fields to `RasterImage`, apply the adjustments in `compileRasterGroup`
  after luma extraction and before dither, mirroring the trace path's raster-prep functions
  (the math already exists in `core/trace`'s raster-prep; for pure-core boundary cleanliness,
  either move those adjust functions to a shared `core/raster/raster-prep` or duplicate the
  small luma transforms in `raster/` - do not have `job/` reach across into `trace/`). Expose
  the controls for image-mode layers/objects (reuse `AdjustmentControls`, currently wired only
  to the trace dialog).
- **Empirical verification FIRST:** take a fixed mid-gray luma buffer, apply gamma=2.0 (and
  separately contrast) via the chosen function, and confirm the transformed luma matches the
  expected curve before it hits the dither. Then emit the engrave S-values with and without
  the adjustment and confirm the S distribution shifts as expected (e.g. higher gamma lifts
  midtones). The shifted S-values are the proof.
- **Fix (file-by-file):**
  - `src/core/scene/scene-object.ts`: add `brightness`/`contrast`/`gamma` to `RasterImage`
    (optional with sane defaults; spread conditionally for exactOptionalPropertyTypes).
  - `src/core/raster/` (new or shared `raster-prep`): the luma adjust functions, pure.
  - `src/core/job/compile-job.ts`: apply the adjustments in `compileRasterGroup` before
    `dither()`.
  - `src/ui/...`: surface `AdjustmentControls` for the selected raster image (not just the
    trace dialog), writing back to the RasterImage.
- **Test:** `compile-job.test.ts`: raster tonal preprocessing shifts the emitted S-values as
  expected for a known input; identity (B=0,C=0,gamma=1) leaves S unchanged.
- **Hardware-verify?** Yes (light). Engrave a photo flat vs with a gamma lift and confirm
  midtone detail improves on wood. Hardware verification needed note.
- **Effort:** M.
- **Done-criteria:** B/C/G reach the engrave compile; identity is a no-op; emitted S tracks
  the adjustment; controls exposed for raster images; hardware confirms tonal control.

### P1-6: Fill-only SVG geometry (no stroke) is silently dropped on import
- **Problem:** The SVG parser skips any element whose stroke normalizes to empty, so
  logos/artwork drawn with fills and no strokes import as nothing (object == null). Now that
  Fill and Image modes exist, fill-only shapes should survive import onto a layer with a
  derived color. User-visible symptom: a very common real-world SVG (filled logo, no strokes)
  imports as an empty canvas.
- **Evidence:** `whole-repo-lightburn-parity-audit-2026-06-04` (P1 SVG fill-only);
  `karpathy-whole-repo-audit-2026-06-02` (KF-016). Live code:
  `src/io/svg/parse-svg.ts:180-181` (`const color = normalizeColor(state.stroke); if (color
  === '') return;` - fill-only dropped); `PresentationState` (121-128) tracks no `fill`; the
  intentional test `parse-svg-presentation-state.test.ts:8-17` ("skips fill-only geometry...")
  asserts `result.object === null` and passes, pinning the bug.
- **Plan:** Capture `fill` in the presentation state and use it as the color fallback when the
  stroke is empty. Add `fill` to `PresentationState` (inherit like `stroke`), and in
  `appendElementGeometry`, if the normalized stroke color is empty, fall back to the normalized
  fill color; only drop the element if BOTH are empty/none. Decide the target layer mode for
  fill-derived geometry: a filled shape should land on a layer that can fill it, but import
  currently creates line-mode layers by color - the faithful behavior is to keep the geometry
  (line-mode is acceptable for v1; the user can switch the layer to Fill). Record the choice
  in the ADR. Be careful with `fill="none"` (must still be treated as empty).
- **Empirical verification FIRST:** take the exact fixture from
  `parse-svg-presentation-state.test.ts` (a `fill="red"` rect, no stroke) and, before the fix,
  confirm `result.object === null`. After the fix, the same fixture must produce one polyline
  on a red-derived layer. Also confirm a `fill="none"` no-stroke element still produces
  nothing (no false-positive import).
- **Fix (file-by-file):**
  - `src/io/svg/parse-svg.ts`: add `fill` to `PresentationState` and `INITIAL_PRESENTATION_
    STATE`; populate it in `presentationStateFor`; in `appendElementGeometry`, use fill as the
    color fallback when stroke is empty; drop only when both are empty/none.
- **Test:** invert `parse-svg-presentation-state.test.ts:8-17` to assert the fill-only rect
  now imports onto a fill-derived color. Add a `fill="none"` no-stroke case that still imports
  nothing. Add a both-stroke-and-fill case to confirm stroke still wins (no regression).
- **Hardware-verify?** No (pure import geometry).
- **Effort:** S-M.
- **Done-criteria:** fill-only shapes import with a fill-derived color; `fill="none"` still
  drops; stroke-present shapes unchanged; the old null-expecting test is inverted and green.

### P1-7: SVG physical units (in/mm/cm) and <use>/<symbol> reuse are not handled
- **Problem:** Width/height with units are parsed via `Number.parseFloat`, dropping the unit,
  so a `4in` or `100mm` drawing imports at the wrong physical size; and `<use href>`/`<symbol>`
  definitions are never expanded, so reused symbol content (repeated logo elements) is
  missing. User-visible symptom: imported size is wrong (a 4in design comes in as 4mm), and
  SVGs that use `<symbol>`+`<use>` import with pieces missing.
- **Evidence:** `lightburn-parity-codex-verification-2026-06-03` (LF-CV-008);
  `whole-repo-lightburn-parity-audit-2026-06-04` (P1 SVG units and reuse). Live code: units -
  `src/io/svg/parse-svg.ts:102-103` (`Number.parseFloat(getAttribute('width'))`, unit
  dropped); reuse - `shape-to-polylines.ts:16-36` (`elementToSubPaths` handles only the 7
  primitives, no `use`/`symbol`), `parse-svg.ts:152-171` (`walkElement` recurses children but
  never resolves `<use href="#id">`); the sanitizer strips only EXTERNAL hrefs, leaving local
  `#id` intact (so expansion is safe to add).
- **Plan:** Two independent pieces; ship as two commits. (a) Units: at the dimension-parse
  boundary, extract the unit suffix and convert to px at the SVG-standard 96 DPI
  (in=96, mm=96/25.4, cm=96/2.54, pt, pc), falling back to the current dimensionless behavior
  if no unit is recognized. NOTE the repo convention (CLAUDE.md Style): unitless SVG dims are
  treated as mm, not px - so a unitless value keeps its current meaning; only explicitly
  unit-suffixed values get converted. Reconcile and document this in the ADR so unit handling
  is consistent with the mm-default rule. (b) Reuse: build a symbol/def registry in a first
  pass (`Map<id, Element>`), then in `walkElement` detect `<use href="#id">`, resolve to the
  referenced `<symbol>`/`<g>`, deep-clone its geometry into the use position applying the
  `<use>` x/y translate, and integrate with the existing transform-matrix accumulation. Expand
  only LOCAL `#id` (the sanitizer already strips external/data URIs). Handle nested `<use>`.
- **Empirical verification FIRST:** (a) parse `<svg width="4in" height="2in">...` and confirm
  the computed bounds are 384x192 px-equivalent (4*96 x 2*96), and that a unitless
  `width="100"` still yields the mm-convention size. (b) parse a minimal `<symbol id="s">` +
  two `<use href="#s" x=.. y=..>` and confirm two copies of the symbol geometry appear at the
  two offsets. The parsed geometry/bounds are the proof.
- **Fix (file-by-file):**
  - `src/io/svg/parse-svg.ts`: a unit-aware length parser for width/height (reconciled with
    the mm-default rule); the symbol registry pass + `<use>` resolution in `walkElement`.
  - `src/io/svg/shape-to-polylines.ts`: if needed, route `<use>`-expanded children through the
    existing primitive handlers (the expansion can be done in parse-svg by cloning, keeping
    `elementToSubPaths` unchanged).
- **Test:** `parse-svg.test.ts`: width/height with `in`/`mm`/`cm`; a unitless value keeps the
  mm convention; `<symbol>`+`<use>` produces the expected copies with offsets; nested `<use>`;
  a `<symbol>` with styling. Confirm the sanitizer still strips external `<use>`.
- **Hardware-verify?** No (pure import; physical size is verified by bounds, and the burn size
  follows from bounds which are already on the HV-covered emit path).
- **Effort:** M (units) + M (reuse).
- **Done-criteria:** unit-suffixed dims convert at 96 DPI while unitless stays mm; local
  `<use>`/`<symbol>` expand (including nested + offsets); external refs still stripped; tests
  cover each.

### P1-8: Convert to Bitmap copies source rotation/mirror that raster output then rejects
- **Problem:** `buildBitmapFromVector` copies the source vector's transform verbatim
  (including rotation/mirror), the canvas honors it (the bitmap looks right on the workspace),
  but output preflight rejects rotated/mirrored rasters as `unsupported-raster-transform`. So
  the converted bitmap previews fine yet Start/Save fail later. User-visible symptom: convert
  a rotated shape to bitmap, it looks correct, then the job refuses to start with a confusing
  error. (The same preview-vs-output divergence exists for any imported rotated raster.)
- **Evidence:** `image-trace-bitmap-deep-research-2026-06-04` (P2 Convert to Bitmap);
  `karpathy-image-to-burn-audit-2026-06-03` (F-M9). Live code:
  `src/ui/raster/vector-to-bitmap.ts:76` (`transform: o.transform` copied verbatim) - and the
  polylines are extracted WITHOUT applying the source transform (line 65) then rasterized to
  identity (line 66), so the pixels are upright but the assigned transform is rotated;
  preflight rejects at `preflight.ts:160-179` (`unsupported-raster-transform`). Tests pin both
  halves: `convert-to-bitmap.test.ts:87-99` (bitmap created with rotationDeg:30) and
  `preflight.test.ts:346-358` (rotated raster flagged).
- **Plan:** Since the rasterizer already bakes the geometry into upright pixels at identity,
  the assigned transform should NOT carry the source rotation/mirror - it should be cleared
  (the pixels already encode the shape; rotating them again would double-apply). Clear
  `rotationDeg`/`mirrorX`/`mirrorY` on the returned RasterImage's transform (keep position +
  scale so it lands where the vector was). This makes preview == output (both upright) and
  preflight passes. Alternative (bake rotation into the pixels) is wrong here because the
  rasterizer used identity bounds, so clearing is the correct match. Separately consider the
  imported-rotated-raster case: that one genuinely has rotated pixels-vs-bounds, so it is a
  different fix (out of scope for this item; note it).
- **Empirical verification FIRST:** convert a vector with rotationDeg=30 (the existing test
  fixture) and inspect the resulting RasterImage transform - confirm today it is 30 deg and
  that `runPreflight` then flags `unsupported-raster-transform`. After the fix, the transform
  must be 0 and preflight must pass, while the bitmap's on-canvas position is unchanged.
- **Fix (file-by-file):**
  - `src/ui/raster/vector-to-bitmap.ts` (`assembleBitmap`): set the returned `transform` with
    `rotationDeg:0, mirrorX:false, mirrorY:false`, preserving translate + scale.
- **Test:** update `convert-to-bitmap.test.ts:87-99` to assert the converted raster has
  identity rotation/mirror; add a preflight test that the converted (formerly rotated) raster
  no longer triggers `unsupported-raster-transform`.
- **Hardware-verify?** No (geometry/preflight correctness; the burn of an upright bitmap is
  already HV-covered).
- **Effort:** S.
- **Done-criteria:** converting a rotated/mirrored vector yields an upright bitmap with
  identity rotation/mirror at the correct position; preflight passes; tests updated.

### P1-9: No Material Test grid generator or persisted material library
- **Problem:** The app warns on uncalibrated defaults (30% / 1500 mm/min / 1 pass) but
  provides no LightBurn-style Material Test array generator and no saved material library, so
  every material/wattage/thickness/air-assist combination must be hand-calibrated. Generic
  defaults applied blindly carry a high overburn risk. User-visible symptom: a new user has no
  guided way to find good settings and may burn through or scorch on first try.
- **Evidence:** `power-controller-audit-2026-06-01` (P2);
  `power-controller-post-fix-audit-2026-06-01` (Residual Risk). Live code: only a warning
  string exists (`job-intent-warnings.ts:39`); no MaterialTest/MaterialLibrary anywhere (grep
  clean); `LAYER_DEFAULTS` constants with no preset/library binding (`layer.ts`); no preset UI
  in `LayerRow.tsx`. IMPORTANT governance note: PROJECT.md currently lists "Material library,
  cut tests, power/speed wizards" under Out of scope - so this is NOT auto-approved roadmap
  work. Per the CLAUDE.md off-roadmap rule, this needs an explicit stop-and-ask + a PROJECT.md
  revision/ADR before implementation. Listed here as the candidate scope, gated on that
  approval.
- **Plan (pending approval):** (a) A test-grid generator: a pure-core function that, given a
  power range x speed range and tile geometry, produces a Scene (labeled grid of small filled
  squares with per-cell power/speed) the user can burn and read. This composes cleanly with
  the existing Scene/compile pipeline. (b) A persisted material library: a storage-backed CRUD
  (the repo already has a pluggable storage adapter per CLAUDE.md - Filesystem/IndexedDb/
  InMemory) holding named material presets {power, speed, passes, air, dither, lpm}, with a UI
  to save the current layer as a preset and apply a preset to a layer. Keep generation in core
  (pure), persistence in the storage layer, UI in `src/ui/layers`.
- **Empirical verification FIRST:** for the generator, emit g-code for a small 3x3 test grid
  and confirm each cell's emitted power/speed matches the requested sweep value and that the
  cell labels are positioned correctly (read the coordinates). For the library, round-trip a
  preset through the storage adapter and confirm it reloads identically.
- **Fix (file-by-file, pending approval):**
  - PROJECT.md + new ADR: promote the feature into scope first.
  - new `src/core/job/material-test-grid.ts` (pure): grid -> Scene.
  - `src/core/storage/...` + a material-library module: preset CRUD via the existing adapter.
  - `src/ui/layers/...`: save-as-preset / apply-preset controls and a test-grid dialog;
    `src/ui/state/scene-mutations.ts` wiring to drop a generated grid into the scene.
- **Test:** core test that the grid Scene has the right per-cell parameters and labels;
  storage test for preset CRUD; UI test for apply-preset updating a layer.
- **Hardware-verify?** Yes (the whole point). Burn a generated grid on a real material and
  confirm the cells span the requested range and the labels are legible/aligned. Hardware
  verification needed note.
- **Effort:** L (and gated on scope approval).
- **Done-criteria:** ONLY after PROJECT.md/ADR approval: grid generator emits a correct
  parameter sweep; material library persists and applies presets; hardware confirms a usable
  test grid.

---

## TIER 3 (P2) - Robustness / footguns

### P2-1: Global keyboard shortcuts fire behind modal dialogs
- **Problem:** `useShortcuts` registers window-level keydown for file/edit/transform/view
  actions without checking whether a modal (the Trace/Import or Add Text dialog) owns focus,
  so Delete/Backspace/Ctrl+O/arrows can mutate or delete the scene while the operator believes
  the modal has input. User-visible symptom: while a dialog is open, pressing Delete quietly
  deletes scene objects behind it; arrows nudge the selection; Ctrl+O can blow away the
  project. Source revalidation prevents a bad trace COMMIT but not the destructive edit
  itself.
- **Evidence:** `image-trace-bitmap-deep-research-2026-06-04` (P2 global shortcuts);
  `whole-repo-lightburn-parity-audit-2026-06-04` (P2 modal shortcut gate). Live code: both
  keydown listeners registered unconditionally - `src/ui/app/use-shortcuts.ts:68` and `:105`;
  the only guard is `isEditableTarget` (`shortcuts.ts:73`) which blocks INPUT/TEXTAREA/
  contenteditable, NOT modals; dialog state exists but is unread by shortcuts -
  `ui-store.ts:71-74` (`imageDialog`, `textDialog`); `App.tsx:28,43-44` mounts `useShortcuts`
  and both dialogs with no coordination; tests (`shortcuts.test.ts:45-116`) cover only the
  input-focus guard.
- **Plan:** Gate the shortcut handlers on modal state. Read `imageDialog`/`textDialog` from
  `useUiStore` in `useShortcuts` (both child hooks), and return early from `onKeyDown` if
  either is non-null. Keep it defensive: a single `isModalOpen()` check at the top of each
  handler so any future dialog is covered too. (Optional later: a generic modal-stack/context
  so dialogs register focus ownership rather than the hook hardcoding the two known dialogs.)
- **Empirical verification FIRST:** in a jsdom test, set `imageDialog` to a RasterImage, then
  dispatch a Delete keydown at `window` and confirm `removeSceneObject` IS called today (the
  bug), then confirm it is NOT called after the gate is added. Repeat for an arrow key
  (nudge) and Ctrl+O.
- **Fix (file-by-file):**
  - `src/ui/app/use-shortcuts.ts`: subscribe to `imageDialog`/`textDialog`; early-return from
    both `onKeyDown` handlers when a modal is open; add the deps to the effect arrays.
- **Test:** `shortcuts.test.ts` (or a new `use-shortcuts.test.tsx`): with a dialog open,
  Delete/Backspace does not remove objects, arrows do not nudge, Ctrl+O does not open. With no
  dialog, behavior is unchanged.
- **Hardware-verify?** No (pure UI input gating).
- **Effort:** S.
- **Done-criteria:** no global shortcut mutates the scene while a modal is open; closing the
  modal restores all shortcuts; tests cover Delete/arrow/Ctrl+O behind a dialog.

---

## TIER 4 (P3) - Out of scope by current governance (record, do not build)

### P3-1: Vector tooling (shape primitives, node editing, boolean ops, weld, offset)
- **Problem (as reported):** There is no creation toolbar (rectangle/ellipse/line/polygon), no
  Edit Nodes tool, and no Boolean Union/Subtract/Intersect, Weld, or Offset Shapes. Paths are
  stored as flattened polylines, never editable as anchor nodes, so users round-trip through
  external tools for basic editing LightBurn provides inline.
- **Evidence + verdict:** `LIGHTBURN-PARITY-AUDIT-2026-06-03`;
  `lightburn-parity-codex-verification` (LF-CV-010); LIGHTBURN-STUDY 8.6. Live code confirms
  total absence (no shape-creation buttons in `Toolbar.tsx`; `SceneObject` has only 4 variants
  in `scene-object.ts:173`; no boolean/weld/offset/node-edit symbols anywhere). CRITICAL: this
  is an explicit Out-of-scope decision in PROJECT.md ("Node editing of imported paths.",
  "Boolean ops."), not an unbuilt backlog item.
- **Status:** Do NOT implement under the current contract. This belongs in Tier 4 only as a
  record that it was reviewed and is governance-blocked. To pursue it requires a PROJECT.md
  revision + a new ADR per the project's governance model (the same gate as P1-9). If/when
  approved, it is a large multi-feature effort (a separate roadmap of its own: a creation
  tool model, an editable-path representation replacing flattened polylines, and a geometry
  boolean/offset kernel) and would need its own design doc before any code.
- **Effort:** XL (and gated on a scope decision; not actionable now).
- **Done-criteria:** N/A under current scope. Action item is a stop-and-ask, not code.

---

## Housekeeping (do these alongside, low risk)

1. **Commit the untracked audit/ artifacts.** `git status` shows a batch of untracked
   evidence/findings/prompts/reports under `audit/` (e.g.
   `audit/reports/whole-repo-lightburn-parity-audit-2026-06-04.md`,
   `audit/reports/image-trace-bitmap-deep-research-2026-06-04.md`,
   `audit/findings/*.json`, `audit/prompts/*`, `audit/scripts/`). These are the source-of-
   truth for this roadmap and must be version-controlled. Commit them in a single
   `docs/chore` commit (they are docs/evidence, not code, so they do not need a test) before
   landing feature work, so the roadmap's citations resolve against tracked files.
2. **Land the wip/checkpoint-2026-06-03 branch.** Current HEAD cdc8f7c is on
   `wip/checkpoint-2026-06-03`. Once the audit artifacts are committed and the tree is clean,
   land it per the repo's branch flow so subsequent tickets branch from a clean, tracked HEAD
   (the contract wants a known clean HEAD recorded in `docs/AGENT_HANDOFF.md`). Update
   `AGENT_HANDOFF.md` with the new clean HEAD, last shipped item, and next ticket (Tier 0
   HV-1).
3. **Kill the stale dev servers.** Multiple LaserForge-2.0 vite dev servers are running and
   holding ports: node PIDs 36552, 27680, 13420 (each with a cmd.exe parent) under
   `C:\Users\Asus\LaserForge-2.0\node_modules\vite`, plus unrelated vite servers from other
   projects (`Documents\New project`, `nelis-verwey-inc-landing`) - leave those alone. Stop
   only the LaserForge-2.0 ones (e.g. `Stop-Process -Id 36552,27680,13420` after confirming
   they are the LaserForge-2.0 vite processes) so they stop holding ports and CPU. This is
   pure environment hygiene, not a commit.

---

## Sequencing (the order to actually execute, and why)

Strict tier order, lower number first, no skipping. Finish each partial before its neighbor.

1. **Housekeeping first** (commit audit artifacts, land the branch, kill stale servers). It is
   near-zero risk and it gives every later commit a clean tracked HEAD and resolvable
   citations. Do it before any code so the working tree is clean when you start.
2. **Tier 0 (Hardware verification backlog) is the gate.** HV-1 through HV-7. No new burn-path
   work starts until the already-shipped emit changes (gap-rapid, M4 fill, decode cap,
   unidirectional fill, raster row split, blank-feed) are confirmed on the Falcon A1 Pro. The
   reason is structural: P0-1/P0-2 (streaming error, pause) and the entire P1 raster cluster
   (P1-3 dithering, P1-4 min-power/M4, P1-5 tonal) ride on exactly these paths. If the
   foundation is wrong on hardware, building on it multiplies the burn risk. HV-7 (blank-feed)
   is the one Tier-0 item provable by emission alone; the rest need a real burn.
3. **Tier 1 (P0) in listed order.** P0-1 (error-stops-the-stream) is the single highest-value
   safety fix and has a misleading green test, so it comes first. P0-2 (pause darks the beam)
   is next and is gated on a hardware observation, which the Tier-0 gate already put the
   machine in front of you for. P0-3 then P0-4 share the safety-notice pattern and the same
   files - do them back to back to avoid re-touching `laser-store.ts`/`laser-line-handler.ts`
   twice. P0-5/P0-6/P0-7 are the freeze-the-UI cluster (Frame/custom-origin guard, Preview
   guard, Convert-to-Bitmap worker) - do the two cheap guard fixes (P0-5, P0-6) before the
   larger worker refactor (P0-7). P0-8 (Frame busy lifecycle) comes last in the tier and
   builds on P0-4's frame try/catch.
4. **Tier 2 (P1) in listed order.** P1-1 (layer order) and P1-2 (job-origin UI) are pure
   capability adds with no emission risk - safe to ship right after the P0 safety work. Then
   the raster-emit cluster P1-3 -> P1-4 -> P1-5 in that order: dithering modes, then
   min-power/M4 (which depends on the dither output shape being stable), then tonal adjust
   (which feeds the same dither). All three are gated behind the Tier-0 raster HV
   confirmation. P1-6 -> P1-7 are the SVG import fixes (fill-only, then units+reuse) - do
   fill-only first (smaller, higher frequency). P1-8 (convert-to-bitmap transform) is a small
   correctness fix. P1-9 (material test/library) is last in the tier and gated on a PROJECT.md
   scope decision - do the stop-and-ask before any code.
5. **Tier 3 (P2):** P2-1 (modal shortcut gate) - small, isolated, do it whenever a gap opens;
   it does not depend on anything above.
6. **Tier 4 (P3):** vector tooling - governance-blocked. No code; only a scope conversation.

Rationale summary: hardware truth gates the burn paths; safety defects outrank features;
within features, capability adds (no emission change) precede emission changes (which need
hardware), and the SVG/import fixes are independent and can interleave when a burn-path item
is blocked on hardware availability.

---

## Appendix: checked-and-already-done (verified at HEAD cdc8f7c, do not re-open)

These were claimed as open by older audits but the LIVE code shows them fixed and tested.
Listed so the next agent does not waste a cycle re-investigating.

1. **startJob early-ack race (writes first bytes before installing streamer state).** FIXED.
   `laser-store.ts:371-382` installs streamer state at line 375 BEFORE awaiting the write at
   378; `advanceStream` reads the installed state. Test "keeps an initial job ack that arrives
   before the first write resolves" (`laser-store.test.ts:134-149`) passes. (The R-H2 race was
   in resume/stop, fixed via the functional-set pattern.)
2. **Custom work origin can Start/Frame without a proven physical bed offset (WCO unknown).**
   FIXED/mitigated. `prepareStartJob` blocks with the
   CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE (`start-job-readiness.ts:49-52`) and Frame blocks
   with the same (`JobControls.tsx:255-258`). `findOriginBoundsIssue` validates physical
   bounds when WCO is known and skips safely when null. Anchoring is correct
   (`start-job-readiness.test.ts:230-250`). 18 tests pass.
3. **Stale exported g-code with long blank-feed gaps can be loaded and burned.** NOT
   APPLICABLE - external .gcode/.nc loading does not exist (no `pickFilesForOpen` accepts
   them; no "Run G-code File" action). `startJob` only consumes a freshly emitted string from
   the current scene via `prepareStartJob -> emitGcode`, which runs preflight. The blank-feed
   invariant (HV-7) guards the emitted string regardless.
4. **Same-layer separate fill objects are not aggregated (double-burn / wrong holes).** FIXED.
   `compile-job.ts:179-212` aggregates all objects on a layer via `collectFillContoursForLayer`
   into one `fillHatching` sweep (even-odd handles holes/overlaps across separate shapes).
   Tests `compile-job-fill.test.ts:93,107,121` pass (including the guardrail that different
   fill layers stay separate so intended overlaps engrave twice).
5. **Fill hatch spacing scales with object transform instead of staying physical.** FIXED.
   `compile-job-fill.test.ts:72-91` ("keeps hatch spacing physical after object scale")
   passes: a 10x10 square at scaleY=2.0 with 1.0mm spacing yields ~1.0mm physical Y-gaps.
   Contours are transformed (`appendFillPathContours` applies transform + machine coords)
   BEFORE hatching, so `hatchSpacingMm` stays physical.

Also note (already shipped, not re-opened): Autofocus has a proper busy lifecycle
(`autofocusBusy` lease + `assertAutofocusIdle` guards across motion actions) per
`karpathy-stage1c-autofocus-lifecycle-2026-06-02`; only the Frame/Jog half remains (P0-8).

---

*End of roadmap. Every code location above was read at HEAD cdc8f7c on 2026-06-04. Before
acting on any item, re-grep the live tree - line numbers drift as commits land, and the
Karpathy rule (verify empirically, read 30+ lines of context, fix only what research backs)
applies to executing this plan as much as to writing it.*
