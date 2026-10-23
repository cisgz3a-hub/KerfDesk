## ADR-666 - Correct the verified audit defects without changing Start policy (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

The owner requested fixes and regression tests for the confirmed findings in the Grok PR audit,
leaving incorrect and resolved findings alone. Verification used main `87ecb4f240deec4e2d161c3306a37f96e0588130`.
This decision amends the affected behavior below; no hardware was operated or qualified.

### Decisions

- **F-030, captured board origin:** capture, document, controller session, trusted position and
  origin versions must still own the target before an origin write and after its asynchronous
  preparation. Recheck after completion before adding the board, allowing only the origin
  version advance from this operation. Remote outline completion uses the same ownership rule.
- **F-020, autofocus:** amend ADR-400 Amendment 2. Validated numeric G38.2/G38.4 focus probes
  establish G21 and G90 through separately acknowledged setup commands before the probe. The
  documented target is an absolute work-Z position in millimetres; inherited Console/program
  G91 or G20 must not change its meaning. Setup failure or session replacement stops dispatch.
  Vendor focus macros retain their own command contract. The established modes remain active.
- **F-024, jog cancellation:** amend ADR-640. Give pending transport writes at most 250 ms and
  owed acknowledgements another 250 ms before attempting the native jog-cancel byte. A pending
  write promise does not prove the controller has not started moving. Retain the existing
  post-cancel acknowledgement ownership, eight-second settlement budget and fresh-Jog retry;
  this bounds host dispatch grace, not physical stop time or an unresponsive transport.
- **F-005, reconnect evidence:** amend ADR-398 Amendment 4. Quiet USB Idle is unknown, just as
  network Idle is: a reset may have finished before reconnection. Run/Hold can prove continued
  execution; startup-banner and alarm evidence retain their existing treatment. Unknown USB
  wording must not claim a startup banner was received when none was observed.
- **F-026, fresh box cutter settings:** use the active cutter for reliefs and new operations.
  Recalculate a known material recipe for that cutter. Without a material recipe, retain the
  machine starter values and their provenance, show the original cutter and retained values
  in Job Review, and do not automatically pin the operation back to the starter cutter.
  A cutter mismatch remains an advisory, not a new Start gate.
- **F-028, thin offset geometry:** treat rings that become collinear on the region normalization
  grid as outlines before offsetting. Preserve existing fill-rule normalization for genuinely
  filled/self-intersecting rings; do not revive contours whose fill cancels intentionally.
- **F-019, project normalization:** continue rejecting unsupported saved autofocus commands,
  but carry a removal notice through native project open and tell the operator to review the
  Auto-focus setting. Valid and empty commands produce no notice.
- **F-029, opened-program warnings:** count G28/G30 stored-position rapid return blocks in
  the lit-rapid warning, including axis-free returns. Exclude G28.1/G30.1 position setters and
  preserve inherited ordinary motion modes. Count blocks, not inferred travel legs. Run review
  remains advisory and an acknowledged warning does not refuse Start.
- **F-032, calibration captures:** allow only one picture measurement in flight per mounted
  step, including across source changes. Suppress stale results after source/bed changes or
  unmount, and release the in-flight guard after a rejected capture so later ticks may retry.

### Laser-dot limitation and repair (F-001)

Amend ADR-664's automatic-off description. The 30-second deadline is a host request and requires
both the app and its controller connection to remain responsive. It is not an autonomous firmware
cutoff. The UI states that limitation and identifies stationary exposure as capable of marking
material. After failed normal and fallback Off attempts, retain the uncertain-on latch and retry
for the exact original light/session. Do not invoke a stale timer's fallback in a replacement
session. Report failure once while keeping LASER OFF offered.

A firmware-enforced cutoff remains unresolved. A queued 30-second dwell would delay ordinary
M5/manual Off behind that dwell, and arbitrary partial handoff can omit a trailing M5. No timed
Falcon firmware command or crash-independent hardware cutoff has been qualified here. These
changes do not claim otherwise and do not silently replace the owner-approved dot behavior.

### Documentation correction and boundaries

F-006: the later grblHAL envelope/settings amendment becomes ADR-375 Amendment 4. The tool-change
Z-only amendment retains Amendment 3; only references belonging to the grblHAL amendment change.

No changes are made for refuted findings, already resolved merges, historical CI events,
intentional release policy, the unverified exact old Node binary pair, or speculative performance
claims. No merge-queue/provider settings, licensing gates or machine controls are changed.

### Verification

Focused regressions cover stale board/session/document state, origin-write readiness races,
G91/G20 autofocus entry, setup refusal, stalled jog transport, reconnect uncertainty, inherited
cutter provenance and material recomputation, submicron geometry and fill cancellation, discarded
focus notices, stored returns, overlapping/rejected/stale captures, failed laser Off retry and
replacement-session fencing. Validation is software evidence only; hardware qualification remains
separate. The final task response records the executed checks and their results.