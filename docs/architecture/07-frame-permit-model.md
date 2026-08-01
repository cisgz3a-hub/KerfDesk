# 7 — The Frame-first permit model

The single most unusual thing about this codebase, and the one rule with no exception mechanism.

## The rule

**CLAUDE.md collaboration rule 7** and **PROJECT.md non-negotiable #21**, under **ADR-228**
(`DECISIONS.md:9934`), clarified by **ADR-230/231/232**:

> A completed Frame for the exact current job — bounds signature plus origin identity — is the **sole
> ordinary Start authorization** on both laser and CNC. The Job Review dialog is the single warning
> surface the operator confirms. **Frame is the source of truth**: calculated bed bounds, configured
> no-go zones, and controller-setting policy may warn in Job Review but must **never** refuse Frame or
> Start.

A *guard* is defined expansively (CLAUDE.md rule 7): anything that blocks, refuses, gates, caps,
clamps, delays, hides, disables, rewrites, or adds confirmation before an otherwise available action.
No new guard may be created — **not for "safety", not for "defense in depth", not with tests or an ADR,
not ever.** ADR-206 (`:8785`) additionally requires explicit maintainer permission for any new guard,
and #21 says that permission should be **presumed denied**.

This is unusual enough to state plainly: the rule exists because the codebase accumulated guards faster
than it accumulated correctness. Project memory records **22 unauthorized guard PRs** as the dominant
defect class of a two-day audit (2026-07-15), and ADR-208/209 (`:8867`, `:8825`) exist purely to
*remove* previously-added obstructive policies.

## The three permitted refusals

Only these may refuse, and each is a *factual impossibility*, not a policy judgment:

| Category | Meaning | Examples in code |
|---|---|---|
| **(a) Transport precondition** | The serial channel factually cannot accept a stream | Disconnected; no status yet; Alarm/not-Idle; a job/jog/frame already running; MPG owns control (ADR-182); a line larger than the RX buffer (`streamer.ts:162`) |
| **(b) Compile integrity** | The program factually cannot be produced | Compile failure; NaN coordinates (`core/invariants/non-finite-coords.ts`); empty output |
| **(c) Handoff consistency** | The exact reviewed program must be the streamed one | Evidence epochs; attestation binding (ADR-181); resume fingerprints (ADR-118) |

Each transport precondition **must offer its fix in place** where one exists — from the earlier "blocks
must offer the fix" decision (#280). And critically: *re-labeling a policy judgment as one of these
three categories is itself a violation of the rule.*

## How the permit actually works

Source: `src/ui/state/framed-run.ts` (227 lines). The type names carry the design.

**1. A candidate is sealed before Frame motion.** `FramedRunCandidate` (`framed-run.ts:50`) holds the
immutable exact prepared input: the `preparedStart` program (G-code, warnings, tool plan, canvas plan,
metrics), the `project`, the `outputScope`, an `executionSignature`, the `frameVerification`, a
`controllerBeforeFrame` snapshot, the external environment, and `returnToWorkPosition` — the
work-coordinate point occupied while the program was prepared. Frame appends a tool-off return leg so
Start begins from that same point (`framed-run.ts:61-63`).

**2. The permit is issued only on physical completion.** `FramedRunPermit` (`framed-run.ts:100`) is
described as *"Completion-issued authorization for one exact prepared program."* It carries the
candidate, the `completedStatusSequence`, and the controller snapshot at completion.

**3. Completion is validated against two changes.** `framedRunCompletionIssue` (`framed-run.ts:148`)
returns a message — and therefore issues **no permit** — when either check fails:

- `sameControllerSetup` (line 162) compares **eleven** fields: session epoch, settings, settings
  observation, build info, build-info observation, WCO cache axes, work-origin active flag, work-origin
  source, trusted-position epoch, work-Z reference epoch, and work-Z zero evidence. Most are compared
  by **reference identity**, not value — a re-read producing an equal object still invalidates the
  permit. Deliberately strict.
- `sameReportedWorkPosition` (line 181) requires the machine to have returned to its pre-Frame work
  position within `1e-3` mm (line 220). It resolves work position from `wPos` when available, else from
  `mPos` minus the cached WCO — and returns `null`, failing the check, when a work origin is active but
  the WCO cache is missing (line 198), because the position cannot then be known.

Note the inches handling at line 195: if `controllerSettings.reportInches` is true, reported axes are
scaled by 25.4 before comparison. A unit-reporting mismatch would otherwise read as a position change.

**4. The permit is one-use.** `FramedRunStartClaim` (`framed-run.ts:108`) is *"One synchronous owner for
an exact permit crossing the final Start handoff."* ADR-230 (`:10136`) names it exact-artifact
authorization with a one-use Start permit; `framed-run-start-consumption.ts` and
`framed-run-invalidation.ts` implement claiming and invalidation.

**5. Review happens at Start, not at Frame.** ADR-237 (`:10540`): an ordinary Frame issues a
**review-pending** permit and is dialog-free; Start opens the single Job Review. The exception is a
transient camera Frame, reviewed before dispatch and carrying `FramedRunReviewEvidence` from birth
(`framed-run.ts:38-47`, `:64-66`).

The two failure messages are user-facing and show the intended tone — informative, actionable, no
scolding (`framed-run.ts:112-115`):

> "Controller or machine setup changed during Frame. No Start permit was issued; review the setup and
> Frame again."

> "The machine did not return to its pre-Frame work position. No Start permit was issued; inspect the
> machine and Frame again."

## Why this design is defensible

ADR-231 (`:10203`) and ADR-232 (`:10248`) carry the argument: **a valid Frame proves physically safe
motion and the live output contract**, and physical Frame completion is the *spatial* source of truth.
A calculated bounds check knows only the configured bed rectangle; it does not know about the clamp, the
jig, or the workpiece sitting 3 mm off where the operator thought. The Frame moves the actual head
through the actual bounding box in the actual workspace. If it completes cleanly, the motion is
physically possible — strictly stronger evidence than arithmetic on a bed dimension someone typed in.

## Where this remains uncomfortable

Stated honestly rather than defended:

1. **ADR-172 blocks CNC Start on missing work Z** (`:7593`), classified as handoff consistency,
   category (c). That classification is arguable — one could call it a policy judgment about whether
   the operator has done their setup. It is the closest thing to a surviving policy guard.
2. **Reference-identity comparison** in `sameControllerSetup` means a benign background re-read of
   settings invalidates a permit and forces a re-Frame. Safe, but it will read to operators as
   flakiness. No ADR addresses the UX cost.
3. **Frame proves geometry, not process.** A clean Frame says the head can traverse the bounding box.
   It says nothing about focus height, material thickness, whether the bit matches the tool plan, or
   whether the workpiece is secured. Job Review warnings are the only cover for all of that, and
   warnings are dismissible by design.
4. **Guard drift in the docs.** Project memory records **4 P1 guard-drift ADRs** still outstanding from
   the 2026-07-25 markdown audit — ADR text describing guards that contradict rule 7. The code is the
   authority; some ADRs have not caught up.

## Cross-reference slot — Phase 2

This is where we are most likely **ahead** of both references, and also where "ahead" is hardest to
prove. Ask:

1. **Does LightBurn have a frame-authorized start at all?** Framing exists there as a convenience. Does
   anything *require* it before Start? If not, our model is a genuine differentiator.
2. **What does LightBurn refuse?** Enumerate every refusal LightBurn actually shows — out-of-bounds, no
   device, power limits. For each, decide: would we have to add a guard to match, and does rule 7 forbid
   it? **A parity gap that rule 7 forbids closing is a legitimate permanent divergence** — record it as
   such, not as a bug.
3. **Easel's "Carve" flow.** Easel walks the user through bit/material/zeroing confirmation before
   carving. That is confirmation-before-action — a guard by our definition. Extract the *information* it
   surfaces and route it into Job Review warnings, the sanctioned surface.
4. **Bounds warnings.** Does LightBurn present out-of-bounds as refusal or warning? If refusal, note
   that we deliberately diverge under ADR-232 and say why.
5. **Position verification.** Does any competitor verify the head returned to its start after framing?
   Our `1e-3` mm check plus eleven-field controller comparison looks unusually strict; confirm whether
   that is uniqueness or over-engineering.
6. **Job Review content.** Compare our warning list against Easel's pre-carve checklist and LightBurn's
   preview stats. Missing *warnings* are safe to add; missing *blocks* are not.
