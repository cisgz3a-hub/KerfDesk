> Historical archive added 6 September 2026. The report below retains its original July baseline, findings, priorities, source claims and reported checks. Those claims were not rerun or refreshed for this publication. Original task instructions are historical context; current Frame-first and Job Review warning policy remains governing. The A-01/A-02 candidate edits remain separately pending current-main reconciliation. Preserving this report does not publish those code changes or validate its historical test results.

# KerfDesk Start authorisation and hidden-blocker audit

**Audit date:** 2026-07-26
**Repository:** `cisgz3a-hub/KerfDesk`
**Audited revision:** `261695ad2d0aa684f2fa0702747d688e3e92a964` (`origin/main` at audit start)
**Current-main refresh:** `de36b8674a8abf0c9276f5666ae34e14a3791476`; its unrelated tile-emission
refactor does not touch the audited or implemented paths.
**Change boundary:** read-only production audit; this file is the only repository change
**Hardware boundary:** no physical laser, CNC, rotary, pendant, interlock, relay, or controller was operated

## Executive verdict

The current ordinary Start path is substantially aligned with the frame-first policy. It does not
re-run controller qualification, `$30`/`$32`, bounds, no-go, camera-placement policy, CNC dialect,
tool identity, overrides, accessories, work-Z policy, or predictive size limits after a valid
completed Frame. Those findings are routed to Job Review as warnings.

Two current accidental/overbroad blockers remain:

1. **Advisory controller evidence can still prevent a successfully completed Frame from issuing a
   permit.** A same-session refresh of controller settings or build-info object/observation identity
   during the physical Frame fails `framedRunCompletionIssue`, despite the governing workflow
   explicitly allowing advisory settings/build-info observations to refresh.
2. **The exact-job retention key includes the entire device profile, including advisory-only
   metadata such as no-go zones.** Changing that metadata after a completed Frame invalidates and
   irreversibly consumes the permit even when the executable program, placement, physical bounds,
   controller session, origin, and position are unchanged.

Both were reported immediately to the coordinating task. No production gate was added, removed,
or changed during this audit.

No further current accidental ordinary-Start blocker was verified. In particular, strict controller
qualification is confined to supervised recovery, current controller policies are warning-only,
preflight refusal is limited to factual program integrity, and recovery persistence cannot
permanently strand Start behind a stale `pendingStart`.

## Classification vocabulary

Every condition in this audit is assigned one of the requested dispositions:

- **Valid safety-critical stop** — a command cannot be constructed, safely owned, sent, or proven to
  match the completed Frame.
- **Valid non-blocking advisory** — information is shown in Job Review or another warning surface,
  while the operator can proceed.
- **Accidental/overbroad block** — a policy-only or unrelated change prevents an otherwise permitted
  exact framed job.
- **Unverified hardware/controller condition** — code, tests, mocks, and protocol documentation
  cannot establish the physical fact.

## Governing contract

The current contract is unambiguous:

- `WORKFLOW.md:7-18` says the exact completed Frame is the only ordinary Start policy gate and limits
  surviving refusals to transport, compile integrity, placement compile inputs, and
  handoff/recovery consistency.
- `WORKFLOW.md:20-27` and ADR-237 place the single Job Review at Start; a plain Frame is
  dialog-free.
- `WORKFLOW.md:735-768` requires an acknowledged physical trace, exact return, and fresh final
  `Idle`, while explicitly allowing advisory settings/build-info observations to refresh.
- ADR-228 (`DECISIONS.md:9936-10010`) deleted/demoted the old Start gates and retained only
  transport, compile integrity, handoff, and placement inputs.
- ADR-230 (`DECISIONS.md:10063-10134`) introduced exact-artifact, completion-issued, one-use
  authorisation.
- ADR-232 (`DECISIONS.md:10205-10247`) removed the reintroduced bounds/no-go and `$30`/`$32`
  Frame refusals: the physical outcome is the spatial source of truth.
- ADR-237 (`DECISIONS.md:10542-10582`) moved Job Review from before Frame to Start without changing
  frame-first authority.

This audit treats those current governing sections as authority over older flow passages.

## End-to-end trace

### 1. User action and visible controls

`LaserWindow.tsx:96-103` passes connection/autofocus availability into `JobControls` and routes the
primary action to `runStartJobFlow`.

`JobControls.tsx:171-185` derives permit readiness. The primary label is:

- `Set up & Frame` without a current permit.
- `Start framed job` with a current permit.

The primary Start control is disabled only for the shared busy/connection surface
(`JobControls.tsx:227-247` and `LaserWindow.tsx:96-103`). The absence of a permit is not a dead-end
block: `start-job-flow.ts:79-94` invokes the same dialog-free Frame action and tells the operator to
press Start again after the trace.

### 2. Frame preparation

`use-frame-action.ts:50-226` owns this sequence:

1. Drain an earlier controller write.
2. Select and confirm G54 when needed.
3. Resolve the exact placement.
4. Compile the exact current program with the ordinary Frame requirement disabled because the Frame
   is being created.
5. Resolve a real motion rectangle.
6. Capture controller, project, output-scope, environment, exact signature, return position, and
   transitional `FrameVerification`.
7. Dispatch the physical Frame.

`frame-controller-readiness.ts:18-67` makes the pending-write drain, owned G54 selection, and fresh
post-selection `Idle` position hard requirements. These are transport/coordinate construction
facts, not policy.

`frame-candidate.ts:14-22` refuses only when there is no actual output rectangle to trace. It does
not apply calculated bed or no-go vetoes.

For CNC, `cnc-frame-lines.ts:28-62` requires current work-Z evidence, a current return Z, and a
driver-provided absolute safe-Z jog. It orders retract → XY perimeter/return → safe restore, and
never falls back to XY motion that could drag a bit through stock.

### 3. Physical Frame completion and permit issue

The frame operation sends tool/spindle/coolant-off motion through the controller-owned motion path.
Only final status-driven completion with an empty command queue can reach permit creation.

`framed-run.ts:148-159` runs the final completion checks:

- controller/setup identity matches;
- reported work XYZ returned to the pre-Frame position within `0.001 mm`.

Cancel, error, Alarm, disconnect, non-owned motion, MPG takeover, missing acknowledgements,
controller/session/origin/work-Z drift, or incomplete return yields no permit.

### 4. Permit retention and Job Review

`framed-run-readiness.ts:12-48` requires:

- exact execution signature;
- camera/rotary external environment;
- controller session, position, origin, trusted-position epoch, and CNC Z reference.

It deliberately calls `controllerStartPreparationStillCurrent` with
`ignoreAdvisoryControllerEvidence: true`, so settings and build-info refresh after completion do not
invalidate a permit.

`framed-run-invalidation.ts:15-49` makes invalidation one-way: once any readiness issue appears, the
permit and transitional verification are cleared so toggling state away and back cannot resurrect
old physical proof.

`start-job-flow.ts:95-114` opens the single Job Review on a current permit, keeps the permit when the
operator cancels, refuses if the permit dies during review, and claims one async Start owner.

Job Review is informational plus deliberate acknowledgement. It can delay confirmation while an
operator edit is being re-prepared, and a factual rebuild failure disables confirmation. It does
not turn controller/bounds/no-go/tool/override/accessory warnings into separate policy gates.

### 5. Compile, output, and preflight

`start-job-readiness.ts:264-338` separates executable-program facts from warnings.

The canonical blocking set in `core/preflight/blocking-codes.ts:24-31` is:

- `non-finite-coordinate`
- `empty-output`
- `relief-needs-cnc`
- `no-output-layer`
- `program-materialization-failed`

`start-job-readiness-policy.ts:62-77` routes every other preflight issue to warnings.
Predictive vector/raster size budgets are warnings (`start-job-readiness-policy.ts:36-59`); only an
actual engine failure to materialise the program blocks.

Additional factual preparation refusals are:

- unresolved placement inputs;
- invalid Print & Cut registration;
- variable-text render/evaluation failure;
- no sendable controller command;
- a line that exceeds the controller RX buffer and therefore cannot be sent.

### 6. Final handoff and wire boundary

`start-job-authorization.ts:43-89` performs the synchronous final authorisation immediately before
streamer creation:

- claimed permit identity is still current;
- current execution signature and external environment still match;
- controller session, position, origin, trusted-position epoch, and work-Z reference still match;
- advisory controller settings/build info are ignored for an ordinary framed permit.

`laser-job-actions.ts:111-165` establishes exclusive `start-arming` ownership before any job bytes.
`laser-job-actions.ts:173-207` then:

- drains earlier untracked writes;
- checks CNC Job Review attestation binding;
- refuses MPG ownership;
- sends the CNC settle dwell and obtains fresh status;
- requires live connection, no Alarm, `Idle`, and unchanged setup reservation;
- requires an empty controller-write fence;
- checks laser Job Review evidence shape;
- checks RX line length;
- reruns the final synchronous authorisation.

Only then does it consume the permit, create the streamer, and write the first batch.

The current laser evidence boundary (`laser-mode-start-evidence.ts:70-88`) checks that Job Review
covered the exact program's M7 shape and that unverified `$30`/`$32`/M7 evidence was acknowledged.
It does **not** live-refuse known or unknown `$30`, `$32`, or M7 capability. The comment and code in
`laser-job-actions.ts:279-290` confirm that those remain advisory.

### 7. Persistence and recovery

Current Start recovery persistence is best-effort:

- `start-job-execution-tracking.ts:73-142` catches staging failure and allows the job to continue
  without a recovery archive.
- `recovery-start-handoff.ts:16-17,89-123` gives `pendingStart` a 5-second owner lease, including a
  bounded future-clock-skew case, then reconciles uncertain acceptance into a recovery capsule.
- `recovery-repository.ts:338-360` promotes a stale persisted `activeRun` to an interrupted capsule
  during startup.
- A live concurrent owner, active run, or double-Start race can temporarily refuse a second Start;
  that protects handoff ownership.

Recovery paths intentionally have stricter contracts:

- Completed-job `Run again` recompiles and compares the execution signature and exact G-code
  fingerprint, opens Job Review, and uses retained Frame compatibility proof.
- Laser checkpoint/manual resume requires fresh qualification and exact fingerprint/line mapping.
- Supervised archived recovery requires matching controller family, fresh qualification, exact
  archived lineage, an exclusive claim, and recovery-specific setup.
- CNC start-from-line, legacy checkpoint resume, and pass-boundary automatic recovery remain
  refused because acknowledgement progress is not proof of physical cutter position. Generic
  same-session CNC Resume is a separate one-click live flow and is not part of ordinary Start.

These recovery constraints do not regain authority over the ordinary completion-issued permit.

## Verified current accidental blockers

### A-01 — Advisory controller evidence refresh during Frame completion refuses the permit

**Classification:** accidental/overbroad block
**Status:** verified current
**User-visible effect:** the machine can cleanly finish and return from Frame, yet KerfDesk reports
that controller or machine setup changed and requires another Frame.

#### Evidence

`framed-run.ts:162-178` requires reference identity equality for:

- `controllerSettings`
- `controllerSettingsObservation`
- `controllerBuildInfo`
- `controllerBuildInfoObservation`

Any same-session refresh that replaces one of those objects during the physical trace fails
`framedRunCompletionIssue` before the permit is created.

This conflicts with:

- `WORKFLOW.md:762-766`: advisory settings/build-info observations may refresh;
- `WORKFLOW.md:865-869`: the same rule at Start;
- ADR-232 controller-setting policy;
- `framed-run-readiness.ts:38-44` and `start-job-authorization.ts:73-78`, which intentionally ignore
  this evidence after permit creation.

`framed-run.test.ts:109-117` currently pins build-info observation drift during Frame as a refusal.
That makes this a verified behaviour rather than a theoretical reading, while also explaining why
green CI does not catch it as a regression.

#### History

The broad settings equality came from PR #291 / `a08f8416` before ADR-232's final demotion was
implemented. Build-info equality was added later by `2b62c729` (the PR #306 line), also without
applying the post-ADR-232 advisory exception at the completion boundary. PR #298 removed the
explicit Frame policy guards but did not narrow this identity comparison.

#### Boundary

Controller **session**, WCO/work origin, trusted-position epoch, work-Z reference, and actual return
position are not implicated by this finding. Those are valid spatial/handoff facts and should not be
removed without new evidence.

### A-02 — Advisory-only device metadata is part of the one-way permit retention key

**Classification:** accidental/overbroad block
**Status:** verified current
**User-visible effect:** changing advisory profile metadata after a valid completed Frame can turn
“Start framed job” back into “Set up & Frame”, forcing an otherwise identical job to Frame again.

#### Evidence

`canvas-motion-plan.ts:212-241` serialises the complete:

- scene;
- machine;
- **device profile**;
- optimisation settings;
- variables;
- output scope;
- placement;
- registration.

The complete device profile includes `noGoZones`. No-go findings are explicitly advisory under
ADR-232, and the focused current test
`use-frame-action.physical-safety.test.ts:235-262` proves an interior no-go finding can still earn a
completed Frame permit.

After Frame, `framed-run-readiness.ts:21-26` compares the current coarse retention key to the
candidate key. `framed-run-invalidation.ts:15-49` irreversibly clears the permit at the first
mismatch.

Therefore a no-go-zone enable/name/geometry edit—or another device-profile field that does not
change the already-cached executable program or its physical Frame—can silently regain blocking
authority through the coarse “exact job” key even though no-go policy cannot refuse Frame or Start
directly.

#### History

The full-project retention key predates frame-first (introduced in `6b5c6e83`, PR #163-era live
canvas work). PR #291 reused it as the exact execution signature; PR #298 removed explicit
bounds/no-go/controller policy blockers but did not split executable inputs from advisory profile
metadata.

#### Boundary

Artwork, output scope, placement, registration, variable values, optimisation, machine mode, device
geometry/emitter settings, and other fields that can change emitted bytes or the physical coordinate
contract remain valid exact-artifact identity. This finding is only about fields that are provably
non-emitting/advisory for the prepared artifact.

## Full condition classification

| Stage | Condition | Classification | Current result |
|---|---|---|---|
| UI | Disconnected controller | Valid safety-critical stop | Primary actions disabled; no transport exists. |
| UI | Autofocus active | Valid safety-critical stop | Primary actions disabled; motion ownership is exclusive. |
| UI | Existing active stream, jog, Frame, controller operation | Valid safety-critical stop | Refused as exclusive transport/motion ownership. |
| UI | No completed permit | Valid safety-critical stop | Start launches Frame; it is a workflow state, not an unrelated policy veto. |
| Prepare | No fresh status, Alarm, non-Idle | Valid safety-critical stop | Controller cannot accept the Frame/stream. |
| Prepare | Required placement origin/current position unavailable | Valid safety-critical stop | Program coordinates cannot be constructed; in-place fixes are offered. |
| Prepare | Invalid Print & Cut registration | Valid safety-critical stop | Exact transformed program cannot be constructed. |
| Prepare | Variable text cannot render/evaluate | Valid safety-critical stop | Exact program cannot be constructed. |
| Prepare | Five canonical compile-integrity codes | Valid safety-critical stop | No executable program exists. |
| Prepare | No sendable command / RX-oversized line | Valid safety-critical stop | Program cannot be streamed by this transport. |
| Preflight | Bounds, no-go, travel, power/speed, plunged travel, raster/scan policy | Valid non-blocking advisory | Included in Job Review warnings. |
| Controller policy | `$30`, `$32`, M7 support, CNC dialect, tool, Work-Z policy, overrides, accessories | Valid non-blocking advisory | Included in Job Review; no ordinary Start refusal. |
| Size policy | Large vector/raster/work estimate | Valid non-blocking advisory | Warns; only actual materialisation failure stops. |
| Frame | Earlier command has not acknowledged | Valid safety-critical stop | Bounded queue-fence refusal. |
| Frame | G54 cannot be selected/confirmed with fresh position | Valid safety-critical stop | Prepared program coordinate frame is not established. |
| Frame | Nothing has a real motion rectangle | Valid safety-critical stop | Nothing executable can be physically traced. |
| CNC Frame | Missing current Work-Z, return Z, or driver safe-Z builder | Valid safety-critical stop | Safe retract/return program cannot be constructed. |
| Frame completion | Cancel, error, Alarm, disconnect, MPG, incomplete queue | Valid safety-critical stop | No completion proof is issued. |
| Frame completion | Wrong return position | Valid safety-critical stop | Physical start point no longer matches prepared artifact. |
| Frame completion | Session, WCO/origin, trusted-position, Work-Z drift | Valid safety-critical stop | Spatial/setup identity changed. |
| Frame completion | Settings/build-info refresh only | **Accidental/overbroad block** | A-01. |
| Permit retention | Emission/placement/registration/environment change | Valid safety-critical stop | Exact physical proof no longer covers the current job. |
| Permit retention | Advisory-only device-profile metadata change | **Accidental/overbroad block** | A-02. |
| Job Review | Operator cancels | Valid non-blocking advisory | Streams nothing; permit remains. |
| Job Review | Operator edit is recompiling | Valid safety-critical stop | Confirmation waits for an exact reviewed artifact. |
| Job Review | Edit causes factual compile failure or signature mismatch | Valid safety-critical stop | Old Frame does not authorise changed/unbuildable bytes. |
| Start claim | Permit already claimed/replaced/revoked | Valid safety-critical stop | Prevents double handoff/replay. |
| Wire | Pending writes, setup reservation loss, non-Idle/Alarm/MPG | Valid safety-critical stop | Final transport ownership and liveness checks. |
| Wire | Laser evidence missing, M7 shape changed, unverified evidence not acknowledged | Valid safety-critical stop | Job Review/handoff evidence does not match exact bytes. |
| Wire | Current `$30`/`$32`/M7 capability finding | Valid non-blocking advisory | No live policy refusal in current source. |
| Persistence | Archive staging/storage failure | Valid non-blocking advisory | Start proceeds untracked and warns. |
| Persistence | Live concurrent `pendingStart`/active-run owner | Valid safety-critical stop | Prevents two Starts from owning one controller; stale state is reconciled. |
| Completed replay | Receipt/fingerprint/signature changed | Valid safety-critical stop | The deliberate repeat is no longer the completed exact job. |
| Supervised recovery | Qualification/controller family/archive lineage mismatch | Valid safety-critical stop | Recovery re-entry has a separate, stricter contract. |
| CNC automatic recovery | Start-from-line/checkpoint/pass re-entry unavailable | Unverified hardware/controller condition | Software acknowledgement is not physical cutter-position proof; refusal remains prudent. |

## Old/demoted gate re-entry check

| Former authority | Direct ordinary Frame/Start block today? | Hidden re-entry found? |
|---|---:|---|
| Absolute-home proof | No | No. Homing may inform display/coordinates, not veto ordinary Frame. |
| Camera-placement policy | No | No direct policy veto. Exact camera environment change invalidates the artifact as designed. |
| Controller qualification | No | No. Strict qualification is called by supervised recovery only. |
| `$30` / `$32` readiness | No | No direct wire refusal. Advisory object refresh can still block **during Frame completion** via A-01. |
| M7 build capability | No | No direct refusal in current source; review/handoff shape remains. |
| Bed bounds | No | No direct Frame or Start refusal. |
| No-go zones | No | They can still invalidate the permit indirectly through A-02. |
| Laser-on-travel / long blank feed / plunged travel | No | Warning-only under canonical preflight partition. |
| CNC dialect | No | Warning-only. |
| CNC Work-Z policy | No at ordinary Start | CNC Frame still requires Work-Z as a real safe-Z construction input. |
| CNC tool identity | No | Warning plus exact Job Review attestation binding. |
| Overrides/accessories | No | Warning-only; live status is refreshed for transport, not policy. |
| Predictive vector/raster budgets | No | Warning-only; actual materialisation failure remains compile integrity. |

## Runtime and test evidence

### Focused unit/integration run

Command:

```text
corepack pnpm exec vitest run \
  src/ui/state/framed-run.test.ts \
  src/ui/laser/use-frame-action.physical-safety.test.ts \
  src/ui/laser/start-job-controller-guards.test.ts \
  src/ui/laser/start-job-framed-permit-claim.test.ts \
  src/ui/laser/start-job-flow.review-at-start.test.ts \
  src/ui/state/recovery/recovery-start-handoff.test.ts \
  src/ui/laser/start-job-laser-mode-flow.test.ts \
  src/ui/laser/cnc-start-accessories.test.ts \
  src/ui/laser/cnc-start-overrides.test.ts
```

Result: **9 files passed, 78 tests passed**.

This verified:

- Frame allows known-wrong/unknown `$30`/`$32`;
- proven/unknown M7 capability remains advisory;
- out-of-bed and no-go jobs can Frame and authorise;
- settings/build refresh after permit creation is accepted;
- controller/session/manual-motion drift still revokes;
- Job Review at Start confirms and streams the exact permit;
- cancel keeps the permit;
- overrides/accessories warn without blocking;
- `pendingStart` crash, live-owner lease, clock skew, cancellation, schema migration, and Forget
  Controller cleanup reconcile correctly.

The same run also reproduced A-01 through the existing test that expects build-info drift during
Frame to refuse completion.

### Browser/runtime run

Command:

```text
corepack pnpm exec playwright test e2e/workbench.e2e.ts \
  --grep "controller positions, not acknowledgements, drive the live canvas trail"
```

Result: **1 passed**.

The isolated mocked-controller browser path:

1. connected and homed;
2. ran Frame without Job Review;
3. observed the serial Frame command;
4. observed enabled `Start framed job`;
5. opened the single Start-time Job Review;
6. confirmed;
7. observed the live run and controller-position-driven route.

This is useful runtime evidence for the happy path and UI wiring, but it is not physical hardware
qualification.

## Relevant recent history

| PR / commit | Effect relevant to this audit |
|---|---|
| #284 / `f13110e3` | Stopped ordinary controller qualification from blocking valid Starts. |
| #286 / `65e21896` | Established ADR-228 Frame-first policy. |
| #291 / `a08f8416` | Made physical completion issue an exact one-use ordinary Start permit. |
| #298 / `d463e664` | Removed remaining explicit Frame bounds/no-go/controller-setting policy blockers. |
| #314 / `af0f2f7a` | Moved the single Job Review to Start; Frame became dialog-free. |
| #329 / `d5545591` | Demoted predictive job/raster size budgets. |
| #392 / `488ef3ae` | Enabled one-click generic same-session CNC Resume; kept automatic re-entry exclusions. |
| #424 / `2ed5de23` | Centralised compile-integrity-only refusal for preflight. |
| #426 / `961d7bab` and #436 / `c26b0d20` | Kept CNC recovery preflight policy advisory. |
| #445 / `261695ad` | Audit baseline; continued compile-integrity-only refusal for tiled CNC export. |
| #446 / `de36b867` | Current main; unrelated tile-emission refactor, with no audited-path overlap. |

The two accidental blockers are survivals across this history rather than newly introduced direct
guards: A-01 spans the PR #291 snapshot model plus the later build-info addition; A-02 reuses a
pre-frame-first live-canvas retention key as permit identity.

## Error surfaces

Current refusal surfaces are generally explicit:

- preparation/compile failure: Start blocker store plus `Cannot start job` alert;
- Frame preparation/dispatch/completion: warning toast or Frame refusal alert/log;
- permit expiry: readiness status plus warning toast, then Start runs Frame;
- permit loss during review: warning toast, zero bytes;
- final wire refusal: `Could not start job` alert plus Start blocker record and laser log;
- recovery refusal: recovery-specific alert/banner;
- persistence failure: non-blocking toast after accepted Start.

A-01 currently uses the broad “Controller or machine setup changed during Frame” message, which
does not reveal that only advisory metadata refreshed. A-02 uses the broad
“artwork, output selection, placement, or registration changed” message even when the actual change
was advisory device metadata. Both messages obscure the accidental authority source.

## Hardware/controller qualification limits

The following remain **unverified hardware/controller conditions**, even with green source, unit,
simulator, and browser evidence:

- whether Frame motion is physically tool-off on each supported firmware/controller;
- actual laser beam-off latency and latched-output behaviour;
- spindle/coolant/air-relay wiring, selector switches, VFD spin-up, and M7/M8 semantics;
- door/interlock behaviour and whether firmware reports all unsafe states before `Idle`;
- actual `$30`, `$32`, status-mask, unit, WCS, homing-corner, and travel configuration;
- step loss, backlash, missed return, or controller rounding not visible in protocol status;
- whether configured CNC safe Z clears real stock, clamps, fixtures, and the installed bit;
- whether a tool-off perimeter proves adequate clearance for interior CNC travel;
- rotary mechanics, diameter/circumference calibration, and return behaviour;
- pendant/MPG or a second sender acting outside KerfDesk's observable ownership;
- safe physical CNC restart position after interruption.

Consequently, this audit does **not** certify burn quality, machine safety, physical clearance, or
automatic CNC recovery. It also does not recommend deleting any current session/origin/position,
safe-Z construction, transport, compile-integrity, exact-byte, or recovery-consistency boundary.

## Documentation drift noticed

`WORKFLOW.md:738-743` and `WORKFLOW.md:875-879` still say a proven stock-GRBL missing option `M`
refuses Frame/Start. Current source and tests instead make M7 capability advisory
(`start-job-controller-policy.ts:12-31`, `laser-job-actions.ts:279-290`). The current governing
rule-7 posture and code agree with each other; those workflow lines are stale. This is not a live
blocker, but it can mislead future audits into reintroducing one.

## Recommended action

Treat only A-01 and A-02 as verified current accidental blockers. If implementation is authorised
later:

1. Narrow Frame-completion comparison so advisory controller settings/build-info refresh cannot
   prevent permit issue, while retaining session, origin, position, Work-Z, acknowledgements, final
   `Idle`, and exact return checks.
2. Split the execution/permit signature into emission-and-placement inputs versus advisory-only
   profile metadata, with explicit regression tests for a completed permit surviving no-go metadata
   edits that do not change executable bytes or the physical Frame.
3. Keep every other safety-critical boundary listed above unless a separate source plus hardware
   qualification proves it overbroad.
4. Correct the stale M7 refusal wording in `WORKFLOW.md`.

## Authorised implementation follow-up

On 2026-07-26, the user authorised a narrow implementation of A-01 and A-02. The uncommitted
working-tree change:

- removes controller-settings/build-info object identity from the physical Frame completion
  comparison, while retaining controller session, WCO, work-origin, trusted-position, Work-Z,
  return-position, acknowledgement, settlement, and final-Idle boundaries;
- excludes only known advisory/non-execution device metadata from the completed-Frame retention key:
  profile labels/provenance/evidence, no-go zones, and estimate-only timing calibration;
- continues to include unknown future profile fields by default, plus all known compile, transport,
  placement, physical-envelope, rotary, laser, and CNC motion fields.

Focused tests prove both repaired paths. Guard tests prove controller-session/origin/position/Work-Z
drift, changed compiled power scale, changed transport RX limit, changed physical bed envelope,
compile refusal, transport refusal, recovery handoff inconsistency, and physical Frame completion
failures still stop or invalidate as designed.

Verification completed for this follow-up:

- 33 focused unit/lifecycle tests passed;
- 86 broader Start, Frame, controller, no-go advisory, recovery, and CNC tests passed;
- TypeScript, changed-file ESLint, formatting, file-size policy, and `git diff --check` passed;
- the mocked-controller browser E2E for Frame -> Start -> live controller-position trail passed;
- a fresh local browser render showed the expected Frame-first Start status and no console errors.

No physical machine was available. The hardware/controller qualification limits above remain
unchanged, and this implementation does not remove any hardware safety or recovery boundary.
