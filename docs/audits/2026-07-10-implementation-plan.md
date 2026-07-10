# KerfDesk audit remediation — implementation plan (2026-07-10)

> Turns every verified finding of severity **minor and above** from the [consolidated v2 audit](2026-07-10-consolidated-audit-v2.md) into a concrete, individually-reviewable ticket. **Planning artifact only — no product source is modified by this document.** Branch `claude/multi-sector-audit-3447b9`.

## How this plan was built

Each of the 18 audited sectors was handed to a dedicated planning agent that re-read the cited code and produced tickets against the repo's own rules. Every ticket names a root cause (with file:line actually read), a concrete approach, the files to touch, a **test-first** step for bug fixes, an ADR flag where an architectural choice or divergence is involved, an effort estimate, and dependencies. Where a finding's real fix turned out bigger or smaller than the audit's estimate once the code was read, the ticket says so.

## Working agreement (enforced per ticket, from CLAUDE.md)

- **One ticket = one concern = one PR.** No batching. A ticket that needs a refactor first is split into a `tidy` PR (no behavior change) that lands before the fix.
- **Bug fixes are test-first:** write the failing test that demonstrates the bug, then the fix that makes it pass. Both land in the same PR.
- **Pure core, module boundaries, and size caps hold.** New logic defaults to a new file; a fix that would push a file past the 250-soft/400-hard counted-line limit includes a split step.
- **G-code changes** require `Snapshot change acknowledged: <reason>` in the PR and an explicit note that the change is intended.
- **LightBurn is the reference.** Parity fixes match LightBurn; a deliberate divergence must be recorded in an ADR.
- **Docs count.** Doc-drift tickets name the exact file+section; `.md` is prettier-ignored, so preserve existing line endings (no EOL flips).

## Reading order — the two criticals gate everything

The plan is ordered by the v2 roadmap. **Phase 0** is the two confirmed criticals plus the verified machine-safety seam bugs; ship those before adding new machine-control surface. **Phase 1** is the remaining safety-adjacent and data-loss seams (update integrity, camera binding, recovery lifecycle, non-GRBL gating, device library). **Phase 2** is operator-trust, feedback, and the confirmed performance hot loops. **Phase 3** is parity decisions, doc/ADR reconciliation, test coverage, and architecture governance.

**The two Phase-0 criticals:**

- **CNC-01 (C1)** — give the CNC M0 tool-change a real application boundary: stop queue-fill, hold in a safe non-cutting state, name the bit, permit guarded jog/probe/Zero-Z, require explicit continuation. Without it the documented bit-swap flow cannot be completed and a cycle-start can cut at the wrong depth.
- **DEV-01 (C2)** — persist the machine profile app-side so `File → New` stops silently reverting to Default 400×400. Until then a new file can emit Y-mirrored G-code against the wrong bed with discarded no-go zones — and the offline save path warns nothing.

## Caveats carried from the audit

Every finding here rests on **static code reading** (plus Codex's live-UI/release-gate pass). No fix below has been perceptually or hardware-verified, and several tickets — especially camera registration, CNC tool-change, non-GRBL streaming, and the Electron updater — **must be validated on real hardware / a packaged build** before their finding is considered closed. Each such ticket flags that in its Risk line. Effort estimates are engineering-only and exclude that hardware validation.

## Ticket roll-up

Total implementation tickets: **203** across 18 epics (from 199 minor-and-above findings; the count is higher than the findings because several findings split into multiple single-concern PRs — e.g. the CNC M0 critical is a 4-PR stack, and refactor-first work is a separate `tidy` ticket). 66 tickets carry an `ADR: NEEDED` flag, clustered into 58 provisional ADRs below. Polish items sit in per-epic tables and are not counted as tickets.

| Epic | Prefix | Tickets | Roadmap phase |
|---|---|---:|---|
| CNC / Easel mode | CNC | 11 | Phase 0 |
| Device & machine profiles | DEV | 11 | Phase 0 |
| G-code generation & motion safety | GCO | 9 | Phase 0 |
| Machine control | MCH | 14 | Phase 1 |
| Non-GRBL controller stack | CTL | 10 | Phase 1 |
| Electron desktop platform | ELE | 9 | Phase 1 |
| Camera & board/registration | CAM | 9 | Phase 1 |
| Persistence, migration & recovery | PST | 11 | Phase 1 |
| Import & file I/O | IMP | 11 | Phase 2 |
| Layers & cut settings | LAY | 11 | Phase 2 |
| Preview, simulation & planning | PRV | 12 | Phase 2 |
| Canvas editing & content creation | CNV | 15 | Phase 2 |
| Trace engine & raster fidelity | TRC | 12 | Phase 2 |
| UI information architecture | UI | 12 | Phase 2 |
| Onboarding, help & docs | DOC | 9 | Phase 2 |
| Performance & robustness | PRF | 11 | Phase 2 |
| Architecture & code health | ARC | 12 | Phase 3 |
| Test & CI quality | TST | 14 | Phase 3 |

## Cross-sector duplicate tickets (implement once)

Three fixes were flagged by two sectors each — de-duplicate before scheduling:

- **UI-01 ≡ LAY-02** — keep the Cuts/Layers list visible while an object is selected. One PR.
- **TRC-11 ≡ LAY-08** — add a per-layer image-overscan setting. One PR (schema + UI).
- **PRF-09 + PST-04** — autosave: PRF-09 is the code move off synchronous localStorage; PST-04 is the WORKFLOW/ADR documentation. Distinct PRs, shared ADR.

## ADR register (provisional)

66 `ADR: NEEDED` flags across the tickets cluster into the decisions below. **Numbers are provisional** — the board stack reserved through ADR-126, so this allocates from **ADR-127**, but parallel branches may also consume numbers. **Allocate serially at each PR and verify against `DECISIONS.md` before writing** (ADR-numbering collisions are a known trap in this repo). Several tickets share one ADR; three ADRs *amend* an existing one.

| ADR | Decision | Tickets |
|---|---|---|
| 127 | Canonical `Result<T,E>` for core control-flow errors (converge the ~46 ad-hoc shapes) | ARC-01, CNV-10 |
| 128 | Size-limit soft-tier is a report-only script; public-API export-cap enforcement + camera/job/scene barrel decomposition (amends ADR-015 wording) | ARC-03, ARC-06 |
| 129 | Laser live-operation state as one discriminated union; `LiveRefs` module-mutable exception disposition (amends ADR-050) | ARC-10, ARC-12 |
| 130 | Registration-box provenance (captured-board vs jig) on the shared reserved layer; jig-panel guard semantics | CAM-04 |
| 131 | Retire the legacy CameraProfile persisted field + normalize-time drop migration | CAM-07 |
| 132 | CNC M0 sender-side tool-change pause as a new `StreamerStatus` (divergence from plain GRBL feed-hold and single-tool LightBurn) | CNC-01 |
| 133 | Through-cut profiles default tabs-off; warn rather than auto-add tabs (divergence from Easel) | CNC-06 |
| 134 | Modal text authoring in the left tool rail; on-canvas editing + system-font import deferred | CNV-01 |
| 135 | Flat (non-nested) group model accepted for v1 | CNV-15 |
| 136 | Driver-declared forced streaming mode coupled to `controllerKind` ("a Marlin-type device never char-counts") | CTL-03 |
| 137 | Ruida layer min==max power mapping vs separate Min/Max Power | CTL-04 |
| 138 | FluidNC console rejects/warns on numeric `$`-writes (reject-vs-warn) | CTL-09 |
| 139 | Device-profile lifecycle across File→New: project-embedded, preserved on New (LightBurn parity) | DEV-01 |
| 140 | App-level laser device list in localStorage (extends the CNC F-CNC13 precedent) | DEV-02 |
| 141 | Profile-apply merge policy: machine facts sourced only from the live controller snapshot | DEV-03 |
| 142 | No-go zones cover app-initiated jog/click motion (internal consistency) | DEV-04 |
| 143 | `.lbdev` import provenance: guessed schema, honest review UX, no real-file verification yet | DEV-05 |
| 144 | In-app long-form help hosting + alert→Dialog migration; Brave/WebSerial guidance single-source-of-truth | DOC-01, DOC-06 |
| 145 | Laser-side Basic/Advanced disclosure (extends ADR-111 to laser) | DOC-07 |
| 146 | Desktop auto-update integrity: out-of-band ed25519 signature over `latest.yml` (amends ADR-024 §5) | ELE-01 |
| 147 | Camera bridge trusts only the pinned production origin, refuses loopback frame-proxy targets (amends ADR-121) | ELE-02 |
| 148 | Desktop file associations + shell-launch routing without an IPC surface (path via `app://` URL param) | ELE-05 |
| 149 | Flatten curves once at import vs re-flatten at output (records the divergence + scale advisory) | GCO-03 |
| 150 | Per-layer Constant/Dynamic power override (LightBurn "Constant Power Mode" parity) | GCO-05 |
| 151 | Embedded-raster-in-SVG import policy (parity vs honest divergence) | IMP-02 |
| 152 | Unified Import command + Ctrl+I semantics (retain per-format items) | IMP-03 |
| 153 | SVG/DXF re-import: default replace-with-diff vs LightBurn add-a-copy | IMP-04 |
| 154 | Recent-projects persistence (localStorage + optional IndexedDB handle store) + re-open UX | IMP-09 |
| 155 | `.lbrn` project import in/out of scope (+ geometry/cut-settings mapping if in) | IMP-10 |
| 156 | Per-object `operationOverride` model + compile bucketing (divergence from LightBurn per-layer-only) | LAY-03 |
| 157 | Layer delete semantics: destructive-confirm vs LightBurn (no delete / orphan-to-default) | LAY-04 |
| 158 | Sub-layer (multi-operation-per-color) model | LAY-07 |
| 159 | Per-layer image-overscan schema (`.lf2`) | LAY-08 ≡ TRC-11 |
| 160 | Deferred LightBurn cut-editor features + rationale | LAY-09 |
| 161 | Opt-in capability-gated Fire/test-pulse control (default off; power clamp + Idle/no-job interlocks) | MCH-03 |
| 162 | Scene-complexity budget as a warn-not-block responsiveness guard on Start/Save + compile-dedupe | PRF-06 |
| 163 | Autosave persistence: IndexedDB primary, localStorage legacy read-fallback; slot/recovery design (Phase C) | PRF-09, PST-04 |
| 164 | Vector-preview color / shade-by-power default (F-A8 layer color vs LightBurn) | PRV-02 |
| 165 | Time-based playback default with distance-rate fallback for oversized jobs | PRV-03 |
| 166 | Persist job placement across sessions (Absolute-mode safety gate still applies on restore) | PRV-09 |
| 167 | `core/job` module split boundaries | PRV-10 |
| 168 | UI raster-preview bitmap-cache exception to ADR-050 (pruning contract) | PRV-11 |
| 169 | Checkpoint captures output scope + placement, clears on physical-idle (not last ack), overwrite confirm (amends ADR-118) | PST-02, PST-07, PST-08 |
| 170 | `PROJECT_SCHEMA_VERSION` first-bump / downgrade-protection policy | PST-09 |
| 171 | Line Art auto-Sketch promotion divergence + "manual band wins" precedence | TRC-01 |
| 172 | Inverse-transform raster sampling (closes the rotated-raster divergence) | TRC-02 |
| 173 | Raster burn-grid resampling kernel (area/bilinear default) | TRC-03 |
| 174 | Trace-time Fill `operationOverride` divergence from LightBurn (record or drop) | TRC-06 |
| 175 | Raster resolution range + streaming plan (changes the documented 5–25 floor/ceiling) | TRC-10 |
| 176 | Image-mode screen/halftone algorithms (screen angle/frequency defaults) | TRC-12 |
| 177 | G-code snapshot-ack CI gate (which globs, PR-event only) | TST-01 |
| 178 | Adopt Playwright as a smoke-level E2E layer (scope; whether it gates deploy) | TST-06 |
| 179 | Dependency audit non-blocking / scheduled, out of the PR release gate | TST-10 |
| 180 | CI split into parallel jobs; deploy gate lists all required status checks | TST-12 |
| 181 | Cuts/Layers list stays visible during selection (reverses the uncoded collapse) | UI-01 ≡ LAY-02 |
| 182 | Color palette strip placement + click semantics + default color set | UI-02 |
| 183 | Panel-visibility model + Window-menu parity (with the Stop-reachable safety rule) | UI-03 |
| 184 | Console collapsed-by-default in the machine rail | UI-08 |

**58 provisional ADRs.** That volume reflects this repo's convention of recording every LightBurn divergence and data-model change as an ADR; the maintainer may consolidate related rows (e.g. the raster ADRs 171–176) into fewer documents at implementation time.

---

# Tickets by epic (ordered by roadmap phase)

## CNC / Easel mode — implementation tickets

The one critical finding (in-app multi-bit M0 tool change) is a real L feature that
cannot land as one reviewable diff. It is planned as a **4-PR dependency stack**
(CNC-01 → CNC-04), each a single concern, all fixing that one finding. The chosen
design matches the reference senders the finding names (gSender/UGS/CNCjs): the
sender **stops feeding at the M0 boundary and does not send M0**, so GRBL drains its
buffer and settles to **Idle** (not Hold) — that is the only state in which GRBL will
accept jog / probe / G92, which is exactly what re-zeroing Z for the new bit needs.
This is deliberately NOT the "map GRBL Hold → paused" minimum; that minimum leaves the
controller in Hold where re-zero is impossible, so it does not make F-CNC14/15 real.

---

### CNC-01 · Model a sender-side tool-change pause in the GRBL streamer (core state machine)
- **Fixes:** In-app multi-bit M0 tool-change pause cannot be completed — severity critical (verified: CONFIRMED). This is PR 1/4.
- **Root cause:** `emitJob` writes a lone `M0` between bit sections (`cnc-grbl-strategy.ts:145-160`), but the pure streamer has no notion of a tool-change boundary: `step()` (`streamer.ts:155-188`) sends `M0` like any sendable line, and `StreamerStatus` (`streamer.ts:39-46`) has only `streaming`/`paused`/terminal — so an M0 never changes app state.
- **Approach:** Add a non-terminal `'tool-change'` variant to `StreamerStatus`. In `step()`, before sending, if the next queued line is a lone `M0` (or `M1`), do NOT send it: return `state` with `status:'tool-change'` and the `M0` left at queue head (nothing sent). Add `continueToolChange(state)`: when `status==='tool-change'`, drop the leading `M0` from `queued`, bump `completed` by 1 (so `completed/total` stays exact), set `status` back to a sendable state, and let the next `step()` resume from the line after `M0` (the emitter's own `M3`/`G4` spin-up follows M0, so the spindle restarts from the stream). Update `isTerminal` (unchanged — non-terminal), and make `step()` return `toSend:''` while `'tool-change'` (mirror the `paused` guard at `streamer.ts:156`). Single-tool jobs contain no `M0` → byte-identical behavior.
- **Files:** `src/core/controllers/grbl/streamer.ts` (modify); `src/core/controllers/grbl/index.ts` (modify — export `continueToolChange` if the barrel re-exports streamer fns).
- **Tests:** `src/core/controllers/grbl/streamer.test.ts` (exists) — test-first: a queue containing `M0` mid-stream stops at `'tool-change'` with `M0` unsent and nothing in `toSend`; `continueToolChange` advances past it and resumes sending the following line; a stream with no `M0` is unchanged (regression guard); `'tool-change'` is non-terminal and `step()` sends nothing while in it.
- **ADR:** NEEDED — sender-side tool-change pause (swallow M0, hold the stream so GRBL stays Idle) as a new StreamerStatus; records the deliberate divergence from a plain GRBL feed-hold and from LightBurn (single-tool).
- **Effort:** M  ·  **Depends on:** none
- **Risk:** New union variant forces `assertNever`/exhaustive-switch updates wherever `StreamerStatus` is matched (grep call sites). No G-code change. Must confirm in-flight lines before `M0` still drain via acks before the boundary is "safe" (UI gates jog on Idle, so this is handled in CNC-03, not here).

---

### CNC-02 · Thread the tool-change pause through the job-control store (Continue action, Stop stays mounted, Start stays blocked)
- **Fixes:** In-app multi-bit M0 tool-change pause — severity critical (verified: CONFIRMED). PR 2/4.
- **Root cause:** The store's `isActiveJob` (`laser-store-helpers.ts:38-40`) and `JobControls`' `jobNeedsRecovery` (`JobControls.tsx:45`) enumerate literal statuses; a new `'tool-change'` status is invisible to both, so no controls mount and there is no store action to leave the pause.
- **Approach:** Add `'tool-change'` to `isActiveJob`'s status list (`laser-store-helpers.ts:39`) so Start stays blocked (`findMachineStartIssues` via `hasActiveStreamer`, `start-job-readiness.ts:200`) and the clear-canvas guard holds. Add it to `jobNeedsRecovery` (`JobControls.tsx:45`) so Stop stays mounted. Add a `continueToolChange` store action (sibling to `resumeJob`) that calls the core `continueToolChange` on the streamer then re-arms the send loop (same path `resumeJob` uses to pump `step()`), setting the streamer state back. Do NOT reuse `resumeJob` (its `resume()` only transitions `paused`).
- **Files:** `src/ui/state/laser-store-helpers.ts` (modify); `src/ui/state/laser-store.ts` + the relevant `laser-*-actions.ts` job-action module (modify — add `continueToolChange`); `src/ui/laser/JobControls.tsx` (modify — `jobNeedsRecovery`).
- **Tests:** `src/ui/state/laser-store-helpers.test.ts` (exists) — `isActiveJob` true for `'tool-change'`; plus a store test that `continueToolChange` moves the streamer off `'tool-change'` and resumes sending.
- **ADR:** none (implements CNC-01's ADR).
- **Effort:** M  ·  **Depends on:** CNC-01
- **Risk:** `isActiveJob` is load-bearing (jog/probe/origin/canvas guards all funnel through it). Keeping `'tool-change'` inside `isActiveJob` intentionally keeps Start blocked — CNC-03 introduces the *narrower* predicate that re-permits setup motion, so land CNC-03 in the same series before shipping to users.

---

### CNC-03 · Permit jog / probe / Zero-Z while section-paused at a tool change
- **Fixes:** In-app multi-bit M0 tool-change pause — severity critical (verified: CONFIRMED). PR 3/4. This is the sub-fix that actually removes the wrong-depth-cut hazard.
- **Root cause:** Every re-zero path is gated on `isActiveJob`, which will include `'tool-change'` after CNC-02: jog (`laser-jog-actions.ts:112-120` → `jogFrameCommandBlockMessage` → `activeJobCommandBlockMessage`, `laser-store-helpers.ts:42-44,68-82`), probe (`laser-probe-actions.ts:20-21`), and `zeroZHere`/`setOriginHere` (`laser-origin-actions.ts:36-43` → `assertNoActiveJob`). So the operator still cannot touch off the new bit.
- **Approach:** Introduce a narrower predicate `isSetupBlockingJob(streamer)` = `isActiveJob(streamer) && streamer.status !== 'tool-change'`, and point `activeJobCommandBlockMessage` (and `assertNoActiveJob`) at it. Result: during `'tool-change'` the setup/jog/probe/origin gates fall through to their existing `statusReport.state === 'Idle'` checks — which correctly keep the commands blocked until GRBL has drained the last section's buffered motion and reports Idle, then release them. `isActiveJob` itself is unchanged (Start/canvas guard still blocked). Keep the change to these three gates only; do not touch the stall-watchdog or disconnect paths.
- **Files:** `src/ui/state/laser-store-helpers.ts` (modify — add predicate, retarget `activeJobCommandBlockMessage`/`assertNoActiveJob`).
- **Tests:** `src/ui/state/laser-store-helpers.test.ts` (exists) — test-first: with `streamer.status==='tool-change'` and a live Idle `statusReport`, `jogFrameCommandBlockMessage` / `activeJobCommandBlockMessage` return `null` and `assertNoActiveJob` does not throw; with `'streaming'` they still block. Add a `laser-origin-actions` / `laser-probe-actions` test that `zeroZHere` and `probe` are permitted at a tool-change pause.
- **ADR:** none.
- **Effort:** M  ·  **Depends on:** CNC-02
- **Risk:** Widening setup access during an active streamer is safety-adjacent — the guard is that the emitter already emits `M5` + park BEFORE `M0` (`cnc-grbl-strategy.ts:146-153`), so at the boundary the spindle is off and the head is parked. Verify no other consumer of `activeJobCommandBlockMessage` needs the old (tool-change-inclusive) semantics.

---

### CNC-04 · Tool-change prompt: name the bit, guide re-zero, expose Continue
- **Fixes:** In-app multi-bit M0 tool-change pause — severity critical (verified: CONFIRMED). PR 4/4.
- **Root cause:** With the state machine in place there is still no operator-facing surface: `RunningControls` (`JobRunControls.tsx:16-63`) renders Resume only when `isPaused`, and the bit name lives in a `;` comment the streamer drops (`isSendableGcodeLine`, `streamer.ts:105-108`), so the operator is never told which bit to load.
- **Approach:** In `JobControls`/`JobRunControls`, when `streamer.status==='tool-change'`, render a distinct block: "Load **{bit}**, touch off Z on the stock top and Zero Z, then Continue" with a **Continue** button wired to `continueToolChange` (Stop stays mounted from CNC-02). Source `{bit}` from a compile-time boundary manifest: have `startJob` accept an ordered `toolChangeLabels: string[]` (derived from the compiled `CncGroup.toolName`s that trigger `appendToolChange`) and pair the Nth pause with the Nth label. If the manifest is deferred, fall back to a generic "Load the next bit" — the safety gap (Continue + re-zero) is fully closed without the name; the name is the incremental nicety the finding calls out.
- **Files:** `src/ui/laser/JobRunControls.tsx` (modify — new tool-change branch); `src/ui/laser/JobControls.tsx` (modify — pass label/state); the emit/prepareOutput boundary that produces `toolChangeLabels` (modify — `io/gcode` emit path or `start-job-flow.ts`).
- **Tests:** `src/ui/laser/JobRunControls.test.tsx` (new/extend) — renders the Continue button + bit name for `status:'tool-change'` and invokes `continueToolChange`; no Continue for `'streaming'`.
- **ADR:** none.
- **Effort:** M  ·  **Depends on:** CNC-02 (CNC-03 for the copy to be truthful about re-zero)
- **Risk:** Component size cap on `JobRunControls.tsx` — if the branch pushes it past the limit, extract a `ToolChangeControls` sub-component (new file) rather than growing it. Label plumbing must not break single-tool (empty manifest) output.

---

### CNC-05 · Advise (WARN) at CNC Start when no work zero / Z-zero was ever set
- **Fixes:** No work-zero (especially Z) confirmation or advisory when starting a CNC job — severity major (verified: CONFIRMED).
- **Root cause:** `findMachineStartIssues` (`start-job-readiness.ts:198-225`) checks streamer/motion/controller-op/autofocus/alarm/Idle + the ADR-098 dialect gate only — nothing inspects work-zero, and the CNC advisory set (`machine-job-warnings.ts:21-27`) has no zero item. The emitter's contract is Z0 = stock top (`cnc-grbl-strategy.ts:11-13`); a homed machine that Starts with no work offset runs the first `G1 Z-1.5` in machine coordinates.
- **Approach:** In `prepareStartJob` (which already holds the `MachineStartSnapshot` with `workOriginActive`/`workOriginSource`, `start-job-readiness.ts:47-64,116-124`), add a CNC-only advisory to the returned `warnings` (not a block — matches ADR-111 WARN philosophy): when `machineKindOf(project.machine)==='cnc'` and `machine.workOriginActive !== true` (or `workOriginSource` is `'none'`/`'unknown'`), append "No work zero is set — Z0 must be the stock top. Jog to the stock surface and Zero Z (or probe) before running, or the cut depth will be wrong." Put the predicate in a small new pure helper so `prepareStartJob` stays under the function cap. Scope to the Start path only (Save-G-code needs no live zero).
- **Files:** `src/ui/laser/cnc-start-advisories.ts` (new — `cncWorkZeroAdvisory(project, machine)`); `src/ui/laser/start-job-readiness.ts` (modify — call it, add to `warnings`).
- **Tests:** `src/ui/laser/cnc-start-advisories.test.ts` (new) — advisory present when CNC + no active origin; absent when `workOriginActive` true; absent for laser. Extend `start-job-readiness.test.ts` to assert it flows into `prepared.warnings`.
- **ADR:** none (WARN-not-block is already the established ADR-111 stance; no new architectural choice).
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Confirm the advisory doesn't double-fire with an existing readiness warning. The finding's optional "pre-carve checklist dialog (don't-show-again)" is a separate larger UX concern — deliberately deferred; not in this ticket.

---

### CNC-06 · Warn when a profile layer cuts through the stock with no holding tabs
- **Fixes:** Default CNC layer is a full through-cut profile with tabs OFF, and nothing warns — severity major (verified: CONFIRMED).
- **Root cause:** `DEFAULT_CNC_LAYER_SETTINGS` is `profile-outside`, `depthMm 6.35`, `tabsEnabled:false` (`machine.ts:217-230`) and `DEFAULT_CNC_STOCK.thicknessMm` is also `6.35` (`machine.ts:193-198`); `compile-cnc-job.ts:54,91,312` fall back to these, so the out-of-box job frees every part with no tabs. Preflight only checks depth ≤ stock+allowance (`cnc-preflight.ts:112-120`); no through-cut-without-tabs advisory exists.
- **Approach:** Add a new pure advisory `detectCncThroughCutTabWarnings(project)` flagging each output layer where `isProfileCutType(cutType)` AND `depthMm >= stock.thicknessMm` AND `!tabsEnabled`: "Layer {id} cuts through the stock with no holding tabs — the part (and hole slugs) come free on the final pass. Enable Tabs or reduce the depth." Wire it into the CNC branch of `detectMachineJobWarnings` (`machine-job-warnings.ts:21-27`), so it surfaces on both Save-G-code and Start (connection-independent). Prefer this over flipping the default `tabsEnabled` (which would churn the G-code snapshot corpus and change every default-layer job); record the choice (warn, not auto-tab, diverging from Easel's auto-tab default) in an ADR.
- **Files:** `src/ui/laser/cnc-through-cut-tab-warnings.ts` (new); `src/ui/laser/machine-job-warnings.ts` (modify — add to the CNC array).
- **Tests:** `src/ui/laser/cnc-through-cut-tab-warnings.test.ts` (new) — warns for the out-of-box default layer (profile, depth==stock, tabs off); silent when tabs on, when depth < stock, when non-profile, and for laser.
- **ADR:** NEEDED — through-cut profiles default tabs-off; KerfDesk warns rather than auto-adding tabs (records the divergence from Easel).
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Touches the same CNC array in `machine-job-warnings.ts` as CNC-08 — independent lines, but land order may cause a trivial conflict. No snapshot churn (advisory only).

---

### CNC-07 · CNC resume must re-enter at the job's real plunge feed, not a hard-coded F300
- **Fixes:** [Codex M-03] CNC resume reconstructs plunge motion with a hard-coded F300 — severity major (verified: CONFIRMED).
- **Root cause:** `streamResumeFromRawLine` passes `plungeMmPerMin: RESUME_PLUNGE_MM_PER_MIN` (=300) into `buildResumeProgram` (`start-job-flow.ts:156,182`), and `cncResumeBody` emits the re-entry descent as `G1 Z{z} F{options.plungeMmPerMin}` (`resume-program.ts:154-156`). The modal scanner tracks the program's last `F` word (`resume-program.ts:99`) but only restores it *after* the plunge (line 157); the actual plunge feed of the last Z-down move is never reconstructed. Per-layer Plunge is a real, user-set value (`CncLayerAdvancedFields.tsx:90-100`; drives `cnc-grbl-strategy.ts:169,225,258,310`), so 300 is wrong whenever the job plunges faster/slower.
- **Approach:** In `resume-program.ts`, add `plungeMmPerMin: number | null` to `ModalState`. Recognize a plunge move with the same signature the emitter uses — a line carrying a `Z` word and an `F` word and **no** `X`/`Y` (matches `G1 Z{passZ} F{plunge}` at `cnc-grbl-strategy.ts:225`/`310`) — and record its `F` as the plunge feed. In `cncResumeBody`, emit `F{state.plungeMmPerMin ?? options.plungeMmPerMin}` so `options.plungeMmPerMin` becomes a fallback only. Keep `buildResumeProgram` pure (Result union, no throw — unchanged).
- **Files:** `src/core/controllers/grbl/resume-program.ts` (modify).
- **Tests:** `src/core/controllers/grbl/resume-program.test.ts` (exists) — test-first: a program whose last plunge before the resume line is `G1 Z-1.5 F250`, built with `options.plungeMmPerMin=300`, must emit the re-entry `G1 Z... F250` (fails today → passes after). Keep a case with no prior plunge that still falls back to the option.
- **ADR:** none (bug fix restoring intended behavior).
- **Effort:** M  ·  **Depends on:** none
- **Risk:** If any snapshot/golden test pins resume-program output, the emitted plunge feed changes when the source job's plunge ≠ 300 — note `Snapshot change acknowledged: resume re-entry now uses the job's real plunge feed` if such a snapshot exists. Laser resume path is unaffected (`laserResumeBody` emits no Z).

---

### CNC-08 · Warn (connection-independent) when a CNC layer still uses the untuned starter feeds
- **Fixes:** With no material picked, layers keep the exact defaults ADR-111 was written about (1000 mm/min, 1.5 mm/pass) — severity major → **corrected to minor** (verified: PARTIAL). Scoped to the surviving kernel the verifier identified: the only gap is that the sole existing guard (`detectCncMachineLimitWarnings`) is connection-dependent (`cnc-machine-limit-warnings.ts:18` returns `[]` when limits are null), so an offline beginner gets zero guidance.
- **Root cause:** `DEFAULT_CNC_LAYER_SETTINGS` is exactly `feed 1000 / depthPerPass 1.5 / 12000 RPM` (`machine.ts:217-230`); `DEFAULT_CNC_STOCK` has no `materialKey` so `seedLayerFromStockMaterial` no-ops (`cnc-project-material.ts:94-97`); material-derived feeds are opt-in. There is no advisory that fires without a connected controller.
- **Approach:** Add a pure `detectCncDefaultFeedWarnings(project)` flagging each output layer with **no** `materialKey` whose `feedMmPerMin === 1000` and `depthPerPassMm === 1.5` (the untouched starter values, named against constants derived from `DEFAULT_CNC_LAYER_SETTINGS`, not inline literals): "Layer {id} uses the generic starter feeds (1000 mm/min, 1.5 mm/pass). Pick a material in Material & Bit to tune them for your stock and bit." Wire into the CNC branch of `detectMachineJobWarnings`. Prefer this over the finding's alternative (default the project material to Softwood), which changes out-of-box compiled output and needs its own ADR.
- **Files:** `src/ui/laser/cnc-default-feed-warnings.ts` (new); `src/ui/laser/machine-job-warnings.ts` (modify).
- **Tests:** `src/ui/laser/cnc-default-feed-warnings.test.ts` (new) — warns for a default layer with no `materialKey`; silent once a `materialKey` is set or feeds are edited off the defaults; silent for laser.
- **ADR:** none (advisory only; recording the actual default-feeds decision would belong to the deferred "default material" alternative, not this ticket).
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Shares the CNC array in `machine-job-warnings.ts` with CNC-06 (trivial conflict only). Compare against constants, not magic numbers, so the two stay in sync if defaults change.

---

### CNC-09 · Make STL relief import discoverable: File-menu command (CNC-gated) + help topic
- **Fixes:** STL relief import is drag-and-drop only — no menu/toolbar command, no help topic — severity minor (verified: no adversarial verdict supplied; confirmed from tree — `importStlFiles` has one call site, the window drop handler `use-import-drag-drop.ts:88`, and `CommandId` has no `import-stl`).
- **Root cause:** DXF got `file.import-dxf` wired end-to-end (`command-types.ts:27`, `command-families.ts:35`, `handleImportDxf` `file-actions.ts:36-49`, `importDxf` in `use-app-commands.ts`); STL was never given a command, so the flagship relief workflow is reachable only by drag-drop.
- **Approach:** Mirror the DXF wiring, gated CNC-only like `file.open-gcode`: add `'file.import-stl'` to the `CommandId` union (`command-types.ts`) and `importStl` to `AppCommandContext`; add `handleImportStl(platform, …)` (`file-actions.ts`) that picks `.stl` via `platform.pickFilesForOpen({accept:['.stl']})`; add the `enabled('file.import-stl', 'file', 'Import STL Relief…', …)` entry to `fileCommands` (`command-families.ts`); add `'file.import-stl'` to `CNC_ONLY_COMMAND_IDS` (`machine-command-gate.ts:41`) so it hides in laser mode; add a `COMMAND_HELP['file.import-stl']` topic (`command-help-topics.ts`) naming the relief flow (import STL → set width/depth → pick roughing/finishing bits). **Binary wrinkle:** `importStlFiles` takes `File[]` and calls `file.name`/`file.arrayBuffer()` (`stl-import-action.ts:30-49`), but `FileHandle.blob` is optional and typed `() => Promise<Blob>` (`platform/types.ts:6-14`) — a `Blob` has no `.name`. So refactor `importStlFiles` to accept `{ name, bytes: ArrayBuffer }[]` (drag-drop passes `file.name`/`await file.arrayBuffer()`; the menu passes handle `name` + `await handle.blob().arrayBuffer()`), and error clearly if `handle.blob` is undefined.
- **Files:** `src/ui/commands/command-types.ts`, `src/ui/commands/command-families.ts`, `src/ui/commands/machine-command-gate.ts`, `src/ui/commands/use-app-commands.ts`, `src/ui/app/file-actions.ts`, `src/ui/app/stl-import-action.ts`, `src/ui/app/use-import-drag-drop.ts`, `src/ui/help/command-help-topics.ts` (all modify).
- **Tests:** `src/ui/commands/machine-command-gate.test.ts` (exists) — `file.import-stl` in `CNC_ONLY_COMMAND_IDS`, present in CNC, hidden in laser. `src/ui/app/stl-import-action.test.ts` (new/extend) — the refactored `{name,bytes}` signature imports a relief and the laser-mode toast still fires.
- **ADR:** none.
- **Effort:** M (S became M because of the `File`→`{name,bytes}` refactor and its two call sites) · **Depends on:** none
- **Risk:** Touching `importStlFiles`' signature changes the drag-drop call site too — keep both call sites in the same PR and re-verify the drag-drop path. Command gate has a "no gated command carries a shortcut" invariant test — do not give this a shortcut.

---

### CNC-10 · Fix WORKFLOW.md CNC drift (tool count; F-CNC14/15 promise an impossible Resume)
- **Fixes:** WORKFLOW.md drift: "8 starter tools" vs 18 in tree; F-CNC14 promises a Resume not rendered during an M0 hold — severity minor (verified: no verdict supplied; confirmed from tree).
- **Root cause:** `WORKFLOW.md:1522` says the bit selector shows "8 starter tools", but `DEFAULT_CNC_TOOLS` now lists 18 (`machine.ts:163-188`). `WORKFLOW.md:1882-1883,1899-1902` say "the streaming UI's Resume continues the job" and the operator "zeros Z (or probes), and resumes" — impossible in the current build (the critical finding).
- **Approach:** Docs-only. `WORKFLOW.md:1522`: change "(8 starter tools)" to "(starter bit library)" so it stops encoding a count. F-CNC14 step 2 / F-CNC15: rewrite to describe *actual current* behavior until CNC-01..04 land — either (a) if this ships before the stack, state plainly that in-app streaming of a multi-bit job cannot re-zero Z at the change and multi-bit jobs should be run from the exported `.nc` in a tool-change-aware sender; or (b) if it ships *with* the stack, rewrite to the new flow (stream stops at the boundary with GRBL Idle → Load bit → Zero Z → Continue). Pick (b) and cross-reference CNC-04, sequencing this doc change to land in the stack's final PR.
- **Files:** `WORKFLOW.md` (modify — F-CNC1 step 2; F-CNC14 step 2; F-CNC15 Success).
- **Tests:** docs-only, no test.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** CNC-04 (for the (b) wording to be true). Can ship standalone with (a) wording if the stack slips.
- **Risk:** CRLF/EOL trap — `.md` is prettier-ignored; preserve existing line endings (edit in place, check `git diff --stat` for phantom whole-file churn).

---

### CNC-11 · Tidy: split the CNC pass builders out of compile-cnc-job.ts (no behavior change)
- **Fixes:** compile-cnc-job.ts at 378 counted lines (soft 250, hard 400); tile-plan.ts at 275 — severity minor (verified: measured this session — `compile-cnc-job.ts` = 378, `tile-plan.ts` = 275 counted code lines).
- **Root cause:** The central compiler dispatches profile/pocket/engrave/v-carve/drill/relief plus tabs/direction/ramps in one file; it is 128 over soft and 22 under hard, so the next cut option forces an unplanned mid-diff split.
- **Approach:** Tidy-first, no behavior change: move the depth/pass builders and their geometry helpers — `contourMajorPasses`, `depthsWithTabTopPass`, `appendTabbedPasses`, `depthMajorPasses`, `passFromPolyline`, `ensureRingClosure`, `orderInnerFirst`, `containmentDepth`, `pointInPolygon` (`compile-cnc-job.ts:303-431`) — into a new `cnc-passes.ts`, exporting what `passesForLayer` needs. `compileCncJob` stays the dispatcher. Emitted G-code must be byte-identical.
- **Files:** `src/core/cnc/cnc-passes.ts` (new); `src/core/cnc/compile-cnc-job.ts` (modify — import from it).
- **Tests:** `src/core/cnc/compile-cnc-job.test.ts` (exists) must stay green unchanged; the G-code snapshot corpus must be byte-identical (this is the proof of no-behavior-change). Add direct `cnc-passes.test.ts` only if helpers become public and warrant it.
- **ADR:** none (pure refactor).
- **Effort:** M  ·  **Depends on:** none — but land BEFORE any CNC compiler feature (including anything touching CNC-01's manifest if it grows the file).
- **Risk:** Pure refactor must not change output — rely on the snapshot corpus as the guard. `tile-plan.ts` (also over soft) gets its **own separate** tidy PR before its next feature — do not batch it here (one concern per PR).

---

#### Polish (deferred, one-liners)
| finding | one-line fix | effort |
|---|---|---|
| Surfacing wizard hardcodes feed 2500 / plunge 600, no user control, no `device.maxFeed` cap (`SurfacingPanel.tsx:19-20`; `surfacing.ts:131-157` validates but never caps, unlike `compile-cnc-job.ts:433-436`) | Add editable Feed/Plunge fields (prefilled from the feeds calculator for the active bit + project material) and cap both to `device.maxFeed` in `buildSurfacingProgram`, mirroring `capFeed`. | S |

---

## Device/machine profile lifecycle & catalog data correctness — implementation tickets

### DEV-01 · Preserve the configured device profile across File → New
- **Fixes:** File → New silently resets the configured machine profile to the Default 400×400 — severity critical (verified: CONFIRMED, critical)
- **Root cause:** `projectActions.newProject` (`src/ui/state/store.ts:403-410`) spreads `...initialState()`, which seeds `project: createProject()` → `DEFAULT_DEVICE_PROFILE` (`src/core/scene/project.ts:35-44`, `src/core/devices/device-profile.ts:218`), and it explicitly carries over material library, saved libraries, layer defaults, and CNC library (`store.ts:406-409`) but never `s.project.device`. Bed/origin/zones/scan-offsets/camera revert to the 400×400 front-left default; origin drives the Y-flip (`origin-transform.ts:49-70`) and bounds preflight tests the wrong bed (`preflight.ts:330`), so offline Save-G-code produces mirrored/mis-bounded output with no warning.
- **Approach:** `createProject` already accepts a `device` arg and derives `workspace` from its bed (`project.ts:35-39`). In `newProject`, after `...initialState()`, override `project: createProject(s.project.device)` so the current machine (bed, origin, zones, scan-offsets, camera) survives New while the scene still clears to `EMPTY_SCENE`. Do NOT touch `setProject` (Open must adopt the opened .lf2's embedded device, not the previous session's). Add a device-semantics clause to WORKFLOW.md F-A13 (`WORKFLOW.md:429-434`): New preserves the current machine profile.
- **Files:** `src/ui/state/store.ts` (modify), `WORKFLOW.md` (modify F-A13)
- **Tests:** `src/ui/state/store.test.ts` (modify) — new failing case "newProject preserves the configured device profile": `replaceDeviceProfile` a custom rear-left 300×200 profile with a no-go zone, call `newProject()`, assert `s.project.device` deep-equals that profile (origin/bed/zones) and `s.project.workspace` is 300×200 — not `DEFAULT_DEVICE_PROFILE`. Sits beside the existing `newProject resets state` / `newProject clears save tracking` cases (`store.test.ts:161,317`).
- **ADR:** NEEDED — device profile lifecycle across File→New (project-embedded, preserved on New; matches LightBurn; cross-restart persistence deferred to DEV-02)
- **Effort:** S (corrected from M — the in-session fix is a one-line carry-over; the M estimate conflated it with cross-restart persistence, which is DEV-02) · **Depends on:** none. DEV-02 extends this to survive app restart / across projects.
- **Risk:** Minimal; only `store.test.ts` churn, no G-code snapshot churn. WORKFLOW.md is prettier-ignored — preserve existing CRLF/EOL (edit CRLF-safe, check `git diff --stat`).

### DEV-02 · Add an app-level laser machine list (saved machines + picker)
- **Fixes:** No app-level laser machine list — custom profiles live only inside the current project — severity major (verified: CONFIRMED, major)
- **Root cause:** The catalog is a fixed built-in array (`src/core/devices/profile-catalog.ts:211-248`); every apply writes only `project.device` via `replaceDeviceProfile`/`updateDeviceProfile` (`src/ui/state/store-actions.ts:50-82`). `duplicateProfileAsCustom` (`profile-catalog.ts:261-280`) is exported (`src/core/devices/index.ts:49`) but referenced only by its own test — no UI caller. The CNC side already has the pattern: an app-level `machineProfiles` slice in localStorage (`src/ui/state/cnc-library-persistence.ts:24-40`, `cnc-library-actions.ts:120-171`, restored on boot by `src/ui/app/use-cnc-library-persistence.ts`), never applied to the laser `DeviceProfile`.
- **Approach:** Mirror the CNC-library precedent for lasers. (new) `src/ui/state/saved-machines-persistence.ts` — localStorage key `laserforge.saved-machines.v1`, safe-parse / clear-on-corrupt, each saved machine `{ id, name, profile }`; validate the embedded profile through `deserializeMachineProfileDocument`/`validateMachineProfileShape` (`src/io/machine-profile`) so junk is rejected (this slice lives in `ui/state`, which may import `io`). (new) `src/ui/state/saved-machines-actions.ts` — add/delete/apply (apply routes through `replaceDeviceProfile`). (new) `src/ui/app/use-saved-machines-persistence.ts` mounted in `App.tsx` beside `useCncLibraryPersistence` (`App.tsx:39`). Add `currentSavedMachinesState(s)` to both `newProject` and `setProject` so the list survives New/Open (`store.ts:392-411`). Wire `duplicateProfileAsCustom` into a "Save as my machine" button in Machine Setup, and add a device picker in the Laser rail (`DeviceSetupControls.tsx`).
- **Files:** `src/ui/state/saved-machines-persistence.ts` (new), `src/ui/state/saved-machines-actions.ts` (new), `src/ui/app/use-saved-machines-persistence.ts` (new), a "Save as my machine" + picker component (new), `src/ui/state/store.ts` (modify), `src/ui/app/App.tsx` (modify)
- **Tests:** `saved-machines-persistence.test.ts` (new) — round-trip + corrupt-slot-cleared; `saved-machines-actions.test.ts` (new) — add/apply/delete + survives `newProject` (fails today).
- **ADR:** NEEDED — app-level laser device list in localStorage (extends the F-CNC13 CNC precedent to lasers)
- **Effort:** L · **Depends on:** DEV-01 (shares the device-lifecycle root; land DEV-01 first). Ties to DEV-07 (needs a WORKFLOW flow + a PROJECT.md phase entry — this is a feature, confirm it is in current scope before building).
- **Risk:** Keep each new file < 250 counted lines; `ui → io/core` boundary is legal but do not push `DeviceProfile` JSON parsing into `core` with any `io` dependency. Supersedes DEV-01's in-session carry once landed (make them consistent).

### DEV-03 · Stop the connected profile-apply from smuggling the old profile's hand-typed numbers in as machine facts
- **Fixes:** Applying a catalog/imported profile while connected silently keeps the OLD profile's machine numbers — severity major (verified: PARTIAL — mechanism confirmed; "all nine fields" is 8 always-required + optional zTravelMm)
- **Root cause:** `profileWithControllerFacts` (`src/core/devices/profile-application.ts:12-31`) spreads `machineReportedProfilePatch(args.current)` (line 19) whenever `lastSettingsReadAt !== null`, and `machineReportedProfilePatch` (`:33-50`) emits every always-defined field of the *current* full `DeviceProfile` (bedWidth/bedHeight/maxFeed/maxPowerS/minPowerS/laserModeEnabled/accel/junctionDeviation, plus optional zTravelMm). So once any `$$` read happened this session, clicking "Use xTool D1 Pro" (`MachineSetupProfiles.tsx:83-93`, card shows the catalog's `profile.bedWidth` at `:104-105`, never the merged result) or "Apply imported profile" (`MachineSetupImportExport.tsx:91-104`) keeps the current profile's hand-typed bed/feed/power for every field the controller did not positively report — reclassifying hand-typed values as machine facts.
- **Approach:** Machine facts must come only from the live snapshot, never from `current`. Drop the `machineReportedProfilePatch(args.current)` term (line 19) so the merge is `chosen profile` ← overridden only by `controllerSettings`/`detectedSettings` that the controller actually reported. The snapshots are still present in the laser store at apply time, so real machine facts survive; unreported fields fall back to the chosen profile's own values (correct). Keep `framingFeedMmPerMin`/`controllerKind` handling as-is. (Optional follow-up, separate PR: render the effective post-merge bed/S in the card before applying.)
- **Files:** `src/core/devices/profile-application.ts` (modify)
- **Tests:** `src/core/devices/profile-application.test.ts` (new — none exists) — pin the provenance tier order controller > chosen profile > nothing: with `lastSettingsReadAt` set, a controller snapshot reporting only `$130` (bedWidth), assert the applied profile takes bedWidth from the controller but takes maxPowerS/maxFeed from the *chosen* profile (not from `current`). Add a regression case: `current` bed 200×200, chosen 430×390, controller reported nothing → applied bed is 430×390 (fails today, returns 200×200).
- **ADR:** NEEDED — profile-apply merge policy (machine facts sourced only from the live controller snapshot)
- **Effort:** S · **Depends on:** none
- **Risk:** Pure-core change; behavior shifts at runtime for connected applies but no fixture uses `profileWithControllerFacts`, so no G-code snapshot churn. Edge: if the snapshot is cleared while `lastSettingsReadAt` stays set, previously-merged facts are dropped — that is the honest outcome (do not claim unreported facts).

### DEV-04 · Enforce safety zones on jog and click-to-position motion
- **Fixes:** Safety zones are not enforced on jog or click-to-position motion — severity major (verified: CONFIRMED, major)
- **Root cause:** No-go zones gate Start (`preflight.ts:147-176`), Frame (`frame-preflight.ts:59-61`), export, and resume, but jog is zone- and bounds-blind end to end: `jogActions.jog` (`src/ui/state/laser-jog-actions.ts:56-69`) gates only on `assertAutofocusIdle` + `assertJogFrameReady`; `jogFrameCommandBlockMessage` (`laser-store-helpers.ts:68-82`) checks only active-job/motion-op/controller-op/Idle; `buildJogCommand` (`core/controllers/grbl/commands.ts:100-122`) checks only finiteness/axis. `dispatchPositionLaser` / `positionLaserTarget` (`src/ui/workspace/position-laser-click.ts:32-59`) clamp to the bed but ignore zones — one click can drive the head through a clamp keep-out at up to 3000 mm/min.
- **Approach:** Add a pure segment-vs-zone check in core and call it at the single choke point. (new/extend) export from `src/core/preflight/no-go-zones.ts` a `firstZoneCrossedBySegment(from: Vec2, to: Vec2, zones): NoGoZone | null` reusing the existing `segmentIntersectsRect`/`rectForZone` helpers (currently private). In `jog` (`laser-jog-actions.ts`), after `assertJogFrameReady`, resolve the target: absolute jogs (`relative: false`, incl. `jogToMachinePosition` and click-to-position) have a known target; relative jogs compute `target = inferCurrentMachinePosition() + {dx,dy}` when a live position exists. If `from→target` crosses an enabled zone, refuse exactly like `assertJogFrameReady` (set `lastWriteError` + log, throw) with the zone name; skip the check only when position is unknown for a relative jog. All three UI paths funnel through `jog`, so this covers jog-pad, jog-to-point, and click-to-position. Document the still-uncovered paths (relative jogs with no known position, homing) in the MachineSetupSafetyZones panel copy (`MachineSetupSafetyZones.tsx`).
- **Files:** `src/core/preflight/no-go-zones.ts` (modify — export the segment check), `src/ui/state/laser-jog-actions.ts` (modify), `src/ui/laser/MachineSetupSafetyZones.tsx` (modify — coverage copy)
- **Tests:** `src/ui/state/laser-jog-actions.zone-guard.test.ts` (new, following `laser-store-jog-to-point.test.ts`) — an absolute jog whose target enters an enabled zone is refused and no `safeWrite` fires; a jog that avoids zones proceeds. Plus a core case in `no-go-zones.test.ts` for `firstZoneCrossedBySegment`.
- **ADR:** NEEDED — no-go zones cover app-initiated jog/click motion (internal-consistency, LightBurn has no equivalent)
- **Effort:** M · **Depends on:** none
- **Risk:** Must not block legitimate relative jogs when position is unknown (skip, don't throw). No G-code snapshot churn. Keep the core helper pure (no throw for control flow — return the zone or null).

### DEV-05 · Make the .lbdev importer honest: import max-feed, disclose every unmapped field, record provenance
- **Fixes:** LightBurn .lbdev importer is built against a guessed schema with no real-file evidence — severity major (verified: CONFIRMED, major)
- **Root cause:** `parseLightBurnDevice` fishes tag aliases (`src/io/lightburn/lbdev-import.ts:71-98`) via regex `extractFirst` (`:226-234`); `mapOrigin` is text-only (`:244-253`) so a numeric origin index lands in needs-review; `lightBurnProfile` (`:102-127`) spreads `DEFAULT_DEVICE_PROFILE` and never imports `maxFeed`; the only fixture is a synthetic `<LightBurnDevice>` (`lbdev-import.test.ts:4-16`); RESEARCH_LOG.md / DECISIONS.md / WORKFLOW.md contain zero `lbdev` mentions.
- **Approach:** Split into code-now and provenance. Code (doable without real files): import `maxFeed` when present (add speed aliases e.g. `MaxSpeed`/`MaxRate`/`XSpeed` → `maxFeed` in `parseLightBurnDevice` + `lightBurnProfile`), and extend `ignoredLightBurnFields` (`:193-206`) to explicitly list every source field we do NOT map (max feed if absent, min S, baud, transfer mode) so the review card discloses the gaps, not just start/end scripts. Provenance: add a RESEARCH_LOG.md entry stating the .lbdev schema is currently GUESSED (no real-file corpus), listing the aliases fished for and the numeric-origin-index unknown; record the honest-review-UX-over-unverified-schema decision in an ADR. State plainly in the ticket/PR that import fidelity is NOT verified against genuine LightBurn `Export Devices` output — obtaining that corpus is the real close-out and is blocked on external files.
- **Files:** `src/io/lightburn/lbdev-import.ts` (modify), `src/io/lightburn/lbdev-import.test.ts` (modify), `RESEARCH_LOG.md` (modify), `DECISIONS.md` (ADR)
- **Tests:** `lbdev-import.test.ts` (modify) — assert `maxFeed` is imported when a `<MaxSpeed>` tag is present; assert the Ignored list names baud/transfer/min-S when absent. Keep the fixture clearly labeled synthetic; do not assert real-file fidelity.
- **ADR:** NEEDED — .lbdev import provenance (guessed schema, honest review UX, no real-file verification yet)
- **Effort:** M · **Depends on:** none (loosely related to DEV-12 polish, which adds controllerKind mapping)
- **Risk:** Alias correctness is unverifiable without real exports — the PR must not claim fidelity. No G-code snapshot churn. RESEARCH_LOG/DECISIONS EOL: check `git diff --stat`, preserve line endings.

### DEV-06 · Cross-check laser job bed/feed against the live controller's reported travel (parity with CNC)
- **Fixes:** Laser jobs never cross-check bounds/feed against the live controller's reported travel — CNC does — severity major (verified: CONFIRMED, major)
- **Root cause:** `parse-settings` folds `$110/$111` → `maxFeed` and `$130/$131` → `bedWidth/bedHeight` into the `ControllerSettingsSnapshot` the laser store holds (`src/core/controllers/grbl/parse-settings.ts:124-136,141-159`). `detectCncMachineLimitWarnings` uses that snapshot for stock-vs-travel and feed-vs-max advisories but returns `[]` unless `machine.kind === 'cnc'` (`src/ui/laser/cnc-machine-limit-warnings.ts:18`). `detectMachineJobWarnings` routes non-CNC projects to `detectJobIntentWarnings(project)`, discarding the `controllerSettings` argument (`src/ui/laser/machine-job-warnings.ts:21-27`); `job-intent-warnings.ts` never reads it. Laser readiness checks only `$30/$31/$32` (`controller-readiness.ts:151-208`) and bounds preflight tests the profile bed alone (`preflight.ts:330-343`), so a stale/mistyped profile bed larger than real travel passes every gate (the `frame-preflight.ts:4-10` soft-limits-off failure mode).
- **Approach:** Add a laser sibling to the CNC advisory. (new) `src/ui/laser/laser-machine-limit-warnings.ts` — `detectLaserMachineLimitWarnings(project, limits)` that warns when `project.device.bedWidth/Height` exceeds the controller-reported `$130/$131` (beyond a small tolerance), and when the fastest output-layer speed exceeds reported `$110/$111` maxFeed; reuse the message shape of `cnc-machine-limit-warnings.ts:22-46`. Wire it into the laser branch of `detectMachineJobWarnings` (`machine-job-warnings.ts:27`) so both call sites (Save G-code `file-actions.ts:175`, Start `start-job-readiness.ts:121`) get it — they already pass `controllerSettings`.
- **Files:** `src/ui/laser/laser-machine-limit-warnings.ts` (new), `src/ui/laser/machine-job-warnings.ts` (modify)
- **Tests:** `src/ui/laser/laser-machine-limit-warnings.test.ts` (new) — profile bed 500×500 with controller `$130/$131 = 400` → warns; profile bed within travel → no warning; layer speed above reported maxFeed → warns. (Advisory-only, no gate.)
- **ADR:** none (extends an existing advisory; no new default or divergence)
- **Effort:** S · **Depends on:** none
- **Risk:** Advisory strings only — no G-code snapshot churn. Choose a sensible tolerance constant (named) so a profile within float-noise of travel doesn't nag.

### DEV-07 · Fix WORKFLOW.md F-A12 orphan-profile drift and add the missing Machine Setup flows
- **Fixes:** WORKFLOW.md drift: F-A12's orphan-profile warning does not exist, and the whole Machine Setup surface has no flows — severity major (verified: CONFIRMED, corrected to minor)
- **Root cause:** WORKFLOW.md:425 promises a status-bar warning "Project's device profile (…) is not configured locally. Add it in Settings." but `grep 'configured locally'` across `src` = 0 matches; the open path (`deserialize-project.ts:210-240` `normalizeDevice`) adopts the embedded device silently. The seven-tab Machine Setup dialog (`MachineSetupDialog.tsx:19-47`: Overview, Profile Catalog, Controller Settings, Firmware Writes, Safety Zones, Raster Diagnostics, Import/Export) ships with no WORKFLOW flows — only F-C7 (wizard, `WORKFLOW.md:815`) exists.
- **Approach:** Docs-only. F-A12 (`WORKFLOW.md:423-425`): the promised warning depends on a local machine list that does not exist yet, so amend F-A12 to describe actual behavior (loads the embedded device silently) and add a forward-reference to the saved-machines list (DEV-02); alternatively, if DEV-02 lands first, spec the real orphan warning (loaded `profileId` absent from catalog + saved machines). Add Machine Setup flows (a new F-B block) for Profile Catalog apply, profile Import/Export (.lfmachine.json + .lbdev), and Safety Zones editing, each with success/error/empty/edge — documenting the corrected behaviors from DEV-03 (apply merge) and DEV-04 (zone coverage).
- **Files:** `WORKFLOW.md` (modify F-A12 + add Machine Setup flows)
- **Tests:** docs-only, no test
- **ADR:** none
- **Effort:** M (docs volume) · **Depends on:** DEV-02 (if implementing the warning rather than amending); document behavior consistent with DEV-03/DEV-04
- **Risk:** WORKFLOW.md is prettier-ignored — preserve CRLF/EOL, verify via `git diff --stat`. Do not spec behavior the code doesn't have (the exact drift being fixed).

### DEV-08 · Round-trip baudRate + camera calibration/alignment through .lfmachine.json
- **Fixes:** .lfmachine.json export/import silently drops baudRate, cameraCalibration, and cameraAlignment — severity minor (verified: null — no adversarial pass; reproduced directly from code)
- **Root cause:** `canonicalProfile` (`src/io/machine-profile/machine-profile-io.ts:235-260`) enumerates the fields it serializes and omits `baudRate`, `cameraCalibration`, `cameraAlignment` — all three real optional `DeviceProfile` fields (`device-profile.ts:129,162,165`) that .lf2 `normalizeDevice` round-trips (`deserialize-project.ts:231-232,251-254`). The workflow round-trip test asserts only `profileId` (`machine-profile-catalog-workflow.test.ts:42`), so the loss is invisible.
- **Approach:** Add the three fields to `canonicalProfile` conditionally (same shape as `canonicalZMetadata`, `:289-296`): `baudRate` when positive-finite; `cameraCalibration`/`cameraAlignment` normalized via `normalizeCameraCalibration`/`normalizeCameraAlignment` (already exported from `src/core/camera/index.ts`; io→core is legal). Add matching validation in `machine-profile-shape.ts` (`validateProfileOptionalZ`-style: baudRate positive; camera fields via the camera validators) and normalize them in `parseProfile` (`machine-profile-io.ts:155-162`). Strengthen the round-trip test to deep-equal the canonical profile.
- **Files:** `src/io/machine-profile/machine-profile-io.ts` (modify), `src/io/machine-profile/machine-profile-shape.ts` (modify), round-trip test in `machine-profile-catalog-workflow.test.ts` or a new `machine-profile-io.test.ts` (modify/new)
- **Tests:** new failing case — serialize a profile with `baudRate: 250000` and a `cameraAlignment`, deserialize, assert both survive (dropped today); deep-equal the canonical profile so future field additions can't silently regress.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** Confirm the camera normalizers accept the profile's stored shape (they back `deserialize-project`). No G-code snapshot churn. Keep `machine-profile-io.ts` under the 400-line cap (currently ~330).

### DEV-09 · Delete the orphaned SafetyZonesPanel and de-duplicate the profile card / slugify helpers (tidy)
- **Fixes:** Orphaned duplicate Safety Zones editor plus copy-pasted catalog cards and slugify helpers — severity minor (verified: null; reproduced directly from code)
- **Root cause:** Two components export `SafetyZonesPanel`: `src/ui/laser/SafetyZonesPanel.tsx:6` (imported only by its own `SafetyZonesPanel.test.tsx`) vs `src/ui/laser/MachineSetupSafetyZones.tsx:15` (the live one, imported by `MachineSetupDialog.tsx:8`), diverged (default zone 10 mm vs 20 mm, W/H min-clamp only in the live one, differing copy). The catalog card is duplicated near line-for-line: `MachineSetupProfiles.CatalogCard` (`:69-126`) vs `DeviceSetupIdentifyStep.PresetCard` (`:44-88`), including a copy of `suggestionConfidenceLabel`. `slugify` exists twice: `MachineSetupImportExport.tsx:214-221` (fallback `'machine-profile'`) and `lbdev-import.ts:264-270` (fallback `'device'`).
- **Approach:** Three independent tidy PRs (no behavior change, per CLAUDE.md tidy-first / one-concern): (09a) delete `SafetyZonesPanel.tsx` + `SafetyZonesPanel.test.tsx` (dead code — confirm no importer via grep first; live editor is `MachineSetupSafetyZones`). (09b) extract a shared `ProfileCard` component + the confidence-label helper, consumed by both `CatalogCard` and `PresetCard`. (09c) extract one `slugify` util into a shared module, parametrizing the fallback string (`'machine-profile'` vs `'device'`) so behavior is preserved exactly.
- **Files:** (09a) delete `src/ui/laser/SafetyZonesPanel.tsx` + `SafetyZonesPanel.test.tsx`; (09b) new `src/ui/laser/ProfileCard.tsx` + modify `MachineSetupProfiles.tsx` / `device-setup/DeviceSetupIdentifyStep.tsx`; (09c) new slugify util + modify `MachineSetupImportExport.tsx` / `lbdev-import.ts`
- **Tests:** pure refactor — existing suites must stay green; 09a removes a dead test; no new test required (CLAUDE.md pure-refactor exception).
- **ADR:** none
- **Effort:** S · **Depends on:** none (do 09a/09b/09c as separate PRs; keep each single-concern)
- **Risk:** 09c must preserve each caller's fallback default (that difference is behavior). 09b spans two features — verify identical render. Confirm the orphan is truly unimported before deletion.

### DEV-10 · Record catalog machine numbers in RESEARCH_LOG.md
- **Fixes:** Catalog machine numbers have no RESEARCH_LOG provenance entries — severity minor (verified: null; reproduced directly from code)
- **Root cause:** Brand starters bake externally-sourced, safety-relevant numbers with only in-code notes: xTool D1 Pro 430×390 (`profile-catalog.ts:47-56`), Sculpfun S30 410×400 (`:66-76`), Ortur LM3 400×400 (`:87-96`), Falcon maxFeed 10000 (`falcon-profiles.ts:11-12`). RESEARCH_LOG.md has zero entries for any machine. Note: PROJECT.md:288's literal rule scopes RESEARCH_LOG to *third-party dependencies*; this ticket extends that ledger to external spec claims — a provenance improvement, not a CI-enforced violation.
- **Approach:** Docs-only. Add one RESEARCH_LOG.md entry per catalog machine: vendor spec URL / manual, retrieved date, the chosen number and rationale (e.g., xTool 430×390 vs the code comment's "lists up to 432×406"; Sculpfun Pro/Max variance; Falcon maxFeed 10000). Document that the numbers remain public-spec starters confirmed from `$$` on connect, not hardware-verified here.
- **Files:** `RESEARCH_LOG.md` (modify)
- **Tests:** docs-only, no test
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** Entries document provenance, not correctness. Preserve RESEARCH_LOG.md EOL (check `git diff --stat`).

### DEV-11 · Split the core/devices index public surface below the export cap (tidy)
- **Fixes:** core/devices index exports ~35 values — far over the module public-API cap — severity minor (verified: null; reproduced directly from code)
- **Root cause:** `src/core/devices/index.ts:1-85` re-exports ~35 value bindings (plus ~25 types) across five concerns, including `../grbl-streaming` (`:77-84`) and `../camera` `CameraProfile` (`:46`) re-exports that belong to sibling modules — blurring the boundary. CLAUDE.md caps public `index.ts` exports at 10 soft / 20 hard.
- **Approach:** Tidy (no behavior change). Stop re-exporting sibling-module surface from `devices`: have consumers import grbl-streaming helpers (`isGrblStreamingMode`, `DEFAULT_GRBL_RX_BUFFER_BYTES`, `normalizeGrblStreamingMode`, …) directly from `core/grbl-streaming`, and `CameraProfile` from `core/camera`; consider moving the gcode-dialects exports to their own module index. `device-profile.ts`/`profile-catalog.ts` may keep their internal imports from those siblings — only the index re-exports move. Update importers (grep-driven) and confirm the value-export count lands ≤ 20.
- **Files:** `src/core/devices/index.ts` (modify) + every importer of the removed re-exports (grep for `from '../../core/devices'` using grbl-streaming/camera names)
- **Tests:** pure refactor — existing suites green; no new test.
- **ADR:** none
- **Effort:** M (wide import churn) · **Depends on:** none
- **Risk:** Import-boundary churn; run `import/no-cycle` + boundaries lint. Do not create a devices→camera or devices→grbl-streaming re-export cycle. Verify the final export count against the 20 cap.

#### Polish (deferred, one-liners)
| finding | one-line fix | effort |
|---|---|---|
| .lbdev import refuses Marlin/Smoothieware LightBurn devices the app can now drive (`lbdev-import.ts:97,166-175,102-127`) | Map recognizable controller strings → `ControllerKind` (marlin/smoothie/grblhal), allow profile creation with the matching catalog starter's streaming/dialect defaults, and set `controllerKind` on import | S |

---

## G-code generation & motion safety — implementation tickets

Sector grade A-. No criticals. Three majors (two mechanism-safety, one fidelity), six minors, two polish. Every ticket below was written after reading the cited source in the current tree.

---

### GCO-01 · Add a last-line-of-defense preflight scan for non-finite motion coordinates
- **Fixes:** Vector path can emit non-finite coordinates (XNaN) and every preflight scanner silently skips them — severity major (verified: CONFIRMED)
- **Root cause:** `grbl-strategy.ts:35-37` `fmt()` is a bare `n.toFixed(3)`, and `emitSegment` (95-109) / `sweepSpanLines` (274-283) interpolate `fmt(pt.x)`/`fmt(pt.y)` with no finite check, so a `NaN` point becomes the literal text `G1 XNaN`. `compile-job.ts:408-410` maps `toMachineCoords(applyTransform(...))` unguarded and pushes kerf/tabs output (421-423, 240-243) unchecked. Preflight is blind: `gcode-words.ts:1` `GCODE_NUMBER` matches digit forms only, so `parseGcodeWord('G1 XNaN','X')` returns `null` and `findOutOfBoundsCoords` (`predicates.ts:98-108`) skips the axis — the file is approved safe-to-write. The raster path was already hardened (`emit-raster.ts:440-448` `validateBounds` throws), the vector path was not.
- **Approach:** Add a pure scanner `findNonFiniteCoords(gcode): readonly Issue[]` in a NEW file `src/core/invariants/non-finite-coords.ts` (keeps `predicates.ts` single-responsibility; default-new-file). For each line where `isGcodeMotionCommand(stripped)` is true, flag any axis/offset word (`X Y Z I J`) whose letter is immediately followed by a non-finite token — e.g. match `/(?:^|[^A-Za-z])([XYZIJ])\s*([+-]?(?:NaN|Inf(?:inity)?))/i`, and additionally flag a word-letter followed by a non-numeric, non-space token that `parseGcodeWord` cannot parse. Return `Issue`s (no throw — core stays pure). Export via `src/core/invariants/index.ts`. Add `PreflightCode` member `'non-finite-coordinate'` and wire the scan into `runPreflight` (`preflight.ts`, after `appendBoundsIssues`) and `runCncPreflight` (`cnc-preflight.ts`, after `appendBoundsIssues`) as a blocking issue. This catches every downstream producer (kerf, tabs, trace, text, offset-fill) at the text boundary regardless of which one emitted the NaN.
- **Files:** `src/core/invariants/non-finite-coords.ts` (new); `src/core/invariants/index.ts` (modify — export); `src/core/preflight/preflight.ts` (modify — union member + wire); `src/core/preflight/cnc-preflight.ts` (modify — wire)
- **Tests:** test-first — new `src/core/invariants/non-finite-coords.test.ts`: `findNonFiniteCoords('G1 X10 YNaN F100 S50')` returns one `Y` issue, `'G1 X10 Y5'` returns none, `'G2 X5 Y5 I-Infinity J0'` returns one. Then `src/core/preflight/preflight.test.ts`: a gcode string containing `XNaN` makes `runPreflight(...).ok === false` with code `'non-finite-coordinate'` (demonstrates the current approve-broken-output bug).
- **ADR:** none
- **Effort:** S  ·  **Depends on:** none
- **Risk:** No emitted G-code changes → no snapshot churn (adds a gate only). Adding a `PreflightCode` union member forces any exhaustive `switch` over `PreflightCode` to add an arm — grep for `assertNever` over preflight codes and the UI issue renderer before finishing.

---

### GCO-02 · Run the controller-readiness gate on the tiled CNC export path
- **Fixes:** [Codex M-04] Tiled CNC export bypasses controller-readiness confirmation and standard provenance metadata — severity major (verified: CONFIRMED)
- **Root cause:** `file-actions.ts:108-121` `handleSaveGcode` early-returns as soon as `handleSaveTiledGcode(...)` returns `true` — before `confirmControllerMismatch` (call at 148, def 204-212), before `emitSaveGcode`'s provenance header (`buildGcodeMetadata`, 142/186-197), and before `pushPostSaveAdvisories` (163). `SaveTiledGcodeCtx` (`save-tiled-gcode.ts:19-27`) has no `controllerSettings` field, and `handleSaveGcode` passes only platform/project/savedName/outputScope/pushToast into it (112-118), so the tiled path structurally cannot run the $30/$32 gate. That gate is CNC-relevant: `cncReadiness` (`controller-readiness.ts:101-148`) makes `$30 != spindleMaxRpm` and `$32=1` BLOCKING errors. Both production callers already pass `controllerSettings` to `handleSaveGcode` (`shortcuts.ts:167`, `use-app-commands.ts:304`), so the data is available — it just never reaches the tiled branch.
- **Approach:** Thread `controllerSettings?: ControllerSettingsSnapshot | null` into `SaveTiledGcodeCtx` and pass it from `handleSaveGcode` (`...(ctx.controllerSettings === undefined ? {} : { controllerSettings: ctx.controllerSettings })`). In `handleSaveTiledGcode`, after all tiles pass preflight in `emitTileFiles` and BEFORE `saveTileFiles`, run the same readiness confirmation once for the whole tile set; abort on cancel. To avoid two divergent gates, tidy-first extract the existing `confirmControllerMismatch` (`file-actions.ts:204-212`) into a shared helper `src/ui/app/confirm-controller-readiness.ts` (no behavior change, own PR), then call it from both save paths. Scope this ticket to the SAFETY gate. The provenance-header and post-save-advisory parity (tiled emit at `save-tiled-gcode.ts:73` calls `cncGrblStrategy.emit` directly with no `buildGcodeMetadata` header and never calls `pushPostSaveAdvisories`) is the same finding's lower-severity tail — land it as a SEPARATE small follow-up PR, do not batch.
- **Files:** `src/ui/app/save-tiled-gcode.ts` (modify — ctx field + readiness confirm before save); `src/ui/app/file-actions.ts` (modify — pass `controllerSettings`; extract helper); `src/ui/app/confirm-controller-readiness.ts` (new — shared gate, tidy-first PR)
- **Tests:** test-first — `src/ui/app/save-tiled-gcode.test.ts`: cnc machine with `tiling` set and `controllerSettings` reporting `$32=1` (or `$30` mismatch), with `jobAwareConfirm` mocked to return `false`, asserts NO `target.write` call (no tile files written). Fails today because the tiled path writes without confirming.
- **ADR:** none
- **Effort:** M  ·  **Depends on:** the tidy extraction PR (part of this ticket). No cross-epic dep — callers already supply `controllerSettings`.
- **Risk:** Behavior change to CNC tiled export (now blockable/confirmable). No G-code bytes change → no snapshot churn. All in `ui/`. Watch `jobAwareConfirm`/`jobAwareAlert` mocking in the test.

---

### GCO-03 · Warn when scaling coarsens curve output; record flatten-at-import as a LightBurn divergence
- **Fixes:** Curves are flattened once at import (0.25 mm); post-import transform scale multiplies chord error with no re-flatten at output — severity major (verified: CONFIRMED)
- **Root cause:** `parse-svg.ts:216-229` flattens curves to a scene-mm tolerance at import (`DEFAULT_FLATNESS_MM = 0.25`, `flatten-curves.ts:12`) and bakes the transformed points into `ColoredPath` polylines. `SceneObject` retains only polylines + a `Transform` with `scaleX/scaleY` (`scene-object.ts:20-28, 84-91`) — no source-curve data. `compile-job.ts:408-410` then applies `obj.transform` to the already-flattened points, so an object scaled 4× post-import burns with ~1 mm chord error (visible faceting). No ADR records flatten-at-import as a deliberate divergence; LightBurn re-flattens at output so scaling never coarsens.
- **Approach:** Full parity (retain curve data on every `SceneObject` variant and re-flatten at compile with tolerance ÷ current scale) crosses `io`↔`core` and touches every variant + `.lf2` schema — too large for one reviewable PR; scope that as a separate design ticket (see Risk). Ship the finding's cheap interim: (1) a NON-blocking advisory when an output vector object's `max(|scaleX|,|scaleY|)` materially exceeds 1, and (2) an ADR recording the divergence. Add `src/ui/laser/scaled-curve-warnings.ts` exporting `detectScaledCurveWarnings(project)`: iterate output-layer objects of kind `imported-svg`/`text`/`traced-image`/`shape`, compute the max abs scale, emit one advisory string when `>= SCALE_CURVE_FIDELITY_FACTOR` (named const, e.g. `1.5`). Wire into `detectMachineJobWarnings` (`machine-job-warnings.ts:20-28`) BEFORE the cnc/laser branch so both machine kinds surface it (faceting affects laser cuts and CNC contours alike). This is an advisory, not a `PreflightIssue` — a scaled export is legitimate, just coarser, so it must not block the write.
- **Files:** `src/ui/laser/scaled-curve-warnings.ts` (new); `src/ui/laser/machine-job-warnings.ts` (modify — wire in); `DECISIONS.md` (modify — new ADR recording the divergence + interim)
- **Tests:** test-first — `src/ui/laser/scaled-curve-warnings.test.ts`: object scaled 4× on an output layer → one warning; scale 1.0 → none.
- **ADR:** NEEDED — flatten curves once at import (scene-mm 0.25) rather than re-flattening at output; record as a LightBurn divergence with the scale-fidelity advisory as the interim mitigation
- **Effort:** M (interim). The full re-flatten parity fix is a SEPARATE large design ticket — not this PR.  ·  **Depends on:** none
- **Risk:** Advisory-only, no G-code change, no snapshot churn. State plainly in the PR: the interim does NOT restore curve fidelity, only warns. The deferred full fix will need golden-image/perceptual verification (rule #2) since it changes emitted geometry.

---

### GCO-04 · Refresh WORKFLOW.md F-A10 (preflight checks) and F-B7 (pause $32 gate) to match the code
- **Fixes:** WORKFLOW.md has drifted behind the safety code: F-B7 pause documents no $32 gate and F-A10 documents 6 of ~12 implemented checks — severity minor (verified: no verdict recorded; kernel confirmed against code)
- **Root cause:** `WORKFLOW.md:356-369` (F-A10) lists the original six pre-write checks, but `runPreflight` now implements roughly twice that — `PreflightCode` (`preflight.ts:35-57`) and the appenders (83-122) add layer-mode-mismatch, offset-fill-open-contour, machine-profile, no-go-zone, laser-on-travel, long-blank-feed, unsupported-raster-transform, relief-needs-cnc, plus the CNC codes. `WORKFLOW.md:630-639` (F-B7) says Pause unconditionally writes `!` and lists only success states, but `laser-job-actions.ts:99-103` refuses Pause on a laser when `$32` is unproven (`PAUSE_REQUIRES_LASER_MODE_MESSAGE`, 32-33, "Use Stop instead"), exempts CNC/router (95-102), and has a stream-side no-hold path (`PAUSE_UNSUPPORTED_MESSAGE`, 34-35).
- **Approach:** Docs-only. Rewrite F-A10's numbered list to reflect the current check set (frame each as a WORKFLOW state, not the code identifier). Update F-B7 with: the pause-blocked error state (quote the `$32=1` requirement and the Stop fallback), the CNC/router exemption, and the no-realtime-hold stream-side path. Do not invent checks — enumerate them from `PreflightCode` + the pause branch.
- **Files:** `WORKFLOW.md` (modify — F-A10 §356-369, F-B7 §630-639)
- **Tests:** docs-only, no test
- **ADR:** none
- **Effort:** S  ·  **Depends on:** none
- **Risk:** CRLF/EOL trap — `.md` is prettier-ignored; edit with an EOL-preserving tool and verify `git diff --stat` shows no whole-file rewrite. No code risk.

---

### GCO-05 · Add an optional per-layer Constant/Dynamic power override (LightBurn parity)
- **Fixes:** No per-layer Constant/Dynamic power mode — power mode is fixed per device dialect — severity minor (verified: no verdict recorded; confirmed against code)
- **Root cause:** `gcode-dialects.ts:57-125` fixes `cutPowerMode`/`fillPowerMode`/`rasterPowerMode` on every built-in dialect; `powerModeForGroup` (`grbl-strategy.ts:401-405`) chooses the mode purely from `group.kind` + dialect; `job.ts:28-45` groups carry no power-mode field. ADR-036 (`DECISIONS.md:1744-1758`) records the default divergence (LightBurn defaults M4 fill; ours M3 cut / M4 fill) but not the missing per-layer override. LightBurn exposes a per-layer "Constant Power Mode" checkbox.
- **Approach:** Add optional `powerMode?: GrblPowerMode` to `CutGroup`/`FillGroup` (`job.ts`). In `powerModeForGroup`, when `group.powerMode` is set return `laserModeWord(group.powerMode)`, else fall back to the dialect (today's behavior). Plumb from a new optional Layer field (`constantPower?: boolean` to mirror LightBurn's checkbox) through `commonGroupFields` (`compile-job.ts:187-200`). Default undefined = byte-identical existing output. Keep it an explicit optional field, not boolean-soup. UI checkbox (copy: "Constant Power Mode") can follow as a separate PR; this ticket is the core plumbing.
- **Files:** `src/core/job/job.ts` (modify — field on CutGroup/FillGroup); `src/core/output/grbl-strategy.ts` (modify — honor `group.powerMode`); `src/core/job/compile-job.ts` (modify — thread from layer); the `Layer` type + `.lf2` serializer (modify — additive optional field)
- **Tests:** test-first — `src/core/output/grbl-strategy.test.ts`: a fill group with `powerMode:'constant'` emits `M3` (not `M4`); a cut group with `powerMode:'dynamic'` emits `M4`; omitted field leaves existing snapshots unchanged.
- **ADR:** NEEDED — per-layer Constant/Dynamic power override for LightBurn "Constant Power Mode" parity; default preserves dialect behavior
- **Effort:** M  ·  **Depends on:** none
- **Risk:** Snapshot churn ONLY if a fixture sets the new field — with default undefined, existing snapshots stay byte-identical (add `Snapshot change acknowledged:` only if new fixtures are introduced). New Layer field is additive to `.lf2` (no schema bump — `letterSpacing` precedent).

---

### GCO-06 · Clamp planner junction entry velocity to both adjacent blocks' target speeds
- **Fixes:** Planner sibling defect: junction/exit velocity is never clamped to the current block's own target speed — severity minor (verified: no verdict recorded; confirmed against code)
- **Root cause:** `planner.ts:229-236` `capJunctionEntries` sets `p.entryV = Math.min(next.targetVelocity, vJunction)` — it omits `prev.targetVelocity`, whereas GRBL clamps the junction speed to the MINIMUM of both adjacent blocks' nominal speeds. `backwardPass` (241-251) then copies `plan[i+1].entryV` into `plan[i].exitV` uncapped, and `forwardPass` (254-264) caps `entryV` to `block.targetVelocity` but never `exitV`. When two same-kind blocks of different speeds abut, the slower block gets `exitV > vTarget`; `blockTime` (300-307) computes `dDecel = max(0, …) = 0` and `tDecel = (vTarget − exitV)/accel < 0`, shaving time off the estimate. Estimation-only (the planner never drives motion).
- **Approach:** One line in `capJunctionEntries`: `p.entryV = Math.min(prev.targetVelocity, next.targetVelocity, vJunction)`. Because `backwardPass` derives each block's `exitV` from the next block's `entryV`, bounding that entry by `prev.targetVelocity` transitively guarantees `exitV <= ` the block's own target, eliminating the negative `tDecel`. Optionally add belt-and-suspenders `p.exitV = Math.min(p.exitV, block.targetVelocity)` in `forwardPass`, but the one-line fix is sufficient.
- **Files:** `src/core/job/planner.ts` (modify — one line)
- **Tests:** test-first — `src/core/job/planner.test.ts`: a property/unit case over abutting same-kind blocks with descending target speeds asserting, for every planned block, `entryV <= block.targetVelocity` AND `exitV <= block.targetVelocity`, plus `blockTime(...) >= 0` (guards the negative `tDecel`). Fails on the current code.
- **ADR:** none
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Time estimates change slightly (become correct/marginally longer). NO G-code output change → no G-code snapshot churn, but any test asserting an exact estimate number may need a refresh. Pure core, deterministic.

---

### GCO-07 · Extend the bounds scanner to catch G2/G3 arcs that bulge off the bed
- **Fixes:** Bounds preflight checks only G2/G3 endpoint words — an arc bulging past the bed edge passes the text scan — severity minor (verified: no verdict recorded; confirmed against code)
- **Root cause:** `findOutOfBoundsCoords` (`predicates.ts:98-108`) treats G2/G3 as motion lines (`isGcodeMotionCommand` matches `G0123`, `gcode-words.ts:18-20`) but reads only the X/Y ENDPOINT words; the I/J center words are ignored, so a CNC arc that bows outside `[0,bed]` while both endpoints are inside is approved. The sampled fallback (`start-job-readiness.ts:142-167` → `computeJobBounds` → `cncPassXyPoints` samples arcs, `job.ts:118-129`) can catch it but returns early when `jobOrigin`/`motionOffset` are absent (148-150); `runCncPreflight`'s own bounds pass (`cnc-preflight.ts:72`, `appendBoundsIssues` 149-161) is the text scanner. `cnc-grbl-strategy.ts:262-274` emits native G2/G3 with I/J. Laser output is unaffected (no arcs emitted).
- **Approach:** Make the bounds scan arc-aware. Add a helper `src/core/invariants/arc-bounds.ts` computing an arc's axis-aligned extent from the previous endpoint (modal current position), the I/J center offset, the new endpoint, and CW/CCW direction — include each cardinal extremum (`center ± r` on ±X/±Y) only when it lies on the swept arc; handle the full-circle case (`endpoint == start`, which `cnc-grbl-strategy.ts:266` emits). Call it from `findOutOfBoundsCoords` when the line is `G2`/`G3`, tracking `lastX/lastY` across lines, and flag any extent corner outside the bed. Keep pure. (Alternative: thread the compiled `Job` into `runCncPreflight` and reuse `cncPassXyPoints` sampling unconditionally — larger surface; the text-level arc extent keeps `cnc-preflight`'s gcode-string contract.)
- **Files:** `src/core/invariants/arc-bounds.ts` (new — arc AABB math); `src/core/invariants/predicates.ts` (modify — call it for G2/G3 with modal position); `src/core/invariants/index.ts` (modify — export if needed)
- **Tests:** test-first — `src/core/invariants/arc-bounds.test.ts` (+ a `predicates.test.ts` case): `G2 X10 Y0 I5 J0` from (0,0) on a bed whose height is below the arc's peak → an out-of-bed issue; an arc fully inside → none; a full circle whose radius pokes off-bed → issue.
- **ADR:** none
- **Effort:** M  ·  **Depends on:** none
- **Risk:** G2/G3 appear only in CNC output; laser is unaffected (no arcs). Extremum math must handle CW/CCW and full circles — cover both in tests to avoid false positives. New blocking bounds issues on jobs that genuinely bulge off-bed are the correct behavior. No G-code change → no snapshot churn.

---

### GCO-08 · Restore (or relocate) the referenced LIGHTBURN-STUDY divergence ledger
- **Fixes:** LIGHTBURN-STUDY.md — the canonical divergence ledger — does not exist in the repo — severity minor (verified: no verdict recorded; absence confirmed by glob)
- **Root cause:** `DECISIONS.md:1089-1091` declares "The authoritative behavior reference is `LIGHTBURN-STUDY.md` §§1–7" and "The running ledger is `LIGHTBURN-STUDY.md` §8", and `grbl-strategy.ts:13-14` cites "LIGHTBURN-STUDY §8" for the preamble pre-arm `M3 S0` divergence. A repo-wide glob for `LIGHTBURN-STUDY*` returns nothing (only `src/core/trace/lightburn-trace-settings.ts` and `src/io/lightburn` exist). The "divergence is a defect unless the ledger records it" rule is unauditable.
- **Approach:** Docs/architecture — surface the choice to the maintainer, do NOT fabricate a ledger. Enumerate every citation first (`grep -r "LIGHTBURN-STUDY"` → `DECISIONS.md`, `grbl-strategy.ts`, and per the finding also `preview-data.ts`, `shortcuts.ts`). Option (a): create `LIGHTBURN-STUDY.md` with §§1–7 (behavior reference) + §8 (divergence ledger), seeding §8 ONLY with entries the code/DECISIONS already assert (preamble pre-arm `M3 S0`; ADR-036 M4-fill; grey raster-layer color per `DECISIONS.md:1095/1102`) and marking anything uncertain "to verify." Option (b): fold the ledger into `DECISIONS.md` as a section and re-point the code comments + DECISIONS references. Recommend (a) with the minimal §8 stub. Optionally add a tiny CI doc-lint that greps for `LIGHTBURN-STUDY` references and asserts the file exists, so it can't silently vanish again.
- **Files:** `LIGHTBURN-STUDY.md` (new) OR `DECISIONS.md` (modify) — maintainer's choice; if (b), also update the four citing files' comments
- **Tests:** docs-only, no test (optional CI doc-existence guard noted above)
- **ADR:** none for option (a) — it restores an already-referenced doc. Option (b) restructures the source-of-truth → ADR: NEEDED — relocate the LightBurn divergence ledger into DECISIONS.md.
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Must NOT invent divergence entries — populate §8 only from existing code/DECISIONS assertions per rule #5 (no invention). EOL trap on the new `.md`.

---

### GCO-09 · Promote image-mode overscan to a per-layer setting (match Fill mode + LightBurn)
- **Fixes:** Image-mode overscan is a hard-coded 5 mm constant with no per-layer setting — severity minor (verified: no verdict recorded; confirmed against code)
- **Root cause:** `compile-job-raster.ts:93` sets `overscanMm: DEFAULT_OVERSCAN_MM` (`compile-job-defaults.ts:6` = 5) for every raster group, while Fill mode exposes per-layer overscan (`compile-job.ts:140`, `Math.max(0, layer.fillOverscanMm)`), so the two scan modes are inconsistent. `preflight.ts:366-379` `maxOutputOverscanMm` already treats image overscan as the constant and fill as per-layer. LightBurn exposes Overscan per-layer on scanned (fill/image) layers.
- **Approach:** Add optional `imageOverscanMm?: number` to the `Layer` type and `ObjectOperationOverride` (`scene-object.ts:47-71`), defaulting to `DEFAULT_OVERSCAN_MM` so existing snapshots stay byte-identical. Read it in `compile-job-raster.ts` (`layer.imageOverscanMm ?? DEFAULT_OVERSCAN_MM`) and update `maxOutputOverscanMm` (`preflight.ts:366-379`) to read the per-layer image value so the M1 overscan note (`preflight.ts:351-363`) stays accurate. Keep the note's wording in sync. (The code comment at `compile-job-defaults.ts:3-5` plans a device-profile field instead; this ticket picks per-layer to match LightBurn — note that deviation from the comment.)
- **Files:** `src/core/scene/scene-object.ts` + the `Layer` type (modify — additive field); `src/core/job/compile-job-raster.ts` (modify — read per-layer); `src/core/preflight/preflight.ts` (modify — `maxOutputOverscanMm` per-layer)
- **Tests:** test-first — `src/core/job/compile-job-raster.test.ts`: image layer with `imageOverscanMm: 2` → raster group `overscanMm === 2`; absent → 5 (default unchanged, snapshot-stable).
- **ADR:** none (LightBurn parity; default value preserved). If the maintainer prefers the device-profile route from the comment, that becomes ADR: NEEDED.
- **Effort:** M  ·  **Depends on:** none
- **Risk:** Snapshots stable while default; churn only for fixtures that set the field. Additive `.lf2` field. UI field to expose the knob can be a follow-up PR.

---

#### Polish (deferred, one-liners)
| finding | one-line fix | effort |
|---|---|---|
| Resume confirmation dialog uses CNC wording for laser jobs (`start-job-flow.ts:162-165` shows "restart the spindle… feed back to depth" for both kinds; `resume-program.ts:165-174` laser body travels-then-arms, never touches Z) | Branch the confirm copy on `machineKindOf(project.machine)` — laser: "move to the resume point with the beam off, then re-arm and continue"; keep CNC wording | S |
| Four core sector files exceed the 250-counted-line soft cap (`compile-job.ts` 367, `emit-raster.ts` 365, `preflight.ts` 346, `grbl-strategy.ts` 309) | Tidy-first splits along existing seams (grbl fill emission → `grbl-strategy-fill.ts`; preflight per-check appenders → sibling modules; emit-raster corrected-row emitters → `emit-raster-corrected.ts`), separate no-behavior-change PRs | M |

---

## Machine control: connection, jog, console, streaming — implementation tickets

Sector grade A-. No criticals. Four major findings (one — the Move-window parity gap — is genuinely four independent PRs, split into MCH-04..07 per the "one concern = one PR" rule). Seven minor findings map to MCH-08..14. Two polish items are tabled at the end.

---

### MCH-01 · Route operator diagnostic log lines into the Console transcript
- **Fixes:** Operator warnings are written to a log surface that no longer exists in the UI (orphaned LaserLog, unread lastWriteError) — severity major (verified: CONFIRMED, major).
- **Root cause:** Commit a52d0960 swapped `<LaserLog/>` for `<ConsolePanel/>` in `LaserWindow.tsx`, but `ConsolePanel` renders `s.transcript` (ConsolePanel.tsx:15,31-34,84) while every `[lf2]` app-diagnostic is written only to `s.log` via `pushLog` (laser-store-helpers.ts:31-33). `LaserLog.tsx:13` is the *only* non-test reader of `s.log` and is mounted nowhere — it is dead. So the wrong-baud handshake hint (laser-connection-actions.ts:172-180), the banner/profile mismatch advisory (laser-line-handler.ts:158-166), the wake-lock-denied warning (use-active-job-wake-lock.ts:13-15,83), and the Marlin "pause is stream-side only" caveat (laser-job-actions.ts:107-109) are all invisible.
- **Approach:** Add a UI-layer helper (NOT core — it may read `Date.now()`) `appendSystemNotice(state, line)` next to the transcript module that returns `{ log: pushLog(state, line), transcript: appendTranscript(state.transcript, systemTranscriptEntry(id, Date.now(), line, 'message')) }`, deriving `id` from the last transcript entry's id + 1 (or 1 when empty). `systemTranscriptEntry` (laser-transcript.ts:87-94) and `ConsoleTranscript`/`visibleEntries`/`rowStyleFor` already render `direction:'system'` rows, so this is purely additive — no duplicate of inbound controller lines. Reroute the four cited `set({ log: pushLog(...) })` sites (and, for consistency, the other `[lf2]` sites in laser-jog-actions.ts:46,117, laser-origin-actions.ts:41,51) through it. Delete `LaserLog.tsx` and fix the stale "LaserLog" comment in LaserWindow.tsx:241. Leave `lastWriteError` as an internal/test signal (it is set alongside `log` in the blocked-command cases, which now become visible via the transcript) and say so in the PR — removing it touches ~20 sites and 15 tests for no user-facing gain, so that is explicitly out of scope here.
- **Files:** `src/ui/state/laser-transcript.ts` (modify — add helper, or a new `laser-system-notice.ts` (new) if it pushes the file past soft limit), `src/ui/state/laser-connection-actions.ts` (modify), `src/ui/state/laser-line-handler.ts` (modify), `src/ui/app/use-active-job-wake-lock.ts` (modify), `src/ui/state/laser-job-actions.ts` (modify), `src/ui/laser/LaserLog.tsx` (delete), `src/ui/laser/LaserWindow.tsx` (comment only).
- **Tests:** test-first in `src/ui/state/laser-connection-actions.test.ts` (handshake timeout appends a system transcript entry whose raw contains "Check baud rate") and `src/ui/state/laser-line-handler.test.ts` (banner-mismatch appends a system transcript entry) — both currently would only see the entry in `s.log`, not `s.transcript`.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none.
- **Risk:** Low. Additive to transcript; no wire/G-code change. Watch that the id derivation stays monotonic after the 500-entry slice (use last-id+1, not length). WORKFLOW copy that names "LaserLog" as the surface is corrected in MCH-09.

---

### MCH-02 · Pass the profile's controller kind + baud when connecting from the menu
- **Fixes:** [Codex M-02] Duplicate Connect surfaces select different controller behavior — severity major (verified: CONFIRMED, major).
- **Root cause:** The rail's `ConnectionBar` calls `connect(platform, { controllerKind, baudRate: profileBaudRate })` (LaserWindow.tsx:40-41,75), but the menu command's callback calls `laser.connect(platform)` with no options (use-app-commands.ts:256). `connect` then resolves `selectControllerDriver(undefined) → grblDriver` (select-controller-driver.ts:16-18) and opens at GRBL's 115200 default (driver.ts:33; laser-connection-actions.ts:52,74), and snapshots GRBL capabilities (laser-connection-actions.ts:59). A catalog Marlin profile is `marlin @ 250000` (profile-catalog.ts:144-145), so the menu path connects at the wrong baud with the wrong driver, and pause/stop realtime bytes Marlin ignores (ADR-095) appear available.
- **Approach:** In `laserCommandContext` read the device profile at click time (same pattern use-frame-action.ts:29 uses): `connectLaser: () => { const d = useStore.getState().project.device; void laser.connect(platform, { controllerKind: d.controllerKind, baudRate: d.baudRate }); }`. `useStore` is already imported in use-app-commands.ts. Optionally extract a tiny pure `connectOptionsForDevice(device): ConnectControllerOptions` for direct unit-testability. Secondary (same Connect surface): the command-family enablement (`laser-command-family.ts:11-12`) enables Connect on `serialSupported && !connected` but ignores `isFileOnlyProfile`/`machineBusy`, unlike the rail (LaserWindow.tsx:77) — a Ruida file-only profile shows an enabled menu Connect that does nothing. Fold that gate into the same PR since it is the same widget, or note it as MCH-02b if it grows the diff.
- **Files:** `src/ui/commands/use-app-commands.ts` (modify), optionally `src/ui/commands/laser-command-family.ts` (modify — file-only/busy gate), `src/ui/state/laser-store.ts` (only if extracting the pure helper there).
- **Tests:** test-first in a new `src/ui/commands/use-app-commands.test.tsx` (or extend `machine-command-gate.test.ts`): triggering the `laser.connect` command invokes `laser.connect` with `{ controllerKind, baudRate }` matching a Marlin project's `project.device`, not `undefined`.
- **ADR:** none.
- **Effort:** S (finding said M; the fix is a two-line callback change plus one test — corrected down).
- **Depends on:** none.
- **Risk:** Low. Behavior converges the menu path onto the already-correct rail path. If you also fix the enablement gate, verify the file-only Ruida profile still disables both surfaces (LaserWindow.test.tsx / a command test).

---

### MCH-03 · Add an opt-in, capability-gated Fire (test-pulse) control
- **Fixes:** No Fire / test-pulse button — unrecorded LightBurn divergence on diode-laser positioning — severity major (verified: CONFIRMED, major).
- **Root cause:** No fire/pulse control exists anywhere in `src/ui` (confirmed: JogPad.tsx and JobControls.tsx have no such button; `OverrideControls.tsx:23` `fire(byte)` sends realtime override percent bytes, not a beam-on), and no ADR records the omission. The shipped catalog targets Creality Falcon diode machines (falcon-profiles.ts) — the exact class that has no red-dot pointer and relies on LightBurn's Fire button for alignment. Frame (use-frame-action.ts) traces the box beam-off and cannot show the current spot.
- **Approach:** ADR first (records the LightBurn-parity feature and the safety envelope), then a small stack: (1) add an opt-in device-profile flag + user-set low fire power (default off, clamped) to `DeviceProfile`; (2) a new store action `fireTestPulse()` that, under the existing connected + `statusReport.state==='Idle'` + no-active-job/motion interlocks (reuse `jogFrameCommandBlockMessage`, laser-store-helpers.ts:68-82), sends `M3 S<clamped>` then `M5` via `safeWrite`, sourced from the driver so it is firmware-neutral (a `commands.fireOn(power)/fireOff` pair on `ControllerCommands`, not a UI-hardcoded literal — same seam as MCH-12); (3) a capability-gated button in a new `FireButton.tsx` mounted in JogPad, hidden unless the profile flag is on and the driver reports laser capability. Momentary (pointerdown→M3, pointerup→M5) matches LightBurn's press-and-hold more closely than click-toggle; pick one and record it.
- **Files:** `DECISIONS.md` (ADR), `src/core/devices/device-profile.ts` (modify — flag + power), `src/core/controllers/controller-driver.ts` + `src/core/controllers/grbl/commands.ts` (modify — fire command builders, pure), a new store action module e.g. `src/ui/state/laser-fire-action.ts` (new), `src/ui/laser/FireButton.tsx` (new), `src/ui/laser/JogPad.tsx` (mount).
- **Tests:** test-first in `src/ui/state/laser-fire-action.test.ts`: fire is blocked (no bytes) when disconnected / non-Idle / job active, and when enabled+Idle it writes `M3 S<clamped>` then `M5` with power clamped to the profile ceiling.
- **ADR:** NEEDED — opt-in capability-gated laser Fire/test-pulse control (LightBurn parity; default off; power clamp + Idle/no-job interlocks).
- **Effort:** M  ·  **Depends on:** benefits from MCH-12's driver-command seam but does not require it.
- **Risk:** Safety-sensitive — this is the one control that fires the beam with no motion. Keep the ADR's interlock list authoritative and mirror it in the action guard. No G-code snapshot impact (realtime, not job stream).

---

### MCH-04 · Continuous (hold-down) jog
- **Fixes:** Move-window parity gaps (continuous/hold-down jog portion) — severity major (verified: CONFIRMED, no severity change).
- **Root cause:** Every arrow is a plain `onClick` sending one `$J=` step (JogPad.tsx:42-45,98-128); the file header (JogPad.tsx:4-6) defers continuous jog to "Phase B polish" but no ADR or WORKFLOW line records it. The driver already exposes `realtime.jogCancel` (0x85) and the store already has `cancelJog` (laser-jog-actions.ts:70-79), so the cancel half is plumbed.
- **Approach:** On the arrow buttons, add pointerdown/pointerup (+ pointerleave/pointercancel) handling: on pointerdown send one `$J=` with a long distance (e.g. the axis travel toward that direction, or a large capped delta) at the jog feed; on pointerup/leave call `cancelJog()` (writes 0x85). Keep the existing click-per-step path for a quick tap (a short press that fires pointerup before a threshold still nets one step). Extract the press logic into a `useHoldJog` hook so JogPad stays under the component cap. Update the JogPad.tsx:4-6 header comment to reflect that continuous jog now ships.
- **Files:** `src/ui/laser/use-hold-jog.ts` (new), `src/ui/laser/JogPad.tsx` (modify — wire the hook into `JogArrowGrid`).
- **Tests:** test-first in `src/ui/laser/JogPad.test.tsx`: pointerdown on an arrow dispatches a long `$J=` jog for that axis/sign; pointerup calls `cancelJog`. Assert against the mocked store `jog`/`cancelJog`.
- **ADR:** none (LightBurn parity, not a divergence).
- **Effort:** M  ·  **Depends on:** none (shares JogPad with MCH-05/06/07 — sequence to avoid conflicts; land 06 first as the smallest).
- **Risk:** Continuous `$J=` while a job is active would corrupt the character-counted stream — JogPad is already disabled during a job (LaserWindow.tsx:92-93,132-138), so keep the disabled guard on the new handlers too. Pointer capture must release cleanly (call cancelJog on pointercancel/blur) so a lost pointerup can't leave the head jogging.

---

### MCH-05 · Go-to-origin (Go to Zero) button
- **Fixes:** Move-window parity gaps (no Go-to-origin portion) — severity major (verified: CONFIRMED).
- **Root cause:** There is no "Go to Origin"/"Go to Zero" control; `jogToMachinePosition` exists in the store (laser-store.ts:178-182; laser-jog-actions.ts:41-55) but is only used by board capture. `OriginRow.tsx:36-107` offers Set/Reset/Release only.
- **Approach:** Add a "Go to origin" button that jogs the head to the current work origin. Reuse the existing `jog` path: with a G92/G54 work origin active, the target work coordinate is (0,0); compute the machine coordinate from `wcoCache`/`statusReport` (the same `inferCurrentMachinePosition` inputs `jogToMachinePosition` already uses) and call `jogToMachinePosition(x, y, feed)`, or add a thin `goToWorkOrigin()` action that jogs to WCO. Gate it exactly like the jog arrows (connected + Idle + no active job/motion) and hide/disable it when no origin is known. Place it in JogPad or OriginRow (OriginRow is the origin home; but it returns null when `wcs==='none'`, so Marlin-v1 has no origin to go to — acceptable).
- **Files:** `src/ui/state/laser-jog-actions.ts` (modify — add `goToWorkOrigin` if a work-coord helper is cleaner than reusing `jogToMachinePosition`), `src/ui/laser/OriginRow.tsx` or `src/ui/laser/JogPad.tsx` (modify — the button).
- **Tests:** test-first in `src/ui/state/laser-store-jog-to-point.test.ts` (extend): with a known WCO and Idle status, Go-to-origin jogs to the machine coordinate of work (0,0); with no live position it blocks (reuses the existing `inferCurrentMachinePosition` null path at laser-jog-actions.ts:43-48).
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none.
- **Risk:** A rapid to origin across the bed is a collision path — keep it beam-off (it is a `$J=` move) and honor no-go zones only insofar as jog already does (jog itself is unbounded, matching LightBurn). Document that it goes to the *work* origin, not machine zero, to avoid confusion on unhomed machines.

---

### MCH-06 · Jog feed selector + name the hardcoded 3000 jog feed
- **Fixes:** Move-window parity gaps (no jog-speed control + magic number) — severity major (verified: CONFIRMED).
- **Root cause:** Jog feed is `const feed = Math.min(maxFeed, 3000)` (JogPad.tsx:32) — an unnamed magic number with no user control; LightBurn's Move window has a speed field.
- **Approach:** Introduce a named module constant `DEFAULT_JOG_FEED_MM_PER_MIN = 3000` and add a small jog-speed selector (a few presets clamped to `maxFeed`, defaulting to the named constant) held in local `useState`, threaded into `send`/`sendFocus`. Keep `FOCUS_FEED_MM_PER_MIN` (JogPad.tsx:21) as the separate focus default. If the smallest first step is preferred, the constant-naming alone is a valid tidy PR; the selector is the parity feature.
- **Files:** `src/ui/laser/JogPad.tsx` (modify).
- **Tests:** test-first in `src/ui/laser/JogPad.test.tsx`: changing the speed selector changes the `F` value in the emitted `$J=`; default equals `min(maxFeed, DEFAULT_JOG_FEED_MM_PER_MIN)`.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none (land before MCH-04/05/07 as the smallest JogPad diff).
- **Risk:** Low. Purely UI-local. Clamp to `maxFeed` so a user can't request a feed the machine rejects.

---

### MCH-07 · Arrow-key (keyboard) jog
- **Fixes:** Move-window parity gaps (no keyboard jog portion) — severity major (verified: CONFIRMED).
- **Root cause:** Keyboard shortcuts cover only Start (Ctrl+Return) and Stop (Ctrl+.) (use-job-shortcuts.ts:19-37); there is no arrow-key jog. LightBurn users expect arrow-key jogging in the Move window.
- **Approach:** Add a `useJogShortcuts` hook (mirroring installJobShortcuts' window-listener + teardown shape, use-job-shortcuts.ts:19-41) that maps Arrow keys → X/Y jog and PageUp/PageDown → Z focus, at the currently-selected step and feed. Respect the same gates the arrows use: ignore when a modal is open (`isModalOpen`), when the target is an editable field (`isEditableShortcutTarget`, already imported by the sibling hook), and when jog is disabled (not connected / not Idle / job active). Because the step/feed live in JogPad local state, either lift them to a small shared store slice or drive the shortcut through the same `jog` action with a module-level default step — prefer lifting step/feed into the laser store so keyboard and buttons stay in sync (a tidy step; note it).
- **Files:** `src/ui/laser/use-jog-shortcuts.ts` (new), the JogPad step/feed state (modify — possibly lift to store), a mount point (e.g. LaserWindow or the existing shortcuts install site).
- **Tests:** test-first in `src/ui/laser/use-jog-shortcuts.test.ts` (sibling to use-job-shortcuts.test.ts): ArrowUp with the machine connected+Idle dispatches a +Y `$J=` at the selected step; the same key with an editable target focused, a modal open, or jog disabled dispatches nothing.
- **ADR:** none.
- **Effort:** M (the step/feed lift makes it more than trivial)  ·  **Depends on:** cleaner after MCH-06 (shared feed) if step/feed are lifted to the store.
- **Risk:** Global keydown handlers are easy to over-fire — the editable-target and modal gates are load-bearing (a designer typing in a numeric field must not jog the head). Do not preventDefault arrow scrolling unless jog actually fired.

---

### MCH-08 · Add the Brave WebSerial caveat to the connect hint and reconcile WORKFLOW
- **Fixes:** Brave WebSerial hint required by PROJECT.md is missing from the connect error path (and WORKFLOW contradicts itself) — severity minor (verified: no verdict; original stands).
- **Root cause:** PROJECT.md:38 mandates a one-line "Enable WebSerial in Brave settings" hint in the F-B1 connect error path, but the actual hint lists Brave as a plain supported browser with no caveat (LaserWindow.tsx:119-122; connection-help.ts:13). WORKFLOW.md:36 includes the "(may require enabling under Brave Shields/flags)" parenthetical while WORKFLOW.md:551 omits it, and the code matches the weaker line.
- **Approach:** Two parts. (1) Code/copy: update the not-supported hint in `ConnectionHints` (LaserWindow.tsx:117-123) and the `CONNECTION_HELP_TEXT` supported-browser line (connection-help.ts:13) to add the Brave Shields/flags caveat, e.g. "…Brave (may need WebSerial enabled under Brave Shields/flags)…". (2) Docs: make WORKFLOW.md:551 match WORKFLOW.md:36 (add the parenthetical). Note the code hint only renders when WebSerial is unsupported — on Brave with it gated behind a flag, `serial.isSupported()` returning false is what surfaces it, matching PROJECT.md's intent.
- **Files:** `src/ui/laser/LaserWindow.tsx` (modify), `src/ui/help/connection-help.ts` (modify), `WORKFLOW.md` (modify line 551 — preserve CRLF/EOL; .md is prettier-ignored, verify `git diff --stat` shows no whole-file EOL flip).
- **Tests:** test-first in `src/ui/laser/LaserWindow.test.tsx`: with `serial.isSupported()` false, the rendered hint text contains "Brave" and "Shields"/"flags". (WORKFLOW/help copy is docs; no separate test.)
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none.
- **Risk:** Low. Copy + one doc line. Watch the EOL trap on WORKFLOW.md.

---

### MCH-09 · Fix WORKFLOW jog-step + poll-cadence drift; re-date the mid-job ETA promise
- **Fixes:** WORKFLOW.md drift: jog step list, status-poll cadence, and the still-missing mid-job ETA — severity minor (verified: no verdict; original stands).
- **Root cause:** Three doc/code mismatches. (1) F-B5 lists steps "0.1 / 1 / 10 / 100 mm" (WORKFLOW.md:603) but code ships nine steps `[0.1,0.5,1,2,5,10,25,50,100]` (JogPad.tsx:19). (2) F-B10 says `?` every 250 ms while connected (WORKFLOW.md:659) but code fast-polls at 250 ms only during activity and idles to every 4th tick / ~1 Hz (laser-connection-actions.ts:40-41,220-242 via `shouldFastPoll`/`IDLE_POLL_DIVISOR`). (3) F-B11 promises "Phase C will add an estimated-time-remaining label" (WORKFLOW.md:663) but the project is in Phase H/I and the in-job bar still shows only acked-line counts (JobControls.tsx:190-207); a *pre-job* estimate exists (`EstimateBadge`, JobControls.tsx:139,161-171) but nothing updates during the run.
- **Approach:** Docs-only. Update WORKFLOW.md:603 to the real nine-step list; update WORKFLOW.md:659 to describe the activity-gated cadence (250 ms while streaming/jogging/framing/probing/autofocus, ~1 Hz when idle). For the ETA, either re-date the promise (remove "Phase C", state the mid-job ETA is still deferred and the bar shows acked-line progress) or, if the maintainer wants it shipped, that is a *separate feature ticket* (compose `live-job-estimate` + `streamer.completed/total` + elapsed time into the ProgressBar) — out of scope for this docs fix. Keep this ticket docs-only.
- **Files:** `WORKFLOW.md` (modify lines 603, 659, 663 — preserve CRLF/EOL; verify with `git diff --stat`).
- **Tests:** docs-only, no test.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none.
- **Risk:** EOL flip on WORKFLOW.md (use a CRLF-preserving edit). If the mid-job ETA is later built, it is a real feature PR, not this one.

---

### MCH-10 · Label the override row 'Power' on laser machines
- **Fixes:** Override panel says 'Spindle' on laser machines — severity minor (verified: no verdict; original stands).
- **Root cause:** `OverrideControls` hardcodes the label `"Spindle"` (OverrideControls.tsx:35-41) regardless of machine kind, though on a laser the 0x99-0x9B bytes change beam power. A machine-aware label helper exists (machine-labels.ts) and is used by LaserWindow/JobControls but not here.
- **Approach:** Read `project.machine?.kind` (default `'laser'`, same pattern as LaserWindow.tsx:39 / JobControls.tsx:78) and render `"Power"` for laser, `"Spindle"` for CNC. Add a `spindleOrPowerLabel(kind)` to machine-labels.ts (keeps the mapping with its siblings) rather than an inline ternary. The −10/+10/reset button titles interpolate `label.toLowerCase()` (OverrideControls.tsx:85,92,99) so they follow automatically.
- **Files:** `src/ui/machine/machine-labels.ts` (modify — add helper), `src/ui/laser/OverrideControls.tsx` (modify).
- **Tests:** test-first in `src/ui/laser/OverrideControls.test.tsx`: with a laser project the row label is "Power"; with a CNC project it is "Spindle".
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none.
- **Risk:** Low. `OverrideControls` currently subscribes only to laser-store; adding a `useStore(project.machine)` selector is fine within ui boundaries.

---

### MCH-11 · Make the Console section collapsible in the rail
- **Fixes:** Right-rail density: Console and jog sections are always expanded in a fixed 300px rail — severity minor (verified: no verdict; original stands).
- **Root cause:** `ConsolePanel` renders as a permanently-open `<section>` (ConsolePanel.tsx:64-95) with its own min-height 90px scroll (ConsolePanel.tsx:372-378), inside the fixed 300px internally-scrolling rail (LaserWindow.tsx:239-256). Every other secondary panel uses `<details>` (DeviceSettings.tsx:42, MachineSettingsPanel.tsx:61, ProbePanel.tsx:13, OriginRow.tsx:183, GrblLaserSetupPanel.tsx:26); the least-used section for a beginner is the only one that can't collapse, pushing Start below the fold on a laptop.
- **Approach:** Wrap `ConsolePanel`'s content in a `<details>`/`<summary>` (summary "Console"), matching the sibling panels' chrome. Persist the open/closed state (a `ui-store` flag or localStorage-backed value, consistent with how other collapsibles persist if they do — check DeviceSettings' pattern before inventing one). Default collapsed for beginners is defensible but changes current behavior; default open preserves it — pick and note. Keep the existing header buttons (Copy/Clear) inside.
- **Files:** `src/ui/laser/ConsolePanel.tsx` (modify — wrap; if this pushes it further past the soft limit, do MCH-13 first).
- **Tests:** test-first in `src/ui/laser/ConsolePanel.test.tsx`: the panel renders a `<summary>` and toggling it hides/shows the transcript region; persisted state round-trips.
- **ADR:** none (unless a default-collapsed choice is made — then a one-line divergence note).
- **Effort:** S  ·  **Depends on:** land after or together with MCH-13 (ConsolePanel is already ~373 counted lines; adding wrapper chrome without extracting helpers risks the 400 hard cap).
- **Risk:** ConsolePanel is close to the hard line cap — adding markup may trip CI. Sequence with MCH-13.

---

### MCH-12 · Move the CNC frame-retract jog literal into the GRBL driver
- **Fixes:** Driver-seam leak: ui/state builds a raw GRBL '$J=' line for the CNC frame retract — severity minor (verified: no verdict; original stands).
- **Root cause:** `laser-store`'s contract says "this file must not hardcode any protocol bytes" (laser-store.ts:2-3), but `cncFrameRetractLine` in ui/state hand-builds `$J=G90 G21 Z<z> F<f>` (laser-jog-actions.ts:107-110), justified by "CNC is GRBL-only (ADR-098)". That holds today, but grblHAL also reports `cncJobs:true` (grbl/driver.ts:54 inherited at grblhal/driver.ts:9-13), so a future CNC-capable non-`$J` firmware turns this into shotgun surgery.
- **Approach:** Add an optional `buildFrameRetract(zMm, feed): string | null` to `ControllerCommands` (controller-driver.ts) and implement it in the GRBL driver (in grbl/frame-lines.ts alongside `buildGrblFrameJogLines`, keeping it pure core). In `frame` (laser-jog-actions.ts:80-103) replace `cncFrameRetractLine(safeZMm, feed)` with `refs.driver.commands.buildFrameRetract?.(safeZMm, feed)`; if the driver returns null/undefined, skip the retract prefix (the seam now decides). Delete `cncFrameRetractLine` from ui/state.
- **Files:** `src/core/controllers/controller-driver.ts` (modify — type), `src/core/controllers/grbl/frame-lines.ts` (modify — impl), `src/ui/state/laser-jog-actions.ts` (modify — call driver, delete literal).
- **Tests:** test-first in `src/core/controllers/grbl/frame-lines.test.ts` (or the module's existing test): `buildFrameRetract(5, 1000)` returns byte-identical `$J=G90 G21 Z5.000 F1000\n` to the old literal. Guard the simulator lifecycle tests (`laser-lifecycle.simulator.test.ts`) still see the same frame bytes.
- **ADR:** none (implements the existing ADR-094 seam; no new decision).
- **Effort:** S  ·  **Depends on:** none.
- **Risk:** Must stay byte-identical (the retract line ends with a trailing `\n` — laser-jog-actions.ts:108-109 uses a literal newline). No G-code snapshot corpus impact (runtime frame jog, not job stream), but simulator byte assertions may cover it — run them.

---

### MCH-13 · Split ConsolePanel's pure transcript helpers into a module (tidy)
- **Fixes:** Several sector files sit well past the 250-line soft limit — severity minor (verified: no verdict; original stands).
- **Root cause:** Counted (non-blank/non-comment) lines: `ConsolePanel.tsx` ≈373, `grbl-settings.ts` ≈375, `laser-store.ts` ≈351 — all under the 400 hard cap but 40-50% past the soft limit where CLAUDE.md says stop-and-split. ConsolePanel mixes five subcomponents with pure filter/format helpers (`visibleEntries` 249-259, `formatTranscriptLine` 334-337, `rowStyleFor` 339-344, `consoleCommandDisabledReason` 309-332).
- **Approach:** Extract the four pure helpers (plus the row/style constants they use) into `console-transcript-view.ts`, imported by ConsolePanel. No behavior change — refactor-only PR. Leave `grbl-settings.ts` and `laser-store.ts` for when they are next touched (call that out; do not batch three unrelated splits into one PR).
- **Files:** `src/ui/laser/console-transcript-view.ts` (new), `src/ui/laser/ConsolePanel.tsx` (modify — import the helpers).
- **Tests:** move/extend the relevant assertions into `src/ui/laser/console-transcript-view.test.ts` (new) covering `visibleEntries` filtering and `consoleCommandDisabledReason`; existing `ConsolePanel.test.tsx` stays green (pure refactor).
- **ADR:** none.
- **Effort:** M  ·  **Depends on:** land before MCH-11 (which adds markup to the same file).
- **Risk:** Pure refactor — PR must be flagged as such (CLAUDE.md allows source-without-new-tests only for pure refactors). No functional change; verify ConsolePanel.test.tsx unchanged output.

---

### MCH-14 · Surface Verified-Frame state before Start
- **Fixes:** [Codex M-13] Frame verification state is invisible and signs less than the complete motion story — severity minor (verified: PARTIAL; corrected to minor).
- **Root cause (surviving kernel only):** The verifier REFUTED the safety claim — "framed envelope covers burn not motion" is a recorded decision (ADR-031 #5, DECISIONS.md:1326-1329), and both the frame action and Start preflight the FULL motion envelope incl. overscan (use-frame-action.ts:68,92-101,117-136; start-job-readiness.ts:97-104). What survives is UX discoverability: for a `verified-origin` start, the operator only learns whether a valid Verified Frame exists when Start *blocks* with the message at start-job-readiness.ts:192-195 (`findVerifiedFrameGateIssue`). There is no visible "frame verified / re-frame needed" indicator beforehand — `frameVerification` state (laser-store) has no dedicated UI reader in the rail.
- **Approach:** Add a small status indicator near the Frame/Start cluster (JobControls SetupRow, JobControls.tsx:91-140), shown only when the active placement mode is `verified-origin`, that reads `frameVerification` + current job/origin and computes validity with the existing pure `isVerifiedFrameValid` (start-job-readiness.ts:19,186-190) — e.g. a green "Frame verified" vs amber "Frame needed before Start" badge. This reuses the exact predicate Start already gates on, so it cannot drift from the block. Keep it read-only; do not change any preflight/gate logic (that part of the finding is a documented non-bug).
- **Files:** `src/ui/laser/JobControls.tsx` (modify — or a new `VerifiedFrameBadge.tsx` (new) mounted in SetupRow, preferred to keep JobControls under the component cap), consuming `frameVerification`/`wcoCache`/`workOriginActive` from laser-store and `isVerifiedFrameValid` from `state/frame-verification`.
- **Tests:** test-first in `src/ui/laser/JobControls.test.tsx` (or a new `VerifiedFrameBadge.test.tsx`): in verified-origin mode with a matching `frameVerification` the badge reads verified; after the job bounds change (signature mismatch) it reads "frame needed"; in non-verified modes the badge is absent.
- **ADR:** none.
- **Effort:** S (scoped to the surviving discoverability sliver; finding said M — the refuted safety half is not built).
- **Depends on:** none.
- **Risk:** Low, read-only. Must use `isVerifiedFrameValid` (not a re-implementation) so the badge and the Start gate never disagree.

---

#### Polish (deferred, one-liners)

| finding | one-line fix | effort |
|---|---|---|
| core jog builder throws for user-reachable invalid input instead of returning a Result (commands.ts:100-122,166-179) | When next touching commands.ts, return `Result<string,E>` from `buildJogCommand`/`assertJogHasAxis` (callers already guard reachable cases at laser-jog-actions.ts:51-54), or record them as assertion-class invariants in an ADR footnote per CLAUDE.md "Pure core". | S |
| Console has no user macros (ConsolePanel.tsx:72-77; grbl/driver.ts:81-88) | Keep deferred — divergence is RECORDED (WORKFLOW.md:707, PROJECT.md:486), so it is a roadmap note, not a bug. When revisited, macros fit through the existing `prepareConsoleCommand` per-firmware validation lane. | L |

---

## Non-GRBL controller stack (Ruida .rd / grblHAL / FluidNC / auto-detection) — implementation tickets

Grade B. The multi-controller seam (ADR-094..097) is sound; the breaches are all at the *edges* where a call site forgot to consult the driver/capability it had in hand. Four majors are single-call-site regressions with tight test-first fixes; the .rd honesty ticket is the one genuinely blocked on external evidence. Order: critical → major → minor. (No criticals in this sector.)

---

### CTL-01 · Add an `overrides` capability and gate the Feed/Spindle/Rapids controls on it
- **Fixes:** Realtime override buttons mounted for every controller family and write GRBL-only override bytes to Marlin/Smoothieware mid-job — severity major (verified: CONFIRMED)
- **Root cause:** `ControllerCapabilities` (src/core/controllers/controller-capabilities.ts:40-67) has no override flag, and the mount decision `shouldShowOverrides` at JobRunControls.tsx:67-69 is literally `isStreaming || isPaused` — kind- and capability-blind. `OverrideControls` fires GRBL 1.1 extended bytes (`RT_FEED_OV_*` etc., OverrideControls.tsx:6-17,23-25) and `sendRealtimeOverride` writes the raw byte straight through `safeWrite` (override-actions.ts:14-16; wired at laser-store.ts:390) with no gate. Marlin/Smoothieware have no realtime override bytes, so the 0x91–0x9D byte lands in their line buffer mid-stream and the `Ov:` readout stays `—` forever (no Ov field is parsed for them).
- **Approach:** Add `readonly overrides: boolean` to `ControllerCapabilities` with a comment ("GRBL 1.1 extended realtime override bytes 0x90–0x9D; false ⇒ the firmware has no realtime overrides and the byte would corrupt the line buffer"). Adding a *required* field forces every explicit capability object to declare it (tsc): set `overrides: true` in grbl/driver.ts:39-55 (grblHAL + FluidNC inherit via `...grblDriver` spread), and `overrides: false` in marlin/driver.ts:29-49, smoothieware/driver.ts:28-44, ruida/driver.ts:15-31. Change `shouldShowOverrides` to also require `capabilities.overrides` (read `useLaserStore((s) => s.capabilities.overrides)` in `RunningControls`, pass it into the guard). Add a defense-in-depth no-op guard: in the store wiring for `sendRealtimeOverride` (laser-store.ts:390) or inside `overrideActions`, drop the write when `!capabilities.overrides`. No G-code snapshot churn (UI + data only).
- **Files:** src/core/controllers/controller-capabilities.ts (modify); src/core/controllers/grbl/driver.ts, marlin/driver.ts, smoothieware/driver.ts, ruida/driver.ts (modify); src/ui/laser/JobRunControls.tsx (modify); src/ui/state/override-actions.ts or src/ui/state/laser-store.ts (modify, for the send guard)
- **Tests:** test-first in src/core/controllers/grbl-family-drivers.test.ts — add a case `exposes realtime overrides only on GRBL-family firmwares` mirroring the existing probing/cncJobs pins (grbl/grblhal/fluidnc `true`; marlin/smoothieware/ruida `false`). Also extend src/ui/laser/OverrideControls.test.tsx (or a new JobRunControls.test.tsx) so that with a marlin capabilities snapshot the override box does not mount and `sendRealtimeOverride` is never called.
- **ADR:** none — extends the established `ControllerCapabilities` pattern (probing, cncJobs) and *restores* the ADR-094 "gate on capability, never kind" rule; not a new architectural choice.
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Purely additive gating. Only risk is the exhaustive-object type change touching 4 driver files; grbl-family-drivers.test.ts already asserts grblHAL/FluidNC capabilities `toEqual(grblDriver.capabilities)`, so those pass automatically once grbl sets `true`.

---

### CTL-02 · Send the driver's `settleDwell` (Marlin `M400`) after a job, not a hardcoded `G4 P0.01`
- **Fixes:** Post-job settle bypasses the driver seam: hardcoded GRBL `G4 P0.01` sent to every family — severity major (verified: CONFIRMED)
- **Root cause:** laser-post-job-settle.ts:21 defines `SETTLE_DWELL_COMMAND = 'G4 P0.01\n'` and sends it at line 51, ignoring `driver.commands.settleDwell` — the field ADR-095 created precisely so Marlin's marker is `M400` (marlin/commands.ts:13, marlin/driver.ts:64). The seam contract is explicit at controller-driver.ts:45-47 ("GRBL 'G4 P0.01'; Marlin 'M400' which acks only when buffered motion has drained"). The sibling home action already does it right (`${driver.commands.settleDwell}\n`, laser-home-action.ts:85), making this the one divergent live call site. On Marlin, `G4 P` is milliseconds and acks immediately, so the settle can log "Controller settled" and clear the streamer while buffered motion still runs.
- **Approach:** The runtime `refs` object here is `LiveRefs`/`HandlerRefs`, which already carries `driver` (laser-store.ts:220; laser-line-shared.ts:13-17) — the call at laser-stream-ack.ts:43 passes it — but `beginPostJobSettle`'s parameter is typed `ControllerLifecycleRefs`, which hides `.driver`. Widen both `beginPostJobSettle` and `runPostJobSettle` to accept `HandlerRefs` (import from laser-line-shared; ui→ui), delete the `SETTLE_DWELL_COMMAND` constant, and set `command: \`${refs.driver.commands.settleDwell}\n\`` (matches the home action's `\n` handling; GRBL_SETTLE_DWELL has no trailing newline).
- **Files:** src/ui/state/laser-post-job-settle.ts (modify)
- **Tests:** test-first in src/ui/state/laser-post-job-settle.test.ts — the existing suite connects with a `Grbl 1.1f` banner; add a Marlin variant (`connect(..., { controllerKind: 'marlin' })`, banner `start`/`FIRMWARE_NAME:Marlin`) that captures writes and asserts the post-job settle marker written is `M400\n`, not `G4 P0.01\n`. (Optionally assert via the Marlin lifecycle simulator that the operation does not complete until pendingMotions drains, per the finding.)
- **ADR:** none — bug fix restoring ADR-095's stated contract.
- **Effort:** S  ·  **Depends on:** none
- **Risk:** No G-code snapshot churn (settle marker is a runtime store write, not compiled output). GRBL behavior is byte-identical (`settleDwell` is `'G4 P0.01'`). Ruida's `settleDwell` is `''` but Ruida is file-only and never streams, so the path is unreachable there.

---

### CTL-03 · Couple `streamingMode` to `controllerKind` so a Marlin/Smoothie board can never char-count
- **Fixes:** streamingMode is never coupled to controllerKind: the wizard's detection overlay can produce a char-counted Marlin profile ADR-095 calls unsafe — severity major (verified: CONFIRMED)
- **Root cause:** Ping-pong for Marlin/Smoothieware exists only as static data in two catalog profiles (profile-catalog.ts:148,173, comment "ping-pong … is the only safe streaming mode"). Nothing enforces it: `initDeviceSetup` stamps `detectedControllerKind` into the draft (device-setup-flow.ts:100) while `streamingMode` rides through unchanged from the baseline profile (default `char-counted`, device-profile.ts:240). `deserialize-project.ts` normalizes the two fields independently (lines 225,246-249), and `runStartJobFlow` passes `project.device.streamingMode` verbatim (start-job-flow.ts:63). Banner detection genuinely mints `marlin` from a GRBL baseline (detect-controller.ts:19-21), so a user who starts from a GRBL profile, connects to a Marlin board, and accepts detection finishes with `controllerKind:'marlin'` + `char-counted` — up to 128 unacked bytes in flight against a firmware with no buffer reporting.
- **Approach:** Add `readonly forcedStreamingMode: GrblStreamingMode | null` to `ControllerDriver` (controller-driver.ts:67-82): `'ping-pong'` for marlin + smoothieware, `null` for GRBL-family + ruida (GRBL keeps the profile's own choice). (a) **Load-bearing safety net at the start boundary:** in start-job-flow.ts (both start and resume paths, lines 63 & 172-174) resolve `selectControllerDriver(project.device.controllerKind).forcedStreamingMode ?? project.device.streamingMode` — this protects hand-edited project files and the deserialize path, not just the wizard. (b) **UX correctness in the wizard:** in `initDeviceSetup` (device-setup-flow.ts:97-101) and the `accept-detected` overlay, when a `detectedControllerKind` is applied, also set `streamingMode` to that driver's forced mode so the Review step shows the truth. (device-setup-flow is ui/ and may import the pure `selectControllerDriver` from core.)
- **Files:** src/core/controllers/controller-driver.ts (modify); src/core/controllers/marlin/driver.ts, smoothieware/driver.ts, grbl/driver.ts, grblhal/driver.ts, fluidnc/driver.ts, ruida/driver.ts (modify — new required field); src/ui/laser/start-job-flow.ts (modify); src/ui/laser/device-setup/device-setup-flow.ts (modify)
- **Tests:** test-first in src/ui/laser/device-setup/device-setup-flow.test.ts — `initDeviceSetup` with a `char-counted` GRBL baseline + `detectedControllerKind: 'marlin'` must yield `draft.streamingMode === 'ping-pong'`. Plus a start-boundary test (extend an existing startJob/laser-store test) asserting a marlin profile carrying `char-counted` streams in `ping-pong`.
- **ADR:** NEEDED — driver-declared forced streaming mode coupled to controllerKind (records the LightBurn-parity rule "a Marlin-type device never char-counts").
- **Effort:** M (top of M — one core type + 3 consumers)  ·  **Depends on:** none. Shares the "new required ControllerDriver field forces all 6 driver objects" mechanic with nothing else, but coordinate with CTL-01 if both land to avoid churn collisions on the driver files.
- **Risk:** New required field touches all driver objects (grbl-family-drivers.test.ts `commands`/`capabilities` `toEqual` assertions are unaffected — the field is top-level on the driver, not inside `commands`/`capabilities`; add an explicit pin instead). A silent override changes which streaming mode runs — but toward the *safe* mode, matching LightBurn; surface it in the Review step so it isn't invisible.

---

### CTL-04 · Delete the false ".rd golden hex fixtures" claim and record the Ruida min==max power mapping
- **Fixes:** .rd verification is circular and the encoder header claims 'golden hex fixtures' that do not exist — severity major (verified: CONFIRMED)
- **Root cause:** rd-encoder.ts:3-5 states determinism is "pinned by golden hex fixtures." No such fixture exists — repo-wide there is no `**/*.rd` and no rd `__snapshots__`; the actual determinism check (ruida.test.ts:97-102) is a same-process double-encode, and the only structural check round-trips through this repo's own decoder (ruida.test.ts:104-126; ruida-decoder.ts:1-4 self-labels as internal-consistency-only). This is a no-invention-rule violation in the one subsystem whose entire story is honesty labeling. Separately, rd-encoder.ts:68-69 writes the single `group.power` into BOTH `layerMinPower` (0xC6 0x31) and `layerMaxPower` (0xC6 0x32) — LightBurn exposes Min/Max Power separately on Ruida (min==max disables the DSP cornering power ramp-down), a divergence ADR-097 does not record.
- **Approach:** Three separable PRs — do NOT batch:
  1. **(S, do now)** Correct the rd-encoder.ts:3-5 header: replace "golden hex fixtures pin it" with the truth ("determinism is pinned by a same-process double-encode test; NO reference `.rd` from real hardware or LightBurn exists yet — see ADR-097"). This is the honest kernel and closable immediately.
  2. **(ADR)** Record the min==max power mapping in ADR-097 as a deliberate current limitation, OR plumb a separate min power. `Job` cut groups currently carry a single `power` (ruida.test.ts:28 shape), so a true Min/Max split is a cross-cutting Job-model change — record the decision now, defer the plumbing.
  3. **(Deferred, external)** Acquire one LightBurn-exported `.rd` for a known simple job and add a decode/diff test against it. This is the only real verification and is blocked on an external artifact — it CANNOT be closed by a code PR alone; track as a hardware/reference-file task.
  emit-rd.ts unit tests (raster refusal, bounds/no-go, empty job) are covered by CTL-10 — do not duplicate here.
- **Files:** src/core/controllers/ruida/rd-encoder.ts (modify — comment); DECISIONS.md ADR-097 (modify — record min==max)
- **Tests:** PR-1 is a comment-only change (no test). PR-3 adds the reference-`.rd` fixture + a decode test when the artifact exists. Note the CLAUDE.md test-modification rule: PR-1 is a docs/comment change; flag it as such in the PR body.
- **ADR:** NEEDED — Ruida layer min==max power mapping (record the divergence from LightBurn's separate Min/Max Power, or decide to plumb separate min power).
- **Effort:** S for the comment kernel; the finding's L is dominated by the external reference-file verification that no in-repo diff can substitute for.  ·  **Depends on:** none. Reference emit-rd test coverage → CTL-10.
- **Risk:** PR-1 is zero-risk. The min==max ADR must not silently change emitted bytes; if step 2 ever plumbs a real min power it is a `.rd` byte change (there is no snapshot, so add the reference test FIRST or a regression passes silently — the very gap this ticket names).

---

### CTL-05 · Teach the Smoothieware status parser the classic comma-delimited report format
- **Fixes:** Smoothieware status parsing only accepts GRBL-1.1 pipe format; comma-delimited reports classify as unknown — severity minor (verified: not adversarially checked; original finding)
- **Root cause:** `classifySmoothieResponse` delegates to the GRBL `parseStatusReport` (smoothieware/response.ts:25), which splits fields on `|` (status-parser.ts:104). A classic Smoothie report `<Idle,MPos:0.0,0.0,0.0,WPos:...>` yields a single field whose `parseState` fails, so `parseStatusReport` returns null and the line falls to `unknown` (response.ts:31). The Smoothie simulator only ever emits the pipe/grbl-mode format (smoothie-simulator.ts:65), so the suite cannot catch it. Consequence: DRO never updates, `controllerIdle` stays false (JogPad disabled, LaserWindow.tsx:52,92-93), and the halt flow can't raise the alarm banner from status state.
- **Approach:** Add a Smoothie-specific normalization in smoothieware/response.ts that, before delegating, rewrites a comma-format inner body to the pipe grammar `parseStatusReport` already understands (split state off the first comma, regroup `MPos:x,y,z` / `WPos:...` axis triples) — keep GRBL's `status-parser.ts` untouched so no GRBL behavior shifts. Add a catalog note to `GENERIC_SMOOTHIEWARE_PROFILE` (profile-catalog.ts:181-187) documenting any `grbl_mode`/`new_status_format` firmware assumption until a hardware pass settles which format real boards emit. NOT verified which format current stock Smoothie builds emit — state that in the ticket and the note.
- **Files:** src/core/controllers/smoothieware/response.ts (modify, or a new smoothieware/status-parser.ts if the transform exceeds ~20 lines — default to a new file per CLAUDE.md); src/__fixtures__/controllers/smoothie-simulator.ts (modify — add a comma-format emission path for the test); src/core/devices/profile-catalog.ts (modify — note)
- **Tests:** test-first in a co-located src/core/controllers/smoothieware/response.test.ts — `classifySmoothieResponse('<Idle,MPos:0.0,0.0,0.0,WPos:0.0,0.0,0.0>')` must return `{ kind: 'status', report: { state: 'Idle', … } }`, and the existing pipe format must still parse.
- **ADR:** none if treated as a tolerant-parser parity fix. If the team instead decides to REQUIRE `new_status_format` and reject the classic format, that is a divergence → ADR NEEDED.
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Keep the transform Smoothie-only; touching `status-parser.ts` would ripple into GRBL/grblHAL/FluidNC. Pure core — return values, no throw.

---

### CTL-06 · Stop stripping undescribed error codes to `null`, and correct the grblHAL "extended error tables" comment
- **Fixes:** grblHAL driver comment claims extended error tables, but error codes stop at 38 and unknown numeric codes are stripped to null — severity minor (verified: not adversarially checked; original finding)
- **Root cause:** grblhal/driver.ts:2-3 says "extended alarm/error code tables handled by the shared describe* lookups," but error-codes.ts ends at code 38 (line 134) and `matchError` degrades any code without a table entry to `{ code: null }`, keeping only the raw string (grbl/response.ts:63-67). grblHAL's extended errors (39+) are absent, so a grblHAL line rejection mid-job terminates the stream safely but the operator gets no explanation and structured state loses the number. Alarms partially deliver (grblHAL 10-13 present, per grbl-family/profile notes), so the comment overstates errors specifically.
- **Approach:** Smallest correct fix is two-fold, but they are separable: (1) In `matchError` (grbl/response.ts:60-68), keep the parsed numeric code even when `describeError` returns null: `return { kind: 'error', code, raw: line }` for the undescribed-numeric branch, so the UI/log can show `error:45` instead of a bare string. (2) Fix the grblhal/driver.ts comment to match reality ("shares GRBL's alarm table incl. grblHAL 10-13; error descriptions cover vanilla GRBL 1-38 only") — OR, if the team wants full coverage, extend `ERRORS` in error-codes.ts with the documented grblHAL 39-79 range. Prefer (1)+comment first; table extension is a larger data task.
- **Files:** src/core/controllers/grbl/response.ts (modify); src/core/controllers/grblhal/driver.ts (modify — comment); optionally src/core/controllers/grbl/error-codes.ts (modify — if extending the table)
- **Tests:** test-first in src/core/controllers/grbl/response.test.ts (or co-located) — `matchError` on `error:45` (an undescribed code) must return `{ kind: 'error', code: 45, raw: 'error:45' }`, not `{ code: null }`. Guard the existing described-code cases still return `{ kind: 'error', code }`.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Keeping the numeric code is a `ControllerEvent` shape change consumers may switch on — audit `classifyResponse` consumers for exhaustiveness. Pure core. No G-code snapshot impact.

---

### CTL-07 · Route .rd save on a `file-only`/output-format capability, not `controllerKind === 'ruida'` in ui/
- **Fixes:** Ruida save dispatch is a controllerKind check in ui/, the pattern ADR-094 bans — severity minor (verified: not adversarially checked; original finding)
- **Root cause:** file-actions.ts:137 routes Save to the .rd path via `ctx.project.device.controllerKind === 'ruida'` — exactly the "`kind === 'grbl'` in ui/ is the same anti-pattern class as platform conditionals" ADR-094 bans (DECISIONS.md:3623). The sibling gate in LaserWindow.tsx:60-61 already does it right (`selectControllerDriver(kind).capabilities.transport === 'file-only'`). A second binary-output family would force a shotgun edit here.
- **Approach:** Replace the `controllerKind === 'ruida'` branch with a capability lookup. Minimal: `selectControllerDriver(ctx.project.device.controllerKind).capabilities.transport === 'file-only'`, mirroring LaserWindow. Cleaner (optional): introduce `outputFormat: 'gcode-text' | 'rd-binary'` on `ControllerCapabilities`, consumed by both the save action and LaserWindow — but that is a broader change; do the transport-capability swap now to match the working sibling. This is a pure refactor (no behavior change) — land it before any file-format additions.
- **Files:** src/ui/app/file-actions.ts (modify)
- **Tests:** src/ui/app/file-actions.test.ts already exercises the G-code path (line 311). Add a case asserting a `ruida`/file-only profile routes to `handleSaveRd` and a serial profile does not — proving the dispatch is capability-driven, not string-matched. (Refactor, but a co-located test guards the routing invariant.)
- **ADR:** none — applies the existing ADR-094 rule. If the `outputFormat` capability route is chosen instead, ADR: NEEDED — output-format capability.
- **Effort:** S  ·  **Depends on:** none. Related to CTL-08 (both are Ruida-save UX) but a distinct concern; keep separate PRs.
- **Risk:** `refactor:` PR — behavior must be byte-identical. Selecting the driver for an unknown kind is already guarded by deserialize normalization (deserialize-project.ts:246-256).

---

### CTL-08 · Make the File-menu save label device-aware ("Save .rd file…" on Ruida)
- **Fixes:** File menu still says "Save G-code…" on Ruida profiles even though it writes a binary .rd — severity minor (verified: not adversarially checked; original finding)
- **Root cause:** The command label "Save G-code..." is static (command-families.ts:44-50) regardless of device; on a Ruida profile it produces a `.rd`. The Laser-rail hint then apologizes for the mislabel — "use Save G-code… to write an experimental .rd job" (LaserWindow.tsx:111-114). WORKFLOW F-H4 (WORKFLOW.md:2437) documents the routing ("Save G-code… writes a `.rd` file instead") but not the label choice; LightBurn relabels the action per active device.
- **Approach:** Make the `file.save-gcode` command label device-aware. Where the command family is built (command-families.ts, the `enabled('file.save-gcode', …)` call), derive the label from the active driver: `selectControllerDriver(device.controllerKind).capabilities.transport === 'file-only' ? 'Save .rd file…' : 'Save G-code…'` (thread the active device/driver into the command-family builder if not already available). Then simplify the LaserWindow.tsx:111-114 hint to drop the self-referential "use Save G-code…" apology.
- **Files:** src/ui/commands/command-families.ts (modify); src/ui/laser/LaserWindow.tsx (modify — hint text)
- **Tests:** co-located command-families test (or extend an existing one) asserting the `file.save-gcode` label is "Save .rd file…" for a file-only profile and "Save G-code…" otherwise. If command-families has no test harness, this is a thin UI-string change — state that the label was verified by reading the builder, not rendered.
- **ADR:** none — matches LightBurn.
- **Effort:** S  ·  **Depends on:** none. Sibling of CTL-07 (Ruida save UX); separate concern/PR.
- **Risk:** The keyboard shortcut and command id must stay `file.save-gcode`/`Ctrl+Shift+E` (only the display label changes) so muscle memory and any tests keying on the id are unaffected.

---

### CTL-09 · Give FluidNC a console override that refuses (or warns on) numeric `$N=value` writes
- **Fixes:** FluidNC console still accepts numeric `$N=value` setting writes that the capability model says the app must not send — severity minor (verified: not adversarially checked; original finding)
- **Root cause:** `fluidncDriver` inherits GRBL's `prepareConsoleCommand` unchanged (fluidnc/driver.ts:10-19 spreads `...grblDriver`), whose `SETTING_WRITE_RE = /^\$\d+=\S.*$/` accepts `$32=1` as a confirmable `setting-write` (console-command.ts:35,59-61). But the FluidNC `settings` capability is `readonly-dump`, the Guarded Writes panel refuses numeric writes (MachineSetupController.tsx:57-66), and the driver's own header says FluidNC legacy-maps or IGNORES numeric writes (fluidnc/driver.ts:2-5). So the console can accept `$32=1`, show `ok`, and change nothing — silently desyncing the operator's model and the next `$$` snapshot.
- **Approach:** Add a `prepareConsoleCommand` override to `fluidncDriver` that wraps the GRBL `prepareConsoleCommand`: when the input matches a numeric `$N=value` write (reuse/export the `SETTING_WRITE_RE` shape from console-command.ts), return `{ ok: false, reason: … }` (or a warn-and-allow) pointing at FluidNC's YAML config, consistent with the panel's wording ("This controller does not accept numeric $ setting writes from the app. Configure the firmware with its own tools."). Keep all other console traffic (status, `$$`, G-code) passing through unchanged. Whether to hard-reject or warn-and-pass is the LightBurn-divergence decision (LightBurn passes raw) → ADR.
- **Files:** src/core/controllers/fluidnc/driver.ts (modify — add override; likely a new src/core/controllers/fluidnc/console-command.ts to keep the driver thin and under limits); src/core/controllers/grbl/console-command.ts (modify — export `SETTING_WRITE_RE` if reused rather than re-declared)
- **Tests:** test-first co-located src/core/controllers/fluidnc/console-command.test.ts (or grbl-family-drivers.test.ts) — `fluidncDriver.prepareConsoleCommand('$32=1').ok === false` with the config-pointer reason, while `$$`, `?`, and a plain G-code line still prepare successfully.
- **ADR:** NEEDED — FluidNC console rejects (or warns on) numeric `$`-writes: a deliberate divergence from LightBurn's raw pass-through, justified by KerfDesk's own `readonly-dump` contract. (Records reject-vs-warn.)
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Must not over-block — only numeric `$N=value`; `$#`, `$G`, `$$`, `$X`, `$J=` etc. must still pass (the GRBL grammar already special-cases those before `SETTING_WRITE_RE`). Pure core, returns a `Result`, no throw.

---

### CTL-10 · Pass the Uint8Array straight to Blob and add the missing .rd save-path tests
- **Fixes:** .rd byte write relies on a fragile buffer cast and the whole save path has zero tests — severity minor (verified: not adversarially checked; original finding)
- **Root cause:** save-rd-action.ts:41 writes `new Blob([result.bytes.buffer as ArrayBuffer])` — passing the UNDERLYING buffer, correct only because `swizzleBytes` happens to allocate an exact-size `Uint8Array` (swizzle.ts:33). Any future subarray/view would silently append or truncate bytes in the exported laser file. `Blob` accepts `ArrayBufferView`, so `new Blob([result.bytes])` is strictly safer and drops the `as ArrayBuffer` assertion. No test exercises `handleSaveRd` or `emitRdFile` (no `src/io/rd/*.test.ts`; file-actions.test.ts:311 covers only the G-code path), so a regression in a binary format bound for a CO2 laser would surface only on hardware.
- **Approach:** (1) Replace `new Blob([result.bytes.buffer as ArrayBuffer])` with `new Blob([result.bytes])` and delete the type assertion (save-rd-action.ts:41). (2) Add co-located tests for `emitRdFile` covering the typed refusals and preflights it already implements (emit-rd.ts): raster-layer refusal, no-go-zone/out-of-bed bounds failure, empty-job. (3) Add a `handleSaveRd` test asserting the `Blob` handed to `SaveTarget.write` contains bytes byte-equal to `encodeRdJob`/`emitRdFile` output (guards the buffer-cast regression directly).
- **Files:** src/ui/app/save-rd-action.ts (modify); src/io/rd/emit-rd.test.ts (new); src/ui/app/save-rd-action.test.ts (new) — new files per CLAUDE.md default-to-new-file rule
- **Tests:** as above — these ARE the test-first additions. The `handleSaveRd` test reads back the written Blob (`await blob.arrayBuffer()`) and compares to `emitRdFile(...).bytes`.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none. Absorbs the "add emit-rd.ts tests" recommendation from CTL-04 — do the emit-rd coverage here, not there.
- **Risk:** Behavior-preserving (`Blob` from a full-length view is byte-identical to `Blob` from its buffer). The new tests are the safety net the .rd path currently lacks entirely.

---

#### Polish (deferred, one-liners)

| finding | one-line fix | effort |
|---|---|---|
| Marlin & Smoothieware jog/frame builders are byte-identical copy-paste (marlin/commands.ts:35-62 vs smoothieware/commands.ts:27-54) | Extract a shared `core/controllers/relative-jog-commands.ts` (relative G91 jog + absolute G90 frame builders) consumed by both drivers, per the CLAUDE.md "extract on the second occurrence" rule; pure refactor, wire bytes must stay identical. | S |

---

## Electron desktop platform: security posture, auto-update & web-vs-desktop parity — implementation tickets

Sector grade: **B+**. No critical found. Two majors (auto-update integrity, cross-origin bridge), seven minors. Findings read against the actual tree at `electron/` and `src/platform/electron/`; pinned deps are `electron ^42.3.0`, `electron-updater ^6.8.9`, `electron-builder ^26.15.3` (package.json:45,63,64). Corrections vs the raw findings are called out per ticket (notably finding 2 was down-graded to minor by the verifier, and finding 5's effort is larger than stated once the no-IPC constraint is accounted for).

---

### ELE-01 · Add an app-owned integrity gate to the desktop auto-update channel
- **Fixes:** "Auto-update channel has no signature verification — a tampered update on the pinned feed installs silently on quit" — severity major (verified: **CONFIRMED**, stays major). Headline finding for this epic.
- **Root cause:** `configureAutoUpdater` sets `autoDownload = true` + `autoInstallOnAppQuit = true` and fires `checkForUpdatesAndNotify()` with zero integrity logic (`electron/auto-update.ts:41-46`), wired unconditionally when packaged (`electron/main.ts:408-411`). The build is unsigned by design (`.github/workflows/release-desktop.yml:88-90` forces `CSC_IDENTITY_AUTO_DISCOVERY:false` when no cert secret; `electron-builder.yml:44-46` is the generic provider pinned to `https://dl.kerfdesk.com/desktop` with no `win:` signing block). electron-updater therefore performs **no** publisher-signature check; the only integrity control is the SHA512 inside `latest.yml`, which is served from the same origin an attacker would already control. ADR-024 §5 (`DECISIONS.md:4012-4017`) explicitly concedes the channel is unhardened "until signing lands." Anyone who can serve that origin (R2/API-token compromise, DNS, or a mis-issued cert + MITM) can publish a higher-version `latest.yml`+`.exe` with a matching hash → silent install-on-quit → RCE. Downgrade is refused (electron-updater default `allowDowngrade=false`); tamper-with-higher-version is not.
- **Approach:** The terminal fix is Windows code signing (electron-updater then verifies the publisher signature automatically) but that is ops/secret-gated and cannot be landed or verified as a code PR here — track it as the follow-on. This ticket adds the interim, app-owned integrity control the audit calls for. Deliver as a short stack (each part its own PR):
  1. **Release-signing tidy (CI, no runtime behavior change):** in `release-desktop.yml`, after electron-builder emits `latest.yml`, produce a detached ed25519 signature `latest.yml.sig` over the exact `latest.yml` bytes using a private key from a new repo secret, and `wrangler r2 object put` it next to `latest.yml` (same `no-cache`). Add the matching **public** key as a named constant.
  2. **Runtime verification gate (fix):** in a new pure module `electron/update-integrity.ts`, add `verifyLatestYmlSignature(latestYmlBytes, sigBytes, pinnedPublicKey): Result<'ok', IntegrityError>` (Node `crypto.verify('ed25519', …)` lives in the io/main layer, not core, so throwing-for-control-flow rules do not apply, but keep it Result-returning for testability; the pinned key is a module-level `SCREAMING_SNAKE_CASE` constant). Rewire `configureAutoUpdater` (or a new `armVerifiedAutoUpdate`) to **not** rely on electron-updater's own unauthenticated `latest.yml` fetch: fetch `latest.yml`+`latest.yml.sig` from the pinned feed in main, verify, and only on success let the updater proceed. **Before implementing, verify the exact electron-updater 6.8.9 interposition point** (e.g. driving `autoDownload=false` + `update-available` → verify → `downloadUpdate()`, vs. a custom provider) against the installed version — do not assume an API. If robust interposition is not achievable in 6.8.9, fall back to the alternative below.
  - **Alternative (smaller, but reverses a maintainer decision):** switch to notify-only — `autoInstallOnAppQuit=false` and require an explicit operator action to install. This removes the silent-install RCE window with a ~5-line diff in `auto-update.ts`, but ADR-024 §Decision(2) deliberately chose *full* auto-update over notify-only, so this needs the ADR below plus maintainer sign-off.
  - Ops note (not a code diff): flag `CLOUDFLARE_API_TOKEN` + the new ed25519 signing key as high-value secrets in the release runbook.
- **Files:** `electron/update-integrity.ts` (new), `electron/update-integrity.test.ts` (new), `electron/auto-update.ts` (modify — arm only after verify), `electron/main.ts` (modify — pass the pinned key / verify hook), `.github/workflows/release-desktop.yml` (modify — emit + publish `latest.yml.sig`).
- **Tests:** test-first in `electron/update-integrity.test.ts`: (a) a valid ed25519 signature over known bytes verifies `ok`; (b) a tampered `latest.yml` byte, (c) a wrong/foreign key, and (d) a missing `.sig` each return the `IntegrityError` variant. Extend `electron/auto-update.test.ts` to assert the updater is **not** armed (no `autoDownload`/`checkForUpdatesAndNotify`) when verification fails. The end-to-end "tampered feed is refused on real Windows" case stays a manual WORKFLOW F-DESK3 checkbox — state plainly it is NOT unit-verifiable.
- **ADR:** NEEDED — "Desktop auto-update integrity: out-of-band ed25519 signature over latest.yml pinned in-app (interim until code signing); amends ADR-024 §5." (If the notify-only alternative is chosen instead, the ADR revises ADR-024 §Decision(2).)
- **Effort:** L  ·  **Depends on:** none in-epic. Cross-epic: the terminal code-signing work (secret provisioning, `win.azureSignOptions`/`CSC_*`) is a separate ops track; this ticket is the interim control and does not block it.
- **Risk:** Touches the release pipeline and the one sanctioned network call — a bug here can brick auto-update (fails safe: a failed verify must leave the app running on the installed version, mirroring the existing `onError` swallow). No G-code impact. Watch electron-updater API assumptions (the "no invention" trap — verify against 6.8.9 first). `electron/auto-update.ts` is tiny; new logic goes in a new file to respect size limits.

---

### ELE-02 · Tighten the loopback camera bridge's cross-origin trust and loopback frame-proxy reach
- **Fixes:** "Loopback camera bridge is drivable cross-origin by the hosted site and every *.pages.dev preview; usable as a private-network + localhost scanner" — severity major (verified: **CONFIRMED**, no correction). Residual-risk hardening of the documented ADR-121 design, not a contract violation.
- **Root cause:** `isTrustedHostedAppOrigin` (`electron/rtsp-camera-bridge.ts:230-242`) trusts `https://kerfdesk.com`, `https://laserforge-2fj.pages.dev`, **and** any `*.laserforge-2fj.pages.dev` (line 237 wildcard — every Cloudflare Pages preview of any branch/PR), and the bridge opts into Private Network Access (`Access-Control-Allow-Private-Network:true`, lines 40-42). Combined, any such origin the operator visits in a normal browser can drive `/discover`, `/frame.jpg?url=`, `/probe`, `/stream.mjpg`. The frame proxy's URL policy allows loopback targets on any non-bridge port — `targetsBridgeItself` (`electron/camera-frame-proxy-policy.ts:56-59`) refuses only the bridge's *own* port, so `http://127.0.0.1:<other>` is permitted (`camera-frame-proxy-policy.test.ts:41` asserts this on purpose). The private-network egress guard blocks public SSRF and the JPEG-magic/content-type check limits exfiltration to image-shaped bytes, but port-open/host-up detection via timing/errors on RFC1918 + localhost remains.
- **Approach:** Two independent tightenings (could be two PRs; both small):
  1. Drop the `.pages.dev` subdomain wildcard in `isTrustedHostedAppOrigin` — pin the exact production origin(s) only. If previews must stay reachable, gate them behind an explicit dev-only env flag rather than a permanent wildcard. Keep the existing loopback-dev-origin allowance untouched.
  2. In `camera-frame-proxy-policy.ts`, refuse **all** loopback targets (not just the bridge port): extend the recursion guard so any `localhost`/`::1`/`127.x` host is rejected, so the proxy cannot read *other* localhost services. Update the deliberate `camera-frame-proxy-policy.test.ts:41` expectation (now `invalid`).
  - Stretch (optional, note only): a per-session bridge token the desktop renderer knows, replacing Origin-header trust — larger, defer to its own ticket if the maintainer wants it.
- **Files:** `electron/rtsp-camera-bridge.ts` (modify — origin allowlist), `electron/camera-frame-proxy-policy.ts` (modify — loopback rejection), `electron/rtsp-camera-bridge.test.ts` (modify — drop preview-wildcard expectation at :23-25, add rejection case), `electron/camera-frame-proxy-policy.test.ts` (modify — flip :41 to invalid, add loopback cases).
- **Tests:** test-first: in `rtsp-camera-bridge.test.ts` add a case asserting `cameraBridgeCorsOrigin('https://<random-hash>.laserforge-2fj.pages.dev')` returns `null` after the change; in `camera-frame-proxy-policy.test.ts` add cases asserting `http://127.0.0.1:8080/...` and `http://localhost:9000/...` are now `invalid`. These fail against current code, pass after the fix.
- **ADR:** NEEDED — "Camera bridge trusts only the pinned production origin (no preview wildcard) and refuses all loopback frame-proxy targets." Records a deliberate tightening of ADR-121's origin/target policy.
- **Effort:** M  ·  **Depends on:** none.
- **Risk:** Behavioral — a preview-build deploy of the app can no longer reach a locally-running bridge (intended); confirm the production origin string is exact (`kerfdesk.com` and, if still used, the canonical Pages origin). A legitimate local test camera on loopback can no longer be proxied (call out in the ticket; machine cameras live on RFC1918, not loopback, so real hardware is unaffected). No G-code/core impact.

---

### ELE-03 · Correct PROJECT.md's Electron permission allowlist (camera + wake-lock omitted)
- **Fixes:** "Security-posture doc understates the actual Electron permission allowlist (camera + wake-lock omitted)" — severity major (verified: **CONFIRMED**, **corrected to minor** by verdict). Docs-only.
- **Root cause:** `PROJECT.md:427` states the permission handler "returns `false` except for `serial` and any `fileSystem*` permission," but the shipped policy also grants `media` (video-only, main-frame, trusted origin) and `screen-wake-lock`. Verified in `electron/trusted-renderer-policy.ts`: `media` at lines 94-99 (check: `isMainFrame===true && mediaType==='video'`) and 101-106 (request: `mediaTypes` exactly `['video']`), `screen-wake-lock` at lines 116-120, both wired live in `electron/main.ts:225-263` (installed at :376). Audio is denied. This is real code/doc drift, exactly what CLAUDE.md's "no invention / verify" rule exists to catch, and it hides the camera capability from the authoritative posture summary.
- **Approach:** Edit `PROJECT.md` Security posture, the "Electron hardening" bullet (line 427). Replace the allowlist clause with the full set: `serial`, any `fileSystem*` (File System Access, Electron 33+), `media` (video-only, main-frame, trusted origin — audio denied), and `screen-wake-lock`. Cite ADR-107/ADR-108 (camera `media`) and ADR-117 (`screen-wake-lock`). Mirror the same correction into ADR-024's hardening note if it restates the allowlist. Optionally note the enforced-invariant test proposed below.
- **Files:** `PROJECT.md` (modify, line 427). Consider `electron/trusted-renderer-policy.test.ts` (modify) to add a test asserting the granted-permission set equals the documented list, so the two cannot drift again — that test half could instead ride ELE-08's parity theme; keep this ticket docs-only unless the maintainer wants the test bundled.
- **Tests:** docs-only, no test (unless the anti-drift test is opted in, in which case add it to `trusted-renderer-policy.test.ts`).
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none. May land as one PROJECT.md doc-sync PR together with ELE-09 (both PROJECT.md-only, non-overlapping sections) if the maintainer prefers — otherwise keep separate.
- **Risk:** None runtime. **EOL trap:** `PROJECT.md` is LF (verified) and prettier-ignored — preserve LF; verify with `git diff --stat` that no CRLF flip snuck in.

---

### ELE-04 · Accept IPv6 ULA/link-local in the camera egress guard (or document IPv4-only)
- **Fixes:** "Egress guard rejects all IPv6 private hosts except ::1 (no ULA/link-local) — IPv6 machine cameras silently unreachable" — severity minor (verified: no verdict override; stands as minor).
- **Root cause:** `isAllowedPrivateNetworkHost` (`electron/private-network-host-policy.ts:7-11`) accepts only `localhost`, `::1`, and RFC1918 IPv4; every other IPv6 literal (fc00::/7 ULA, fe80::/10 link-local) falls through to `isAllowedIpv4Host` (lines 13-24), fails the dotted-quad parse, and is refused with an opaque "private-network hosts only" error. This is a safe **under-allow** (not the earlier over-allow fc00::/fd00:: class), but it makes an IPv6-only camera unreachable. `private-network-host-policy.test.ts:6-28` has no IPv6-ULA/link-local cases.
- **Approach:** Primary (if IPv6 cameras are in scope): add a small pure `isAllowedIpv6Host` helper that parses the literal and classifies the first hextet — accept fc00::/7 (first byte `0xfc`/`0xfd`) and fe80::/10 (`fe80`–`febf`), reject everything else. Route bracketed/unbracketed IPv6 to it before the IPv4 parser. Keep the conservative default — do **not** broaden to "any non-public IPv6." Pure module, stays in electron/ (io/main layer), no core-purity concern. Alternative (if out of scope): docs-only — add the IPv4-only limitation to WORKFLOW F-CAM6 (`WORKFLOW.md:2794`) and stop there.
- **Files:** `electron/private-network-host-policy.ts` (modify), `electron/private-network-host-policy.test.ts` (modify). Alternative path: `WORKFLOW.md` F-CAM6 (modify, docs-only).
- **Tests:** test-first in `private-network-host-policy.test.ts`: add `fc00::1`, `fd12:3456::1`, `[fe80::1]` → `true`; add a public/global IPv6 (`2001:4860:4860::8888`) → `false`. These fail today, pass after the helper lands.
- **ADR:** none (an under-allow widening within the existing private-network intent; note the fc00:: precedent in the PR description).
- **Effort:** S  ·  **Depends on:** none.
- **Risk:** Low — correct IPv6 first-hextet classification is the only subtlety (expand `::` correctly; a malformed literal must return false, not throw). No public host must ever be accepted. No G-code/core impact.

---

### ELE-05 · Register OS file associations and route double-clicked project files into the desktop app
- **Fixes:** "No OS file association / file re-open on desktop — double-clicking a project file does not open KerfDesk" — severity minor (verified: no verdict override; stands as minor). Effort corrected **M → L** (see risk).
- **Root cause:** `electron-builder.yml:17-31` declares only the NSIS target and no `fileAssociations`, and `electron/main.ts` has no `second-instance`/`open-file`/argv handling, so a `.lf2`/SVG/G-code file double-clicked in Explorer or via "Open with" neither launches nor loads the app. LightBurn registers its project extensions and opens them on double-click; KerfDesk desktop supports drag-into-window only (`WORKFLOW.md:72`), so this is a muscle-memory parity gap.
- **Approach:** Two parts. (1) Add `win.fileAssociations` to `electron-builder.yml` for the project extension(s) (`.lf2`) and, if desired, SVG/G-code. (2) Handle the launch path in `main.ts`: `app.requestSingleInstanceLock()` + a `second-instance` handler to route the argv file to the already-running window, plus first-launch argv parsing. **Constraint that drives the effort up:** the shell has *no preload/contextBridge/ipcMain by design* (the core security win, ADR-024 Consequences). Handing a file path to the renderer therefore cannot use IPC without adding a hardened `contextBridge` (which ADR-024 explicitly defers to its own ADR). The boundary-respecting option is to encode the path into the `app://` load URL (e.g. a query param the renderer reads on boot) rather than open an IPC channel — decide this in the ADR. Extract argv→file-path selection into a pure helper (`electron/open-file-argv.ts`, new) so it is unit-testable; the window-routing wiring stays in `main.ts`.
- **Files:** `electron-builder.yml` (modify), `electron/main.ts` (modify — single-instance + routing), `electron/open-file-argv.ts` (new — pure argv/path parse), `electron/open-file-argv.test.ts` (new), `WORKFLOW.md` F-DESK1/F-DESK3 (modify — document the launch flow), and a small renderer boot read of the URL param if that transport is chosen.
- **Tests:** test-first in `electron/open-file-argv.test.ts`: given argv arrays (Windows first-run with a trailing file path, a `second-instance` argv, a no-file launch, a flag-only argv), assert the extracted file path (or `null`). The packaged double-click / drag-to-icon behavior is only verifiable on real Windows — add a WORKFLOW F-DESK3 checkbox and state it is NOT unit-verifiable.
- **ADR:** NEEDED — "Desktop file associations + shell-launch file routing without adding an IPC surface (path via app:// URL param)." Records how this stays inside the no-preload posture.
- **Effort:** L (raised from M — the no-IPC routing + single-instance + ADR make it more than a config add)  ·  **Depends on:** none.
- **Risk:** Single-instance lock changes app-lifecycle behavior (a second launch now focuses the existing window instead of spawning) — verify against the existing `activate`/`window-all-closed` handlers (`main.ts:419-431`). If the path is passed via the `app://` URL, ensure the existing path-traversal guard and the renderer's importer treat it as untrusted input. `main.ts` size — keep new logic in the new module.

---

### ELE-06 · Platform-gate the PWA service-worker registration off on desktop
- **Fixes:** "PWA service-worker update path is not platform-gated; desktop correctness relies on Chromium refusing SW on app://" — severity minor (verified: no verdict override; stands as minor).
- **Root cause:** `App.tsx:69` renders `<PwaUpdatePrompt />` unconditionally in both targets, and `PwaUpdatePrompt` calls `useRegisterSW` at the top of the component (`src/ui/app/PwaUpdatePrompt.tsx:35-56`). On the packaged `app://` scheme SW registration is expected to fail, so `onRegisterError` logs "Service worker registration failed; offline mode unavailable" every launch (line 54) and the web update banner never appears. That single-update-story is correct only while Chromium keeps rejecting service workers on the custom secure scheme; there is no explicit desktop guard, and a future Chromium that allowed SW on `app://` could surface a second update mechanism and let a cached precache mask electron-updater's on-disk swap.
- **Approach:** Gate the mount, not the hook (hooks can't be called conditionally). In `App.tsx`, render `<PwaUpdatePrompt />` only when not the desktop shell, read via the existing platform context — `usePlatformOptional()?.id !== 'electron'` (from `src/ui/app/platform-context.tsx:32`, the non-throwing variant so unit tests without a provider still render as "not desktop"). This uses `adapter.id` (a `platform/types` concept already used to hide Download/Install chrome), so it respects the ui←platform/types boundary — do **not** import `isElectronRenderer` from `platform/electron` into a ui component. Not mounting the component means `useRegisterSW` never runs on desktop: no per-launch error, single-update-story made explicit.
- **Files:** `src/ui/app/App.tsx` (modify — conditional render), `src/ui/app/App.test.tsx` or `src/ui/app/PwaUpdatePrompt.test.tsx` (modify — add the gate test). Add a one-line note to ADR-024/ADR-060 that SW registration is web-only (docs, optional in same PR).
- **Tests:** test-first: add a case asserting that with a platform adapter `id:'electron'` provided, `PwaUpdatePrompt` is not mounted / `useRegisterSW` is not invoked (mock `virtual:pwa-register/react` as the existing `PwaUpdatePrompt.test.tsx` already does), and that with a web adapter it still mounts. Fails today (always mounts), passes after the gate.
- **ADR:** none (a one-line note added to existing ADR-024/ADR-060).
- **Effort:** S  ·  **Depends on:** none.
- **Risk:** Low — ensure `usePlatformOptional()` returning `null` (no provider, e.g. isolated tests) is treated as "web" so the banner still works in the browser. No G-code/core impact.

---

### ELE-07 · Fix the will-navigate guard's fail-open and extend it to will-redirect
- **Fixes:** "will-navigate guard reads event.url.length and can throw before preventDefault (fail-open); no will-redirect/frame-navigate handling" — severity minor (verified: no verdict override; stands as minor).
- **Root cause:** `installNavigationPolicy` (`electron/main.ts:280-293`) computes `const targetUrl = event.url.length > 0 ? event.url : url` — if `event.url` is `undefined`, that dereference throws *inside* the handler before `event.preventDefault()` runs, so the navigation proceeds (fail-open), inverting the intended default of a security control. The handler also covers only `will-navigate`, not `will-redirect` (nor `will-frame-navigate`), so it is narrower than the Electron checklist's "limit navigation" item. Real risk is low (same-origin app, no external links), but the pattern is wrong.
- **Approach:** Use the always-provided second `url` parameter directly and drop the `event.url` dereference: `if (!shouldAllowNavigation(url, TRUSTED_RENDERER_ORIGINS)) event.preventDefault();`. Register a `will-redirect` listener with the identical trusted-origin check (reuse the same closure). `shouldAllowNavigation` (`electron/trusted-renderer-policy.ts:55-57`) is already pure and tested, so no new logic is introduced — this is a correctness + coverage-widening wiring fix. Confirm `Electron.Event.url` nullability against the pinned Electron 42 typings before relying on the `url` param shape.
- **Files:** `electron/main.ts` (modify — `installNavigationPolicy`).
- **Tests:** test-first (structural, following the existing `electron/csp-policy.test.ts` source-assertion precedent since `main.ts` imports the native `electron` module and can't be unit-imported under Vitest): add a test asserting `main.ts` no longer references `event.url.length` in the navigation handler and registers a `will-redirect` listener. The trusted-origin decision itself is already covered by `electron/trusted-renderer-policy.test.ts`. State plainly that the runtime handler behavior is only fully verified on packaged Windows (WORKFLOW F-DESK3).
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none.
- **Risk:** Low — verify `will-redirect` fires with a usable `url` arg in Electron 42; ensure the same-origin app's legitimate redirects (if any) are within `TRUSTED_RENDERER_ORIGINS` so the tighter guard doesn't block real navigation. `main.ts` size — the diff is a few lines. No G-code impact.

---

### ELE-08 · Pin the cross-boundary camera-host list and the two CSP strings with structural tests
- **Fixes:** "Cross-boundary duplication: machine-camera host list and the two CSP strings are kept in sync by comment only" — severity minor (verified: no verdict override; stands as minor).
- **Root cause:** The machine-camera candidate hosts are duplicated between `electron/camera-frame-proxy.ts:28-33` (`MACHINE_CAMERA_FRAME_URL_CANDIDATES`) and `src/platform/web/web-camera.ts:18-23` (`NETWORK_CAMERA_HOSTS`) because electron/ cannot import from src/; a comment says "update both together" but nothing enforces it. Separately, `public/_headers:13` and `electron/main.ts:79-91` each carry the full CSP with a "keep aligned" comment, and `electron/csp-policy.test.ts:9-29` only asserts a few substrings appear in both — not that the two policies' directive sets are equivalent — so a tightening in one surface could silently fail to reach the other.
- **Approach:** Add a structural test (test-only PR, no source change) that reads both files as text (the pattern `csp-policy.test.ts` already uses via `readFileSync(process.cwd()/…)`), extracts the two host arrays, and asserts they are identical as sets; and parses both CSP strings (`public/_headers` and the `CSP_POLICY` array in `electron/main.ts`) into directive→sources maps and asserts they match directive-by-directive. Keep it one concern ("cross-surface duplication is pinned"); one new test file is fine. If parity is *intentionally* asymmetric anywhere, encode the allowed diff explicitly so the test documents it.
- **Files:** `electron/cross-surface-parity.test.ts` (new). No product source changes.
- **Tests:** this ticket *is* the test — it is an invariant-pinning addition (allowed as a test-only PR). Write it to fail if either list or CSP diverges (verify by temporarily editing one copy locally).
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none. Note: if ELE-02 changes the Electron CSP or ELE-03's optional allowlist test lands, sequence this after so the parity assertions encode the final strings.
- **Risk:** Low — the CSP parser must normalize source ordering/whitespace so a cosmetic reorder doesn't false-fail. Reading `src/platform/web/web-camera.ts` from an electron/ test is text-only (no import), so no module-boundary violation. No runtime/G-code impact.

---

### ELE-09 · Correct PROJECT.md: src/platform/electron/ exists and the v1 .exe is unsigned
- **Fixes:** "PROJECT.md drift: claims src/platform/electron/ does not exist and that the .exe is signed" — severity minor (verified: no verdict override; stands as minor). Docs-only.
- **Root cause:** `PROJECT.md:299` states "there is no `src/platform/electron/`," but that directory exists and holds `index.ts`, `is-electron.ts`, `is-electron.test.ts`, `release-desktop-workflow-gate.test.ts` (confirmed by Glob and by `src/ui/app/main.tsx:8` importing `isElectronRenderer` from it). `PROJECT.md:305` lists the build output as "signed Windows `.exe`," but ADR-024 §5 (`DECISIONS.md:4012-4017`) and `release-desktop.yml:30,88-90` ship it **unsigned** in v1. Both are exactly the unverified claims CLAUDE.md forbids and mislead a new contributor about where platform code lives and the shipped artifact's trust level.
- **Approach:** Edit `PROJECT.md`: (1) line 299 — acknowledge `src/platform/electron/` holds the renderer-side Electron detection + release-workflow gate (the main-process desktop code still lives in the top-level `electron/` folder); (2) line 305 — change "signed Windows `.exe`" to "Windows `.exe` (unsigned in v1 — ADR-024 §5; code signing is secret-gated)."
- **Files:** `PROJECT.md` (modify, lines 299 and 305).
- **Tests:** docs-only, no test.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none. Could land as a single PROJECT.md doc-sync PR with ELE-03 (different, non-overlapping sections of the same file); keep separate if the maintainer wants one-concern-per-PR strictness.
- **Risk:** None runtime. **EOL trap:** `PROJECT.md` is LF (verified) and prettier-ignored — preserve LF; check `git diff --stat` for an accidental CRLF flip. Note line 305's signing correction should read consistently with ELE-01's outcome (still unsigned in v1).

---

#### Polish (deferred, one-liners)

_None — every finding in this sector is critical/major/minor and has a full ticket above._

---

## Camera & board/registration workflow — implementation tickets

Grade B+. No criticals. Four majors (two silent mis-registration defects in the accuracy-critical path, two doc/UX-consistency), four minors, three polish. Every physical-accuracy claim remains hardware-CLAIMED — none of these fixes can be perceptually verified without the machine; each ticket says so where it applies.

### CAM-01 · Map 4-point alignment clicks through the object-fit content rect (letterbox-aware)
- **Fixes:** Manual 4-point alignment clicks mis-map on non-4:3 camera frames — severity major (verified: CONFIRMED)
- **Root cause:** `clickToIntrinsicPixel` (`src/ui/camera/NetworkCameraView.tsx:32-43`) maps a click linearly over the **full** element rect, but the `<img>` renders `width:100%` + `aspectRatio '4 / 3'` + `objectFit:'contain'` (`feedStyle`, lines 257-263). A frame whose natural aspect ≠ 4:3 (16:9 is typical) is letterboxed inside the element, so clicks resolve to wrong intrinsic pixels; those feed `beginAlignment`/`addAlignmentPoint` → `solveHomography` (`src/core/camera/alignment.ts:44-57`) verbatim, systematically mis-registering the overlay/trace with no operator-visible signal.
- **Approach:** In `clickToIntrinsicPixel`, first compute the displayed content rect from `natural` aspect vs the element box (object-fit `contain`): `contentW = min(rect.width, rect.height * nw/nh)`, `contentH = min(rect.height, rect.width * nh/nw)`, centered with letterbox offsets `(rect.width-contentW)/2`, `(rect.height-contentH)/2`. Map the click within the content rect; **return `null` when the click lands in a letterbox bar** (outside the content rect) so bar clicks are ignored rather than snapped to an edge. The element still forces `aspectRatio '4 / 3'`, so for a non-4:3 frame the content rect is the pillar/letterboxed image inside that 4:3 box — this is the exact correction. Pure function, no signature change (already takes `rect` + `natural`).
- **Files:** `src/ui/camera/NetworkCameraView.tsx` (modify — `clickToIntrinsicPixel` only)
- **Tests:** `src/ui/camera/NetworkCameraView.test.ts` (modify) — test-first: add a case with `natural = {1920,1080}` (16:9) in the existing 4:3 `rect {400,300}`; a click at the content top edge (element y = 37.5, the top of the fitted image) must map to intrinsic `y ≈ 0` (today's code returns ~135), and a click in the letterbox bar (element y = 10) must return `null`. Existing 4:3 cases must still pass unchanged.
- **ADR:** none (restores intended behavior; matches LightBurn, which taps the raw captured image so display fit can't skew correspondence)
- **Effort:** S · **Depends on:** none
- **Risk:** Low — pure math. NOT hardware-verifiable here; correctness rests on the new unit case + the geometry. No G-code/snapshot impact.

### CAM-02 · Make a persisted camera alignment resolution-aware before warping (trace + overlay)
- **Fixes:** Persisted camera alignment is applied to frames of any resolution — no guard — severity major (verified: CONFIRMED)
- **Root cause:** `CameraAlignment` stores `frameWidth/frameHeight` (`src/core/camera/camera-alignment.ts:14-15`, written only at `auto-align.ts:48-49` and `NetworkCameraView.tsx:144-145`) but **no consumer reads them back**. `buildCameraTraceImage` warps `raw` with `alignment.homography` regardless of size (`src/ui/camera/trace-from-camera.ts:61-66`); `WorkspaceCameraOverlay`/`CameraOverlay` warp the still/live frame the same way (`WorkspaceCameraOverlay.tsx:47-60`, `CameraOverlay.tsx:41-59`). `getUserMedia` is unconstrained (`src/platform/web/web-camera.ts:68-71`), so a later session can deliver a different default resolution and a homography solved at 1280×960 applied to 640×480 mis-places by 2×. The calibration path already solves this (`frameMatchesCalibration` + `scaleIntrinsicsToFrame`, `src/core/camera/resolution-match.ts`); the alignment path has no equivalent.
- **Approach:** New pure core module `src/core/camera/alignment-resolution.ts` mirroring `resolution-match.ts`: `alignmentMatchesFrame(alignment, w, h): boolean` and `scaleAlignmentHomographyToFrame(alignment, w, h): Mat3` = `multiplyMat3(alignment.homography, S)` where `S = diag(sw/fw?…)` — precisely a diagonal similarity `S[0]=frameW_solved/frameW_actual`, `S[4]=frameH_solved/frameH_actual`, `S[8]=1` (per-axis, exactly mirroring how `scaleIntrinsicsToFrame` scales fx/cx by width ratio and fy/cy by height ratio). Because `H·(S·p') = H·p`, this re-expresses the actual-frame pixel in the solved-frame basis before the map. Export both from `src/core/camera/index.ts`. Then rescale at each apply site using the frame size already in hand: `trace-from-camera.ts` (`raw.width/height`, the **burn-critical** path), `WorkspaceCameraOverlay.tsx` `StillOverlay` (`still.width/height`), and `CameraOverlay.tsx` (its `frame` state). Prefer **rescale** over refuse for consistency with the calibration path; optionally add a stricter guard that returns the new typed failure `'resolution-mismatch'` from `buildCameraTraceImage` when the aspect ratio differs beyond a small tolerance (anisotropic rescale of a fisheye homography is suspect). Splittable: the trace half is the safety fix and can land first; the two overlay sites (cosmetic mis-registration) can be a follow-up PR sharing the same helper — note this in the PR if split.
- **Files:** `src/core/camera/alignment-resolution.ts` (new); `src/core/camera/index.ts` (modify — 2 exports; see CAM-08, keep the module split in mind); `src/ui/camera/trace-from-camera.ts` (modify); `src/ui/camera/WorkspaceCameraOverlay.tsx` (modify); `src/ui/camera/CameraOverlay.tsx` (modify)
- **Tests:** `src/core/camera/alignment-resolution.test.ts` (new) — test-first: an alignment solved at 1280×960 applied to a 640×480 frame must produce a homography that maps a 640×480 pixel to the SAME bed-mm as the original maps the equivalent 1280×960 pixel (assert `applyHomography` equality); `alignmentMatchesFrame` true only on exact match. Add a `buildCameraTraceImage` case in `src/ui/camera/trace-from-camera.test.ts` proving an off-resolution `raw` no longer mis-registers (or returns `'resolution-mismatch'` if the guard variant is chosen).
- **ADR:** none if rescale (mirrors the ADR-108 calibration precedent). ADR NEEDED — camera-alignment off-resolution policy — ONLY if the team picks "refuse" as the default, or pins `getUserMedia` ideal width/height (that changes a capture default and is a separate, optional hardening ticket).
- **Effort:** M · **Depends on:** none (touches `index.ts` like CAM-08 — land CAM-02 first or rebase)
- **Risk:** Core stays pure (math only). Rescale is geometrically exact for pure resolution changes, approximate under a sensor crop — the optional aspect guard bounds that. NOT hardware-verifiable here. No snapshot impact (trace feeds a raster, not G-code fixtures).

### CAM-03 · Rewrite WORKFLOW.md F-CAM1/F-CAM4 to the shipped wizard-centric flow
- **Fixes:** WORKFLOW.md camera flows F-CAM1/F-CAM4 have drifted — severity major (verified: CONFIRMED)
- **Root cause:** F-CAM1 (`WORKFLOW.md:2700-2704`) describes engraving four targets and **dragging** four on-screen markers onto crosshairs; no drag flow exists (`grep drag` in `src/ui/camera` = 0 hits). The only manual alignment is **clicking the four bed corners** on the machine-camera preview (`NetworkCameraView.tsx:58-76`, seeded `(0,0),(bedW,0),(bedW,bedH),(0,bedH)`), rendered only for the machine camera — USB has no manual path. F-CAM4 (`WORKFLOW.md:2759-2766`) describes standalone "Add markers to project" and "Auto-align" buttons; both now live only inside the Align-to-bed wizard (`AutoAlignControls.tsx:9-25` opens `CameraAlignWizard`; the marker burn is wizard-internal via `burn-markers-step.ts`).
- **Approach:** Docs-only. Rewrite F-CAM1 success bullet to: pick camera → machine-camera manual path is **click** (not drag) the four **bed corners** in the live preview → homography solves on the 4th → "Save & show on canvas". Note USB/RTSP sources have no manual path (align via the wizard). Rewrite F-CAM4 to: alignment is launched from the **Align-to-bed wizard** ("Add markers to project" and detect are wizard steps, not standalone buttons). Keep the error/empty/edge bullets that still hold. Do NOT invent behavior — describe only what `NetworkCameraView.tsx`, `AutoAlignControls.tsx`, and the align-wizard actually do.
- **Files:** `WORKFLOW.md` (modify — F-CAM1 §2698-2712, F-CAM4 §2757-2776)
- **Tests:** docs-only, no test
- **ADR:** none. (Separate follow-up worth flagging: the surviving bed-corner manual path is lower-accuracy and often occluded vs LightBurn's tap-the-burned-crosses; retiring it or upgrading it to click the burned markers would be a code change needing its own ticket + ADR — out of scope here.)
- **Effort:** S · **Depends on:** none
- **Risk:** `.md` is prettier-ignored — preserve existing CRLF line endings (edit in place; verify `git diff --stat` shows no whole-file EOL flip). Content-only risk: describing the wizard, not the aspirational drag flow.

### CAM-04 · Make the Registration Jig panel provenance-aware so it can't silently unlock/replace a captured board
- **Fixes:** Registration Jig panel can silently unlock, replace, or re-purpose a captured board — severity major (verified: PARTIAL)
- **Root cause:** Place Board and the Registration Jig share one registration box (`applyAddRegistrationBox` drops any existing box, `src/ui/state/registration-box-actions.ts:54-57`; Place Board routes through it via `commitCapturedBoard`, `src/ui/state/board-capture-actions.ts:95`). The box is identified by reserved **color only** — `isRegistrationBox` keys on `REGISTRATION_LAYER_COLOR` (`src/core/scene/registration-layer.ts:44`) with **no provenance field**. The always-available jig panel (`RegistrationJigOutlineControls.tsx:64-68`) shows a one-click unlock checkbox wired to the provenance-blind `applySetRegistrationBoxLocked` (`registration-box-actions.ts:111-127`) and a Create/**Replace** button (`buttonLabel`, lines 241-244). ADR-124 locks the captured board precisely because its canvas position encodes the physical work origin (`DECISIONS.md:6023-6025`), so unlock+drag or Replace silently breaks centering/Fill/Array/burn placement. Verifier scoped to PARTIAL: the hazard and the "no provenance field" kernel are confirmed; the "Create silently deletes" sub-claim is softened (the button already relabels to "Replace box/circle"), so the surviving fix is the missing provenance tag + the unguarded unlock/replace.
- **Approach:** Add an optional provenance tag to the registration box object and make the jig panel respect it. Add `readonly provenance?: 'captured-board' | 'jig'` to `ShapeObject` (`src/core/scene/scene-object.ts:271-…`, sits beside `locked` at line 81's pattern); set `provenance: 'captured-board'` in `board-capture-actions.ts`'s `locked()`/`buildBoardOutline`, and `'jig'` (or leave undefined) for `applyAddRegistrationBox` jig creates. In `RegistrationJigOutlineControls.tsx`, when the current box is `'captured-board'`: disable/hide the unlock checkbox and the Replace button, and show a warning line ("This outline is a captured board — unlocking or replacing it breaks its physical registration. Use Place Board to re-capture."). Add io normalization: `optionalStringUnion`-style check in `src/io/project/project-shape-validator.ts` (mirroring the `optionalBoolean(obj, ...locked)` calls at lines 187/217/241/259/303) so the field round-trips and malformed values are rejected; unknown/absent → `undefined` (treated as jig, back-compatible).
- **Files:** `src/core/scene/scene-object.ts` (modify — add field); `src/ui/state/board-capture-actions.ts` (modify — tag captured); `src/ui/workspace/RegistrationJigOutlineControls.tsx` (modify — guard unlock/replace + warning); `src/io/project/project-shape-validator.ts` (modify — validate field)
- **Tests:** `src/io/project/project-object-locking.test.ts` (or a new `project-registration-provenance.test.ts`) — test-first: a `captured-board` provenance round-trips and a malformed value is rejected. Add a `RegistrationJigOutlineControls` render test asserting the unlock checkbox + Replace button are disabled and the warning shows when the sole registration box has `provenance:'captured-board'`, and remain enabled for a jig box.
- **ADR:** NEEDED — registration-box provenance (captured-board vs jig) sharing one reserved layer, and the jig panel's guard semantics
- **Effort:** M · **Depends on:** none (touches the same `board-capture-actions.ts` as CAM-06 — coordinate if both land)
- **Risk:** Schema addition is additive/optional — old files load (absent → jig). Confirm `exactOptionalPropertyTypes` handling (set the key only when captured, or type it `| undefined`). No G-code/snapshot impact.

### CAM-05 · Warn when the first captured corner isn't the board's bottom-left (wrong-origin plausibility check)
- **Fixes:** Wrong-first-corner capture yields a correct-looking outline with a wrong origin — severity minor (verified: no adversarial verdict; original finding stands)
- **Root cause:** Geometry is order-independent (`bestFitRectangleFromCorners`, `src/core/scene/board-capture.ts:63-71`) but the G92 work origin is set at the **first** captured corner (`use-board-capture-handlers.ts:48`, `setOriginHere` on `corners.length === 0`). Capturing e.g. the top-right first draws an identical outline while the origin — and the burn — sits at the wrong corner. ADR-124 records this as a known limitation with text guidance as the only mitigation (`DECISIONS.md:5916-5922`), framing an origin check as needing the device origin — but the feature's convention is machine +X = width, +Y = height (front-left baseline, `boardCornersFromOrigin` at 102-113), so bottom-left ≡ the bounding-box `(minX, minY)`. That check needs only the captured points, no device origin.
- **Approach:** Add a pure helper `firstCornerOffsetMm(corners: ReadonlyArray<Vec2>): number | null` to `board-capture.ts` — distance from `corners[0]` to the bounding-box `(minX, minY)` corner; `null` unless exactly 4 finite points (reuse the existing `boundingBox`/`isFiniteVec` helpers). Keep `bestFitRectangleFromCorners` order-independent (do NOT add an order-dependent field to it — single responsibility). Export the helper. In `BoardCaptureSteps.tsx` `MeasuredBoard`, when `firstCornerOffsetMm(corners) > FIRST_CORNER_WARN_MM` (named constant, e.g. mirror `OFF_SQUARE_WARN_MM = 5`), render a warning mirroring the off-square copy: "The first corner you captured wasn't the bottom-left, so the work origin is set at the wrong corner — Start over and capture the bottom-left first." Pass `corners` into `MeasuredBoard` (already available on `BoardCaptureSteps` props). The manual-size path synthesizes `corners[0] = origin`, so offset is 0 → no false warning.
- **Files:** `src/core/scene/board-capture.ts` (modify — new pure helper + export); `src/core/scene/index.ts` (modify — export); `src/ui/laser/board-capture/BoardCaptureSteps.tsx` (modify — warning in `MeasuredBoard`)
- **Tests:** `src/core/scene/board-capture.test.ts` (modify) — test-first: `firstCornerOffsetMm([BL,BR,TR,TL]) ≈ 0`; `firstCornerOffsetMm([TR,BR,BL,TL])` ≈ the board diagonal (large); `null` for <4 or non-finite. (Optional UI render assertion in the board-capture panel test.)
- **ADR:** none — but amend ADR-124's "Known limitation" paragraph (`DECISIONS.md:5916-5922`) in the same PR to note the bounding-box-relative first-corner check now covers it (correcting the "would need the device origin" framing).
- **Effort:** S · **Depends on:** none
- **Risk:** Pure core stays pure. Cosmetic-only (adds a warning; no geometry/G-code change). Preserve CRLF in the DECISIONS.md amendment.

### CAM-06 · Embed a compact jog cluster in the Place Board capture phase
- **Fixes:** No jog controls in the Place Board panel — capture ping-pongs across the screen — severity minor (verified: no adversarial verdict; original finding stands)
- **Root cause:** The capture loop jogs with `JogPad` in the right-rail controller column (`LaserWindow.tsx:92`) then clicks "Capture corner" in the floating panel pinned top-left of the canvas (`BoardCapturePanel.tsx:83-97`), 4+ times per board — the mouse crosses the whole screen per corner. Post-capture "Jog head to" buttons already exist (`BoardPlacementControls.tsx:61-77`, `jogToPoint`/`jogToMachinePosition`), so jog is wired into the panel's world but not exposed during capture.
- **Approach:** Add a compact directional jog cluster to the capture phase (`BoardCaptureSteps` / `CircleCaptureSteps`, near "Capture corner"), reusing the gated `jog` action and `jogAxisSignsForOrigin(device.origin)` exactly as `JogPad` does (`JogPad.tsx:30,39-45`), with a small step selector and the panel's existing `disabled`/`feed` (`BoardCapturePanel.tsx:33,36`). To avoid copy-pasting `JogPad`'s `JogArrowGrid` + `send`/signs logic (anti-pattern: copy-paste duplication on its second appearance), **tidy-first**: extract the arrow grid + sign/step/send into a shared `src/ui/laser/JogArrowCluster.tsx` (no behavior change), land it, then consume it in both `JogPad` and the board-capture panel. Keep each file under the size cap — the extraction should net-shrink `JogPad.tsx`.
- **Files:** `src/ui/laser/JogArrowCluster.tsx` (new — extracted); `src/ui/laser/JogPad.tsx` (modify — consume extraction); `src/ui/laser/board-capture/BoardCaptureSteps.tsx` + `CircleCaptureSteps.tsx` (modify — mount the cluster); possibly `BoardCapturePanel.tsx` to thread the `jog`/step props
- **Tests:** For the tidy extraction: `src/ui/laser/JogArrowCluster.test.tsx` (new) asserting a click sends one `jog` with the origin-correct signed delta (mirror any existing JogPad behavior test). For the feature: a board-capture panel render test asserting the cluster is present and gated by `disabled` during capture.
- **ADR:** none (ergonomic reuse of the existing gated jog; no LightBurn equivalent, no default change)
- **Effort:** M · **Depends on:** none (split as tidy `JogArrowCluster` PR → then the board-capture feature PR, per "tidy first")
- **Risk:** Extraction must be behavior-identical for `JogPad` (regression surface: origin sign mapping, step, feed, air-assist layout which stays in JogPad). Touches `BoardCaptureSteps.tsx` alongside CAM-05 — coordinate. No G-code/snapshot impact.

### CAM-07 · Delete the legacy CameraProfile model and the DeviceProfile.cameraProfile field
- **Fixes:** core/camera public surface is 2× over the export cap, and a legacy camera model ships alongside the live one — severity minor (verified: no adversarial verdict; original finding stands) — split from CAM-08
- **Root cause:** `src/core/camera/index.ts:59-79` re-exports the legacy `CameraProfile` model (`camera-profile.ts`, `camera-transform.ts`) whose UI consumers are gone; its only non-test use is shape validation in `profile-catalog.ts:311-389`. Meanwhile `DeviceProfile` carries THREE camera fields — legacy `cameraProfile?` (`device-profile.ts:137`) plus the live `cameraCalibration?` (:162) and `cameraAlignment?` (:165) — so two parallel persisted alignment models invite wiring the wrong one.
- **Approach:** Delete `src/core/camera/camera-profile.ts` and `src/core/camera/camera-transform.ts` and their block in `index.ts` (lines 59-79). Remove `DeviceProfile.cameraProfile` and drop it at normalize time in `profile-catalog.ts` (ignore/strip the legacy key on load so old profiles still parse). Confirm via grep that no live UI/io path reads `cameraProfile`/`buildCameraTransforms`/`effectiveCameraSource` before deleting — if any surprise consumer exists, STOP and re-scope. This also removes ~8 legacy value exports, materially shrinking the index (but not under the 20 cap alone — see CAM-08).
- **Files:** `src/core/camera/camera-profile.ts` (delete); `src/core/camera/camera-transform.ts` (delete); `src/core/camera/index.ts` (modify — drop legacy block); `src/core/devices/device-profile.ts` (modify — remove field); `src/core/devices/profile-catalog.ts` (modify — normalize-time drop + remove shape validation); associated `*.test.ts` for the deleted modules (delete)
- **Tests:** `profile-catalog` test (modify/add) — test-first: a persisted profile containing a legacy `cameraProfile` key loads successfully with the field dropped (back-compat), and no export references the deleted symbols (tsc/lint enforces).
- **ADR:** NEEDED — retire the legacy CameraProfile persistence (records the deliberate removal of a persisted DeviceProfile field + the normalize-time drop migration)
- **Effort:** M · **Depends on:** none (land before CAM-08 so the split targets the post-deletion surface)
- **Risk:** Deleting a persisted field is a migration — the normalize-time drop must not reject old files. Pure refactor otherwise (flag PR as such); the deleted-module tests are the coverage. No G-code impact.

### CAM-08 · Split core/camera/index.ts into calibration / alignment / detection sub-entries (export cap)
- **Fixes:** core/camera public surface is 2× over the export cap — severity minor (verified: no adversarial verdict) — split from CAM-07
- **Root cause:** Even after CAM-07 removes the legacy block, `src/core/camera/index.ts` still exports ~36 value symbols + ~30 types (homography, fisheye, LM solver, checkerboard detection, markers, warping, sessions, trust, resolution) against CLAUDE.md's 10-soft / **20-hard** cap on an `index.ts`'s public exports — the module is doing too much.
- **Approach:** Pure refactor. Group into cohesive sub-module entry points, e.g. `core/camera/calibration/index.ts` (fisheye, calibrate, calibrate-sweep, corner-subpix, checkerboard, calibration-session, calibration-trust, pose-diversity, camera-calibration, resolution-match), `core/camera/alignment/index.ts` (homography, alignment, matrix3d, mat3, align-markers, camera-alignment, alignment-resolution from CAM-02, warp-to-bed), and `core/camera/rectify/index.ts` (rectify-map, cpu-rectify, gray) — final grouping to be sized to keep each entry ≤ 20. Update importers (they cross the module boundary through the barrel today) to the new sub-entry paths. No logic change; keep files pure.
- **Files:** `src/core/camera/index.ts` (modify/shrink or convert to a thin re-export of the sub-barrels — must itself stay ≤ 20); new `src/core/camera/*/index.ts` barrels; consumer import updates across `src/ui/camera/**`, `src/io/**` (mechanical path edits)
- **Tests:** No behavior change — existing camera tests must pass unchanged; the win is enforced by the lint export-cap rule and tsc. Flag as a pure refactor (no new test required per CLAUDE.md).
- **ADR:** none (internal module organization)
- **Effort:** M · **Depends on:** CAM-07 (split the reduced surface) and coordinate with CAM-02's `index.ts` export add (rebase onto whichever barrel `alignment-resolution` lands in)
- **Risk:** Wide but mechanical import churn; `eslint-plugin-boundaries` and `import/no-cycle` must stay green (don't introduce a barrel cycle). No runtime/G-code impact.

### CAM-09 · Fix the PROJECT.md module map line for src/ui/calibration
- **Fixes:** PROJECT.md directory map mislabels src/ui/calibration as camera setup UI — severity minor (verified: no adversarial verdict; original finding stands)
- **Root cause:** `PROJECT.md:398` reads `calibration/  camera/registration setup UI`, but `src/ui/calibration/` contains `MaterialTestDialog.tsx`, `IntervalTestDialog.tsx`, `ScanOffsetCalibrationDialog.tsx` (+ `CalibrationNumberField.tsx`) — the ADR-044 material calibration dialogs. All camera setup UI lives under `src/ui/camera/` (`wizard/`, `align-wizard/`). A contributor sent by the doc lands in the wrong module.
- **Approach:** Docs-only. Change the `calibration/` map line to something like `material/interval/scan-offset calibration dialogs` and (optionally) add/adjust the `camera/` line to note camera calibration + bed alignment UI lives under `ui/camera/` (`wizard`, `align-wizard`, `panel`).
- **Files:** `PROJECT.md` (modify — module map, line ~398)
- **Tests:** docs-only, no test
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** `.md` prettier-ignored — preserve CRLF; verify `git diff --stat` shows only the touched lines.

#### Polish (deferred, one-liners)
| finding | one-line fix | effort |
|---|---|---|
| Camera panel is a fixed floating panel, not draggable (`CameraPanel.tsx:101-118`) | Reuse the jig panel's drag/keyboard-move machinery (`RegistrationJigPanel.tsx:110-171`, `ui-store FloatingPanelPosition`) so the Camera panel can be moved off the overlay it controls | S |
| Circle capture: typed diameter silently overrides a jog-measured one (`CircleCaptureSteps.tsx:61-95`) | When both a measured (`measured`) and typed diameter exist and differ by more than a few percent, show the rectangle path's style of warning before "Create board outline" | S |
| Align wizard Done step leaves the marker pattern as the operator's scene (`burn-markers-step.ts:31`, `AlignWizardDetectStep.tsx:63-88`) | Add a "Restore my artwork (Undo)" button on `DoneStep`, or auto-undo the generated marker scene once the alignment persists | S |

---

## Project persistence, save-format migration, autosave & crash/job recovery — implementation tickets

Ordering: critical → major → minor. No critical findings in this sector. Two tickets
(PST-04, PST-05) are split from a single major finding (#5, autosave docs/ADR + F-A12 drift)
because they touch different files and different concerns; both are labelled as such. PST-06
is the REFUTED finding, scoped to the surviving kernel per the verifier.

---

### PST-01 · Clear the restored autosave slot on restore so no phantom "Restore?" re-prompt
- **Fixes:** "Restored autosave slots are never cleared after manual save — phantom 'Restore?' prompts offering stale work on every subsequent launch" — severity major (verified: CONFIRMED).
- **Root cause:** `readAutosave()` returns the newest snapshot across current-session + indexed + legacy keys (`src/ui/state/autosave.ts:95-102`, candidates at `172-178`). On accept, `runAutosaveRecovery` calls `s.setProject(record.project)` and only sets `dirty:true` — it keeps the dead session's source slot armed (`src/ui/app/use-autosave.ts:109-117`). Later manual save/open call `clearAutosave()` with no args, whose scope is current-session key + legacy only (`autosave.ts:125-136`, `180-183`; callers `file-actions.ts:255`, `293`). So the slot the restore came from is never cleared and re-prompts on any later empty-project launch — the `file-actions.ts:253-255` comment ("Drop it so the recovery prompt doesn't fire on the next boot") states a contract the code does not meet.
- **Approach:** In the accept branch of `runAutosaveRecovery` (`use-autosave.ts:109-117`), after `setProject`, re-home the restored copy to the CURRENT session slot and drop the source slot: `const w = writeAutosave(record.project); if (w.kind === 'ok') clearAutosave(record); else reportAutosaveFailure()`. `clearAutosave` already accepts an `AutosaveSnapshot` and clears by its `storageKey` (`autosave.ts:127`), and `record` is exactly that shape. Because the re-write happens BEFORE the clear, the M15 invariant (the restored project's only durable copy must never be dropped) still holds; if the re-write fails (quota), keep the source slot and toast the failure. Keep `setState({ dirty: true })`. After this, the sole durable copy lives under the current session key, so the existing no-arg `clearAutosave()` on first manual save (`file-actions.ts:255`) satisfies the "no re-prompt" contract with no change to `file-actions.ts`.
- **Files:** `src/ui/app/use-autosave.ts` (modify — accept branch only; `writeAutosave` + failure reporter are already imported/available in the module).
- **Tests:** test-first in new `src/ui/app/use-autosave.test.ts` (co-located; mirror the `localStorage` stub setup used in `src/ui/state/autosave.test.ts`). Seed a dead-session slot via `writeAutosave(project, now, { sessionId: 'dead' })`, leave `useStore` project empty, call `runAutosaveRecovery(() => true)`, then assert (a) the `dead` slot key is removed from `localStorage`, (b) `readAutosave()` returns the project under the current session key, and (c) a second `runAutosaveRecovery` after a no-arg `clearAutosave()` does not re-prompt. The (a) assertion fails on today's code.
- **ADR:** none (implements the already-recorded M15 contract).
- **Effort:** S · **Depends on:** none
- **Risk:** Low. A quota failure on the re-write must not drop the source slot — the `w.kind === 'ok'` guard covers it. No G-code, no boundary/size concern.

---

### PST-02 · Persist output scope + job placement in the checkpoint so selective-burn resume works
- **Fixes:** "Crash resume dead-ends with a misleading 'project was edited' refusal when the interrupted run used non-default output scope or job placement" — severity major (verified: CONFIRMED).
- **Root cause:** The checkpoint fingerprint covers `prepared.gcode`, which is compiled from `jobPlacement` and `currentOutputScope(app)` (`src/ui/laser/start-job-flow.ts:133-134` for start, `50` cited; `prepareResume` at `114-135`). `currentOutputScope` reads `outputScopeSettings` + live selection ids (`src/ui/state/store.ts:414-423`). Neither `jobPlacement` nor `outputScopeSettings` is serialized into the Project (confirmed: absent from `src/io/project/serialize-project.ts`), so after a crash+restore they reset to defaults. A run that used "cut selected graphics" or a non-default placement recompiles to different bytes, `fingerprintsEqual` fails, and `runCheckpointResumeFlow` alerts "it was edited since" (`start-job-flow.ts:98-106`) — recovery of a selective multi-hour burn is impossible exactly when it matters.
- **Approach:** Capture the scope+placement the run used INTO the checkpoint and re-apply them at resume so the recompiled bytes match the fingerprint again.
  1. `src/core/recovery/job-checkpoint.ts` (pure core): add `outputScope: OutputScope` (import from `core/scene`) and `jobPlacement: JobPlacementSettings` (import from `core/job`) to `JobCheckpoint`; thread them through `createJobCheckpoint` args and add strict parse arms in `validatedCheckpointBody` (OutputScope = two booleans + string[]; JobPlacementSettings = `startFrom` literal + `anchor` literal). Bump `JOB_CHECKPOINT_SCHEMA_VERSION` 1→2 so pre-existing v1 slots (which lack the fields) read as `null` and are discarded — acceptable, checkpoints are transient. Keep core pure (plain-data fields only).
  2. `start-job-flow.ts`: pass `currentOutputScope(app)` + `jobPlacement` into `createJobCheckpoint` at the write site (`70-76`).
  3. `start-job-flow.ts`: parameterize `prepareResume` to take optional `{ outputScope, jobPlacement }` overrides. `runCheckpointResumeFlow` passes the checkpoint's stored values; `runStartFromLineFlow` (manual, ungated) keeps passing current app state. This is the load-bearing change — resume must recompile with the run's scope/placement, not the reset defaults.
  4. Extend the mismatch alert (`start-job-flow.ts:99-104`) to name scope/placement/selection as possible causes (belt), and update WORKFLOW.md "Error — project changed since the run" (`789-792`) accordingly.
- **Files:** `src/core/recovery/job-checkpoint.ts` (modify), `src/ui/laser/start-job-flow.ts` (modify), `WORKFLOW.md` (modify §789-792). If `job-checkpoint.ts` approaches the soft limit after the parse arms (currently ~191 raw, well under), extract the OutputScope/placement validators into a new `job-checkpoint-fields.ts` — not expected.
- **Tests:** test-first in `src/core/recovery/job-checkpoint.test.ts`: `createJobCheckpoint` with a non-default `outputScope`/`jobPlacement` → `serializeJobCheckpoint` → `parseJobCheckpoint` round-trips the fields, and a v1 (fieldless) payload parses to `null`. Add a flow-level assertion (in the existing start-job-flow test file if present, else a focused case) that `runCheckpointResumeFlow` no longer refuses when only the transient scope/placement changed since the run.
- **ADR:** NEEDED — extend ADR-118: the checkpoint now captures output scope + job placement (was "fingerprint + counts only"); schema bumped to 2.
- **Effort:** M (borderline L) · **Depends on:** none. If the diff grows, split a tidy PST-02a (parameterize `prepareResume`, no behavior change) landing first, then PST-02b (schema fields + wiring).
- **Risk:** Checkpoint schema bump invalidates in-flight v1 slots (transient, acceptable). No G-code snapshot churn — resume bytes become identical to the original run again. Re-applying stored `selectedObjectIds` relies on object ids surviving autosave (they do: ids are serialized + `requireString`-validated).

---

### PST-03 · Reject non-finite (+Infinity) numerics for the machine + CNC-layer blocks at the .lf2 boundary
- **Fixes:** "Machine/CNC numeric normalization accepts +Infinity (JSON '1e999'), which reaches emitted G-code as 'G0 ZInfinity'" — severity major (verified: PARTIAL — mechanism confirmed; the specific `safeZMm → G0 ZInfinity` headline was flagged uncertain by the verifier, but the trust-boundary divergence is confirmed).
- **Root cause:** `validateProjectShape` runs before normalization and rejects non-finite for every `device.*` numeric (its primitives all require `Number.isFinite`, `src/io/project/project-shape-primitives.ts:171-173`), but it has NO `machine` arm (`project-shape-validator.ts:52-68`) and `validateProjectLayer` has NO `cnc` arm (`project-layer-shape-validator.ts:21-53`). For those blocks the ONLY guard is normalization, and the normalizer helpers are non-finite-tolerant: `positiveNumberOrDefault`/`nonNegativeNumberOrDefault` (`deserialize-project.ts:297-303`, feeding `machine.params.safeZMm`/`spindleMaxRpm`/`spindleSpinupSec` at `141-151`) and `isPositiveNumber`/`isNonNegativeNumber` (`normalize-layer.ts:203-205`, `199-201`) all pass `Infinity`. `JSON.parse('1e999') === Infinity`, and downstream `Math.max(0, Infinity) === Infinity` (`compile-cnc-job.ts:183`, `cnc-grbl-strategy.ts:361`) formats to `"Infinity"` via `fmt` (`cnc-grbl-strategy.ts:43-44`). `device.*` is safe (validator-gated); `machine.*` and `layer.cnc.*` are the exposed surface.
- **Approach:** Harden the normalizer helpers to treat non-finite as malformed — the in-design fix, since machine/CNC normalization already substitutes defaults field-by-field ("malformed values cannot reach the compiler"). Change `positiveNumberOrDefault` and `nonNegativeNumberOrDefault` (`deserialize-project.ts:297-303`) to add `&& Number.isFinite(value)`, and `isPositiveNumber`/`isNonNegativeNumber` (`normalize-layer.ts:199-205`) likewise. `isPositiveInteger` (uses `Number.isInteger`) and `isPercent` (bounded `<=100`) already exclude Infinity — leave them. This closes every path where `Infinity` reaches the compiler.
- **Files:** `src/io/project/deserialize-project.ts` (modify — two helpers), `src/io/project/normalize-layer.ts` (modify — two helpers).
- **Tests:** test-first in `src/io/project/project-machine-cnc.test.ts` (existing): load a `.lf2` whose JSON has `machine.params.safeZMm: 1e999` (and one CNC-layer `feedMmPerMin: 1e999`); assert the deserialized value equals the default, not `Infinity`. A companion case can assert `emitGcode` on that project emits no line containing `Infinity`.
- **ADR:** none (bug fix — enforces the repo's existing "reject non-finite at the trust boundary" policy).
- **Effort:** S · **Depends on:** none. **Optional belt (separate PR):** add `machine` + `layer.cnc` arms to the shape validator so these blocks are REJECTED like `device.*` rather than silently defaulted — but `project-shape-validator.ts` is 4 lines under the hard-400 limit (see PST-11), so those arms must land in a NEW `project-machine-shape-validator.ts` and depend on PST-11's split. Not required for this fix.
- **Risk:** No snapshot churn (no fixture carries Infinity). Pure behavior change only for corrupt/hand-edited files. Stays inside `io/`.

---

### PST-04 · Document autosave as WORKFLOW F-C3 (four states) and record its ADR
- **Fixes:** "Autosave shipped with no WORKFLOW flow and no ADR; F-A12 error surface also drifted (modal vs toast)" — severity major (verified: CONFIRMED). This ticket = the F-C3 + ADR half; the F-A12 half is PST-05.
- **Root cause:** WORKFLOW.md lists "F-C3. Autosave + recovery" as a STUB (`805-812`, line `809`) while the feature is live (`App.tsx` mounts `useAutosave` + `useAutosaveRecovery`). Every policy decision lives only in code comments — 30 s fixed interval, per-window session slots + index, restore-prompt-only-when-empty, decline-means-discard, pause-during-streaming, beforeunload flush (`autosave.ts:1-29`, `use-autosave.ts:1-18`). DECISIONS.md has no autosave ADR (the only `## ADR-` autosave hit is ADR-093, the unrelated Material Library; autosave is only mentioned inside ADR-118 at `5501`/`5553`).
- **Approach:** Docs + ADR, no code change.
  - WORKFLOW.md: replace the F-C3 stub bullet (`809`) with a full flow under the four required states, matching the shipped behavior: **Success** (dirty project auto-persists every 30 s + on `beforeunload`; per-window session slot); **Error** (`writeAutosave` failure → warning toast `AUTOSAVE_FAILURE_MESSAGE`, prompting manual save); **Empty** (recovery prompt fires only when the in-memory project is still the empty default — `use-autosave.ts:102`); **Edge** (restore keeps the record armed until first manual save per M15; decline discards; writes pause during streaming but the `beforeunload` flush overrides that). Cross-reference PST-01's clear-on-restore behavior so the doc and code agree.
  - DECISIONS.md: add an ADR (marker `ADR: NEEDED`) recording the slot/index/session-id + prompt-when-empty + decline-discards design and the 30 s hardcoded interval (note the open question of a user-configurable interval for LightBurn parity — see PST-05's LightBurn note).
- **Files:** `WORKFLOW.md` (modify §805-812), `DECISIONS.md` (modify — new ADR entry).
- **Tests:** docs-only, no test.
- **ADR:** NEEDED — autosave slot/index/session + recovery-prompt design (Phase C).
- **Effort:** M (mostly writing) · **Depends on:** land after PST-01 so the documented restore lifecycle matches the fixed code.
- **Risk:** CRLF/EOL trap — `.md` is prettier-ignored; preserve existing line endings (edit in place, verify `git diff --stat` shows no whole-file EOL flip).

---

### PST-05 · Reconcile F-A12 invalid-file modal-vs-toast and the missing device-profile-warning edge
- **Fixes:** "…F-A12 error surface also drifted (modal vs toast)" — severity major (verified: CONFIRMED). Split from finding #5; the autosave half is PST-04.
- **Root cause:** WORKFLOW.md F-A12 specifies a **Modal** for "file is not a valid .lf2" (`420-421`), but `handleOpenProject` surfaces it as a **toast** (`file-actions.ts:307`, `pushToast(... 'error')`) — while the adjacent schema-too-new branch does use a modal (`file-actions.ts:302`, `jobAwareAlert`), matching spec. Separately, the F-A12 edge "valid .lf2 references a device profile not on this machine → status-bar warning" (`424-425`) has no implementation in the open path (`handleOpenProject` emits only the migrated/opened toast; no profile-locality check).
- **Approach:** This is a doc-vs-code divergence with a taste call — per CLAUDE.md, **report and let the maintainer choose**; the ticket proposes the default and names both options.
  - Modal-vs-toast: recommend aligning the **doc to the code** (invalid-file stays a non-blocking error toast, consistent with how all other file-open failures toast in `handleOpenProject`), i.e. edit WORKFLOW.md `420-421` from "Modal" to "error toast". Alternative (if the maintainer wants blocking parity with the schema-too-new modal): change `file-actions.ts:307` to `jobAwareAlert` — a code change needing a test.
  - Profile-warning edge: the status-bar warning is unimplemented. Recommend either implementing a minimal check (compare the loaded `project.device.profileId`/`name` against the locally configured profiles and push an info toast/status warning) or, if out of scope now, editing WORKFLOW.md `423-425` to mark the edge as deferred so the doc stops asserting behavior that does not exist.
- **Files:** `WORKFLOW.md` (modify §420-425). Optionally `src/ui/app/file-actions.ts` (modify) if the maintainer picks the code-side alignment or chooses to implement the profile warning.
- **Tests:** docs-only if the doc-alignment path is chosen. If code changes (modal switch or profile check), test-first in a co-located `file-actions` test asserting the chosen surface.
- **ADR:** none.
- **Effort:** S · **Depends on:** none.
- **Risk:** Low; docs EOL trap as in PST-04. Keep the two sub-decisions in separate commits if both code and doc change.

---

### PST-06 · Surface work-zero re-verification at resume (kernel only — headline REFUTED)
- **Fixes:** "Checkpoint resume never re-validates work zero; custom-origin jobs re-burn at the wrong physical position after controller power loss" — severity major (verified: REFUTED, corrected to polish). Written per instruction, scoped to the surviving kernel only.
- **Root cause (surviving kernel):** The verifier refuted the headline: the resume path runs the same placement gate as Start (`runCheckpointResumeFlow → prepareResume → prepareStartJob → resolveJobPlacement`), and `resolveUserOrigin`/`resolveVerifiedOrigin` REFUSE when the controller no longer reports a custom origin (`src/ui/job-placement.ts:108-113`, `138-143`) — so the "silent wrong-position re-burn" is not reproducible. What survives: when a custom origin IS still active but the operator re-set it to a DIFFERENT physical location after a power cycle, the G92-applied bytes are identical (fingerprint passes) and placement passes, leaving only the confirm sentence "The work zero must be UNCHANGED since the original run" (`start-job-flow.ts:162-165`) as the guard. The checkpoint stores no WCO, so no mechanical comparison is possible without new persisted state.
- **Approach:** UX-only, no new data model. Make the work-zero contract impossible to skim past: (a) in the resume confirm (`streamResumeFromRawLine`, `start-job-flow.ts:162-165`) and/or the banner (`CheckpointResumeBanner.tsx:30-45`), show the controller's currently cached WCO (`laser.wcoCache` is already available) so the operator can eyeball whether zero moved; (b) tighten the confirm copy to prompt an explicit "re-set origin at the same physical corner if unsure." Do NOT add a WCO field to the checkpoint (that was the refuted, over-scoped fix).
- **Files:** `src/ui/laser/start-job-flow.ts` (modify — confirm text) and/or `src/ui/laser/CheckpointResumeBanner.tsx` (modify — display cached WCO).
- **Tests:** light — a render/string test on the banner asserting the WCO/contract text appears; the confirm text change is copy-only. If purely copy, docs-adjacent; add a snapshot/string assertion where a test file already exists for the banner.
- **ADR:** none.
- **Effort:** S · **Depends on:** none.
- **Risk:** Minimal (UI copy + read-only display). Do not regress the H13 job-aware dialog rule — reuse `jobAwareConfirm`.

---

### PST-07 · Warn before starting a new job overwrites a checkpoint that has real progress
- **Fixes:** "Single global checkpoint slot: starting any other job silently destroys a valid crash-recovery record" — severity minor (verdict: not adversarially re-verified; mechanism reads true from code).
- **Root cause:** `runStartJobFlow` unconditionally writes a fresh checkpoint once a new stream starts (`start-job-flow.ts:70-76`), and `streamResumeFromRawLine` stamps `resumeInFlight` on WHATEVER checkpoint is stored (`start-job-flow.ts:166-169`), even one belonging to a different interrupted job; `use-job-checkpoint` then clears on any run reaching `done` (`use-job-checkpoint.ts:42-45`). So crashing mid-job A, then running an unrelated job B, silently destroys A's recovery record. Single-slot is the recorded ADR-118 v1 design (`DECISIONS.md:5527-5530`), but silent destruction is not called out there.
- **Approach:** Before the initial checkpoint write in `runStartJobFlow`, read the existing checkpoint; if it exists with `ackedLines > 0` and is not `resumeInFlight`, `jobAwareConfirm("Starting a new job discards the interrupted-job record from <startedAt> (N of M lines). Continue?")` and abort the start if declined. Separately, guard the `resumeInFlight` stamp in `streamResumeFromRawLine` so it only stamps when the resumed program's fingerprint matches the stored checkpoint (compare `fingerprintGcode(gcode)` to `checkpoint.fingerprint` via `fingerprintsEqual`, both already imported) — otherwise leave the foreign record untouched.
- **Files:** `src/ui/laser/start-job-flow.ts` (modify).
- **Tests:** test-first in the start-job-flow test (or a new co-located `start-job-flow.test.ts`): with a checkpoint whose `ackedLines>0` present, `runStartJobFlow` prompts and, on decline, does not overwrite the stored checkpoint; and `streamResumeFromRawLine` with a non-matching fingerprint does not stamp `resumeInFlight`.
- **ADR:** NEEDED (small) — amend ADR-118 to record the overwrite confirm + fingerprint-gated resume stamp on the single slot.
- **Effort:** S · **Depends on:** none. Note the confirm text overlaps PST-06's copy — keep messages distinct.
- **Risk:** A confirm in the Start path must remain job-aware (no active job at Start, so a native confirm is fine per H13). Don't block the common case where no prior progress exists (`ackedLines === 0` → no prompt).

---

### PST-08 · [Codex M-05] Keep the checkpoint until the machine reports Idle, not on 'done' (last ack)
- **Fixes:** "[Codex M-05] Recovery checkpoint is deleted before physical completion" — severity minor (verified: PARTIAL, corrected to minor).
- **Root cause:** `streamer` reaches `done` on the LAST ack (`src/core/controllers/grbl/streamer.ts:219-227`; ack = "parsed into RX buffer", `job-checkpoint.ts:42-46`), and `use-job-checkpoint` clears the checkpoint on that `done` transition (`use-job-checkpoint.ts:42-45`). But the app itself treats `done` as not-yet-idle: `beginPostJobSettle` dwells (`G4 P0.01`) and waits for `STABLE_IDLE_REPORTS = 2` before releasing the streamer (`src/ui/state/laser-post-job-settle.ts:21-22`, `68-80`). If the controller loses power during that final buffer drain (between last ack and Idle), the checkpoint is already gone and the buffered-but-unexecuted tail cannot be resumed. The verifier confirmed the mechanics but weakened the finding: clear-on-done is a DELIBERATE, documented ADR-118 decision (`DECISIONS.md:5527-5530`) and the ack-vs-execution gap is documented (`5557-5563`), with the banner + manual Start-from-line as mitigations.
- **Approach:** Defer the clear from the `done` transition to genuine physical completion — the successful post-job-settle (2 stable Idle). Concretely, clear the checkpoint from the settle-success path in `laser-post-job-settle.ts:72-80` (where `controllerOperation` goes `post-job-settle → null` with "Controller settled after job."), and remove the clear from `use-job-checkpoint.ts:42-45`. Critically, still clear on the settle-FAILURE path (`77-98`) and on any terminal streamer reset that reaches Idle, so a checkpoint is never orphaned forever when settle can't complete. Because this reverses a recorded ADR decision, keep the change minimal and reversible.
- **Files:** `src/ui/state/laser-post-job-settle.ts` (modify — clear on success + failure completion), `src/ui/app/use-job-checkpoint.ts` (modify — drop the clear-on-done). Import `clearJobCheckpoint` from `job-checkpoint-storage` in the settle module.
- **Tests:** test-first in `src/ui/state/laser-post-job-settle.test.ts` (existing): checkpoint present → job reaches `done` → checkpoint STILL present until `waitForFreshIdle` resolves; after settle success it is cleared; and a settle failure still clears (no orphan). A regression case: power loss simulated between `done` and Idle leaves the checkpoint resumable.
- **ADR:** NEEDED — amend ADR-118 "Clear-on-done only" to "clear-on-physical-idle (post-job settle), with settle-failure fallback."
- **Effort:** M · **Depends on:** none. Related to PST-07 (both touch checkpoint clear lifecycle) but independent files/concerns — do not batch.
- **Risk:** Highest-risk minor here — mis-handling the settle-failure/disconnect paths could leave a stale checkpoint that re-prompts after a normal completion. The failure-path clear is mandatory. Verify against `laser-post-job-settle.test.ts` and the lifecycle simulator tests.

---

### PST-09 · Add schema-downgrade protection and a per-era .lf2 fixture corpus
- **Fixes:** "Schema-version machinery is dormant while the format grew five phases of surface; no historical .lf2 corpus in CI and downgrades silently drop data" — severity minor (verdict: not adversarially re-verified; reads true from code).
- **Root cause:** `PROJECT_SCHEMA_VERSION` is still `1` (`src/core/scene/project.ts:8`) and `MIGRATORS` is empty (`src/io/project/migrations.ts:25`); every shipped block (machine/CNC, groups, relief, camera, notes, subLayers, operationOverride, shapes) landed as additive normalization with defaults. Two gaps: (a) because the number never moves, the `schema-too-new` gate (`deserialize-project.ts:57-59`) can't fire on a downgrade — an older build opens a newer file as v1, silently drops unknown blocks, and a re-save destroys them; (b) "every historical version loads" is proven only by synthetic per-feature fixtures built programmatically (e.g. `project-registration-jig.test.ts`, `project-machine-cnc.test.ts`), never a committed real `.lf2` per era.
- **Approach:** Two independent, small pieces — split into two PRs.
  - **PST-09a (policy/ADR + corpus):** Commit one real `.lf2` fixture per shipped phase under `src/io/project/__fixtures__/era/` and add a loader round-trip test (`deserializeProject(fixture).kind === 'ok'`, key blocks preserved). Docs/ADR only for the first-bump policy — define WHEN to bump `PROJECT_SCHEMA_VERSION` (e.g. bump the next time a block is added that an older build would silently drop), so `schema-too-new` downgrade detection actually starts firing. No production code change.
  - **PST-09b (optional, deferred):** when the policy triggers the first real bump, add the migrator table entry + a `schema-too-old`/downgrade-warning path. Not actionable until a bump is scheduled.
- **Files:** `src/io/project/__fixtures__/era/*.lf2` (new), a new `src/io/project/era-corpus.test.ts` (new), `DECISIONS.md` (modify — bump policy ADR). No change to `migrations.ts` in 09a.
- **Tests:** the era-corpus round-trip test IS the deliverable (loader over committed fixtures).
- **ADR:** NEEDED — first-bump policy for `PROJECT_SCHEMA_VERSION` (when additive stops being safe / downgrade protection).
- **Effort:** M · **Depends on:** none.
- **Risk:** Fixtures must be genuine era files, not reconstructed (the point is to catch normalization regressions a synthetic fixture would miss). No behavior change in 09a.

---

### PST-10 · Make the recovery-prompt decline non-destructive
- **Fixes:** "Recovery prompt's Cancel is a one-click permanent discard of the only backup" — severity minor (verdict: not adversarially re-verified; reads true from code).
- **Root cause:** `runAutosaveRecovery` uses a native `confirm()` at boot where Cancel immediately deletes the slot (`use-autosave.ts:103-119`, `clearAutosave(record)` on decline). Post-crash the autosave slot is the only durable copy (its own M15 comment), so a reflexive Cancel — or a user who wants to defer — destroys it irreversibly. The checkpoint banner got this right (persistent, explicit Dismiss — `CheckpointResumeBanner.tsx:47-56`); the more valuable autosave record has the more dangerous UI.
- **Approach:** Make decline keep the slot for this session (suppress re-prompt until next launch) and reserve deletion for an explicit action. Minimal version without new UI: on decline, do NOT `clearAutosave(record)`; instead set a session-scoped in-memory guard (module-level `let` is banned outside function bodies per CLAUDE.md — use a `sessionStorage` flag keyed like the autosave session id, or a store field) so `runAutosaveRecovery` returns early on subsequent mounts this session but the slot survives to next launch. A fuller version replaces the native confirm with a three-option dialog (Restore / Not now / Discard); flag that as an ADR-worthy UX change. Recommend the minimal "Not now keeps the slot" behavior first.
- **Files:** `src/ui/app/use-autosave.ts` (modify). If a real dialog is chosen, a new small component under `src/ui/app/` (new).
- **Tests:** test-first in `src/ui/app/use-autosave.test.ts` (shared with PST-01): decline (`confirmRestore` returns false) → the slot key still exists in `localStorage` and a second `runAutosaveRecovery` in the same session does not re-prompt.
- **ADR:** none for the minimal keep-slot fix; NEEDED only if the three-option dialog is adopted (native-confirm → custom dialog is a UX/H13 decision).
- **Effort:** S · **Depends on:** PST-01 (both edit `runAutosaveRecovery`; land PST-01 first, then this — they touch adjacent branches). Shares the new test file.
- **Risk:** The session-guard must not become a module-level mutable (`let`) — use `sessionStorage` or a store slice to respect the no-module-mutable rule. Ensure "keep on decline" doesn't reintroduce the phantom-reprompt PST-01 fixes (decline suppresses THIS session only; next launch legitimately re-offers until saved).

---

### PST-11 · Tidy-split project-shape-validator.ts and deserialize-project.ts under the size limit
- **Fixes:** "io/project files are at the size-limit cliff: project-shape-validator.ts is 4 counted lines under the hard 400 CI failure" — severity minor (verdict: not adversarially re-verified; line counts measured in-session).
- **Root cause:** `project-shape-validator.ts` is ~449 raw / ~396 counted lines — over the 250 soft limit and one small addition from the hard-400 lint error; `deserialize-project.ts` is ~328 raw / ~276 counted (also over soft). The validator grows with every SceneObject variant and shape kind (its own comment at `project-shape-validator.ts:310-311` says "ellipse / polygon / polyline add arms here"), so the next variant trips CI mid-feature. Precedent for the split exists in-folder (`project-device-profile-validator.ts`, `project-layer-shape-validator.ts`, `project-operation-override-validator.ts`).
- **Approach:** Pure refactor, no behavior change (Tidy-first). Extract per-object-kind validators (vector/text/traced-image/raster/shape/relief + their bounds/transform/paths helpers) into a new `project-object-validators.ts`, leaving `validateProjectShape` as the thin dispatcher. Separately, move the machine/CNC + tiling normalizers out of `deserialize-project.ts` into a `normalize-machine.ts` (mirrors `normalize-layer.ts`). This unblocks PST-03's optional validator-belt (adding `machine`/`layer.cnc` arms) without breaching the hard limit.
- **Files:** `src/io/project/project-object-validators.ts` (new), `src/io/project/normalize-machine.ts` (new), `src/io/project/project-shape-validator.ts` (modify — shrink to dispatcher), `src/io/project/deserialize-project.ts` (modify — import extracted normalizers).
- **Tests:** pure refactor — no new behavior; the existing `project.test.ts` + `project-security-validation.test.ts` + `project-machine-cnc.test.ts` must stay green (flag the PR as a pure refactor per CLAUDE.md so the "source change without test change" gate is satisfied). Add no assertions.
- **ADR:** none.
- **Effort:** S · **Depends on:** none — but should land BEFORE PST-03's optional validator-belt and before any feature that adds a validator arm.
- **Risk:** Cross-module import boundaries stay within `io/`; keep new files exporting named functions and re-export through the existing entry points so `deserialize-project.ts` imports don't cross into internals. Verify counted-line results with the CI line-count script after the split.

---

#### Polish (deferred, one-liners)

| finding | one-line fix | effort |
|---|---|---|
| Corrupt/superseded autosave slots linger in localStorage forever (`autosave.ts:104-123`) | Mirror the checkpoint policy: in `readAutosaveAtKey`, on parse/schema/deserialize failure `removeItem` the slot + unregister it from the index (contrast `job-checkpoint-storage.ts:28-30`). | S |
| Resume banner has no "back up a few lines" affordance (`CheckpointResumeBanner.tsx:30-45`, sits directly above `StartFromLineControl`, `JobControls.tsx:60-61`) | Add an optional offset stepper (or a "Resume earlier…" action that pre-fills Start-from-line with the mapped `rawResumeLine`), defaulting to ~a buffer's worth. | S |
| Truncated comment leaves the coordinate-cap rationale half-missing (`project-shape-validator.ts:51`) | Restore the full sentence explaining `MAX_COORDINATE_MAGNITUDE_MM` (absurd magnitudes serialize to exponent notation the G-code bounds-check regex can't read, defeating the bounds check). | S |

---

## Import & file I/O workflow — implementation tickets

### IMP-01 · Add a G-code preflight predicate that catches non-numeric coordinate words
- **Fixes:** Preflight bounds check silently skips non-numeric coordinates — the NaN backstop is still missing at the G-code gate — severity major (verified: CONFIRMED)
- **Root cause:** `parseGcodeWord` returns `null` both when a word is *absent* and when it is *present-but-non-numeric*: `GCODE_NUMBER` never matches `XNaN`/`XInfinity` and the `Number.isFinite` filter nulls overflow forms (`gcode-words.ts:1-11`). `appendAxisBoundsIssue` returns immediately on `null` (`predicates.ts:121`), so `findOutOfBoundsCoords` silently skips the axis, and no other predicate inspects the token. Meanwhile `fmt()` stringifies `NaN.toFixed(3)` → `'NaN'` (`grbl-strategy.ts:35-37`), so `G1 XNaN ...` passes every check and faults on GRBL mid-job.
- **Approach:** New pure predicate `findNonNumericMotionWords(gcode): readonly Issue[]` in a **new** file. For each motion line (`isGcodeMotionCommand`), detect any of `X/Y/Z/F/S` that is *present* (letter matched via the existing `(?:^|[^A-Za-z])` boundary) but is **not** immediately followed by a valid `GCODE_NUMBER` — reuse the exact `GCODE_NUMBER` source so legitimate `X1.2e2`, `X.5`, `X-3E-1` never false-positive. Return one `Issue` per offending word. Wire into `runPreflight` via a new `appendNonNumericWordIssues(gcode, issues)` and add `'non-numeric-coord'` to the `PreflightCode` union. (Preferred over asserting `Number.isFinite` inside each strategy's `fmt()`, which would duplicate the guard across 4+ emitters; the preflight gate is the single chokepoint the finding calls "blind".)
- **Files:** `src/core/invariants/non-numeric-words.ts` (new); `src/core/invariants/index.ts` (modify — export the predicate); `src/core/preflight/preflight.ts` (modify — new code + append call). `PreflightCode` is referenced only in `preflight.ts` + `preflight/index.ts` (no exhaustive switch to update).
- **Tests:** `src/core/invariants/non-numeric-words.test.ts` (new, write first): `G1 XNaN Y5` → one issue; `G1 X-3E-1 Y.5` and `G0 Y6` (X absent) → none. Plus a `src/core/preflight/preflight.test.ts` case: a gcode string containing `G1 XNaN` makes `runPreflight(...).ok === false`.
- **ADR:** none (pure invariant hardening; no output/default change — matches LightBurn "never emits malformed coordinate words").
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Read-only over the gcode string → no snapshot churn. Keep the predicate pure (return `Issue[]`, no throw). Only real risk is a regex that flags valid scientific/decimal forms — mitigated by reusing `GCODE_NUMBER`.

### IMP-02 · Import embedded `<image>` bitmaps from SVGs (or make the dropped-image toast honest)
- **Fixes:** SVG embedded `<image>` elements are dropped with a stale "Phase E will support these" promise — severity major (verified: CONFIRMED)
- **Root cause:** `walkElement` matches `tag === 'image'` and only does `counts.image += 1` (`parse-svg.ts:171-172`); no geometry/raster object is produced, and `parse-svg.ts:450-452` appends the "Ignored N image element(s)" note. The sanitizer already *keeps* `data:image/` hrefs (`sanitize.ts:36,66`), so the bitmap survives sanitization but is discarded at the walk. The toast (`import-toasts.ts:46-52`) says "Phase E will support these" though Phase E shipped (`PROJECT.md:89-91`); `WORKFLOW.md:90-92` carries the same stale promise.
- **Approach (parity, preferred):** Extract embedded bitmaps into `raster-image` objects. In a **new** `src/io/svg/svg-embedded-images.ts`, collect `<image>` elements carrying a `data:image/` href plus their resolved geometry (x/y/width/height after unit scale + transform); surface them on `ParseSvgResult` as `embeddedImages: EmbeddedSvgImage[]` (replacing the bare `ignoredImageElements` count). At the UI import boundary (`handleImportSvg` in `file-actions.ts` and `importMany` in `use-import-drag-drop.ts`), decode each data URL through the existing `importImageFile` luma/geometry path (`import-image-action.ts`) and insert a `raster-image` alongside the `imported-svg`. Route new extraction into the new file (NOT `parse-svg.ts`, which is already at the ~400-line cap — see Polish). **Smaller alternative (maintainer's call):** leave decode unbuilt and just change the toast to an honest "N embedded image(s) not imported — place the bitmap separately" and update `WORKFLOW.md:90-92`; this still needs the ADR to record the divergence.
- **Files:** `src/io/svg/svg-embedded-images.ts` (new); `src/io/svg/parse-svg.ts` (modify — call extractor, drop the count); `src/io/svg/index.ts` (modify — export type); `src/ui/app/file-actions.ts` + `src/ui/app/use-import-drag-drop.ts` (modify — decode + insert); `src/ui/app/import-toasts.ts` (modify — replace stale toast); `WORKFLOW.md:90-92` (modify). Alternative scope: only `import-toasts.ts` + `WORKFLOW.md`.
- **Tests:** `src/io/svg/svg-embedded-images.test.ts` (new) — an SVG with one `data:image/png` `<image>` yields one `EmbeddedSvgImage` with correct mm bounds; `src/ui/app/use-import-drag-drop.test.tsx` — a mixed vector+bitmap SVG inserts both an `imported-svg` and a `raster-image`.
- **ADR:** NEEDED — embedded-raster-in-SVG import policy (build parity vs record honest divergence).
- **Effort:** M  ·  **Depends on:** none (routes into a new file to avoid the parse-svg.ts size cap; Polish split optional)
- **Risk:** `parse-svg.ts` is at the counted-line cap — do NOT grow it; keep extraction in the new file. Luma decode is async/UI-layer (canvas), so it cannot live in synchronous pure `parseSvg` — the UI boundary owns decode. Watch DOMPurify keeping only `data:image/` (already true).

### IMP-03 · Add a unified "Import…" command on Ctrl+I that accepts every format
- **Fixes:** Import is split into three format-specific commands; Ctrl+I opens an SVG-only picker — severity major (verified: CONFIRMED)
- **Root cause:** `command-families.ts:34` binds `Import SVG…` to Ctrl+I; `file.import-dxf`/`file.import-image` have no shortcut (`:35-42`). Pickers are single-family: `file-actions.ts:58` accepts `['.svg']`, `:43` `['.dxf']`, `platform-image-files.ts:3` image-only. `shortcuts.ts:135` dispatches Ctrl+I → `handleImportSvg` (SVG-only). Worse, `shortcut-list.ts:30` labels Ctrl+I generically as "import", over-promising. The drop handler already dispatches SVG+DXF+image+STL from one entry point (`use-import-drag-drop.ts:63-92`).
- **Approach:** Extract the drop handler's extension-dispatch body into a shared `dispatchImportFiles(files, deps)` in a **new** `src/ui/app/import-dispatch.ts` (SVG→`parseSvg`+`importSvgObject`, DXF→`importDxfFiles`, PNG/JPG→`importImageFile` via `FileHandle.blob()`, STL→`importStlFiles`). Add `handleImportAny(platform, deps)` opening one picker with `accept ['.svg','.dxf','.png','.jpg','.jpeg','.stl']` and routing each returned `FileHandle` by extension through the shared dispatcher. Add a `file.import` command "Import…" bound to Ctrl+I in `command-families.ts`; repoint `FILE_DISPATCH['i']` in `shortcuts.ts` to `handleImportAny`; drop the Ctrl+I binding off `file.import-svg` but keep the three per-format items as secondary menu entries. `shortcut-list.ts:30` ("import") becomes accurate.
- **Files:** `src/ui/app/import-dispatch.ts` (new); `src/ui/app/use-import-drag-drop.ts` (modify — call shared dispatcher); `src/ui/app/file-actions.ts` (modify — `handleImportAny`); `src/ui/commands/command-families.ts` (modify — add `file.import`, move Ctrl+I); `src/ui/app/shortcuts.ts` (modify — rebind `i`); `src/ui/commands/use-app-commands.ts` (modify — wire `importAny` into `fileCommandContext`); `src/ui/commands/command-types.ts` (modify — add `importAny` to `AppCommandContext`); `WORKFLOW.md` F-A3/F-A4 (modify — one universal Import).
- **Tests:** `src/ui/app/import-dispatch.test.ts` (new) — a mixed file list routes each extension to the right importer; `src/ui/app/shortcuts.test.ts` — Ctrl+I invokes `handleImportAny`, not the SVG-only handler.
- **ADR:** NEEDED — unified Import command + Ctrl+I semantics (records LightBurn parity; retains per-format items).
- **Effort:** M (corrected up from S: doing it right means the shared dispatcher extraction + new command + context field + shortcut rebind, not just widening the accept list)  ·  **Depends on:** none
- **Risk:** Image import currently flows through `callbacks.requestImportImage` (dialog); the unified path decodes `FileHandle.blob()` directly like the drop path — verify parity of the raster-insert (selection/stagger). Boundary-safe (all `ui/`). No snapshot churn.

### IMP-04 · Make repeat-import of a same-named file offer "import as copy" instead of always replacing
- **Fixes:** Re-importing a file with the same name silently replaces the existing object instead of adding a copy — severity major (verified: CONFIRMED)
- **Root cause:** `findReimportTarget` matches purely on `source` filename (`scene-mutations.ts:79-87`; `source` = "filename for display", `scene-object.ts:87`); `importSvgObject` unconditionally routes a match to `applyReimport`, which keeps id+transform and diffs colors (`object-insert-actions.ts:55-63`, `scene-mutations.ts:454-488`) — there is no add-as-copy branch. `store.test.ts:196-212` pins this as intended "Phase C #7". LightBurn's Import always adds a new instance. `PROJECT.md:75` scopes "SVG re-import with diff" but no ADR records the always-replace divergence, and `WORKFLOW.md:810` F-C4 is a bare stub.
- **Approach:** Keep replace-with-diff as the default (it serves the iterate-in-Inkscape loop) but give the user the choice. Thread an optional `importMode: 'replace' | 'copy'` (named union, not a boolean flag) decided at the UI layer into `importSvgObject`; `'copy'` bypasses `findReimportTarget` and forces `applyFreshImport`. Surface it either as a `jobAwareConfirm` prompt when a re-import target is found ("Replace design.svg, or import as a copy?") or a secondary "Import as Copy" menu item — maintainer's UX call. Write `WORKFLOW.md` F-C4 with the explicit semantics and record the divergence in `DECISIONS.md`.
- **Files:** `src/ui/state/object-insert-actions.ts` (modify — honor `importMode`); `src/ui/state/store.ts` + `src/ui/state/scene-mutations.ts` (modify — `ImportOutcome`/action signature); `src/ui/app/file-actions.ts` + `src/ui/app/use-import-drag-drop.ts` (modify — pass the chosen mode); `WORKFLOW.md:810` (write F-C4); `DECISIONS.md` (new ADR). May be split doc-first (F-C4 + ADR land, then the code).
- **Tests:** `src/ui/state/store.test.ts` — new case: `importSvgObject(replacement, { mode: 'copy' })` (or the UI copy path) adds a second object; existing replace tests unchanged.
- **ADR:** NEEDED — SVG/DXF re-import semantics: default replace-with-diff vs LightBurn add-a-copy.
- **Effort:** M  ·  **Depends on:** none (note: DXF re-import shares `importSvgObject`/`applyReimport`, so the fix covers DXF too — see IMP-08's importer)
- **Risk:** Signature change ripples to every `importSvgObject` caller; keep the param optional so default behavior is unchanged. Honor CLAUDE.md: use a named union, not `doThing(obj, true)`.

### IMP-05 · Reconcile WORKFLOW.md web-save docs with the Chromium-only File System Access contract
- **Fixes:** WORKFLOW.md documents a web save "browser download" fallback that deliberately does not exist — severity major (verified: CONFIRMED, corrected to **minor**)
- **Root cause:** `WORKFLOW.md:342` (F-A9 web) says G-code save "uses File System Access API where available, else browser download"; `WORKFLOW.md:396-397` (F-A11 edge) says web project save "falls back to browser download" and specifies a `Save needs file-system access. Re-prompt?` modal. The shipped adapter contradicts both: `web-adapter.ts:1-6` states "No download-fallback path" and `:50-53` throws when `showSaveFilePicker` is missing; that throw surfaces as the generic error toast in `file-actions.ts:245-247`, with no re-prompt modal. `PROJECT.md:37` targets Chromium-only, so the code is correct and the doc drifted.
- **Approach:** Docs-only. Rewrite `WORKFLOW.md:342` and `:396-397` to state the Chromium-only File System Access contract (no download fallback, no IndexedDB), and the *actual* failure copy ("Could not save project: File System Access API is required to save files in the web app."). Delete the phantom `Save needs file-system access. Re-prompt?` modal. Confirm with the maintainer that the resolution is doc-follows-code (not implement-the-fallback) — CLAUDE.md treats internal contradiction as stop-and-ask, and `PROJECT.md:37` already settles it toward Chromium-only.
- **Files:** `WORKFLOW.md:342,396-397` (modify).
- **Tests:** docs-only, no test.
- **ADR:** none (decision is already implied by `PROJECT.md:37` + the adapter comment; this only aligns the doc).
- **Effort:** S  ·  **Depends on:** none
- **Risk:** EOL trap — `WORKFLOW.md` is prettier-ignored; preserve existing CRLF/LF line endings (edit via a CRLF-preserving method, verify `git diff --stat` shows only the intended hunks).

### IMP-06 · Update F-A3 to match shipped SVG-import behavior (sniff / spinner / units / batch toast)
- **Fixes:** F-A3 documented import states missing: no MIME/content sniff, no >5s parse spinner, no units-assumed toast, no batch summary toast — severity minor (verified: no verdict recorded; kept minor)
- **Root cause:** Filters are extension-only (`use-import-drag-drop.ts:112-124` sort by `.svg`/`.png` name; picker `accept` lists), but `WORKFLOW.md:95` documents MIME + first-200-byte content sniff. `parseSvg` is synchronous (`parse-svg.ts:414-438`), so the documented non-blocking "Parsing large SVG…" spinner (`WORKFLOW.md:105`) is impossible and a confirmed oversize import freezes the UI. The "no units — assuming millimeters" info toast (`WORKFLOW.md:123-124`) is never emitted (unit handling is richer per ADR-046). Multi-file drops toast per-file (`use-import-drag-drop.ts:83-88`), not the documented batch `Imported 3 designs · 7 colors total` (`WORKFLOW.md:88`).
- **Approach:** Primary is docs-reconciliation: correct `WORKFLOW.md` F-A3 (lines 88, 95, 105, 123-124) to describe extension-based filtering, synchronous parse with no spinner, actual per-file toasts, and the real unit handling. Explicitly separate the only genuine mechanism gap — moving `parseSvg` into the existing trace Web Worker so oversize imports don't block the main thread — as a **deferred, separate enhancement ticket** (M), not folded in here.
- **Files:** `WORKFLOW.md:88,95,105,123-124` (modify). (Worker move, if pursued later: `src/io/svg/parse-svg.ts` + a worker wrapper — separate PR.)
- **Tests:** docs-only, no test.
- **ADR:** none (the worker-move enhancement, if built, would need one).
- **Effort:** S for the doc reconciliation (corrected down from M — the M was the worker move, which is deliberately split out)  ·  **Depends on:** overlaps IMP-02 on the `WORKFLOW.md:90-92` embedded-image line — coordinate the doc edits.
- **Risk:** EOL/CRLF trap (prettier-ignored `.md`). Don't silently "document" the UI-freeze as acceptable — flag the worker move so the perceptual/UX gap stays visible.

### IMP-07 · Gate oversize-import confirm before reading the file in the picker paths
- **Fixes:** Picker import path reads the whole file into memory before the 25 MB oversize confirm — severity minor (verified: no verdict recorded; kept minor)
- **Root cause:** `FileHandle` exposes no `size` (`platform/types.ts:6-14`), so the File-menu SVG path must `await file.text()` before it can call `confirmOversizeImport(name, text.length)` (`file-actions.ts:66-69`); the DXF path is identical (`dxf-import-action.ts:35-36`). The guard then only blocks the *parse*, not the *read* — a multi-hundred-MB file OOMs/stalls the tab before the user is asked. The drop path checks `file.size` first, in the correct order (`use-import-drag-drop.ts:150`).
- **Approach:** Add `readonly size?: number` to `FileHandle`. Populate it in `web-adapter.ts` (the File from `handle.getFile()` already has `.size`) and the Electron adapter (from `fs.stat`). Hoist `confirmOversizeImport` above the `await file.text()` in both picker paths, gating on `handle.size` when present and falling back to the current post-read gate when `size` is `undefined` (mock/unpopulated adapters).
- **Files:** `src/platform/types.ts` (modify — add `size?`); `src/platform/web/web-adapter.ts` (modify — set `size: file.size`); Electron adapter under `src/platform/electron/*` (modify — set from stat; verify path); `src/ui/app/file-actions.ts:66-69` (modify — hoist); `src/ui/app/dxf-import-action.ts:35-36` (modify — hoist).
- **Tests:** `src/ui/app/dxf-import-action.test.ts` (extend, write first) — a handle whose `size` exceeds the threshold and a declining confirm means `text()` is never called; and the `size === undefined` fallback still parses.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Optional field is backward-compatible; must keep the post-read fallback for adapters that don't set `size`. Boundary-safe. No snapshot churn.

### IMP-08 · Reject/report unreadable DXF coordinate values instead of silently zeroing them
- **Fixes:** DXF value-level corruption coerces silently to 0 instead of rejecting with a line number — severity minor (verified: no verdict recorded; kept minor)
- **Root cause:** `parseNumber` substitutes a fallback (0) for any non-numeric value (`dxf-entities.ts:180-183`); `firstNumber` (`:163-166`) uses it for geometry codes. `tokenizeDxf` only rejects structural corruption — bad integer *group codes* and truncation (`dxf-tags.ts:32-44`) — which is what `WORKFLOW.md:1753-1754` actually documents, not value-level corruption. DXF also has no coordinate-magnitude cap; SVG does (`svg-import-budget.ts:1-6`, `coordinateMagnitudeMm: 1_000_000`), so extreme-but-finite DXF coords import and only fault later at bed-bounds preflight.
- **Approach:** For geometry-bearing codes (10/20/30, 40/41/42, 50/51), make value parsing distinguish "unreadable" from "0": a strict parse that returns a tagged failure at those extraction sites, counted into `parseDxf`'s existing `skippedSummary` so the entity is skipped and the toast lists it (matches LightBurn "rejects unreadable entities"). Add a magnitude cap mirroring SVG — reject/skip entities whose |coord| exceeds the cap (reuse `SVG_IMPORT_LIMITS.coordinateMagnitudeMm` via a shared const or a small `DXF_IMPORT_LIMITS`).
- **Files:** `src/io/dxf/dxf-entities.ts` (modify — strict parse for geometry codes + magnitude cap, feed skipped tally); possibly `src/io/dxf/parse-dxf.ts` (modify — surface the corrupt-value count in `skippedSummary`); a shared limits const (new small file or reuse — io←io import is allowed).
- **Tests:** `src/io/dxf/dxf-entities.test.ts` (or `parse-dxf.test.ts`, write first) — a LINE with a non-numeric X is reported as skipped (not imported at 0); a coord beyond the magnitude cap is skipped.
- **ADR:** none (parity with LightBurn).
- **Effort:** M (corrected up from S: strict parse at multiple geometry sites + cap + wiring into the skip report is more than a one-liner)  ·  **Depends on:** none
- **Risk:** Import-side only → no snapshot churn. Behavior change: previously-zeroed geometry now skipped (it was garbage). Keep non-geometry codes tolerant so normal files are unaffected.

### IMP-09 · Add File → Open Recent (MRU of saved/opened projects)
- **Fixes:** No Open Recent, anywhere — severity minor (verified: no verdict recorded; kept minor)
- **Root cause:** `WORKFLOW.md:29` (F-A1) says returning users open via `File → Open Recent (Phase C)`; grep for `Open Recent|recentProjects|recent-files` over `src` returns nothing. `fileCommands` (`command-families.ts:10-60`) has no recent list. Combined with recovery only prompting on an empty scene and `lastSaveTarget` cleared on New/Open, every session starts with a full picker navigation to the last project.
- **Approach:** Persist a small MRU (localStorage) of saved/opened project entries (name + timestamp; plus the `FileSystemFileHandle` in IndexedDB where the platform can persist it). Record entries from `handleSaveProject` and `handleOpenProject`. Render a `File → Open Recent` submenu; selecting an entry re-opens via the stored handle after a `queryPermission`/`requestPermission` check (web), falling back to a pre-filled picker when no handle/permission. MVP scope = names-only + picker fallback (M); handle re-open is the L upgrade.
- **Files:** `src/ui/state/recent-projects.ts` (new — persisted MRU store, add/dedupe/cap); `src/ui/app/file-actions.ts` (modify — record on save/open); `src/ui/commands/command-families.ts` (modify — submenu); wiring in `use-app-commands.ts`.
- **Tests:** `src/ui/state/recent-projects.test.ts` (new) — add/dedupe/cap/persist round-trip.
- **ADR:** NEEDED — recent-projects persistence surface (localStorage + optional IndexedDB handle store) and re-open UX. Note: `WORKFLOW.md`/`PROJECT.md` disallow an IndexedDB *save* fallback (F-A11); a recent-*handle* store is a distinct use that this ADR must scope separately.
- **Effort:** M (names-only MVP; L with handle re-open)  ·  **Depends on:** none
- **Risk:** New persistence surface; keep it best-effort (a corrupt/absent store must not break boot). Handle-permission prompts are async and can be denied — degrade to the picker.

### IMP-10 · Record a scope decision (ADR) for `.lbrn` project import
- **Fixes:** `.lbrn` project import is absent with no recorded scope decision — severity minor (verified: no verdict recorded; kept minor, effort L)
- **Root cause:** grep for `lbrn` over `src` returns nothing; `io/lightburn` imports only `.lbdev` device profiles (`lbdev-import.ts:40-64`). The out-of-scope list (`PROJECT.md:462,470-471`) names `.clb`, AI, PDF explicitly but is silent on `.lbrn`; `DECISIONS.md:39` calls `.lf2` "analogous to `.lbrn`" without saying whether reading `.lbrn` is in or out of scope. For a LightBurn migrator their entire project library is unreadable, and the repo has no written decision that this is intentional.
- **Approach:** This is a scope decision, not a bug. Primary deliverable is a `DECISIONS.md` ADR that either (a) scopes a geometry-plus-cut-settings `.lbrn` importer (the format is zlib-wrapped XML → shapes map to `SceneObject`s, cut layers to layers), or (b) explicitly declares `.lbrn` out of scope and adds it to the `PROJECT.md` out-of-scope list so the gap is a recorded choice. If the decision is "build it," a follow-up L implementation ticket adds a clean-room `src/io/lightburn/lbrn-import.ts` (inflate + XML parse, no parser libs per ADR-098 mandate).
- **Files:** `DECISIONS.md` (new ADR); `PROJECT.md:470-471` (modify if out-of-scope). Implementation (only if scoped in): `src/io/lightburn/lbrn-import.ts` (new) + `src/io/lightburn/index.ts` (modify).
- **Tests:** ADR/docs-only for the decision; if implemented, `src/io/lightburn/lbrn-import.test.ts` against a `.lbrn` fixture.
- **ADR:** NEEDED — `.lbrn` project import in/out of scope (and, if in, geometry+cut-settings mapping).
- **Effort:** S for the decision; L for the importer if scoped in  ·  **Depends on:** maintainer scope call before any code
- **Risk:** Building it is a large clean-room parser; do NOT start implementation before the ADR settles scope.

### IMP-11 · Implement or remove F-A12's "device profile not configured locally" warning
- **Fixes:** F-A12 edge state "project references a device profile not configured locally" has no implementation — severity minor (verified: no verdict recorded; kept minor)
- **Root cause:** `WORKFLOW.md:423-425` documents a status-bar warning (`Project's device profile (xTool S1) is not configured locally. Add it in Settings.`) when opening a `.lf2` whose embedded profile is unknown to this machine. The load path adopts the embedded device wholesale — `deserializeProject` normalizes and keeps it (`deserialize-project.ts:210-240`), and `handleOpenProject` (`file-actions.ts:288-299`) does no local-profile comparison. grep for `not configured locally` returns nothing.
- **Approach:** Two honest options; pick one and record it. (a) Delete/mark the F-A12 edge state in `WORKFLOW.md` as unimplemented (docs, S) — the defensible move if no machine-local device-profile registry exists to compare against. (b) Implement the check: compare the opened project's device against the local machine-profile store and surface the status-bar warning (M — requires a local-profiles registry and a status-bar surface; verify these exist before committing). Primary recommendation: docs-reconciliation (option a) unless the maintainer wants the feature.
- **Files:** `WORKFLOW.md:423-425` (modify/remove). If implemented: `src/ui/app/file-actions.ts` (modify — post-load compare) + wherever local device profiles are stored + a status-bar component.
- **Tests:** docs-only if option (a). If implemented: a `file-actions` test that opening a project with an unknown embedded profile pushes the warning.
- **ADR:** none.
- **Effort:** S (docs) / M (implement)  ·  **Depends on:** none
- **Risk:** EOL/CRLF trap for the `.md` edit. Don't claim the check exists — verify a local-profile registry before choosing option (b).

#### Polish (deferred, one-liners)
| finding | one-line fix | effort |
|---|---|---|
| Core import files riding the 400 counted-line cap (`parse-svg.ts` ~400, `project-shape-validator.ts` ~396, `scene-mutations.ts` ~392, `store.ts` ~381) | Split before the next feature touches them: extract matrix/transform → `svg-transform.ts` and color → `svg-color.ts` from `parse-svg.ts` (also unblocks IMP-02); same treatment for the validator and `scene-mutations.ts`. Pure refactor PR, no behavior change. | M |
| Inconsistent io error contract: `parseSvg` throws (`parse-svg.ts:417-427`, `svg-import-budget.ts:29-46`) while `parseDxf` returns a `Result` (`parse-dxf.ts:29-38`), forcing every caller into try/catch (`use-import-drag-drop.ts:151-171`) | Migrate `parseSvg` to the same `ParseResult` tagged union in a pure refactor PR; the toast helpers already centralize messaging so the diff is mechanical. | M |

---

## Layers & cut settings (the LightBurn Cuts panel) — implementation tickets

Sector grade **B**. Core LightBurn semantics are correct; every ticket below is governance, discoverability, or doc-drift — not a compile/output correctness bug. All findings were static-read only; none was verified perceptually. No criticals. 4 majors (finding 4 splits into two tickets — a behavior fix and a docs rewrite), 6 minors, 1 polish.

---

### LAY-01 · Enable material-preset Apply on device mismatch (warn, don't block) per ADR-045
- **Fixes:** Material preset apply is device-BLOCKED, contradicting ADR-045's warn-don't-block decision — severity major (verified: CONFIRMED)
- **Root cause:** Device-mismatched presets are filtered out by `rankMaterialRecipeCandidates` (scopeScore returns null, material-matching.ts:97-121), so `materialLibraryPresetOptions` tags them `isAssignable:false` / "not compatible" (material-library-preset-options.ts:42-49). The UI disables Apply on `isAssignable===false` (MaterialLibraryRecipeControls.tsx:19-22) AND the store re-blocks via `canAssignPreset` (material-library-actions.ts:66,104-107), which returns false whenever no match exists — so even a UI bypass yields "Preset was not applied." DECISIONS.md:2366-2367 says device hints "do not block cross-machine reuse."
- **Approach:** Scope this to the *device-mismatch* axis only (that is what ADR-045 governs). (1) In `unmatchedOption` set `isAssignable:true`, keeping `warnings:[INCOMPATIBLE_WARNING]` and the "not compatible" label so the warning still shows. (2) In `assignMaterialPresetToLayer`, delete the `if (!canAssignPreset(...)) return {}` guard at line 66 (and the now-unused `canAssignPreset` helper); the recipe patch already applies correctly regardless of match. (3) In `MaterialLibraryRecipeControls`, drop `isAssignable===false` from `applyDisabled` and gate Apply behind a `jobAwareConfirm` (already imported) when `activePresetOption.warnings.length > 0`, matching ADR-045's "warn, perhaps with a confirm." Leave `confidence==='unsupported'` matched presets blocked — that is a distinct safety axis (`confidenceScore` -1000) ADR-045 does not cover; note it explicitly so the scope is deliberate.
- **Files:** src/ui/layers/material-library-preset-options.ts (modify); src/ui/state/material-library-actions.ts (modify); src/ui/layers/MaterialLibraryRecipeControls.tsx (modify)
- **Tests:** test-first in src/ui/state/material-library-actions.test.ts — add a case: a preset whose device fields don't match the active profile now returns `true` from `assignMaterialPresetToLayer` and patches the layer recipe. Also extend src/ui/layers/material-library-preset-options.test.ts (or add it) asserting a device-mismatched preset yields `isAssignable:true` with the incompatible warning retained.
- **ADR:** none — this *restores* ADR-045. (Only if the maintainer decides blocking is now intended does ADR-045 need an explicit supersede; note that alternative in the PR.)
- **Effort:** S · **Depends on:** none
- **Risk:** Behavior change to preset assignment; no G-code snapshot churn (assignment path unchanged, only reachability). Confirm-dialog wording should name the device so the warn is intelligible. Keep `unsupported` blocked to avoid regressing the neotronics-unsupported safety case.

---

### LAY-02 · Keep the Layers list expanded when an object is selected
- **Fixes:** Selecting any object collapses the Layers list into a closed `<details>` and hides the layer's cut fields — severity major (verified: CONFIRMED; verifier noted the "re-collapses on every selection" claim holds only for no-selection→selection transitions, since same-fragment element-type swap remounts)
- **Root cause:** When `hasSelection`, `CutsLayersPanel` wraps `LayerList` (and the laser-only `MaterialLibraryPanel`) in `CollapsedPanel` (CutsLayersPanel.tsx:48-64), an uncontrolled `<details>` with no `open` attribute (lines 89-101) → renders closed. The no-selection branch renders `LayerList` bare, so switching branches remounts a fresh, closed disclosure every time a selection first appears. LightBurn's Cuts list is always visible.
- **Approach:** Give `CollapsedPanel` a discriminated `defaultOpen` prop (not a bare boolean literal at the call site — pass a named const) and render `<details {...(defaultOpen ? { open: true } : {})}>`. Default the **Layers** section open so the list stays visible on selection; leave Material Library collapsible. This is the minimal faithful fix (default-open); full persistence across manual toggles would require lifting open-state into `useUiStore` (larger — call out as optional follow-up, not required for parity). The companion complaint — LayerRow.tsx:154-157 replacing the layer's Power/Speed/Passes with the "Use Selected Artwork Settings above" hint — is the automatic per-object redirect; its redesign (explicit toggle vs auto-redirect) is a design decision deferred to the LAY-03 ADR, not this ticket.
- **Files:** src/ui/layers/CutsLayersPanel.tsx (modify)
- **Tests:** test-first in src/ui/layers/CutsLayersPanel.test.tsx (add if absent) — with an object selected, the "Layer management section" `<details>` renders with `open` and the layer rows are queryable.
- **ADR:** none
- **Effort:** S (finding estimated M; default-open is a few lines. Full cross-selection persistence would be M) · **Depends on:** none; interacts with LAY-03 (redirect UX)
- **Risk:** Low. Purely presentational. Verify the panel doesn't become cramped when SelectedObjectProperties + open layer list both show; that is the intended LightBurn layout.

---

### LAY-03 · Record the per-object `operationOverride` model in an ADR (+ persistent per-row override indicator)
- **Fixes:** Per-object cut-setting overrides (operationOverride) are an unrecorded LightBurn divergence — severity major (verified: CONFIRMED)
- **Root cause:** `ObjectPowerScale.operationOverride` (scene-object.ts:76-78) forks any layer setting per object; the compiler buckets overridden objects into synthetic effective layers (compile-job.ts:96-120 `vectorObjectBucketsForLayer`/`layerWithObjectOverride`; same in compile-job-raster.ts:99-102), and LayerRow silently retargets its own commit to `setSelectedObjectsOperationOverrideForLayer` whenever a selection exists on the layer (LayerRow.tsx:218-244), surfacing as "Selected Artwork Settings" (SelectedObjectOperationSettings.tsx:64). Only `powerScale` carries a LightBurn-parity comment (scene-object.ts:74). DECISIONS.md has no ADR for this (grep hits at 1037/2283/4178/4217/6091 are all unrelated "per-object" uses). ADR-027 (DECISIONS.md:1068) makes unrecorded LightBurn divergences defects.
- **Approach:** Write an ADR (governance deliverable, docs-only) recording: the override storage (`operationOverride` on `ObjectPowerScale`, inherit-missing-fields semantics), the compile bucketing into synthetic layers and its execution-order/preview implications, interaction with material presets (presets apply to layers, not overrides) and the layer list (an override is invisible except a "Editing selected (n)" badge while selected), and the deliberate divergence from LightBurn's strictly-per-layer model. The ADR should also settle the LAY-02 redirect question (auto-redirect vs explicit toggle). Companion code (small, can ride this PR or a follow-up): a persistent per-row indicator in LayerRow — e.g. a badge when `objects.some(o => sceneObjectUsesLayerColor(o, layer.color) && o.operationOverride !== undefined)` — so an override is discoverable without selecting.
- **Files:** DECISIONS.md (modify — new ADR, allocate number centrally); optionally src/ui/layers/LayerRow.tsx (modify — indicator) if the indicator lands here
- **Tests:** docs-only for the ADR, no test. If the indicator is included, test-first in src/ui/layers/LayerRow.test.tsx asserting the badge appears when any same-color object carries an override.
- **ADR:** NEEDED — per-object `operationOverride` model, compile bucketing, and divergence from LightBurn per-layer-only cut settings
- **Effort:** S (ADR) / +S (indicator) · **Depends on:** none; the ADR's redirect decision informs LAY-02
- **Risk:** Docs EOL trap — DECISIONS.md is prettier-checked; preserve existing line endings (edit via a tool that keeps LF/CRLF as-is). If the indicator lands, watch LayerRow.tsx size (296 counted, see LAY-11) — extract a small `<LayerOverrideBadge>` rather than growing the file.

---

### LAY-04 · Reconcile the Delete-layer destructive semantics with the spec (confirm + accurate labels, or orphan)
- **Fixes:** WORKFLOW.md F-A7 is stale spec — sub-claim (b): delete button destroys artwork, contradicting the doc — severity major (verified: CONFIRMED). Split from finding 4; the doc rewrite is LAY-05.
- **Root cause:** `DeleteLayerButton` calls `deleteLayerAndObjects` (DeleteLayerButton.tsx:5-11) → `deleteLayerContent` removes the layer *and* every object of its color (layer-actions.ts:127-137,216-242), with no confirmation. WORKFLOW.md:226 says the delete is "for the *Layer*, not the objects" and WORKFLOW.md:455 says Phase A exposes no manual layer delete at all; LightBurn has no per-layer delete button (empty layers just leave the list). So the shipped behavior is both undocumented and destructive-without-confirm (undo does restore it).
- **Approach:** Decide deliberately (surface to maintainer). Smallest safe fix that removes the contradiction: gate `DeleteLayerButton.onClick` behind `jobAwareConfirm` (pattern already used in MaterialLibraryRecipeControls.tsx:45) with copy naming that artwork is deleted too, and keep the accurate title "Delete this layer and its assigned artwork." The more LightBurn-faithful alternative — remove the button (or make it non-destructive: drop the layer, reassign its objects to a default layer) — is larger because no "default layer" concept exists; note it as the option that matches LightBurn. Either way the doc must change (LAY-05).
- **Files:** src/ui/layers/DeleteLayerButton.tsx (modify); if the orphan option is chosen instead: src/ui/state/layer-actions.ts (modify) + a new core reassignment helper
- **Tests:** test-first in src/ui/layers/DeleteLayerButton.test.tsx — clicking Delete with `jobAwareConfirm` mocked to false does NOT call `deleteLayerAndObjects`; true does. (For the orphan option: a layer-actions.test.ts case asserting objects survive reassigned.)
- **ADR:** NEEDED — records the deliberate divergence: whether we keep a destructive delete-with-artwork (confirm-gated) or match LightBurn (no layer delete / orphan-to-default)
- **Effort:** S (confirm) / M (orphan) · **Depends on:** none; pairs with LAY-05 (doc must reflect the decision)
- **Risk:** Behavior change to a destructive action. `jobAwareConfirm` is UI-side, no core-purity concern. No G-code churn.

---

### LAY-05 · Rewrite WORKFLOW.md F-A7 to the shipped card UI (docs-only)
- **Fixes:** WORKFLOW.md F-A7 is stale spec — sub-claims (a),(c),(d): layout, phantom status messages, un-marked Fill/Image supersede — severity major (verified: CONFIRMED). Split from finding 4; delete semantics is LAY-04.
- **Root cause:** ADR-016 (DECISIONS.md:286) makes WORKFLOW.md the spec, but F-A7 drifted: (a) WORKFLOW.md:217-226 specifies a 7-item left-to-right row; the shipped UI is a vertical card stack (CutsLayersPanel.tsx:1-11 comment says so explicitly). (c) Documented status confirmations "Layer · power set to 50%" (240) and range errors "Power must be 0–100" (265) do not exist — grep "power set to" finds only an unrelated raster comment. (d) F-A7:220 still calls Fill/Image "disabled in Phase A" with no superseded marker, unlike the properly-marked F-ML1.
- **Approach:** Docs-only. Rewrite the F-A7 "Layout" block (217-226) to describe the card stack (header strip: swatch + order controls + Mode + action buttons + Show/Output/Job Air toggles; then field rows for power/speed/passes and mode-specific fields — matching CutsLayersPanel.tsx and LayerRow.tsx). Update the Mode line (220): Line/Fill/Image are all live. Reconcile the status-message lines (240, 264-272): either mark them superseded (with change-history note, as F-ML1 does) or, for the maxFeed cap, keep the message and cross-reference LAY-06 which implements it. Preserve the reorder/visibility/output sub-flows that are still accurate.
- **Files:** WORKFLOW.md (modify — section F-A7, lines ~214-272)
- **Tests:** docs-only, no test
- **ADR:** none
- **Effort:** M · **Depends on:** LAY-04 (final delete wording) and LAY-06 (which status messages actually ship). Sequence after both, or land first and note the two lines as tracked.
- **Risk:** EOL trap — `.md` is prettier-ignored, but keep existing line endings; verify via `git diff --stat` that only intended lines changed (no CRLF↔LF flip). No code impact.

---

### LAY-06 · Surface feedback when Speed is clamped to device maxFeed
- **Fixes:** Out-of-range numeric input is clamped silently — the promised red flash / status feedback is absent — severity minor (verified: no verdict; static claim)
- **Root cause:** `SpeedInput` clamps typed value into [1, maxFeed] inside `parse` (LayerRowFields.tsx:230) and the debouncer snaps the displayed text to the committed value (use-debounced-commit.ts:54-61, the deliberate M25 fix). Data is correct, but a user typing 8000 on a 6000-maxFeed device is silently corrected. WORKFLOW.md:269 promised "Capped to device max feed 6000 mm/min." The power (0-100) and passes (≥1) clamps match native input constraints and LightBurn — the load-bearing gap is only the device-dependent maxFeed cap.
- **Approach:** Reuse the existing `useToastStore.pushToast` (toast-store.ts:39, variant `'warning'`). Fire it once **on commit** (not per keystroke) when the committed speed was reduced by the maxFeed cap. Concrete: in `SpeedInput`, track the last raw numeric via a ref set in `parse`; in the `commit` callback compare against `maxFeed` and, when capped, `pushToast(\`Capped to device max feed ${maxFeed} mm/min\`, 'warning')`. Keep power/passes silent (they match LightBurn). Do not push from inside the generic `useDebouncedCommit` hook (keep it reusable) — do it in the field component. Cross-reference LAY-05 so WORKFLOW.md's red-flash lines are either softened or aligned to this toast.
- **Files:** src/ui/layers/LayerRowFields.tsx (modify — SpeedInput); apply the same to the Speed field in src/ui/layers/SelectedObjectOperationSettings.tsx (line 142) only if consistency is wanted (note as optional)
- **Tests:** test-first in src/ui/layers/LayerRowFields.test.tsx — typing a speed above maxFeed and flushing pushes exactly one warning toast with the cap value; typing an in-range value pushes none.
- **ADR:** none (or NEEDED only if the maintainer decides silent-clamp is the accepted design and WORKFLOW.md's promised feedback is dropped — then record that)
- **Effort:** S · **Depends on:** none; informs LAY-05
- **Risk:** Toast spam if fired on keystroke — must fire on commit/flush only. No core/purity impact (toast store is UI-side). No G-code churn.

---

### LAY-07 · Hide the dead "Visible" checkbox in the sub-layer editor (+ record the sub-layer model)
- **Fixes:** Sub-layers: LightBurn-divergent feature with no ADR, and the sub-layer dialog shows a dead 'Visible' checkbox — severity minor (verified: no verdict; confirmed by read)
- **Root cause:** The sub-layer editor reuses `CutSettingsDialog` wholesale (LayerSubLayers.tsx:118-127), so it renders both Visible and Output checkboxes, but `subLayerPatchFromDialog` (LayerSubLayers.tsx:182-190) discards `visible` (`_visible`) and remaps `output`→`enabled`. The user toggles a Visible box that does nothing. Sub-layers (layer.ts:46-51,193-208) are documented in WORKFLOW.md:882-897 but have no ADR (grep for sub-layer/sublayer in DECISIONS.md: none).
- **Approach:** Two concerns, one small ticket. (1) UI bug: pass a discriminated variant to `CutSettingsDialog` (e.g. `context: 'layer' | 'sub-layer'` — a string union, NOT a boolean prop per CLAUDE.md) so it hides the Visible field and relabels "Output" as "Enabled" when editing a sub-layer. (2) Governance: add an ADR recording the sub-layer model (extra operations per color, emitted after the primary via `outputOperationLayers`, layer.ts:204-208) and its divergence from LightBurn (which duplicates artwork / uses per-layer two-pass instead).
- **Files:** src/ui/layers/CutSettingsDialog.tsx (modify — accept variant, conditionally omit Visible / relabel Output); src/ui/layers/LayerSubLayers.tsx (modify — pass the sub-layer variant); DECISIONS.md (modify — new ADR)
- **Tests:** test-first in src/ui/layers/CutSettingsDialog.test.tsx — rendered with the sub-layer variant, there is no "Visible" checkbox and the enabled control is labeled "Enabled"; the layer variant still shows Visible.
- **ADR:** NEEDED — sub-layer (multi-operation-per-color) model and divergence from LightBurn
- **Effort:** S · **Depends on:** none
- **Risk:** `CutSettingsDialog` is shared with the primary layer editor — verify the default variant preserves current layer-editing behavior exactly (no snapshot/UX change for the main path). DECISIONS.md EOL trap.

---

### LAY-08 · Make image-mode overscan a per-layer setting (or record the fixed-5mm interim)
- **Fixes:** Image-mode overscan is a hard-coded 5 mm, not a per-layer setting — severity minor (verified: no verdict; confirmed by read)
- **Root cause:** Fill overscan is per-layer (`fillOverscanMm`, exposed in LayerRowFields.tsx:166-190 and the dialog), but raster/image overscan is the fixed `DEFAULT_OVERSCAN_MM = 5` (compile-job-defaults.ts:6) applied unconditionally at compile-job-raster.ts:93, with no field in CutSettingsImageFields or LayerImageFields. The code comment ("ride device profiles in the future") is an intent note, not an ADR. LightBurn exposes Overscanning per scanned layer for both Fill and Image.
- **Approach:** Primary (parity fix): add `imageOverscanMm` to `LayerOperationSettings` (layer.ts:20-44), default 5 in `LAYER_DEFAULTS` (keeps existing G-code identical), add it to `LAYER_OPERATION_SETTING_KEYS`, `captureLayerOperationSettings`, and the clipboard `LAYER_SETTING_KEYS`/`layerSettingsFrom` (layer-actions.ts:284-342); consume `layer.imageOverscanMm` in `compileRasterGroup` instead of `DEFAULT_OVERSCAN_MM` (compile-job-raster.ts:93); add a field in CutSettingsImageFields.tsx and LayerImageFields.tsx mirroring `fillOverscanMm`. Smaller interim alternative: docs-only ADR recording the fixed 5 mm and the device-profile deferral. Recommend the maintainer pick based on whether per-layer image overscan is wanted now.
- **Files:** (parity) src/core/scene/layer.ts (modify); src/core/job/compile-job-raster.ts (modify); src/ui/state/layer-actions.ts (modify — clipboard keys); src/ui/layers/CutSettingsImageFields.tsx (modify); src/ui/layers/LayerImageFields.tsx (modify). (interim) DECISIONS.md (modify)
- **Tests:** test-first in src/core/job/compile-job-raster.test.ts — a raster layer with a non-5 `imageOverscanMm` emits that overscan; default 5 leaves existing output unchanged. Plus a layer-model test that clipboard copy/paste round-trips the new field.
- **ADR:** NEEDED — either per-layer image-overscan schema addition (data model / `.lf2`) or the interim fixed-value + deferral
- **Effort:** L (per-layer field: schema + core + UI) / S (docs interim) · **Depends on:** none
- **Risk:** Schema addition touches `.lf2` persistence — round-trip carefully. G-code snapshot: no churn while default stays 5 and no fixture sets a new value; if a snapshot fixture adopts the field, add `Snapshot change acknowledged: per-layer image overscan`. LayerImageFields.tsx is 310 counted (see LAY-11) — adding a field may push it over; extract rather than grow.

---

### LAY-09 · Add a scope ADR listing deferred LightBurn cut-editor features (docs-only)
- **Fixes:** Missing LightBurn cut-editor features are not recorded as out of scope — severity minor (verified: no verdict; confirmed by read)
- **Root cause:** The Cut Settings editor covers kerf, tabs, air, fill, and a deep image section (CutSettingsCommonFields.tsx:63-130; layer.ts:20-44) but omits LightBurn per-layer staples — perforation mode, dot mode, Z offset / Z step per pass, cut-through (start/end pause) delays, fill grouping, ramp — with no DECISIONS.md scope entry (grep for those terms: none relevant). The project's own rule (ADR-027) wants absences a LightBurn user will hunt for to be deliberate and written down.
- **Approach:** Docs-only. Add a short scope ADR to DECISIONS.md enumerating the deferred cut-editor features and the reason for each (e.g. Z offset/Z step gated on the focus-test / Z-emit track; perforation and dot mode not yet built), so parity gaps read as decisions rather than surprises.
- **Files:** DECISIONS.md (modify — new scope ADR)
- **Tests:** docs-only, no test
- **ADR:** NEEDED — deferred LightBurn cut-editor features and rationale
- **Effort:** S · **Depends on:** none (relates to LAY-08 image-overscan and any future Z-offset work; can reference them)
- **Risk:** DECISIONS.md EOL trap. Purely additive doc.

---

### LAY-10 · Add move-to-top / move-to-bottom for layer reordering
- **Fixes:** Layer reordering is single-step arrow buttons only — severity minor (verified: no verdict; confirmed by read)
- **Root cause:** `LayerOrderControls` offers only one-position up/down buttons (LayerOrderControls.tsx:26-46), and `moveLayer` only swaps adjacent (`LayerMoveDirection = 'up' | 'down'`, scene.ts:19,73-82). Moving an 8-layer job's bottom layer to first is 7 clicks. LightBurn supports drag-and-drop plus move up/down/top/bottom.
- **Approach:** Smallest parity step: extend `LayerMoveDirection` to `'up' | 'down' | 'top' | 'bottom'` and handle the new arms in `moveLayer` (nextIndex = 0 for top, length-1 for bottom; splice), keeping `moveLayer` the single mutation primitive (store passthrough at store-actions.ts:39-49 already forwards the direction, and pushes undo). Add top/bottom buttons to `LayerOrderControls`, disabled at the ends. Full drag-and-drop is a larger follow-up — note it, don't build it here.
- **Files:** src/core/scene/scene.ts (modify — union + moveLayer arms, keep pure); src/core/scene/index.ts (no change — re-exports the type); src/ui/layers/LayerOrderControls.tsx (modify — two more buttons)
- **Tests:** test-first in src/core/scene/scene.test.ts — `moveLayer(scene, id, 'top')` moves to index 0, `'bottom'` to the last index, both no-op when already there and preserve the other layers' order.
- **ADR:** none (LightBurn parity, not a divergence)
- **Effort:** M · **Depends on:** none
- **Risk:** `moveLayer` feeds compile order (compile-job.ts:50) — reordering changes emitted-group order; if any G-code snapshot fixture reorders via these new arms, add `Snapshot change acknowledged: layer move-to-top/bottom`. Otherwise no churn.

---

### LAY-11 · Split the five sector files over the 250 counted-line soft limit (tidy, no behavior change)
- **Fixes:** Five sector files exceed the 250 counted-code-line soft limit — severity minor (verified: no verdict; line counts are approximate grep, not the ESLint counter)
- **Root cause:** Approx counted / raw: SelectedObjectOperationSettings.tsx ~385/402 (near the 400 hard counted limit), layer-actions.ts ~370/399 (near the 600 raw backstop; also mixes create + assignment + delete + clipboard + sub-layer re-export), LayerImageFields.tsx ~310, LayerRow.tsx ~296, LayerRowFields.tsx ~265. CLAUDE.md mandates stop-and-split at the soft limit.
- **Approach:** One tidy PR **per file** (do not batch — each is behavior-preserving and independently reviewable). Priority order by proximity to the hard limit: (1) SelectedObjectOperationSettings.tsx — extract `SelectedFillFields` and the `NumberField`/`MixedCheckbox`/`FieldRow` primitives into a sibling module. (2) layer-actions.ts — carve the clipboard flow (copy/paste + `LAYER_SETTING_KEYS`/`layerSettingsFrom`/`layerSettingsEqual`/`subLayersEqual`) and the delete flow (`deleteLayerAndObjects`/`deleteLayerContent`/`removeLayerColorFromObject`) into sibling action modules, following the existing `layer-sub-layer-actions.ts` split pattern. (3) Then LayerImageFields.tsx, (4) LayerRow.tsx, (5) LayerRowFields.tsx as they approach the limit. Each PR moves code only — no logic edits.
- **Files:** src/ui/layers/SelectedObjectOperationSettings.tsx (+ new sibling); src/ui/state/layer-actions.ts (+ new sibling action modules); src/ui/layers/LayerImageFields.tsx; src/ui/layers/LayerRow.tsx; src/ui/layers/LayerRowFields.tsx (each modify + new)
- **Tests:** pure refactor — flag each PR as such; existing co-located tests must pass unchanged. Update imports in test files where symbols move. No new behavioral test required.
- **ADR:** none
- **Effort:** M (spread over ~5 small PRs) · **Depends on:** sequence BEFORE LAY-03 (indicator → LayerRow.tsx), LAY-06 (LayerRowFields.tsx), and LAY-08 (LayerImageFields.tsx) if those edits would push a file past the hard limit; otherwise those tickets must include their own split step.
- **Risk:** Import churn only; module-boundary rules (ui←core,io) unchanged since these are all ui/ files. Verify no default-export or `index.ts` public-export count violations after moving symbols.

---

#### Polish (deferred, one-liners)

| finding | one-line fix | effort |
|---|---|---|
| Offset Fill lives inside the Fill dialog as "Follow Shape", not in the Mode dropdown where LightBurn users look (LayerRow.tsx:211-213 mode list; CutSettingsFillFields.tsx:17-29 style=Follow Shape) | Add an "Offset Fill" Mode option that sets `mode:'fill', fillStyle:'offset'` (mapping back to "Fill/Follow Shape" for display), or record the consolidation as a deliberate divergence in DECISIONS.md | S |

---

## Toolpath preview, simulation & job planning — implementation tickets

### PRV-01 · Show placement-failure reason in the preview overlay instead of a false "enable Output" hint
- **Fixes:** Placement failure yields an empty preview with a wrong 'enable Output' diagnosis — severity major (verified: CONFIRMED)
- **Root cause:** `use-preview-toolpath.ts:63-64` substitutes `buildToolpath(EMPTY_JOB)` when `resolveJobPlacement` returns `ok:false`, discarding `placement.messages`. `PreviewStatusOverlays` (`preview-overlays.tsx:14-19`) only receives `project` + `toolpath`, so `previewHasBurnableContent` (`preview-status.ts:20-23`) sees `totalLength===0` with no output raster and renders the scope-oriented hint "Nothing to preview — enable Output…" even though the real cause is placement (`job-placement.ts:69-127` produces three distinct failure messages).
- **Approach:** Carry the failure through the toolpath model the hook already returns. In `preview-status.ts` widen `PreviewIssue` from the bare string `'too-complex'` into a discriminated union `{ kind:'too-complex' } | { kind:'placement-unavailable'; messages: ReadonlyArray<string> }`, and update `previewIssueFor` to return it. In `use-preview-toolpath.ts`, on `!placement.ok` build `{ ...buildToolpath(EMPTY_JOB), previewIssue:{ kind:'placement-unavailable', messages: placement.messages } }` instead of a bare `EMPTY_JOB`. In `preview-overlays.tsx` render a distinct `lf-banner lf-banner--warning` "Preview unavailable: <message>" when the issue is `placement-unavailable`, and suppress the `empty` enable-Output hint whenever a `previewIssue` is present. Update the `=== 'too-complex'` check at `preview-overlays.tsx:18` and `draw-preview.ts:150-152 emptyPreviewToolpath` to the tagged shape.
- **Files:** `src/ui/workspace/preview-status.ts` (modify), `src/ui/workspace/use-preview-toolpath.ts` (modify), `src/ui/workspace/preview-overlays.tsx` (modify), `src/ui/workspace/draw-preview.ts` (modify — `emptyPreviewToolpath`/`PreviewIssue` usage)
- **Tests:** `src/ui/workspace/preview-overlays.test.tsx` — add a failing case: a toolpath tagged `placement-unavailable` renders the "Preview unavailable: …" banner and does NOT render the enable-Output hint. Also `src/ui/workspace/use-preview-toolpath.test.tsx` — placement failure returns a toolpath carrying the placement message, not a bare empty toolpath.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** `PreviewIssue` shape change ripples to every `previewIssueFor` caller (currently `preview-overlays.tsx`); grep confirms it is small. No G-code/snapshot impact. Stats panel still shows a Time estimate next to 0.0 mm on placement failure — out of scope here, addressed structurally by PRV-06.

### PRV-02 · Render preview cuts in layer color and add an optional shade-by-power mode
- **Fixes:** Preview cuts ignore layer color and have no shade-by-power — severity major (verified: CONFIRMED)
- **Root cause:** `drawCut` (`draw-preview.ts:258-264`) names its color parameter `_color` and unconditionally strokes every cut with `canvasTheme.previewCut` (`#2563eb`, `canvas-theme.ts:48`). `ToolpathStep` cut variant (`toolpath-types.ts:21-30`) carries `color` but no power. This diverges from WORKFLOW F-A8 (`WORKFLOW.md:293` "Cut paths rendered in their Layer color at full opacity") and from ADR-028's LightBurn baseline (`DECISIONS.md:1121` "shades according to power"), which is honored for rasters only.
- **Approach:** Two sequential PRs (smallest-diff):
  - **PR1 (parity, no new state):** rename `_color`→`color` in `drawCut` and set `ctx.strokeStyle = color`. Travel stays `previewTravel` gray. This delivers the F-A8 spec directly (step color is already the layer color, threaded via `drawStep` `draw-preview.ts:165`).
  - **PR2 (shade-by-power, opt-in):** add `readonly power?: number` to the cut variant in `toolpath-types.ts`; thread `group.power` into the cut steps pushed by `appendContourGroupSteps`/`appendFillSweepSteps` (`toolpath.ts:114,169`) and `appendRasterSpanSweepSteps` (`toolpath-raster-steps.ts:136`). Add a `previewShadeByPower` boolean to `ui-store` with a checkbox in `PreviewStatsPanel` (`preview-overlays.tsx`), and in `drawCut` scale stroke darkness/alpha by `power` when the toggle is on. Record the residual divergence (F-A8 says full-opacity layer color; LightBurn says dark/shaded) via ADR so the chosen default is deliberate.
- **Files:** PR1: `src/ui/workspace/draw-preview.ts` (modify). PR2: `src/core/job/toolpath-types.ts` (modify), `src/core/job/toolpath.ts` (modify), `src/core/job/toolpath-raster-steps.ts` (modify), `src/ui/state/ui-store.ts` (modify), `src/ui/workspace/preview-overlays.tsx` (modify), `src/ui/workspace/draw-preview.ts` (modify)
- **Tests:** `src/ui/workspace/draw-preview.test.ts` — PR1: assert `drawCut` strokes with the passed step color (spy on `strokeStyle`), not the fixed theme blue. PR2: assert power on cut steps in `src/core/job/toolpath.test.ts`, and shade-by-power alpha scaling in `draw-preview.test.ts`.
- **ADR:** NEEDED — vector-preview color/shade-by-power: which of F-A8 (layer color) vs LightBurn (shade-by-power) is the default, and readability caveat for light layer colors on the light bed
- **Effort:** M (PR1 is S) · **Depends on:** none
- **Risk:** Light layer colors (white/yellow) become near-invisible on the light bed viewport — the ADR must state the default. Adding `power` to cut steps is additive (optional field), no `.lf2`/G-code change; toolpath parity test `draw-preview.parity.test.ts` may need a look.

### PRV-03 · Drive preview playback in job time, not compressed distance
- **Fixes:** Playback is distance-compressed, not time-based simulation — severity minor
- **Root cause:** `use-preview-playback.ts:6-10,35,51` advances `scrubberT` by `deltaMs/durationMs` over a fixed wall clock (slow/normal/fast = 60/30/10 s) at a constant arc-length rate, so a 100 mm/min engrave and a 6000 mm/min travel animate identically; the UI self-describes as "compressed route preview" (`preview-overlays.tsx:213`). The planner already computes per-block times (`planner.ts:62-81`) but exposes only a total.
- **Approach:** Add a pure core helper (new file) `planStepDurations(toolpath, device)` that prices each `ToolpathStep` — cuts via the planner's trapezoid math, travels at rapid feed — into a cumulative seconds array aligned 1:1 with `toolpath.steps`. In `use-preview-playback.ts`, integrate real elapsed time against total planned seconds and map elapsed→`scrubberT` by locating the arc-length at that cumulative time (so the head visibly slows on slow layers, matching LightBurn). Keep the existing distance-rate loop as an explicit fallback when the job exceeds the complexity budget (no per-step timing). Relabel the "compressed route preview" copy.
- **Files:** `src/core/job/plan-step-durations.ts` (new), `src/core/job/index.ts` (modify — export), `src/ui/workspace/use-preview-playback.ts` (modify), `src/ui/workspace/preview-overlays.tsx` (modify — speed control copy)
- **Tests:** `src/core/job/plan-step-durations.test.ts` (new) — a slow cut step and a fast travel of equal length get proportional durations; sum equals `estimateJobDuration` within tolerance. `src/ui/workspace/use-preview-playback.test.tsx` — time-based advance spends more wall time on the slow segment.
- **ADR:** NEEDED — time-based playback as the default with a distance-rate fallback for oversized jobs
- **Effort:** M (leans L — aligning the per-step time model with `sliceToolpath`'s arc-length domain is the real work) · **Depends on:** none (independent of PRV-06, but both touch estimate fidelity)
- **Risk:** Core-purity must hold in the new file (no clock/DOM — time is integrated in the UI hook). The play-speed selector changes meaning (multiplier vs fixed duration) — reflect in help text.

### PRV-04 · Correct PROJECT.md Phase C wording: optimizer is nearest-neighbor, not 2-opt
- **Fixes:** PROJECT.md promises 2-opt; shipped optimizer is nearest-neighbor with a silent 2,000-segment cutoff — severity minor
- **Root cause:** `PROJECT.md:75` lists "path optimization (2-opt)"; `optimize-paths.ts:1-24` is an explicitly-documented nearest-neighbor with inside-first containment buckets ("NOT full 2-opt"), and above `MAX_NEAREST_NEIGHBOR_SEGMENTS=2000` (`optimize-paths.ts:48,94`) it silently returns source order with no UI signal.
- **Approach:** Docs-only. Edit `PROJECT.md:75` to describe what shipped: replace "path optimization (2-opt)" with e.g. "path optimization (nearest-neighbor, inner-shapes-first)". Do NOT claim 2-opt. Preserve the sentence's other Phase C items. (Landing real 2-opt over the NN seed, surfacing the >2000-segment skip in the preview/stats, and exposing inner-first as a visible option are separately-scoped follow-ups — note them but keep this ticket docs-only.)
- **Files:** `PROJECT.md` (modify, §Phase C line 75)
- **Tests:** docs-only, no test
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** CRLF/EOL trap — `.md` is prettier-ignored; make the edit preserve existing line endings (verify `git diff --stat` shows only the one line changed, not a whole-file EOL flip).

### PRV-05 · Honor unidirectional image scanning in the raster ETA, then de-duplicate the sweep model
- **Fixes:** Raster ETA duplicates the sweep model and ignores unidirectional scanning — severity minor
- **Root cause:** `estimate-duration.ts:143-168 rasterActiveSweepSegments` alternates sweep direction unconditionally (`sweepIndex % SWEEP_DIRECTION_PERIOD === 1`, line 148), while the toolpath/emitter gate on `group.bidirectional ?? true` (`toolpath-raster-steps.ts:36`). A unidirectional image layer is therefore priced as bidirectional, omitting the per-row return rapids → ETA too low. Separately, `RASTER_GAP_RAPID_THRESHOLD_MM=5` and a `rasterActiveSpans` routine exist in both files (`estimate-duration.ts:48,173` and `toolpath-raster-steps.ts:13,72`) — the copy-paste drift CLAUDE.md names as an anti-pattern.
- **Approach:** Two PRs.
  - **PR1 (fix):** gate the reverse-sweep alternation in `rasterActiveSweepSegments` on `(group.bidirectional ?? true)` so unidirectional rows all scan the same direction; when unidirectional, the modeled geometry then makes the planner price a full-width return travel per row at rapid feed.
  - **PR2 (tidy):** extract one shared span-extraction helper (`RASTER_GAP_RAPID_THRESHOLD_MM` + `rasterActiveSpans`) into a core module consumed by both `estimate-duration.ts` and `toolpath-raster-steps.ts`; behavior-preserving.
- **Files:** PR1: `src/core/job/estimate-duration.ts` (modify). PR2: `src/core/job/raster-spans.ts` (new), `src/core/job/estimate-duration.ts` (modify), `src/core/job/toolpath-raster-steps.ts` (modify)
- **Tests:** `src/core/job/estimate-duration.test.ts` — failing case first: a `RasterGroup` with `bidirectional:false` estimates strictly longer than the same group with `bidirectional:true` (return-rapid pricing). PR2 keeps `toolpath-raster.test.ts` green unchanged.
- **ADR:** none
- **Effort:** M (fix is S) · **Depends on:** none
- **Risk:** PR1 changes ETA numbers for unidirectional raster layers only (no G-code/snapshot churn). PR2 is pure-core; keep the two loop shapes' span semantics identical when merging (the estimator's row is one continuous sweep; the toolpath's is per-span with leads — the shared helper must only own span extraction, not sweep construction).

### PRV-06 · Make the live estimate placement-aware and the preview park move dialect-aware
- **Fixes:** Estimate ignores job placement; preview always draws origin start + park travel regardless of dialect — severity minor
- **Root cause:** `estimateLiveJob` calls `prepareOutput(project, { outputScope })` with no `jobOrigin` (`live-job-estimate.ts:46`), so the Time row prices travel on the UNPLACED job while the Cut/Travel rows use the PLACED preview job — the two rows of one stats panel describe different runs. Separately, `buildPreviewToolpath` hardcodes `startPoint`/`parkPoint` `{0,0}` (`draw-preview.ts:141-143`) and the planner always appends a final travel back to `ORIGIN` (`planner.ts:104`), so both draw/price a park-back leg even on dialects where `grbl-strategy` skips it (`parkAtOriginAfterJob === false`, `grbl-strategy.ts:91`).
- **Approach:** (a) Thread the resolved `jobOrigin` into the estimate: `estimateLiveJob` takes an optional `jobOrigin` and forwards it to `prepareOutput`; `useJobEstimate` (`use-job-estimate.ts`) resolves placement (same `resolveJobPlacement` + laser-store snapshot `use-preview-toolpath.ts:29-31` already uses) and passes it. (b) Gate the park leg on the dialect: in `buildPreviewToolpath` omit `parkPoint` unless `resolveGrblDialect(project.device).parkAtOriginAfterJob`; in `planner.ts buildBlocks` gate the final `appendTravel(out, cursor, ORIGIN, travelV)` on the same flag (planner already imports `resolveGrblDialect`).
- **Files:** `src/ui/laser/live-job-estimate.ts` (modify), `src/ui/laser/use-job-estimate.ts` (modify), `src/ui/workspace/draw-preview.ts` (modify), `src/core/job/planner.ts` (modify)
- **Tests:** `src/core/job/planner.test.ts` — a no-park dialect yields no final origin-return travel block (shorter estimate). `src/core/job/estimate-duration.test.ts` or a `live-job-estimate` test — a placed job's estimate matches the placed toolpath's travel. Write the failing assertion first.
- **ADR:** none (bug fix toward "same simulated run"; no new default)
- **Effort:** M (each half is S; may split into two PRs — estimate-placement, then dialect-park) · **Depends on:** none
- **Risk:** Gating the planner park leg changes ETA numbers (planner/estimate tests assert times) — not G-code, so no snapshot acknowledgment needed. Threading `jobOrigin` into the debounced estimate must not reintroduce per-mousemove recompiles (keep the `use-job-estimate.ts` debounce).

### PRV-07 · Put per-layer overflow amounts into the out-of-bounds preview banner (F-A8)
- **Fixes:** Out-of-bounds preview state lacks the per-layer distances F-A8 specifies — severity minor
- **Root cause:** `preview-overlays.tsx:35-40` shows a generic danger banner ("Some objects extend past the bed…") and `hasOutOfBoundsObjects` (`out-of-bounds.ts:12-15`) is a boolean predicate; there are no layer names or millimeter amounts. WORKFLOW F-A8 (`WORKFLOW.md:313-315`) specifies "Out-of-bounds path segments rendered in red" plus a summary like "Preview: 1 layer extends 12 mm beyond bed".
- **Approach:** Add a pure summarizer beside `out-of-bounds.ts` that returns, per offending layer, the max mm overflow past each bed edge (reuse `transformedBBox` already imported there; overflow = `max(0, -minX, -minY, maxX-bedW, maxY-bedH)` aggregated per layer color/name). Feed the count + worst extent into the banner text in `preview-overlays.tsx` to match the F-A8 wording ("Preview: N layer(s) extend up to M mm beyond bed"). Keep the existing red dashed outlines.
- **Files:** `src/ui/workspace/out-of-bounds.ts` (modify — add `summarizeOutOfBounds`), `src/ui/workspace/preview-overlays.tsx` (modify — banner text)
- **Tests:** `src/ui/workspace/out-of-bounds` test (new co-located `out-of-bounds.test.ts` if absent) — an object 12 mm past the right edge on layer X reports `{ layerCount:1, maxOverflowMm:12 }`. `preview-overlays.test.tsx` — banner interpolates the count and amount.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** Segment-level red (F-A8's "path segments") vs the current object-level outlines is a larger change (`draw-scene.ts:41` / `draw-out-of-bounds-outlines`) — scope this ticket to the banner text; note the segment-level rendering as a separate follow-up so the diff stays reviewable.

### PRV-08 · Add elapsed + estimated-remaining labels to the running-job progress row
- **Fixes:** No estimated-time-remaining or elapsed time during a running job — severity minor
- **Root cause:** `describeProgressDisplay` (`JobControls.tsx:190-207`) renders only "completed / total lines". WORKFLOW F-B11 (`WORKFLOW.md:663`) promises "Phase C will add an estimated-time-remaining label" and PROJECT.md marks MVP complete at Phase C, but the label never landed. The planner estimate exists pre-run (`estimate-duration.ts:50-62`).
- **Approach:** Capture the job's planned `totalSeconds` at Start (store it on the laser-store job/streamer state when the run begins, from the same `estimateJobDuration` the badge uses). Add a pure UI helper (new file) `jobProgressEta(totalSeconds, completed, total, elapsedMs)` → `{ elapsedLabel, remainingLabel }` using `formatDuration`, deriving remaining from planned duration weighted by acknowledged-line fraction. Render both in the progress row (`ProgressBar`/`describeProgressDisplay`). Update WORKFLOW F-B11 (`WORKFLOW.md:663`) to state the label shipped (docs, CRLF-safe).
- **Files:** `src/ui/laser/job-progress-eta.ts` (new), `src/ui/laser/JobControls.tsx` (modify — render labels), laser-store job-start action (modify — persist planned seconds; e.g. `src/ui/state/laser-job-actions.ts`), `WORKFLOW.md` (modify §F-B11)
- **Tests:** `src/ui/laser/job-progress-eta.test.ts` (new) — 50% lines of a 120 s job → remaining "1m 0s"; guards divide-by-zero and completed>total.
- **ADR:** none (fulfills an already-planned feature)
- **Effort:** M · **Depends on:** none (line-fraction weighting is crude but matches the finding; a block-time weighting could later reuse PRV-03's `planStepDurations`)
- **Risk:** Elapsed uses wall clock — must live in UI/store, never core. Line-fraction remaining is uneven across slow/fast layers; label it an estimate. Verify perceptually, not just via the pure test (per CLAUDE.md #2).

### PRV-09 · Persist Start From / Job Origin across sessions
- **Fixes:** Start From / Job Origin settings are session-only, reset to Absolute on every launch — severity minor
- **Root cause:** `jobPlacement` initializes to `DEFAULT_JOB_PLACEMENT` (absolute/front-left) in the store (`store.ts:365`) and is never serialized to `.lf2` nor persisted app-level (grep of `src/io/project` for `jobPlacement`/`startFrom`: none). The CNC library, camera prefs, and device-setup flags all persist via localStorage (`device-setup-configured-persistence.ts`, `use-cnc-library-persistence.ts`).
- **Approach:** Mirror the existing pattern. New `src/ui/state/job-placement-persistence.ts` (storage-injected `load`/`persist`, fail-soft) modeled on `device-setup-configured-persistence.ts`, persisting `jobPlacement` (and `outputScopeSettings`). New hook `src/ui/app/use-job-placement-persistence.ts` modeled on `use-cnc-library-persistence.ts` — restore on mount without clobbering a session that already changed it, auto-persist on change — mounted once in `App`. Leave the absolute-mode safety gate (`job-placement.ts:69-77`) untouched: a persisted custom-origin mode still refuses to start until the origin is set.
- **Files:** `src/ui/state/job-placement-persistence.ts` (new), `src/ui/app/use-job-placement-persistence.ts` (new), `src/ui/app/App.tsx` (modify — mount hook)
- **Tests:** `src/ui/state/job-placement-persistence.test.ts` (new) — round-trips a `user-origin` placement; malformed/absent storage falls back to `DEFAULT_JOB_PLACEMENT`; quota error fails soft.
- **ADR:** NEEDED — persist job placement across sessions (LightBurn parity), recording that the Absolute-mode safety gate still applies on restore
- **Effort:** S · **Depends on:** none
- **Risk:** A restored `current-position`/`user-origin` mode with no live machine will (correctly) fail placement at preview/start — which PRV-01 now explains in the overlay. No `.lf2` schema change.

### PRV-10 · Split core/job's public index (~41 value exports) along existing seams (tidy)
- **Fixes:** core/job public API is ~40 value exports — double the CLAUDE.md hard cap of 20 — severity minor
- **Root cause:** `src/core/job/index.ts:1-88` re-exports ~41 value bindings spanning compile, job placement/origin, duration estimation, toolpath/scrubber, calibration-pattern generators (material/interval/scan-offset/camera-align), and fill heat-risk — six responsibilities behind one index that every sector imports through. CLAUDE.md caps public exports at 10 soft / 20 hard.
- **Approach:** Mechanical, behavior-preserving re-export moves, one seam per PR (tidy-first, no feature in the same diff): (1) `core/calibration` — material/interval/scan-offset/camera-align generators (most isolated); (2) `core/estimate` — planner + `estimate-duration` + `formatDuration`; (3) `core/toolpath` — steps/slice/summary; (4) `core/placement` — job-origin/frame/registration; leaving `core/job` = compile + job model. Each PR moves files (or just re-export surfaces) and updates importers, keeping the `boundaries` rule (core←core only) satisfied.
- **Files:** `src/core/calibration/index.ts` (new) + moves, `src/core/estimate/index.ts` (new) + moves, `src/core/toolpath/index.ts` (new) + moves, `src/core/placement/index.ts` (new) + moves, `src/core/job/index.ts` (modify — shrink); plus every importer of the moved symbols (modify)
- **Tests:** pure refactor — existing co-located tests move with their sources; no new behavior test. Flag each PR as a pure refactor in its description (CLAUDE.md test-gate exemption).
- **ADR:** NEEDED — core/job module split and the new module boundaries
- **Effort:** L · **Depends on:** none — but do it **before** the next compile-touching feature, not alongside one
- **Risk:** Wide import churn across all sectors; high merge-conflict surface with in-flight branches. No behavior/G-code change. Low urgency relative to the correctness tickets — sequence last unless a feature forces it.

### PRV-11 · Record (or DI-relocate) the ui/workspace raster-preview bitmap caches per ADR-050's rule
- **Fixes:** Module-level mutable caches in ui/workspace lack the ADR that CLAUDE.md's rule requires — severity minor
- **Root cause:** `draw-raster-preview.ts:40-41` holds module-level mutable `Map`s (`previewCanvasCache`, `pendingPreviewBuilds`); `draw-scene.ts:35,93` prunes a sibling `pruneRasterImageCaches` implying the same pattern in `draw-raster.ts`. CLAUDE.md bans module-level mutables outside Zustand, and ADR-050 (`DECISIONS.md:2679-2683`) scopes its exception explicitly to `src/core/job` WeakMap memoization: "Any other module-level mutable still violates the rule and needs its own ADR."
- **Approach:** Lowest-risk path (recommended): write a short ADR recording the UI bitmap-cache exception — its pruning contract (string-keyed, pruned each frame against live data URLs, bounded in practice) and why it is not a WeakMap — and add the ADR-050-style "carries a comment pointing here" note atop `previewCanvasCache`/`pendingPreviewBuilds` and the `draw-raster.ts` cache. Alternative (larger, note only): move the caches behind a DI'd cache object owned by `Workspace`, mirroring `displayPolylineCacheRef` (`Workspace.tsx:240-244`). Let the maintainer choose.
- **Files:** `DECISIONS.md` (new ADR), `src/ui/workspace/draw-raster-preview.ts` (modify — pointer comment), `src/ui/workspace/draw-raster.ts` (modify — pointer comment)
- **Tests:** docs/comment-only, no test (ADR path). If the DI-relocation alternative is chosen instead, it needs a cache-lifecycle test.
- **ADR:** NEEDED — UI raster-preview bitmap-cache exception to ADR-050 (pruning contract)
- **Effort:** S · **Depends on:** none
- **Risk:** None for the ADR path (docs + comments). The alternative refactor touches the hot draw path and needs its own verification.

### PRV-12 · Clamp planner junction/exit velocity to both blocks' target speeds
- **Fixes:** [Codex M-30] Planner ETA can assign a block exit velocity above that block's target velocity — severity minor (verified: CONFIRMED)
- **Root cause:** `capJunctionEntries` (`planner.ts:234-235`) caps a junction entry only to the ENTERED block's target (`Math.min(next.targetVelocity, vJunction)`), missing GRBL's min-of-both-nominals rule. `backwardPass` then sets `plan[i].exitV = plan[i+1].entryV` (`planner.ts:246-247`) and `forwardPass` clamps `entryV` to the block's own target but `exitV` only to the physics bound `sqrt(entryV²+2ad)` (`planner.ts:260-262`) — never to the block's own target. So a slow cut followed by a collinear fast cut gets the slow block an `exitV` far above its target; `blockTime` (`planner.ts:300-307`) then computes a negative `tDecel` (clamped via `dDecel=max(0,…)`) and under-prices the block.
- **Approach:** Cap the shared junction to both adjacent nominals — in `capJunctionEntries` set `p.entryV = Math.min(prev.targetVelocity, next.targetVelocity, vJunction)`. This propagates through `backwardPass` so the slow block's `exitV ≤ 5`. Add a belt-and-suspenders clamp in `forwardPass`: `p.exitV = Math.min(p.exitV, maxExit, block.targetVelocity)`. Both are one-line changes; the junction cap is the root-cause fix.
- **Files:** `src/core/job/planner.ts` (modify — `capJunctionEntries`, `forwardPass`)
- **Tests:** `src/core/job/planner.test.ts` — failing case first from the verifier's worked trace: accel 1000, a 10 mm cut at 5 mm/s followed by a collinear 10 mm cut at 100 mm/s. Assert the slow block's `exitV ≤ 5` and its `blockTime ≈ 2.005 s` (not the mispriced 1.9075 s), and total estimate rises accordingly.
- **ADR:** none
- **Effort:** M · **Depends on:** none
- **Risk:** Changes ETA numbers (never G-code — no snapshot acknowledgment). Other `planner.test.ts`/`estimate-duration.test.ts` numeric expectations that encoded the too-fast exit will need updating; verify each shift is toward the physically-correct (longer) time.

#### Polish (deferred, one-liners)
| finding | one-line fix | effort |
|---|---|---|
| In-canvas preview mode vs LightBurn's separate Preview window undocumented (ADR-027 requires recording divergences; `Workspace.tsx:107-118`, `shortcuts.ts:394-398`) | Write a one-paragraph ADR recording in-canvas preview as a deliberate divergence and why; optionally alias `Alt+P` to the Preview toggle for muscle memory | S |
| Stale comments / dangling doc refs around the preview pipeline (`preview-status.ts:1-5` claims raster has "no toolpath steps" though `appendRasterGroupSteps` shipped; ADR-028 §6 `DECISIONS.md:1137` still says the raster scrubber is "deferred to a separate PR"; `DECISIONS.md:1121` + `preview-data.ts:5` cite deleted `LIGHTBURN-STUDY.md §1.4`) | Refresh the two stale comments and add a one-line note where LIGHTBURN-STUDY.md is cited that the study was removed at open-sourcing (commit 42e7556d) so the ADR evidence chain stays verifiable | S |

---

## Canvas editing, drawing tools & content creation — implementation tickets

Scope note: the audit graded this sector B+ — the machinery is mature and mostly LightBurn-faithful. Every ticket below is an edge fix (feedback, parity binding, discoverability, doc drift, or an architecture-contract cleanup). None touch G-code emission, so **no snapshot churn is expected anywhere in this epic** unless a ticket says otherwise. Two findings bundle independent concerns and are split into separate one-concern PRs (finding "ungroup/duplicate" → CNV-02/-03; finding "undo rough edges" → CNV-12/-13/-14), per the repo's "never batch unrelated fixes" rule.

---

### CNV-01 · Add a Text tool to the left ToolStrip and record the modal-text divergence
- **Fixes:** Text tool is a modal dialog with 4 bundled fonts — far from LightBurn's on-canvas text — severity major (verified: CONFIRMED)
- **Root cause:** Text is created only from the top `Toolbar` (`tools.add-text`, `src/ui/commands/command-families.ts:75`) and the Tools menu; the left tool palette `TOOLS` array has no text entry (`src/ui/workspace/ToolStrip.tsx:17-27`) and `TOOL_BINDINGS` is r/e/l only (`src/ui/app/shortcuts.ts:306-310`). A LightBurn user reaches for a Text tool in the left rail and a Ctrl+T-style binding and finds neither. The dialog-vs-on-canvas editing model and the missing palette placement are unrecorded divergences (ADR-012 records bundled-fonts-only; ADR-103 records arc/system-font as roadmap; neither covers placement/model).
- **Approach:** Short-term, muscle-memory fix only (keep the existing dialog): add a Text affordance to `ToolStrip` next to the `Lib` button that calls `useUiStore.getState().openTextDialog({ mode: 'add' })` — mirror the existing non-mode `libraryButtonStyle` button pattern (`ToolStrip.tsx:50-58`) or add an `IconButton` with a `text`/`type` icon and a `TOOL_HELP` topic. Do **not** add it to the `TOOLS` mode array (text is not a drag-draw mode). Record an ADR stating (a) text is authored via a modal, not on-canvas typing, and (b) it now lives in the left rail as well as Toolbar/Tools menu. Leave true on-canvas click-to-place text as a separate, explicitly-deferred L ticket (needs a new `ToolMode` variant + contextual options bar; see recommendation).
- **Files:** `src/ui/workspace/ToolStrip.tsx` (modify); `src/ui/help/help-topics.ts` (modify — add a `text` `ToolHelpKey` + `TOOL_HELP` entry if using an IconButton); `DECISIONS.md` (modify — new ADR)
- **Tests:** `src/ui/workspace/ToolStrip.test.tsx` — add a case asserting a Text control renders and clicking it opens the text dialog (spy on `openTextDialog`).
- **ADR:** NEEDED — text is modal-authored (not on-canvas) and placed in the left tool rail; on-canvas editing + system-font import remain future work.
- **Effort:** S (was L — the L is the deferred on-canvas rewrite; the reviewable parity win here is S)  ·  **Depends on:** none
- **Risk:** Low. Adding a `ToolHelpKey` requires updating the `ToolHelpKey` union + `TOOL_HELP` record together (exhaustive) or the button won't type-check. Don't grow `command-families.ts` (already ~389 lines, finding CNV-polish-2).

---

### CNV-02 · Rebind Ungroup to Ctrl+U (keep Ctrl+Shift+G as an alias)
- **Fixes:** Ungroup binding Ctrl+Shift+G diverges from LightBurn's Ctrl+U (split from the "ungroup/duplicate" finding) — severity major (verified: CONFIRMED)
- **Root cause:** `EDIT_BINDINGS` binds Ungroup to `Ctrl+Shift+G` only (`src/ui/app/shortcuts.ts:215-217`); the menu advertises the same (`src/ui/commands/edit-command-family.ts:145,153`). No `Ctrl+U` binding exists anywhere in `src/ui`, so nothing justified avoiding LightBurn's binding. Group is correctly `Ctrl+G` (`shortcuts.ts:211-213`, `edit-command-family.ts:126`).
- **Approach:** In `EDIT_BINDINGS`, add a binding matching `hasMeta(e) && key==='u' && !shiftKey` → `c.ungroupSelection()`, and keep the existing `Ctrl+Shift+G` binding as an alias. `handleEditShortcut` already `preventDefault`s before invoke (`shortcuts.ts:287`), so the browser's Ctrl+U "view source" default is suppressed. Update the `edit.ungroup` command shortcut label to `Ctrl+U` (the primary) in `edit-command-family.ts:145,153`. This removes the unrecorded divergence, so no ADR.
- **Files:** `src/ui/app/shortcuts.ts` (modify); `src/ui/commands/edit-command-family.ts` (modify)
- **Tests:** `src/ui/app/shortcuts.test.ts` — add a case: a synthetic `Ctrl+U` keydown routes to `ungroupSelection`, and `Ctrl+Shift+G` still does too.
- **ADR:** none (matching LightBurn removes a divergence)
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Low. Confirm no other handler consumes bare `Ctrl+U`. The Arrange-menu placement of Group/Ungroup is a separate concern — deferred to the polish table, not batched here.

---

### CNV-03 · Duplicate in place (Ctrl+D), drop the 10 mm stagger
- **Fixes:** Ctrl+D duplicates with a 10 mm offset instead of in place (split from the "ungroup/duplicate" finding) — severity major (verified: CONFIRMED)
- **Root cause:** `applyDuplicate` reuses `MULTI_IMPORT_OFFSET_MM` (=10) and shifts every clone `+10 mm` in x and y (`src/ui/state/scene-mutations.ts:29,210,216-224`). LightBurn's Duplicate places the clone exactly over the source; the operator then moves it. The offset is asserted as intended by `src/ui/state/duplicate.test.ts:21-22`, but it is an unrecorded divergence.
- **Approach:** Make `applyDuplicate` clone at the source transform with **no** offset (remove the `+ offset` on x/y; keep the fresh id and the "new clones become the selection" behavior). Leave `MULTI_IMPORT_OFFSET_MM` untouched for the fresh-import stagger (`applyFreshImport`) and leave paste's `PASTE_OFFSET_MM` alone (LightBurn also offsets paste). Test-first: flip `duplicate.test.ts` case 1 to assert `clone.transform.x/y === before.transform.x/y`, watch it fail, then fix.
- **Files:** `src/ui/state/scene-mutations.ts` (modify — `applyDuplicate` only); `src/ui/state/duplicate.test.ts` (modify)
- **Tests:** `src/ui/state/duplicate.test.ts` — rewrite the "10 mm offset" assertion (lines 21-22) to expect in-place coordinates; the multi-select and no-op cases already pass unchanged.
- **ADR:** none if matching LightBurn (in place). NEEDED **only** if the maintainer chooses to keep a deliberate small offset as a KerfDesk divergence.
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Low. In-place clones sit exactly atop originals (invisible until moved) — this is the LightBurn behavior, but call it out in the PR so the reviewer isn't surprised the canvas "looks unchanged." No G-code impact.

---

### CNV-04 · Surface boolean / weld / offset failure messages as toasts
- **Fixes:** Boolean / weld / offset failures are silently swallowed — dead-end with zero feedback — severity major → **corrected to minor** (verified: PARTIAL)
- **Root cause:** `weldSelectionMutation`, `booleanSelectionMutation`, and `offsetSelectionMutation` wrap the core call in `try { … } catch { return state; }` (`src/ui/state/vector-path-actions.ts:131-135, 163-167, 195-199`) — the thrown `Error` carries a user-worded message (`src/core/geometry/vector-path-booleans.ts:47,59,79,91`; weld throws similarly) but the empty binding discards it. Menu gating (`selectionCanCombine`, `src/ui/commands/selection-command-state.ts:91-97`) cannot pre-detect an empty Intersect of disjoint shapes or a collapsing inward Offset, so those reachable cases click and nothing happens.
- **Approach:** In each of the three catches, bind the error and push one warning toast, then keep the state-unchanged return: `catch (error) { useToastStore.getState().pushToast(error instanceof Error ? error.message : 'Operation failed.', 'warning'); return state; }`. Import `useToastStore` exactly as `scene-clipboard-actions.ts:12` already does inside a `set` updater (`scene-clipboard-actions.ts:89-94`). Leave `dogboneSelectionMutation`'s per-object `catch { continue; }` (`vector-path-actions.ts:76-80`) untouched — that is an intended "no qualifying corners" skip, not a user-facing failure.
- **Files:** `src/ui/state/vector-path-actions.ts` (modify)
- **Tests:** `src/ui/state/vector-path-actions.test.ts` — add cases: intersect of two disjoint closed shapes pushes a `warning` toast and leaves the scene unchanged; an inward offset larger than the shape pushes a toast. Assert against `useToastStore.getState().toasts`.
- **ADR:** none
- **Effort:** S (smaller than the finding's S once read — three one-line catches)  ·  **Depends on:** none, but see CNV-10 — if the core Result refactor lands first, reimplement this as the `err`/`{reason}` arm of a `match` instead of a `catch`. Whichever lands second rebases the same lines.
- **Risk:** Low. Same-file, no boundary/size concern. This is the immediate UX fix; CNV-10 is the deeper architectural one.

---

### CNV-05 · Add a Shape Properties editor for drawn primitives (corner radius / sides / points)
- **Fixes:** No shape-property editing after drawing: corner radius, polygon sides, star points are frozen — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** `shapeFromDrag` hardcodes `cornerRadiusMm: 0`, `DEFAULT_POLYGON_SIDES = 6`, `DEFAULT_STAR_POINTS = 5`/ratio `0.5` (`src/core/shapes/shape-from-drag.ts:20-22,43`) and no UI edits a shape's spec afterwards — `object-properties-actions.ts` only covers `powerScale` and operation overrides (`src/ui/state/object-properties-actions.ts:28-36`). The parametric spec already exists on the object (`ShapeObject.spec: ShapeSpec`, `src/core/scene/scene-object.ts:269-274`), so this is purely a missing editor. ADR-051 records it deferred (P2) — a known parity gap, not an unrecorded divergence.
- **Approach:** (1) New pure-core dispatcher `shapeFromSpec(spec, { id, color, transform })` (new file `src/core/shapes/shape-from-spec.ts`) that switches on `spec.kind` and calls the existing `createRectangle/createEllipse/createPolygon/createStar` (`create-rectangle.ts:16` etc.), re-materializing `paths`+`bounds` while preserving id/color/transform — mirroring how `editPolylineShape` rebuilds spec+paths+bounds (`path-node-edit-actions.ts:246-262`). (2) New store action `setSelectedShapeSpec(patch)` (new file `src/ui/state/shape-spec-actions.ts`) that, for a selected `kind:'shape'` object, merges the patch into `spec`, re-runs `shapeFromSpec`, `ensureLayersForColors`, and pushes one undo. (3) New `ShapeProperties` panel component (new file under `src/ui/layers/`) shown when a single `kind:'shape'` object is selected, editing `cornerRadiusMm` (rect), `sides` (polygon), `points`/`innerRadiusRatio` (star). Keep each file < 250 counted lines (new files, not growth).
- **Files:** `src/core/shapes/shape-from-spec.ts` (new); `src/ui/state/shape-spec-actions.ts` (new); `src/ui/layers/ShapeProperties.tsx` (new); wire the action into the store + mount the panel (modify the store index + the right-panel container).
- **Tests:** `src/core/shapes/shape-from-spec.test.ts` (new) — round-trips each spec kind and preserves transform; `src/ui/state/shape-spec-actions.test.ts` (new) — editing a rect's corner radius re-materializes paths and pushes exactly one undo.
- **ADR:** none (implements the ADR-051 P2 item; if the panel's placement/scope needs recording, a short ADR note, otherwise none)
- **Effort:** M  ·  **Depends on:** none
- **Risk:** Re-materializing on edit is geometry the user initiated, so no fixture/snapshot churn. Watch the right-panel container's size cap when mounting the new section.

---

### CNV-06 · Node tool: tell the user to "Convert to Path" when they click an ineligible object
- **Fixes:** Node editor silently no-ops on primitives without a Convert-to-Path hint — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** `hitPathNode` only recognizes `imported-svg`, `traced-image`, and polyline-spec shapes as node-editable (`src/ui/workspace/path-node-hit-test.ts:76-80`); on a miss `beginPathNodeDrag` just calls `selectPathNode(null)` and returns (`src/ui/workspace/path-node-drag.ts:21-24`). Clicking a rect/ellipse/polygon/star/text with the node tool does nothing and gives no hint that `convertSelectionToPath` (which exists) would unlock it. The node tooltip is generic (`src/ui/help/help-topics.ts:81-84`).
- **Approach:** Two cheap wins, one PR: (a) in `beginPathNodeDrag`, when `hitPathNode` is null, run an object-level hit test; if the point lands on a present-but-ineligible object (a `shape` whose `spec.kind !== 'polyline'`, or a `text` object), push a one-shot `info` toast "Convert to Path to edit its nodes." Reuse the existing object hit-test helper the select tool uses (locate via `use-workspace-drag.ts`), passed in as a dep so `path-node-drag.ts` stays testable. (b) Extend the `node` `TOOL_HELP` tooltip (`help-topics.ts:81-84`) to note "Rectangles, text, and other primitives must be Converted to Path first." No new node-editing capability — scope stays as-is.
- **Files:** `src/ui/workspace/path-node-drag.ts` (modify — add optional object-hit + toast dep); `src/ui/workspace/workspace-drag-deps.ts` / `use-workspace-drag.ts` (modify — thread the dep + `pushToast`); `src/ui/help/help-topics.ts` (modify — tooltip)
- **Tests:** `src/ui/workspace/path-node-drag.test.ts` — clicking an ineligible object (rect shape) with no node hit pushes the hint toast and selects no node; clicking empty space does not toast.
- **ADR:** none
- **Effort:** S–M (the finding said M; the toast+tooltip is the small kernel — do not attempt insert-node here)
- **Risk:** Low. Keep the toast one-shot / non-spammy (only when an object is actually under the pointer). No boundary concern (all `ui/`).

---

### CNV-07 · WORKFLOW.md: refresh F-A5/F-A6 and add the missing Phase G/D canvas flows (docs)
- **Fixes:** WORKFLOW.md drift: stale marquee and flip-menu specs, no flows for drawing/text/node/group/align, code cites a missing LIGHTBURN-STUDY.md — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** (1) `WORKFLOW.md:156` says the marquee selects objects "fully or partially inside," but the shipped marquee is LightBurn-directional — L→R enclosing, R→L crossing (`src/ui/workspace/selection-marquee.ts:13-27`). (2) `WORKFLOW.md:200-201` places Flip under "Edit → Flip Horizontal (H)", but flips are registered in the **Arrange** family (`src/ui/commands/arrange-command-family.ts:51-89`). (3) Phase D is a 5-line stub (`WORKFLOW.md:840-846`) and there are no Phase G flows (draw/node/group/align/snap) at all; the doc admits the density gap (`WORKFLOW.md:5`). (4) Four comments cite `LIGHTBURN-STUDY.md` §§ that no longer exist — the file was deleted at open-sourcing (per the sweep audit's own S5-F7, commit `42e7556d`): `src/ui/app/shortcuts.ts:297`, `src/ui/workspace/selection-marquee.ts:9`, `src/core/raster/preview-data.ts:5`, `src/core/output/grbl-strategy.ts:13`.
- **Approach:** Docs-only. Rewrite F-A5's marquee step to describe the directional enclosing/crossing behavior; move Flip's reference in F-A6 to the Arrange menu. Add a Phase G flow section (draw rect/ellipse/polygon/star/pen, node edit, group/ungroup, align/distribute, snapping) each with success/error/empty/edge states, and flesh the Phase D text stub. For the four code citations: the LIGHTBURN-STUDY.md restoration is owned by another epic (sweep S5-F7 — restore or relocate the study); this ticket only rewrites the **two sector-owned** comments (`shortcuts.ts:297`, `selection-marquee.ts:9`) to drop the dead `§` reference (or add "(study removed at open-sourcing)"). Note the two core comments (`preview-data.ts`, `grbl-strategy.ts`) as a cross-epic dependency, do not touch them here.
- **Files:** `WORKFLOW.md` (modify — F-A5, F-A6, new Phase G section, Phase D fill-in); optionally `src/ui/app/shortcuts.ts` + `src/ui/workspace/selection-marquee.ts` (modify — comment-only)
- **Tests:** docs-only, no test (comment-only source edits are policy-exempt; flag the PR as docs/comment-only).
- **ADR:** none (WORKFLOW.md is the doc-as-spec contract, ADR-016)
- **Effort:** M (the docs writing dominates)  ·  **Depends on:** cross-epic — LIGHTBURN-STUDY.md restoration (sweep S5-F7) for the two core-comment citations
- **Risk:** EOL trap — `.md` is prettier-ignored; preserve existing CRLF/LF (edit via a CRLF-preserving path, check `git diff --stat`). If splitting the comment edits out to avoid mixing docs + source, that's an acceptable second PR.

---

### CNV-08 · Register a Design Library command and give the strip button a real icon + label
- **Fixes:** Design library reachable only via an unlabeled 'Lib' text button; absent from the command registry and menus — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** The library opens solely from a small text button (`Lib`) appended below the icon strip (`src/ui/workspace/ToolStrip.tsx:50-58`) that calls `setLibraryDialogOpen(true)`. There is no `tools.design-library` command id (`src/ui/commands/command-types.ts:44-72` has no library entry), so it appears in no menu, context bar, shortcut, or command-driven help. A user scanning Tools finds only CNC material/bit libraries.
- **Approach:** Register a `tools.design-library` command: add the id to the `CommandId` union (`command-types.ts`), add `openDesignLibrary`/`libraryDialogOpen` (already in `useUiStore`) to `AppCommandContext` and wire it, and register the command in `toolsCommands` in the first Tools group next to Box Generator (`command-families.ts:62-98`, `MENU_GROUPS.tools[0]` in `AppMenuBar.tsx:137-145`). Give the strip button a proper `IconButton` (icon + "Design Library" label) instead of the ad-hoc `libraryButtonStyle` text button. Add a `COMMAND_HELP` topic entry.
- **Files:** `src/ui/commands/command-types.ts` (modify — CommandId + context); `src/ui/commands/command-families.ts` (modify — register); `src/ui/commands/AppMenuBar.tsx` (modify — MENU_GROUPS); `src/ui/workspace/ToolStrip.tsx` (modify — IconButton); `src/ui/help/command-help-topics.ts` (modify — topic); the context builder that constructs `AppCommandContext` (modify — provide `openDesignLibrary`).
- **Tests:** `src/ui/commands/command-registry.test.ts` — assert the registry emits a `tools.design-library` command that invokes `setLibraryDialogOpen`. `src/ui/workspace/ToolStrip.test.tsx` — assert the labelled Design Library button opens the dialog.
- **ADR:** none (ADR-105 G11 already covers the feature; this is registry plumbing)
- **Effort:** S  ·  **Depends on:** none (independent of CNV-09 but touches the same `command-types.ts`/`command-families.ts` — sequence to avoid conflicts)
- **Risk:** `command-families.ts` is ~389 counted lines (CNV-polish-2). Adding one `enabled(...)` is fine but do not let it cross 400 — if it would, split the tools-family builder first.

---

### CNV-09 · Register an Offset command beside the booleans; render the panel row disabled-with-reason
- **Fixes:** Offset tool hidden in the right-hand panel row; missing from the Tools menu where the booleans live — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** Offset is only `OffsetPathsRow` — a distance field + Outward/Inward buttons that `return null` unless a closed-vector selection exists (`src/ui/layers/OffsetPathsRow.tsx:16,27`). It has no command id, so it is absent from the Tools group that holds convert-to-path/weld/subtract/intersect/exclude (`command-families.ts:99-101`, `MENU_GROUPS.tools[5]` at `AppMenuBar.tsx:156`) and from the context bar, and it vanishes when nothing qualifies (unlike every registry command, which renders disabled-with-reason).
- **Approach:** Add a `tools.offset` command (`command-types.ts` union + context), gated by a new `canOffsetSelection` = `selectionCanWeld(...)` (same eligibility the row uses, `OffsetPathsRow.tsx:27`), registered next to the booleans in `vectorBooleanCommands` or `toolsCommands`. The command opens a small dialog (or focuses the existing row) to collect distance + direction, then calls `offsetSelection(±mm)`. Keep the panel row as the quick path but change its `return null` (`OffsetPathsRow.tsx:27`) to render disabled-with-reason so it does not disappear. Add a `COMMAND_HELP` topic.
- **Files:** `src/ui/commands/command-types.ts` (modify); `src/ui/commands/vector-boolean-commands.ts` or `command-families.ts` (modify — register); `src/ui/layers/OffsetPathsRow.tsx` (modify — disabled state); `src/ui/help/command-help-topics.ts` (modify); the `AppCommandContext` builder (modify — `offsetSelection` is already a store action).
- **Tests:** `src/ui/commands/command-registry.test.ts` — assert `tools.offset` appears (disabled with reason when no closed-vector selection, enabled otherwise).
- **ADR:** none (ADR-103 G1 already groups offset with the booleans)
- **Effort:** S–M (a new dialog is the only non-trivial part; reusing the row's fields keeps it S)  ·  **Depends on:** none — shares `command-types.ts` with CNV-08, sequence them
- **Risk:** Same `command-families.ts` size watch as CNV-08. If both CNV-08 and CNV-09 add a dialog, keep each dialog in its own new file.

---

### CNV-10 · Make core booleans/offset return a Result instead of throwing for control flow
- **Fixes:** src/core geometry throws for control flow, violating the pure-core Result contract — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** `combineVectorObjects` and `offsetVectorObjects` (and `weldVectorObjects`) throw `Error` for fully expected conditions — too few objects, open contour, empty result, collapsed offset (`src/core/geometry/vector-path-booleans.ts:47,59,79,91,114`). CLAUDE.md's pure-core rules ban "throw exceptions for control flow — return a `Result<T,E>`," and every UI caller wraps them in `try/catch` (`src/ui/state/vector-path-actions.ts:131-135,163-167,195-199`) — the exact anti-pattern that produced the silent-swallow bug (CNV-04).
- **Approach:** Change the three core functions to return a discriminated `Result<ImportedSvg, { reason: string }>` (`{ ok: true; value } | { ok: false; reason }`), moving each thrown message into the `reason`. Update the five UI call sites to `match` on the result: on `ok:false`, push the toast (this becomes CNV-04's toast, done cleanly) and return state unchanged; on `ok:true`, proceed. This is a behavior-preserving refactor of the internal contract (the user-visible behavior is identical once CNV-04's toast is in place). Keep `closedWorldPaths`'s open-contour case flowing into the same `reason`.
- **Files:** `src/core/geometry/vector-path-booleans.ts` (modify); `src/core/geometry/vector-path-tools.ts` (modify — weld); `src/ui/state/vector-path-actions.ts` (modify — five call sites)
- **Tests:** `src/core/geometry/vector-path-booleans.test.ts` — replace `expect(() => …).toThrow()` cases with `expect(result.ok).toBe(false)` + reason assertions (test-first: adjust the existing throw-expecting cases).
- **ADR:** NEEDED — small: adopt `Result<T,E>` for the vector-boolean/offset core surface (records the pattern for future geometry ops). Alternatively `none` if the repo already has a canonical `Result` helper to reuse — verify before writing the ADR.
- **Effort:** M  ·  **Depends on:** ideally lands **before** CNV-04 (tidy-first); if CNV-04 shipped first, this ticket converts its `catch` blocks into `match` arms. Blast radius is the five call sites the finding named.
- **Risk:** Low behavioral risk; the churn is mechanical. Verify no other consumer of these three functions relies on the throw (grep confirms only `vector-path-actions.ts` + tests). No G-code impact.

---

### CNV-11 · Extend snapping to shape drawing (not just move drags)
- **Fixes:** Snapping is barely configurable and only applies to move drags — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** `transformDragWithSnap` returns `guides:[]` and skips snapping for every drag kind except `move` (`src/ui/workspace/drag-snap.ts:35`), so shapes drawn with the rect/ellipse/polygon/star/pen tools land on arbitrary sub-mm coordinates. LightBurn snaps during shape creation too. (Secondary: the snap UI is a cryptic `#` toggle in the zoom chip with no distance/grid fields and no persistence — `src/ui/workspace/overlays.tsx:39-54`, `src/ui/state/ui-store.ts:293-294`.)
- **Approach:** Primary PR — apply the existing grid/object snapper to draw-drag endpoints. In the draw-tool path (`draw-tool.ts` / `use-workspace-drag.ts`), snap the drag's start and current scene points via `snapMoveTransform`'s grid/object logic (`src/ui/workspace/snapping.ts:42-71`) before `shapeFromDrag`, honoring the same `snapSettings.enabled` + Ctrl-bypass rule `drag-snap.ts:39` already implements. Keep it a pure transformation of the two points so it stays testable. The discoverability/config sub-items (magnet icon + tooltip on the `#` toggle; a distance/grid popover; `localStorage` persistence of `snapSettings`) are **separate smaller follow-up PRs** — list them but do not batch them into this one.
- **Files:** `src/ui/workspace/draw-tool.ts` and/or `src/ui/workspace/use-workspace-drag.ts` (modify); possibly a new `src/ui/workspace/draw-snap.ts` helper if `use-workspace-drag.ts` (~386 lines) is near the cap (it is — prefer a new file).
- **Tests:** `src/ui/workspace/drag-snap.test.ts` — a draw drag ending near a grid line snaps to it; Ctrl bypasses; disabled `snapSettings` is a no-op.
- **ADR:** none (matches LightBurn — snapping during creation)
- **Effort:** M  ·  **Depends on:** none
- **Risk:** Existing draw tests that assert exact drawn coordinates near grid lines may now snap — audit and update them. Prefer a NEW helper file over growing `use-workspace-drag.ts` past its cap (CNV-polish-2).

---

### CNV-12 · Deduplicate the HISTORY_DEPTH constant (tidy)
- **Fixes:** Undo 50-step cap duplicated in two constants (part 1 of the "undo rough edges" finding) — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** `HISTORY_DEPTH = 50` is defined independently in `src/ui/state/scene-mutations.ts:28` (used by `pushUndo`, the undo cap) and `src/ui/state/store-actions.ts:15` (used by the redo cap at `store-actions.ts:111,127`). A change to one silently desyncs the undo and redo ceilings — the copy-paste anti-pattern CLAUDE.md names.
- **Approach:** Export `HISTORY_DEPTH` once from `scene-mutations.ts` and import it in `store-actions.ts`, deleting the local copy. Pure refactor, no behavior change.
- **Files:** `src/ui/state/scene-mutations.ts` (modify — export); `src/ui/state/store-actions.ts` (modify — import)
- **Tests:** pure refactor — flag as such (no behavior change). Optionally a small test that the redo stack caps at `HISTORY_DEPTH`.
- **ADR:** none
- **Effort:** S  ·  **Depends on:** none (land before CNV-13/-14 to keep undo PRs clean)
- **Risk:** None (constant hoist).

---

### CNV-13 · Preserve selection across undo/redo when the ids still exist
- **Fixes:** Selection wiped on every undo/redo (part 2 of the "undo rough edges" finding) — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** `undo()` and `redo()` unconditionally clear `selectedObjectId`/`additionalSelectedIds`/`selectedPathNode(s)` (`src/ui/state/store-actions.ts:112-115,128-131`), so undoing a nudge deselects everything and repeated undo-tweak cycles force reselection.
- **Approach:** After restoring the target `Project`, keep the prior selection ids that still resolve to a live, unlocked, visible object in the restored scene (reuse the `visibleSelectionState`-style filter already in `store-actions.ts:273-293`); drop ids that no longer exist; clear node selection (its indices may be stale). Apply symmetrically in `undo` and `redo`. Test-first.
- **Files:** `src/ui/state/store-actions.ts` (modify — `historyActions`)
- **Tests:** `src/ui/state/store-actions.test.ts` (new, co-located) — nudge an object, undo, assert it stays selected; delete an object, undo the delete, assert selection restores only surviving ids; undo past an object's creation drops its id.
- **ADR:** none
- **Effort:** S–M  ·  **Depends on:** CNV-12 (same file; land the tidy first)
- **Risk:** Low. Ensure node-selection stays cleared (indices reference the pre-restore geometry). No G-code impact.

---

### CNV-14 · Label undo-history entries with action names
- **Fixes:** Undo History dialog rows are unlabeled (part 3 of the "undo rough edges" finding) — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** The undo stack is `ReadonlyArray<Project>` with no per-entry metadata, so the dialog can only render `projectSummary` = "N objects, M layers" (`src/ui/commands/UndoHistoryDialog.tsx:74-96`) — no action names.
- **Approach:** Thread an action label through the history stack: change the stack element to `{ project: Project; label: string }` (or a parallel labels array) and give `pushUndo` a `label` parameter (`scene-mutations.ts:72-74`). Every mutating slice that calls `pushUndo` must pass a label ("Move", "Duplicate", "Weld", "Group", …). Render `label` in `HistoryRow`. This is the honest cost: `pushUndo` has many call sites across the state slices, so it is materially larger than the finding's "S."
- **Files:** `src/ui/state/scene-mutations.ts` (modify — `pushUndo` signature + stack type); every slice calling `pushUndo` (modify — pass a label); `src/ui/commands/UndoHistoryDialog.tsx` (modify — render label); `src/ui/state/store.ts` (modify — stack type)
- **Tests:** `src/ui/commands/UndoHistoryDialog.test.tsx` (new) — rows show action labels; a slice test asserting a labeled entry is pushed.
- **ADR:** none
- **Effort:** L (corrected up from the finding's S — the `pushUndo` signature change fans out across all mutating slices)
- **Depends on:** CNV-12 (constant), and ideally after CNV-13 so the undo PRs stack cleanly
- **Risk:** High churn / wide blast radius touching every mutating slice — the highest-risk ticket in this epic for the least user value. Consider deferring; if taken, do it as one mechanical PR with the signature change + every call site together (it will not compile otherwise). No G-code impact.

---

### CNV-15 · Record the flat-group model in an ADR (v1) — or implement nested groups
- **Fixes:** Groups are flat id-sets: grouping steals members from existing groups, so nested groups are impossible — severity minor (verified: no adversarial verdict; original stands)
- **Root cause:** `SceneGroup` is `{ id, name, objectIds }`; `groupSelectionInState` strips selected ids out of all existing groups then creates one new flat group (`src/ui/state/scene-group-actions.ts:62-88`), `pruneGroups` deletes any group under 2 members (`:137-145`), and `ungroupSelectionInState` dissolves to loose objects in one step (`:90-104`). Grouping two existing groups destroys them into one; LightBurn preserves group hierarchy. No ADR covers grouping at all.
- **Approach:** Default (accept v1): write an ADR recording the flat-group model as a deliberate simplification, and note the LightBurn divergence (per ADR-027, an unrecorded divergence is a defect — recording it discharges that). Optionally add a guard/message when the user groups objects that already belong to a group, so the destructive re-parenting is at least visible. The larger alternative — migrate `objectIds` to `memberIds: (objectId | groupId)[]` for true nesting — is the L path and should be its own ADR + implementation ticket; nothing downstream depends on flatness except these three helpers.
- **Files:** `DECISIONS.md` (modify — new ADR). If also adding the guard message: `src/ui/state/scene-group-actions.ts` (modify).
- **Tests:** ADR route is docs-only. If the guard message is added: `src/ui/state/scene-group-actions.test.ts` — grouping objects already in a group emits the warning.
- **ADR:** NEEDED — flat (non-nested) group model accepted for v1; nested groups deferred.
- **Effort:** S for the ADR route (finding said L — the L is only if nesting is implemented)  ·  **Depends on:** none
- **Risk:** None for the docs route. The nesting implementation (if chosen) would ripple through selection expansion (`expandedObjectIdsForGroups`) and persistence — out of scope for the v1 ADR.

---

#### Polish (deferred, one-liners)

| finding | one-line fix | effort |
|---|---|---|
| Tool-strip tooltips omit the LightBurn-parity shortcuts (Ctrl+R/E/L) — `src/ui/help/help-topics.ts:89-108` | Append "(Ctrl+R)" etc. to the rect/ellipse/polyline `TOOL_HELP` tooltips, sourced from the same `TOOL_BINDINGS` table `shortcuts.ts:306-310` uses so they can't drift (mirrors `Toolbar.tsx:115-116`). | S |
| Sector hotspot files at 89–100% of the 400-line hard cap — `DesignLibraryDialog.tsx`, `command-families.ts`, `use-workspace-drag.ts`, `CommandShell.tsx`, `drag-state.ts`, `AddTextDialog.tsx` | Pre-emptive splits (own PRs, no behavior change): `DesignLibraryDialog` → grid/filters subcomponents; `use-workspace-drag`'s per-tool `beginToolDrag` branches → per-tool modules. Prerequisite for CNV-01/-05/-08/-09/-11 if they'd push a hotspot file over. | M |
| Group/Ungroup live under Edit, not Arrange (from the ungroup finding) — `edit-command-family.ts:124-155` | LightBurn keeps Group/Ungroup in the Arrange menu; mirror or move the two commands there. Menu-placement only; own PR. | S |

---

## Trace engine & raster/image fidelity — implementation tickets

### TRC-01 · Let a manual Cutoff/Threshold entry suppress Line Art's auto-Sketch promotion
- **Fixes:** Line Art's auto-Sketch promotion silently disables Cutoff/Threshold with no off switch — severity major (verified: CONFIRMED)
- **Root cause:** `preprocessForTrace` runs `shouldUseSketchTrace` (trace-image.ts:250) *before* `applyThreshold` (trace-image.ts:258); the Line Art preset ships `autoSketchTrace:true` (trace-presets.ts:39) and is the default preset. `shouldUseSketchTrace` (auto-sketch-trace.ts:12-14) honours `sketchTrace===false` as *not force-on* but never as *force-off*, so on any colour-rich image the sketch branch wins and `sketchTraceToMonochrome` (trace-image.ts:344-361) ignores `cutoffLuma`/`thresholdLuma` entirely. In the dialog, `mergeLightBurnTraceSettings` deletes `useOtsuThreshold` when the user enters a manual band (trace-options.ts:34-35) but leaves `autoSketchTrace` set, so the live Cutoff/Threshold inputs are inert with no explanation and (for Line Art) no Sketch checkbox to turn off (TraceSettingsControls.tsx:135-143).
- **Approach:** Make explicit user band-entry win, mirroring the existing Otsu-precedence delete. In `mergeLightBurnTraceSettings` (trace-options.ts), when `manualThreshold` is true, also `delete out['autoSketchTrace']` alongside the existing `delete out['useOtsuThreshold']`. Note: the preset *always* defines `cutoffLuma:0`/`thresholdLuma:128`, so gate on `settings.cutoffLuma !== undefined || settings.thresholdLuma !== undefined` (the user override), never on the merged value. Update `AutoSketchTraceNote` copy (TraceSettingsControls.tsx:205-211) to state that dragging Cutoff/Threshold turns auto-sketch off. (Alternative, larger: replace the Line Art note with a tri-state Auto/On/Off control — deferred; note-plus-precedence is the smaller diff.)
- **Files:** `src/ui/trace/trace-options.ts` (modify), `src/ui/trace/TraceSettingsControls.tsx` (modify, copy only)
- **Tests:** test-first in `src/ui/trace/trace-options.test.ts` — add a case: `mergeLightBurnTraceSettings(TRACE_PRESETS['Line Art'], { cutoffLuma: 40 })` returns options with `autoSketchTrace` absent (and `useOtsuThreshold` absent); with `{}` it keeps `autoSketchTrace:true`. Optionally add a `trace-image.test.ts` case asserting that with a manual band + no `autoSketchTrace`, a colour-rich fixture routes through `applyThreshold` not `sketchTraceToMonochrome`.
- **ADR:** NEEDED — record the Line Art auto-Sketch promotion as a deliberate LightBurn divergence (LightBurn's Sketch Trace is an explicit checkbox, default off) and the "manual band wins" precedence rule.
- **Effort:** S · **Depends on:** none
- **Risk:** Pure UI-merge change; no core or G-code impact. Watch that no other caller relies on `autoSketchTrace` surviving a manual band. Confirm `trace-image-sketch.test.ts` still passes (it exercises force-on `sketchTrace:true`, untouched).

### TRC-02 · Engrave rotated raster images by inverse-transform sampling the source luma
- **Fixes:** Rotated raster images cannot engrave at all; compile ignores rotation and preflight blocks the job — severity major (verified: CONFIRMED)
- **Root cause:** `compileRasterGroup` sizes the burn grid from the machine-space AABB (`rasterBoundsInMachineCoords`, raster-bounds.ts:16-34, which maps all four corners through the full transform incl. `rotationDeg` then min/maxes) but then resamples the *unrotated* source luma straight into that grid (`resampleLumaNearest(preparedLuma …)`, compile-job-raster.ts:60-66). `orientRasterLumaForMachine` (compile-job-raster.ts:112-133) only XORs mirror/negative-scale flips — `rotationDeg` is never read in the compile path. Preflight then blocks the job honestly (`unsupported-raster-transform`, preflight.ts:314-320), but the canvas still allows a `rotate` drag on image objects (use-workspace-drag.ts:58), so the flow dead-ends at Start/Save.
- **Approach:** Replace the resample+orient seam with per-target-pixel inverse-transform sampling. For each target pixel `(px,py)` of the machine-space AABB, map its mm centre back through the inverse of `toMachineCoords(applyTransform(·, obj.transform), device)` to a source pixel; sample the source luma there (white `255` outside the object footprint). This folds rotation, mirror, and scale into one mapping and lets `orientRasterLumaForMachine` be retired for the rotated case. Keep it a pure helper in a NEW `src/core/job/raster-sample.ts` (compile-job-raster.ts is already ~207 physical lines; adding an inverse-sampling loop would push it toward the cap). Then drop the `rotationDeg !== 0` guard in `appendUnsupportedRasterTransformIssues` (preflight.ts:314).
- **Files:** `src/core/job/raster-sample.ts` (new), `src/core/job/compile-job-raster.ts` (modify — call the sampler, remove the mirror-only orient path for rotated images), `src/core/preflight/preflight.ts` (modify — remove/relax the rotation guard)
- **Tests:** test-first in `src/core/job/compile-job-raster.test.ts` — extend the existing rotated case (:247) beyond the AABB assertion: a small asymmetric luma fixture rotated 90° must produce `sValues` equal to the manually-rotated pixel grid (not the axis-aligned resample). Add a 0°/mirror regression asserting byte-identical output to today (parity for the unrotated path). Add a `preflight.test.ts` case: a rotated image on an image layer no longer emits `unsupported-raster-transform`.
- **ADR:** NEEDED — inverse-transform raster sampling; records closing the documented rotated-raster divergence (currently only a code comment at preflight.ts:310-313).
- **Effort:** M · **Depends on:** none — but **shares the compile-job-raster resample seam with TRC-03**; whichever lands second must rebase, and ideally the rotation sampler adopts TRC-03's area-averaged kernel (merge consideration).
- **Risk:** G-code snapshot churn for any rotated raster fixtures — `Snapshot change acknowledged: rotated raster now engraves via inverse-transform sampling` required; verify unrotated fixtures stay byte-identical. Pure-core: no DOM/clock/random, return values only. Inverse-transform math must handle non-invertible/degenerate transforms (return white) without throwing.

### TRC-03 · Replace nearest-neighbor burn-grid resampling with area-averaging (downscale) / bilinear (upscale)
- **Fixes:** Image-mode burn-grid resampling is nearest-neighbor only — photos alias when downscaled to lines/mm — severity major (verified: CONFIRMED)
- **Root cause:** `resampleLumaNearest` (luma-resample.ts:27-46) is pure point-sampling — one source pixel per target pixel, no footprint averaging — and it is the only resampler between the stored source luma and the `linesPerMm` burn grid that feeds `dither()` (compile-job-raster.ts:60-66,75). Downsampling a multi-megapixel photo to e.g. 10 lines/mm drops/shimmers thin dark features and moirés textures; the dither input then depends on sub-pixel placement. The same NN function backs the UI previews (processed-bitmap.ts:51, AdjustImageDialog.preview.ts:52), so the operator's "the image is the preview" promise inherits the aliasing.
- **Approach:** Add a new `resampleLuma(input, targetW, targetH)` in luma-resample.ts that box-averages the source footprint when downscaling (target < source on an axis) and bilinearly interpolates when upscaling, per axis; keep `resampleLumaNearest` for the `passThrough` path (exact source pixels). Switch compile-job-raster.ts:60-66 to `resampleLuma` for the non-passThrough branch. Switch the two UI previews to the same function so preview matches the burn. Keep it pure-core (no allocation surprises beyond the output buffer; guard zero dims → `whiteLuma`).
- **Files:** `src/core/raster/luma-resample.ts` (modify — add `resampleLuma`, export from `src/core/raster/index.ts`), `src/core/job/compile-job-raster.ts` (modify), `src/ui/raster/processed-bitmap.ts` (modify), `src/ui/raster/AdjustImageDialog.preview.ts` (modify)
- **Tests:** test-first in NEW `src/core/raster/luma-resample.test.ts` — (a) a 4→2 downscale of a black/white checker returns mid-grey block means (proves footprint averaging, not point-sampling); (b) a 2→4 upscale of a two-value gradient returns interpolated intermediate values; (c) `passThrough` path unchanged. Pair with the raster perceptual fixture from TRC-04 (block-mean tone vs source luma) to prove the kernel end-to-end.
- **ADR:** NEEDED — raster burn-grid resampling kernel (the raster ADR F.2 and amendments never decide the resampler; this records area/bilinear as the chosen default, mirroring the trace side's ADR-100 supersampling lesson).
- **Effort:** M · **Depends on:** shares the compile-job-raster resample seam with **TRC-02** (rebase/merge); the perceptual proof depends on **TRC-04**'s tone instrument.
- **Risk:** G-code snapshot churn on every raster fixture — `Snapshot change acknowledged: burn-grid resampling now area-averages/bilinears instead of nearest-neighbor` required, and this is intended. Preview visuals change (they now match the burn — desirable). Confirm no perf regression on the 4M-pixel budget ceiling (area-average is O(source footprint); large downscales sum many source px per target — keep it summed-area/incremental if hot).

### TRC-04 · Add perceptual coverage for the raster dither/emit pipeline
- **Fixes:** Zero perceptual coverage of the raster/image (dither/emit) pipeline — severity major (verified: CONFIRMED)
- **Root cause:** `src/__fixtures__/perceptual` contains no reference to `dither`, `emitRaster`, `linesPerMm`, or `RasterImage` (case-insensitive grep: zero matches); `toolpath-rasterize.test.ts` exercises only `mode='fill'` scenes and never feeds `rasterizeGcodeBurn` (gcode-rasterize.ts:28) image-mode output. `dither.test.ts` asserts endpoints/threshold/determinism/non-mutation (dither.test.ts:32-59) but never tonal fidelity of an actual image. PROJECT.md:100 still records F.2.f hardware burn as pending. So no instrument or burn evidences that a grayscale/error-diffusion engrave tonally resembles its source — which, per CLAUDE.md rule 2, forbids calling Image-mode fidelity "verified."
- **Approach:** Add two perceptual instruments under `src/__fixtures__/perceptual/`: (a) `raster-tone.test.ts` — dither a known gradient/photo luma fixture and compare block-mean tone-per-region against the source luma (mapped through sMin/sMax), catching kernel and power-mapping bugs; (b) `raster-emit.test.ts` — run `emitRaster`/`compileRasterGroup` output through the existing `rasterizeGcodeBurn` (extended to ink proportional to modal S, or thresholded) and IoU/tone-compare against the dithered mask, catching emit-geometry bugs. Reuse existing `createMask`/rasterize helpers. Keep the F.2.f hardware-burn checklist item open (docs, see TRC-05 scope note).
- **Files:** `src/__fixtures__/perceptual/raster-tone.test.ts` (new), `src/__fixtures__/perceptual/raster-emit.test.ts` (new), possibly a small `raster-tone.ts` helper (new); `src/__fixtures__/perceptual/gcode-rasterize.ts` (modify only if S-proportional inking is needed — today it inks binary on `s>0`)
- **Tests:** the tickets' deliverable *is* the tests; they must fail meaningfully if the resample kernel (TRC-03) or dither mapping regresses. No product-source change, so no bug-fix test-first pairing.
- **ADR:** none (test/instrument addition under the existing ADR-025 perceptual regime).
- **Effort:** M · **Depends on:** none; **provides the fixture TRC-03 cites**, so land TRC-04 first or together.
- **Risk:** Fixtures must be deterministic (no clock/random) to satisfy the byte-identical regime. Tolerance bands need tuning so the test is sensitive to kernel/mapping bugs without flaking on legitimate dither texture. `gcode-rasterize.ts` lives in fixtures (not core), so extending it is boundary-safe.

### TRC-05 · Correct PROJECT.md / WORKFLOW.md trace-engine descriptions to the shipped in-house engine
- **Fixes:** PROJECT.md and WORKFLOW.md materially misdescribe the shipped trace engine — severity major (verified: CONFIRMED)
- **Root cause:** PROJECT.md:91 says tracing runs "via `imagetracerjs`"; :93 calls the outline-vs-centerline gap "Known open gap — the next frontier"; :233-238 marks ADR-030 "pending maintainer decision (2026-05-29)"; :303 lists imagetracerjs as THE Phase E vectorizer. The tree contradicts all of it: `trace-to-paths.ts:189-200` routes binary presets to the in-house contour backend with an explicit ADR-123 comment (imagetracerjs = UI-unreachable fallback), Centerline is a shipped preset (trace-presets.ts:50-75), and every ADR-030 control is live in the dialog (TraceSettingsControls.tsx:83-146). WORKFLOW.md:850-856 still lists Phase E as four STUB lines. Under the doc-as-spec regime every session starts from stale facts.
- **Approach:** Docs-only. Rewrite PROJECT.md Phase E (§89-93) to: in-house contour/centerline/edge engine per ADR-123, imagetracerjs = UI-unreachable multi-colour fallback, centerline gap CLOSED, `DEFAULT_TRACE_OPTIONS` degeneration noted as fallback-only; update the pending-decision bullet (:233-238) to "shipped (B1–B4)"; correct the tech list (:303) to name the in-house engine with imagetracerjs as fallback. Replace WORKFLOW.md's Phase E STUB (:850-856) with real F-E1..E4 flows: import raster, open trace dialog, presets + debounced live preview + Cutoff/Threshold/Ignore/Smoothness/Optimize + boundary crop/enhance + alpha mask + delete-after, and the success/error/empty/edge states. Keep the F.2.f hardware-burn item open (ties to TRC-04).
- **Files:** `PROJECT.md` (modify §89-93, §233-238, §303), `WORKFLOW.md` (modify §850-856)
- **Tests:** docs-only, no test.
- **ADR:** none (documents already-decided ADR-123/ADR-030).
- **Effort:** S · **Depends on:** none (informational overlap with TRC-04's "keep hardware item open")
- **Risk:** CRLF/EOL trap — `.md` is prettier-ignored; preserve existing line endings (edit in place, don't let the tool flip CRLF↔LF — check `git diff --stat`). No code impact.

### TRC-06 · Record (or drop) the trace-time Fill operationOverride divergence from LightBurn
- **Fixes:** Every filled-contours trace commits an object-level Fill operationOverride — unrecorded LightBurn divergence — severity minor (verified: not independently re-verified; confirmed by reading the code)
- **Root cause:** `traceFillStyle` defaults to `'scanline'` (ImportImageDialog.tsx:88) and is always passed on commit (:120-124), so `operationOverrideForTrace` (ImportImageDialog.tsx:343-350) returns `{ mode:'fill', fillStyle }` for every filled-contours trace, baked onto the `TracedImage` (:283-293). `compileRasterGroup`/compile then honours the per-object override (`layerWithObjectOverride`, compile-job-raster.ts:99-102 / compile-job.ts), so the traced object fills regardless of its layer's mode — bypassing "a layer's mode applies to every object on it." LightBurn outputs plain vectors and lets the layer's cut setting decide Line vs Fill. No ADR records this (grep of DECISIONS.md for operationOverride/fill style: none).
- **Approach:** Decision-first (maintainer choice). Option A (parity): drop the default override in `operationOverrideForTrace` — return `undefined` unless the user explicitly picks a fill style, letting layer mode govern. Option B (keep product behavior): record the trace-time Fill override as an ADR and leave code as-is. If A, keep the Fill-style picker but treat "Scanline" as "no override / inherit" vs an explicit fill choice. Sequence with the §8.6 #1 TracedImage-elimination it interacts with (DECISIONS.md:1080).
- **Files:** `src/ui/trace/ImportImageDialog.tsx` (modify — only under Option A), `DECISIONS.md` (ADR — under Option B) / DECISIONS.md ledger note either way
- **Tests:** test-first in `src/ui/trace/ImportImageDialog.test.ts` — under Option A: a filled-contours commit with default fill style produces a `TracedImage` with no `operationOverride`; an explicit non-default fill style still produces `{mode:'fill', …}`.
- **ADR:** NEEDED — either records the divergence (Option B) or records the deliberate move to LightBurn parity (Option A).
- **Effort:** S · **Depends on:** interacts with cross-epic §8.6 #1 "eliminate TracedImage" — coordinate before Option A lands.
- **Risk:** Under Option A, compile output for traced objects on non-fill layers changes → possible G-code snapshot churn (`Snapshot change acknowledged: traced objects no longer force Fill`). Pure product-behavior change; verify existing trace fixtures.

### TRC-07 · Delete the dead Canny-era trace modules
- **Fixes:** Dead Canny-era modules linger after the ADR-115/123 engine replacements — severity minor (verified: not independently re-verified; confirmed by grep)
- **Root cause:** `edge-reconnect.ts` (279 lines) has zero importers and no test (grep: no match anywhere). `edge-subpixel.ts` is imported only by its own `edge-subpixel.test.ts`. `canny-edges.ts` + `canny-gradient.ts` survive only because three perceptual fixtures import `cannyEdges` (edge-curve-quality.test.ts, trace-benchmark-loop.ts, trace-artifacts.test.ts) plus `canny-edges.test.ts`. ADR-115 explicitly flagged these as "orphaned modules pending a separate cleanup commit" (DECISIONS.md:5282-5286); ADR-123 removed the potrace family but left this set. The own-engine directive is to delete superseded tracer machinery.
- **Approach:** Delete `src/core/trace/edge-reconnect.ts`. Delete `src/core/trace/edge-subpixel.ts` + `edge-subpixel.test.ts`. For canny: either delete the `edge-curve-quality`/`trace-artifacts`/`trace-benchmark-loop` canny usages and `canny-edges*`/`canny-gradient.ts` + tests, or (if the benchmark case is worth keeping) move `cannyEdges`/`computeGradient` into `src/__fixtures__/perceptual/` so `core/` carries no dead engine code. Decide with the maintainer whether the canny benchmark still earns its keep.
- **Files:** `src/core/trace/edge-reconnect.ts` (delete), `src/core/trace/edge-subpixel.ts` + `.test.ts` (delete), `src/core/trace/canny-edges.ts`/`canny-gradient.ts` + tests and the 3 fixture importers (delete or relocate)
- **Tests:** pure deletion/refactor — no new test. `pnpm test`/`pnpm typecheck` must stay green after removal (proves nothing reachable imported them).
- **ADR:** none (executes ADR-115's already-recorded cleanup intent).
- **Effort:** S · **Depends on:** none
- **Risk:** Removing canny may drop a perceptual benchmark case — confirm no live trace path depends on it (edge preset uses the edge tracer/contour finisher, not `cannyEdges`, per trace-presets.ts:76-105). Boundary-safe (all within core/trace or fixtures). Two concerns (edge-reconnect/subpixel deletion vs canny relocation) — if the canny decision is contested, split into TRC-07a (delete the two unambiguously-dead modules) and TRC-07b (canny relocation) so the safe deletion lands immediately.

### TRC-08 · Bring core/trace's index.ts public surface back under the 20-export cap
- **Fixes:** core/trace public surface exceeds the index.ts export cap; legacy tests-only API still exported — severity minor (verified: not independently re-verified; confirmed by counting index.ts)
- **Root cause:** `src/core/trace/index.ts:19-53` exports 24 value symbols (hard limit 20 per CLAUDE.md — "the module is doing too much; split it"), including `traceImageToSvgString` whose own index comment says "no app code calls it today (tests only)" (:11-12).
- **Approach:** (1) Stop exporting `traceImageToSvgString` from index.ts — its co-located tests import it directly from `'./trace-image'` (in-module import, boundary-legal); delete it outright if no test needs it. (2) Split the seven preprocessing primitives (`despeckle`, `medianFilter`, `otsuThreshold`, `adjustBrightness`, `adjustContrast`, `adjustGamma`, `invertImage`) out of the top-level barrel into a sub-barrel (e.g. `src/core/trace/preprocess/index.ts` re-export, or have consumers import the existing `./preprocess`/`./raster-prep` directly if all consumers are in-module/tests). That drops value exports from 24 → ~16, under the cap. Tidy-only, no behavior change.
- **Files:** `src/core/trace/index.ts` (modify), possibly `src/core/trace/preprocess/index.ts` or equivalent sub-barrel (new); update any out-of-module importer of the moved primitives
- **Tests:** none new — this is a pure refactor; `pnpm typecheck` + existing tests prove no consumer broke. Flag the PR as a `refactor:` with no behavior change.
- **ADR:** none.
- **Effort:** M · **Depends on:** landing after TRC-05/TRC-06 is not required, but keep it a standalone tidy PR (CLAUDE.md: refactors don't ride with features).
- **Risk:** Must verify every external importer of the moved symbols (grep for `from '../trace'`/`from '../../core/trace'` referencing the 7 primitives) so nothing reaches a now-private path. The four warning-band files (TracePreview.tsx ~374, emit-raster.ts ~365, stroke-chains.ts ~353, trace-image.ts ~330 counted lines) are over the 250 soft limit but under the 400 hard cap — NOT part of this ticket; schedule separate tidy tickets before a feature next touches them.

### TRC-09 · Give the trace dialog draggable sliders and an Alt+T / context entry point
- **Fixes:** Trace dialog controls are number inputs, not sliders, and lack LightBurn's shortcut/context entry points — severity minor (verified: not independently re-verified; confirmed by reading the code)
- **Root cause:** All trace settings render as `type="number"` fields (TraceSettingsControls.tsx:234-258); LightBurn's Trace window scrubs threshold/smoothness with sliders against the live preview. `tools.trace-image` is registered without a shortcut (command-raster-family.ts:20 passes no shortcut arg) so there is no Alt+T, and there is no right-click/canvas-context path to Trace (grep of WorkspaceContextBar for trace: none) — entry is Toolbar (Toolbar.tsx:132) + menu (AppMenuBar.tsx:155) only.
- **Approach:** (1) In `NumberRow`, render a paired `range`+`number` input for Cutoff/Threshold/Smoothness (and optionally Optimize) sharing one `onChange`; the existing 300ms-debounced preview already absorbs scrubbing (ImportImageDialog useMemo/useTracePreview). (2) Add `shortcut: 'Alt+T'` to the `tools.trace-image` command in command-raster-family.ts and wire it in the shortcut dispatcher (mirror an existing tool shortcut, e.g. Alt+M at command-registry.test.ts:176) — verify no collision. (3) Add "Trace Image" to the selection context bar when a raster image is selected (WorkspaceContextBar), reusing the same gated command.
- **Files:** `src/ui/trace/TraceSettingsControls.tsx` (modify — slider markup), `src/ui/commands/command-raster-family.ts` (modify — shortcut), the shortcut/keymap module (modify), `src/ui/workspace/WorkspaceContextBar.tsx` (modify — context entry)
- **Tests:** `src/ui/commands/command-registry.test.ts` — assert `tools.trace-image` now carries `Alt+T` and no other command lost its key; a TraceSettingsControls render test asserting a `range` input exists for Cutoff and shares value with its number field. Three sub-concerns — if reviewers want the smallest diffs, split into TRC-09a (sliders), TRC-09b (Alt+T), TRC-09c (context bar).
- **ADR:** none (UI parity, no default/behavior semantics changed).
- **Effort:** S (per sub-part) · **Depends on:** none
- **Risk:** Shortcut collision with an existing Alt+T binding — grep before assigning. Slider + number must clamp identically (reuse the existing `clamp`). No core/G-code impact.

### TRC-10 · Widen the image-engrave resolution range by streaming raster rows
- **Fixes:** Image engrave resolution clamped to 5-25 lines/mm and 4M target pixels — a hard ceiling LightBurn does not have — severity minor (verified: not independently re-verified; confirmed by reading the code)
- **Root cause:** `normalizeLinesPerMm` clamps to `[MIN_RASTER_LINES_PER_MM=5, MAX_RASTER_LINES_PER_MM=25]` (raster-units.ts:4-8) and `evaluateRasterBudget` rejects any target grid over `MAX_RASTER_PIXELS=4_000_000` (raster-budget.ts:12,54-60). A 200×200 mm image at 10 lines/mm sits exactly at the cap; 300×300 mm at 10/mm is refused. The budget is a deliberate freeze guard because the whole pipeline pre-materializes the target grid (resample luma + dither Uint16/Float32 + the full emit string) — bounding pixels bounds the freeze.
- **Approach:** Medium-term (the real fix): stream raster emit row-band by row-band (dither + emit per band, discarding each) so peak memory is O(row) not O(grid), letting `MAX_RASTER_PIXELS` rise or retire — `emit-raster.ts`'s own header lists async-iterable emit as planned future work (emit-raster.ts:29-31, "Async-iterable emit for >100 KB jobs (ADR-020 Q3 threshold)"). Short-term (separable, land first): lower `MIN_RASTER_LINES_PER_MM` (the budget already guards the real cost, so a coarse floor is safe) to enable coarse/stylized intervals. Because streaming is a large architectural change, scope this ticket to the short-term floor drop + an ADR proposing the streaming path; the streaming rewrite is its own epic-sized follow-up.
- **Files:** `src/core/raster/raster-units.ts` (modify — floor), `WORKFLOW.md` (modify §949-951 lines/mm range), `DECISIONS.md` (ADR)
- **Tests:** test-first in `src/core/raster/raster-units.test.ts` — `normalizeLinesPerMm(2)` returns the new floor (not 5); interval round-trips hold. Streaming has no test here (deferred).
- **ADR:** NEEDED — raster resolution range + streaming plan (changes the documented 5-25 floor/ceiling and records deferring the pixel-cap removal to a streaming emit).
- **Effort:** L (streaming) / S (floor-drop short-term) — corrected: the finding's "L" applies to streaming; the shippable slice here is S. · **Depends on:** none
- **Risk:** Lowering the floor changes emitted G-code for any job that was clamped up to 5/mm → snapshot churn (`Snapshot change acknowledged: raster lines/mm floor lowered`). Raising the pixel cap without streaming would re-introduce the freeze — do NOT touch `MAX_RASTER_PIXELS` in the short-term slice.

### TRC-11 · Add a per-layer image overscan setting (mirror fillOverscanMm)
- **Fixes:** image overscan fixed at 5mm, not per-layer (second half of "LightBurn image-mode parity gap") — severity minor (verified: not independently re-verified; confirmed by reading the code). Split from the halftone concern → see TRC-12.
- **Root cause:** Raster overscan is the compile-time constant `DEFAULT_OVERSCAN_MM=5` (compile-job-defaults.ts:6), applied unconditionally in `compileRasterGroup` (compile-job-raster.ts:93), whereas fill overscan is per-layer via `layer.fillOverscanMm` (compile-job.ts:140,180; Layer field at layer.ts:34). PROJECT.md:347 itself documents "image overscan is a fixed 5 mm default (not per-layer)." LightBurn exposes per-cut overscan on image layers.
- **Approach:** Add `imageOverscanMm: number` to `LayerOperationSettings` (layer.ts:20-44) defaulting to 5 for back-compat; use `Math.max(0, layer.imageOverscanMm)` at compile-job-raster.ts:93 instead of the constant. Surface a number field in the Image-mode layer settings UI (next to Dither/lines/mm). Add a `.lf2` load migration defaulting missing `imageOverscanMm` to `DEFAULT_OVERSCAN_MM` so old projects load unchanged.
- **Files:** `src/core/scene/layer.ts` (modify — field + default), `src/core/job/compile-job-raster.ts` (modify), the layer-settings UI panel for Image mode (modify), the `.lf2` load/default path (modify), PROJECT.md:347 (modify — remove the "fixed 5mm" note)
- **Tests:** test-first in `src/core/job/compile-job-raster.test.ts` — a layer with `imageOverscanMm: 2` yields a `RasterGroup.overscanMm === 2`; a legacy layer (field absent) defaults to 5. Add a scene-load/default test for the migration.
- **ADR:** NEEDED — changes the documented "fixed 5mm image overscan" decision to per-layer, and touches the `.lf2` schema.
- **Effort:** M · **Depends on:** none
- **Risk:** `.lf2` schema addition → migration must default correctly or old projects change their burn. G-code snapshot churn only if a fixture sets a non-5 value (`Snapshot change acknowledged: per-layer image overscan`); default path stays byte-identical. Watch layer.ts and the settings component against size caps.

### TRC-12 · Add Halftone / Newsprint angle-screen image modes
- **Fixes:** no Halftone/Newsprint screens (first half of "LightBurn image-mode parity gap") — severity minor (verified: not independently re-verified; confirmed by reading the code). Split from TRC-11.
- **Root cause:** `DITHER_ALGORITHMS` (scene-object.ts:160-172) lists 11 error-diffusion/ordered/grayscale modes but no angle-screened Halftone/Newsprint, which LightBurn users pick for wood/photo work. `dither()` dispatches by the same enum (dither.ts:59-70).
- **Approach:** Add `'halftone'` (and optionally `'newsprint'`) to `DITHER_ALGORITHMS` and a new pure `ditherHalftone` in a NEW `src/core/raster/dither-halftone.ts` (dither.ts is ~365 counted lines — near the cap; do NOT grow it): a rotated dot-screen mapping luma → variable dot radius on an angled grid. Wire the new arm into `dither()`'s switch (assertNever keeps exhaustiveness) and add the mode to the Image-mode dither dropdown. Ship with a perceptual fixture (leverages TRC-04's tone instrument).
- **Files:** `src/core/scene/scene-object.ts` (modify — enum), `src/core/raster/dither-halftone.ts` (new), `src/core/raster/dither.ts` (modify — dispatch), the dither dropdown UI (modify), `src/__fixtures__/perceptual/raster-tone.test.ts` (extend, from TRC-04)
- **Tests:** test-first in `src/core/raster/dither.test.ts` — halftone on a uniform mid-grey produces a periodic dot pattern at the configured angle (deterministic, non-mutating, endpoints black→full/white→off); tone-preservation via the TRC-04 fixture.
- **ADR:** NEEDED — new image-mode screen algorithms (LightBurn parity); records screen angle/frequency defaults.
- **Effort:** M · **Depends on:** TRC-04 (perceptual tone instrument) for the fidelity proof.
- **Risk:** New enum value → every exhaustive switch on `DitherAlgorithm` must handle it (assertNever will flag misses at compile time — good). Adds a new dither mode to save/load — verify round-trip. No churn to existing modes' snapshots.

#### Polish (deferred, one-liners)
| finding | one-line fix | effort |
| --- | --- | --- |
| imagetracerjs fallback is unreachable yet retains a degenerate default (batch-trace falls back to `DEFAULT_TRACE_OPTIONS`, which routes to the imagetracerjs quantizer that collapses binary input to a full-frame rectangle) | Pin `batch-trace.ts:41`'s fallback to `TRACE_PRESETS['Line Art']` instead of `DEFAULT_TRACE_OPTIONS`; open with the maintainer whether the ~80KB multi-colour lazy chunk earns its keep or should be deleted to finish the own-engine directive (ADR-recorded retention, so no unrecorded divergence). | S |

---

## UI information architecture & button layout (the whole shell) — implementation tickets

Scope note: 5 major + 7 minor findings become full tickets below (critical→major→minor); 2 polish items are the table at the end. Every citation was read in the current tree; corrections to the original findings are called out inline.

---

### UI-01 · Keep the Cuts/Layers list visible while an object is selected
- **Fixes:** Selecting an object collapses the layer list (and Material Library) into closed `<details>` — severity major (verified: CONFIRMED)
- **Root cause:** `CutsLayersPanel.tsx:31` computes `hasSelection`, and the ternary at `:48-64` wraps `LayerList` + `MaterialLibraryPanel` in `CollapsedPanel` (`:89-102`, a `<details>` with no `open` attribute → collapsed) whenever anything is selected. Because the ternary swaps component *types* at the same tree position, the uncontrolled `<details>` open state also resets on every deselect→reselect. `SelectedObjectProperties` is already rendered unconditionally at `:43`, so the collapse only hides the panel's namesake list — the opposite of LightBurn.
- **Approach:** Delete the `hasSelection` ternary and the `CollapsedPanel` helper; always render `{showMaterialLibrary ? <MaterialLibraryPanel/> : null}` then `<LayerList layers={layers}/>` unwrapped, directly below the always-mounted `SelectedObjectProperties`. The rail already scrolls (`.lf-rail` overflow-y:auto), so the taller column is fine and matches LightBurn (layer list always visible; shape properties above it, never displacing it).
- **Files:** `src/ui/layers/CutsLayersPanel.tsx` (modify — remove ternary + `CollapsedPanel`)
- **Tests:** `src/ui/layers/CutsLayersPanel.test.tsx` — the existing case at `:156-176` ("collapses material and layer management…") asserts `materialSection.open === false` / `layerSection.open === false`; **invert it first** into a failing test that asserts, with `O1` selected, the layer row controls are visible (e.g. `host.querySelector('button[aria-label="Delete layer #000000"]')` / `select[aria-label="Mode for #000000"]` is non-null and not inside a closed `<details>`). Then make the fix pass.
- **ADR:** NEEDED — record that the Cuts/Layers list stays always-visible during selection (LightBurn parity), reversing the previously-uncoded collapse behavior.
- **Effort:** S · **Depends on:** none (UI-02 builds on the same panel but is independent)
- **Risk:** Only touches an inverted test, no snapshot/G-code churn. The rail gets taller during selection (scrolls) — intended. Confirm perceptually that `SelectedObjectProperties` + full `LayerList` coexist without overflow clipping; not verified visually in planning.

---

### UI-02 · Add a LightBurn-style color palette strip for one-click layer assignment
- **Fixes:** No LightBurn-style color palette for one-click layer assignment — severity major (verified: CONFIRMED)
- **Root cause:** The only assign path is the per-card button `AssignSelectionButton.tsx:4-20` (`assignSelectionToLayer(layer.id)`, where `layer.id` is the color key), and layer creation is the color-picker+Add form `AddLayerControls.tsx:8-38`. `App.tsx:51-75` mounts no palette; a repo-wide grep confirms no palette component exists. So LightBurn's single most-used gesture (click a color chip = assign selection / set active drawing color, creating the layer if needed) is several clicks deep.
- **Approach:** New component `LayerPaletteStrip.tsx` (in `src/ui/layers/`): a horizontal row of color chips = existing `project.scene.layers` colors ∪ a small `DEFAULT_PALETTE` constant. Click behavior: if there is a selection → assign it to that color (create the layer if the color has none yet); if no selection → `setActiveLayerColor(color)` (ui-store already has this at `ui-store.ts:124-125,297-298`) to set the next-drawn color, mirroring LightBurn. To keep the click atomic/undoable, add a store action `assignSelectionToColor(color)` in the scene/store slice that does create-if-missing (`createManualLayer`) then `assignSelectionToLayer`. Mount the strip atop the Cuts/Layers rail (below the heading) or docked under `StatusBar`.
- **Files:** `src/ui/layers/LayerPaletteStrip.tsx` (new), `src/ui/layers/index.ts` (modify — export), `src/ui/app/App.tsx` **or** `src/ui/layers/CutsLayersPanel.tsx` (modify — mount), scene/store slice (modify — add `assignSelectionToColor` if a combined action doesn't already exist)
- **Tests:** `src/ui/layers/LayerPaletteStrip.test.tsx` (new) — (a) with a selection, clicking an existing-color chip moves the selected object to that color; (b) clicking a default-color chip not yet present creates the layer and assigns; (c) with no selection, clicking a chip sets `useUiStore.getState().activeLayerColor`.
- **ADR:** NEEDED — palette strip placement + click semantics (assign-or-create / set-active-color) and the default color set (LightBurn parity).
- **Effort:** M · **Depends on:** none; complements UI-01 (palette gives a fast assign path independent of the list's visibility)
- **Risk:** New file must stay under size limits; the new store action must be pure/immutable (Immer/spread). Chip colors are scene DATA not chrome — use raw hex (same `no-restricted-syntax` exception AddLayerControls already documents). Not verified visually.

---

### UI-03 · Make the two right rails collapsible and expose panel visibility in the Window menu
- **Fixes:** Right rails are fixed-width and non-collapsible; the Window menu cannot show/hide any panel — severity major (verified: CONFIRMED)
- **Root cause:** `App.tsx:54-66` mounts `Cnc3DPane` + `CutsLayersPanel` + `LaserWindow` unconditionally in the main flex row. `CutsLayersPanel.tsx:106-113` (width 320, flexShrink 0) and `LaserWindow.tsx:239-256` (width 300, flexShrink 0, internal scroll) never hide; only `Cnc3DPane.tsx:33,164-177` collapses (to 44px). `windowCommands` (`command-families.ts:331-380`) registers only Preview / Fit View / Project Notes / Undo History — no panel toggles.
- **Approach:** Reuse the `Cnc3DPane` collapse pattern. (1) Add a `panelVisibility` slice to `ui-store.ts` — a record of booleans keyed by panel id (`layers`, `laser`), each defaulting `true`, with toggle actions. (This is UI state, not a state machine, so a boolean record is acceptable; no discriminated union needed.) (2) `CutsLayersPanel` and `LaserWindow` read their flag and render a thin collapsed strip with an expand chevron (like `Cnc3DPane`), not `null`. (3) Register `window.toggle-layers` / `window.toggle-laser` (and mirror the existing Camera/Board/Jig panel toggles into the `window` family) so the Window menu lists every panel with an `active` checkmark. May land as two PRs — rails-collapse first, then Window-menu registration — to keep each diff reviewable.
- **Files:** `src/ui/state/ui-store.ts` (modify — visibility slice), `src/ui/layers/CutsLayersPanel.tsx` (modify), `src/ui/laser/LaserWindow.tsx` (modify), `src/ui/commands/command-families.ts` + `command-types.ts` (modify — new `window.*` CommandIds + ctx wiring), `src/ui/commands/use-app-commands.ts` (modify — wire toggles)
- **Tests:** `CutsLayersPanel.test.tsx` / `LaserWindow.test.tsx` — collapsed flag renders the strip + expand control, expanded renders full content; `command-registry.test.ts` — `window.toggle-layers`/`window.toggle-laser` exist and their `active` reflects visibility. test-first on the collapse behavior.
- **ADR:** NEEDED — panel-visibility model + Window-menu parity, **including the safety rule** that the machine/Laser rail's Stop control stays reachable (see Risk).
- **Effort:** M (leans L given the surface area) · **Depends on:** none
- **Risk:** The visible **Stop** button lives in `JobControls` inside `LaserWindow`; hiding that rail removes the visible panic control. The `Ctrl+.` stop shortcut is global (`use-job-shortcuts.ts:43-49`, deliberately un-gated per PROJECT.md non-negotiable #9) so panic-by-keyboard survives, but the ADR must decide whether the Laser rail may be hidden mid-job at all. No G-code churn.

---

### UI-04 · Make Ctrl+I / File → Import open one picker that accepts every 2D format
- **Fixes:** Import is fragmented into three type-filtered commands; Ctrl+I only accepts .svg — severity major (verified: CONFIRMED)
- **Root cause:** `command-families.ts:34-42` registers three separate import commands and only `file.import-svg` carries `'Ctrl+I'`. The pickers are type-filtered: `file-actions.ts:58` (`accept ['.svg']`), `:43` (`accept ['.dxf']`), `platform-image-files.ts:3` (`['.png','.jpg','.jpeg']`). The window key handler hard-binds `i` → `handleImportSvg` (`shortcuts.ts:135`). Unified extension-dispatch already exists for drops (`use-import-drag-drop.ts:63-93`), so only the picker path is fragmented.
- **Approach:** Extract the drop handler's per-extension routing (`pickSvgFiles`/`pickImageFiles`/`isDxfFile` + the `importMany`/`importImagesInOrder`/`importDxfFiles` fan-out) into a shared pure dispatcher module, then add `handleImportAny(platform, {importSvgObject, importRasterImage}, pushToast)` that opens ONE picker with `accept ['.svg','.dxf','.png','.jpg','.jpeg']` and routes each handle by extension through that dispatcher. Repoint `file.import-svg` → a single `file.import` command labeled "Import…" (Ctrl+I) and repoint `shortcuts.ts` `FILE_DISPATCH.i` to it. Keep `file.import-dxf` / `file.import-image` as menu conveniences. STL stays drag-only here (covered by UI-09).
- **Files:** `src/ui/app/import-dispatch.ts` (new — shared pure routing extracted from the drop hook), `src/ui/app/file-actions.ts` (modify — add `handleImportAny`), `src/ui/app/use-import-drag-drop.ts` (modify — reuse the extracted dispatcher, no behavior change), `src/ui/app/shortcuts.ts` (modify — `i`→import-any), `src/ui/commands/command-families.ts` + `command-types.ts` (modify — rename/point the command)
- **Tests:** `src/ui/app/import-dispatch.test.ts` (new) — a mixed `[.svg,.dxf,.png]` handle list routes each to the correct importer; assert the picker `accept` array includes all four so a `.png`/`.dxf` is no longer rejected by the Ctrl+I path. test-first: today a picker returning a `.png` handle is never imported via Ctrl+I.
- **ADR:** none (pure LightBurn parity — single Import that dispatches by extension)
- **Effort:** M (corrected up from the finding's S — the honest fix extracts a shared dispatcher rather than only adding a shortcut) · **Depends on:** none; the dispatcher extraction is a natural tidy-first that also de-dupes the drop hook (do the extraction in its own PR if it grows)
- **Risk:** Extraction must be behavior-preserving for drag-drop (same toasts, same oversize-guard, same stagger order). No G-code churn.

---

### UI-05 · Route DesignLibraryDialog and Viewer3DDialogShell through the kit Dialog contract
- **Fixes:** DesignLibraryDialog and Viewer3DDialogShell bypass the kit Dialog contract (no focus trap, no Escape, no modal registration) — severity major (verified: CONFIRMED)
- **Root cause:** `DesignLibraryDialog.tsx:92` and `Viewer3DDialogShell.tsx:55` render bespoke `role="dialog"` full-screen backdrops with neither `useDialogA11y` (Escape/focus-trap/restore) nor `useRegisterModal`. Every other dialog composes `kit/Dialog.tsx:28-29`, which wires both. Because these two never increment `ui-store` `modalDepth`, `isModalOpen(state)` (`ui-store.ts:350-354`) stays false behind them, so global shortcuts stay live — including `Ctrl+Enter` Start job, whose only guards are `isModalOpen` + connection (`use-job-shortcuts.ts:26-33`). A user browsing the library on a connected machine can start a burn from behind the dialog.
- **Approach:** Port both to `kit/Dialog`. DesignLibraryDialog: keep the `if (!open) return null` guard at `:49`, then wrap the header/browser/footer in `<Dialog onClose={() => setOpen(false)} ariaLabel="Design library" size="xl">` (its 860px panel maps to `--xl` = `min(900px, 100vw-40px)`); drop the bespoke `backdropStyle`/`panelStyle`. Viewer3DDialogShell: return `<Dialog onClose={props.onClose} ariaLabel={props.ariaLabel} size="xl">` wrapping the existing header + canvas + state hints; the canvas `ref`/effect stay untouched. Both are only mounted while open (`App.tsx:71`; `Workspace.tsx:175`, `SelectedReliefProperties.tsx:47`), so `useRegisterModal` will register/unregister correctly.
- **Files:** `src/ui/library/DesignLibraryDialog.tsx` (modify), `src/ui/relief-viewer/Viewer3DDialogShell.tsx` (modify)
- **Tests:** test-first — `src/ui/library/DesignLibraryDialog.test.tsx` and `src/ui/relief-viewer/Viewer3DDialogShell.test.tsx`: mounting the open dialog makes `useUiStore.getState().modalDepth === 1` (fails today), and dispatching an `Escape` keydown invokes `onClose`. Optionally add a repo-wide guard test asserting no production `role="dialog"` outside `kit/Dialog`.
- **ADR:** none (internal consistency — conforms to the existing kit contract)
- **Effort:** S · **Depends on:** none
- **Risk:** Focus now traps and initial focus lands on the first focusable (Close button / first filter input) — intended. The library grid must still scroll inside `.lf-dialog` (max-height 90vh, overflow-y auto). This is a real safety fix (start-job-behind-dialog), so verify perceptually that both dialogs still lay out correctly; not verified visually in planning.

---

### UI-06 · Fix the undefined `var(--lf-bg)` token in six components (incl. a WCAG-AA contrast miss)
- **Fixes:** `var(--lf-bg)` is referenced in six components but never defined in tokens.css — severity minor (verdict: not adversarially re-checked; citations reproduce exactly)
- **Root cause:** `tokens.css:23-90` defines `--lf-bg-0/-1/-2/-input` but **no** `--lf-bg`; a grep for `--lf-bg:` returns nothing. Six sites reference `var(--lf-bg)`: as **text over the accent fill** on `MachineModeToggle.tsx:68` (active segment) and `DesignLibraryDialog.tsx:350` (active category) — invalid-at-computed-value, so it inherits dark text on `#1976d2` (~3.5:1, below the AA 4.5:1 target); and as a **surface background** on `LayerRow.tsx:72` (selected badge), `SafetyNoticeBanner.tsx:61` (recover button), `MachineSettingsPanel.tsx:298` (settings table wrap), `MachineSetupStyles.ts:29` (setup card) — all falling back to transparent.
- **Approach:** Replace by intent — the two text-on-accent sites → `--lf-on-fill` (`#fff`, the token that exists exactly for this, `tokens.css:45`); the four surface sites → the intended surface token: `--lf-bg-1` for the badge/recover-button/table-wrap (white surfaces reading against `--lf-accent`/`--lf-danger-fg` text) and `--lf-bg-2` for the setup card (matches `.lf-card`). Do NOT define `--lf-bg` — the references express wrong intent, not a missing alias. Then add a static guard test.
- **Files:** `src/ui/machine/MachineModeToggle.tsx`, `src/ui/library/DesignLibraryDialog.tsx`, `src/ui/layers/LayerRow.tsx`, `src/ui/laser/SafetyNoticeBanner.tsx`, `src/ui/laser/MachineSettingsPanel.tsx`, `src/ui/laser/MachineSetupStyles.ts` (all modify)
- **Tests:** `src/ui/theme/token-usage.test.ts` (new) — scan `src/ui/**` for every `var(--lf-…)` reference and assert each name is defined in `tokens.css`. This fails today (`--lf-bg`), then passes after the replacements — and prevents recurrence.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** The `MachineModeToggle` active-segment fix is the load-bearing part (AA contrast); the four surface swaps are low-risk but should be eyeballed per-site since the exact surface (bg-1 vs bg-2) is a judgment call. Not verified visually.

---

### UI-07 · Sync shipped shortcuts into the Shortcuts dialog and WORKFLOW.md, and guard against drift
- **Fixes:** In-app Shortcuts dialog and WORKFLOW.md both lag shipped shortcuts (clipboard, group, Convert to Bitmap) — severity minor
- **Root cause:** `shortcuts.ts:199-217` implements Ctrl+C/X/V and Ctrl+G/Ctrl+Shift+G, and the Edit command family attaches those shortcut strings (`edit-command-family.ts:14,22,113,126,145`); `shortcuts.ts:317-320` binds Ctrl+Shift+B → Convert to Bitmap. But `shortcut-list.ts:46-55` (Edit family, the single source for the Shortcuts dialog + toolbar hint) lists none of them, and its Tools family (`:34-44`) omits Ctrl+Shift+B. `WORKFLOW.md:485-487` still says Cut = "not implemented" and Copy/Paste have "no scene-object clipboard yet." The only doc-sync test (`shortcuts-docs.test.ts:5-13`) pins just the Ctrl+E/Shift+E swap. Note: the Convert-to-Bitmap **command** carries no shortcut string (`command-families.ts:119-133`), so a naive registry-diff would miss it.
- **Approach:** (1) Add rows to `shortcut-list.ts`: Edit ← Ctrl+C copy, Ctrl+X cut, Ctrl+V paste, Ctrl+G group, Ctrl+Shift+G ungroup; Tools ← Ctrl+Shift+B convert to bitmap. (2) Add `shortcut: 'Ctrl+Shift+B'` to the `tools.convert-to-bitmap` command in `command-families.ts` so the registry becomes the single source of truth (also surfaces the chord in the menu). (3) Fix `WORKFLOW.md` F-A15 Edit lines `:485-487` to state Cut/Copy/Paste are implemented with a real scene-object clipboard. (4) Extend `shortcuts-docs.test.ts` to diff `shortcutFamilies()` against every command shortcut string in the built registry.
- **Files:** `src/ui/common/shortcut-list.ts` (modify), `src/ui/commands/command-families.ts` (modify — add the Ctrl+Shift+B shortcut), `WORKFLOW.md` (modify — F-A15 Edit section), `src/ui/app/shortcuts-docs.test.ts` (modify — anti-drift diff)
- **Tests:** the extended `shortcuts-docs.test.ts` is itself the regression guard: assert every `command.shortcut` in `buildAppCommands(...)` appears in `shortcutFamilies(machineKind)` and vice-versa.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** `.md` is prettier-ignored — preserve CRLF/EOL (per repo memory the Edit tool can flip CRLF→LF on `.md`; check `git diff --stat` shows only the touched lines, fix via a CRLF-preserving write if it reflows the whole file). No G-code churn.

---

### UI-08 · Collapse the Console section in the machine rail by default
- **Fixes:** Laser/Machine right rail keeps Console and Jog permanently expanded — severity minor
- **Root cause:** `LaserWindow.tsx:63-102` stacks DeviceSetup, ConnectionBar, StatusDisplay, full `JogPad`, `ProbePanel`, `JobControls`, and a full `ConsolePanel` in a 300px scrolling column. Only `ProbePanel.tsx:13-22` uses the collapsible `<details>` pattern; `ConsolePanel.tsx` (the least-used surface for beginners) has no collapse affordance and sits fully expanded at the bottom, forcing long scrolls.
- **Approach:** Wrap `<ConsolePanel/>` in `LaserWindow` in a `<details>`/`<summary>` "Console" defaulting **closed** (no `open` attribute), mirroring `ProbePanel`. Keep the wrapper in `LaserWindow` (not inside `ConsolePanel`) so `ConsolePanel`'s own `aria-label="GRBL console"` and internal tests are untouched. To avoid a third copy of the details pattern (ProbePanel + CutsLayersPanel's old CollapsedPanel), extract a tiny `CollapsibleRailSection.tsx` and reuse it for Console (and, optionally later, Probe). Leave JogPad expanded (frequently used) for v1. Matches prior maintainer feedback about grouping the controller panel into collapsible sections.
- **Files:** `src/ui/laser/CollapsibleRailSection.tsx` (new, optional), `src/ui/laser/LaserWindow.tsx` (modify)
- **Tests:** `src/ui/laser/LaserWindow.test.tsx` (new or extend) — the Console renders inside a `<details>` whose `open === false` by default; expanding reveals the console input. test-first.
- **ADR:** NEEDED — Console collapsed-by-default in the machine rail (changes a default; endorsed by prior "don't crowd the controller panel" feedback).
- **Effort:** M · **Depends on:** none; conceptually adjacent to UI-03 but a distinct, smaller concern (section density vs. whole-rail hide)
- **Risk:** The **Stop** control lives in `JobControls`, above Console, so collapsing Console never hides panic controls. No G-code churn.

---

### UI-09 · Add a CNC-gated File → Import STL Relief… command
- **Fixes:** STL relief import is reachable only by drag-and-drop — no menu or toolbar entry exists — severity minor
- **Root cause:** `importStlFiles` (`stl-import-action.ts:30`) is wired only into the drop handler (`use-import-drag-drop.ts:21,88`). The `CommandId` union (`command-types.ts:21-96`) has no `import-stl`, so no File-menu/toolbar/context entry exposes it, even though DXF got a File-menu command in the same phase. `WORKFLOW.md:1648-1656` (F-CNC7) documents drag-only, so it is doc-consistent but undiscoverable.
- **Approach:** Add `'file.import-stl'` to the `CommandId` union and an `importStl` field to `AppCommandContext`; register a `file.import-stl` command ("Import STL Relief…") in `fileCommands` (`command-families.ts`), and add it to the CNC-only set in `machine-command-gate.ts` (same gating as `file.open-gcode`). Wire `importStl` in `use-app-commands.ts` `fileCommandContext` to open a `.stl` picker (`platform.pickFilesForOpen({ accept: ['.stl'], multiple: true })`), convert each handle to a `File` (reuse `fileFromHandle` from `platform-image-files.ts`), and call `importStlFiles({ project, importObject: importSvgObject, pushToast })`. Update WORKFLOW F-CNC7 to note the File-menu entry alongside drag-drop.
- **Files:** `src/ui/commands/command-types.ts` (modify — id + ctx field), `src/ui/commands/command-families.ts` (modify — command), `src/ui/commands/machine-command-gate.ts` (modify — CNC-only set), `src/ui/commands/use-app-commands.ts` (modify — wire `importStl`), `src/ui/app/stl-import-picker.ts` (new — picker→File→importStlFiles glue), `WORKFLOW.md` (modify — F-CNC7)
- **Tests:** `command-registry.test.ts` (extend) — `file.import-stl` present + enabled in CNC mode, gated out in laser mode; `src/ui/app/stl-import-picker.test.ts` (new) — a picked `.stl` handle reaches `importStlFiles`. test-first on the gate.
- **ADR:** none (follows the app's own "every import has a File-menu command" convention)
- **Effort:** S (finding S; note the wiring spans 5 small touchpoints) · **Depends on:** none; keep separate from UI-04 (STL stays out of the general Ctrl+I picker because it is CNC-only)
- **Risk:** Must gate CNC-only (relief has no laser meaning — `importStlFiles` already toasts in laser mode, but the command shouldn't even appear). No G-code churn.

---

### UI-10 · Stop rebuilding the whole command surface on every 250 ms status poll
- **Fixes:** CommandShell subscribes to entire stores, rebuilding the whole command surface on every 250 ms status poll — severity minor
- **Root cause:** `use-app-commands.ts:46-47` calls `useStore()` and `useLaserStore()` with **no selector**, so every store mutation re-renders the menu bar / toolbar / numeric-edits bar / context bar and re-runs `buildAppCommands` (~70 command objects, including scene scans like `selectedConvertibleVectors` and open-fill-contour counts at `:119-133`). While connected, the laser status poll fires this every ~250 ms. The cost is already acknowledged elsewhere (`use-dialog-a11y.ts:44-47`, `tokens.css:18-20`).
- **Approach:** Pure refactor, its own PR (tidy — no behavior change). Replace the whole-store subscriptions with selectors for the exact fields the command context reads, and/or wrap the laser-derived portion in a `useMemo` keyed only on the fields that gate commands — `connection.kind`, `streamer?.status`, `motionOperation`, `controllerOperation`, `autofocusBusy`, `statusReport?.state` — so high-frequency position/report updates that don't change enablement no longer rebuild the surface. Consider extracting a `use-command-context.ts` to keep the file under the size cap.
- **Files:** `src/ui/commands/use-app-commands.ts` (modify), optional `src/ui/commands/use-command-context.ts` (new)
- **Tests:** `src/ui/commands/use-app-commands.test.ts` (new/extend) — a laser-store mutation that changes only `statusReport` position (not the gating fields) leaves the built command array referentially stable (memo identity unchanged), while a `connection.kind` change rebuilds it. Flag the PR as a pure refactor.
- **ADR:** none
- **Effort:** M · **Depends on:** none
- **Risk:** Highest risk in the epic — under-narrowing a selector can stale-out command enablement (a command stuck enabled/disabled after a state change). Enumerate every field the derivations read before narrowing, and verify perceptually that menu/toolbar enablement still updates on selection and connection changes — green tests will not prove this.

---

### UI-11 · Place Box Fit Test next to Box Generator in the Tools menu
- **Fixes:** Box Fit Test falls into the Tools menu's leftover block, separated from Box Generator — severity minor
- **Root cause:** `AppMenuBar.tsx:136-164` `MENU_GROUPS.tools` lists `tools.box-generator` (group 1) and the calibration generators (group 2) but omits `tools.box-fit-test`, which is registered immediately after box-generator (`command-families.ts:277-282`) as its calibration companion. `groupCommands` (`:166-180`) appends any unlisted command to a trailing leftovers block, so Box Fit Test lands at the very bottom of the ~25-item menu, after Convert to Bitmap.
- **Approach:** Add `'tools.box-fit-test'` to `MENU_GROUPS.tools` immediately after `'tools.box-generator'` in the first group (its functional companion). Add a test asserting no `tools.*` command falls into leftovers.
- **Files:** `src/ui/commands/AppMenuBar.tsx` (modify)
- **Tests:** `src/ui/commands/AppMenuBar.test.tsx` (new/extend) — for the full built `tools` command set, `groupCommands('tools', …)`'s leftovers group is empty (every registered tools CommandId appears in a named `MENU_GROUPS` group). Fails today (box-fit-test is a leftover), passes after the fix.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** Presentational ordering only; no G-code churn.

---

### UI-12 · Update WORKFLOW.md F-A2 to describe the actual left ToolStrip
- **Fixes:** WORKFLOW.md F-A2 still documents the pre-Phase-G left toolbar ("Select, Pan, Zoom-fit, Preview-toggle") — severity minor
- **Root cause:** `WORKFLOW.md:50` describes a left "Toolbar" of "Select, Pan, Zoom-fit, Preview-toggle." The actual left rail is the ADR-051 `ToolStrip` (`ToolStrip.tsx:17-27`): Select, Node, Measure, Rect, Ellipse, Polygon, Star, Pen, Position-laser + a "Lib" button; Preview lives in the top toolbar (`Toolbar.tsx:132-136`) and the Window menu. Docs-as-spec is drifted for the first screen a reader checks.
- **Approach:** Docs-only. Rewrite the F-A2 "Toolbar" bullet (`WORKFLOW.md:50`) to list the current ToolStrip tools and note Preview now lives in the top toolbar / Window menu. Leave the disabled-controls list (`:52-58`) unless it too is wrong.
- **Files:** `WORKFLOW.md` (modify — F-A2 section)
- **Tests:** docs-only, no test.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** `.md` is prettier-ignored — preserve CRLF/EOL (check `git diff --stat` for a whole-file reflow; use a CRLF-preserving write if needed).

---

#### Polish (deferred, one-liners)
| finding | one-line fix | effort |
|---|---|---|
| Top toolbar is 14 text-label buttons that barely fit 1512px; "Lib" is a text stub in the icon rail (`Toolbar.tsx:122-137`, `ToolStrip.tsx:50-58`) | Move toolbar buttons to icon+tooltip (`kit/icons.tsx`/`IconButton` exist) or at least iconify the five panel/generator toggles; give the design-library a proper `IconButton` icon in the ToolStrip | M |
| Machine mode switch (Laser \| CNC) lives inside the Cuts/Layers panel (`MachineModeToggle.tsx`, mounted `CutsLayersPanel.tsx:40`) | Surface machine kind next to the device/connection badge in the top toolbar (where device identity lives), or mirror it in the machine-labeled menu; record placement via ADR | S |

---

## Onboarding, help, error UX & docs — implementation tickets

### DOC-01 · Make the two Help-menu long-form guides reachable from the app
- **Fixes:** In-app help points users at docs/ files that are not shipped, from inside a window.alert that cannot link — severity major (verified: CONFIRMED)
- **Root cause:** `CONNECTION_HELP_TEXT` ends with the bare relative path `Full guide: docs/connection-troubleshooting.md` (`src/ui/help/connection-help.ts:39`) and `SAFETY_NOTICE_TEXT` with `Full guide: docs/safety.md — …` (`src/ui/help/safety-notice.ts:36`). Both are shown via `jobAwareAlert` → `window.alert` (`src/ui/state/job-aware-dialogs.ts:25-31`), wired at `src/ui/commands/CommandShell.tsx:89-90`. The web bundle only serves `public/` (no `docs/` — confirmed: `public/` holds 404.html, _headers, _redirects, download.html, eula.txt, favicon.svg, splash.jpg, third-party-notices.txt), so on kerfdesk.com the path resolves to nothing, and a native alert can't hyperlink regardless.
- **Approach:** Introduce a new `src/ui/help/help-doc-urls.ts` exporting named constants for the two guide URLs (satisfies the magic-string rule and gives DOC-08 a single source). Replace the trailing bare-path lines in both text constants with an absolute, copyable URL from those constants. Two viable hosting choices — pick one in the ADR, do **not** invent a URL: (a) ship copies of `docs/connection-troubleshooting.md` + `docs/safety.md` under `public/docs/` (Vite serves `public/` verbatim) and reference the deployed `…/docs/*.md` URL; or (b) reference the GitHub blob URL where `docs/` already lives (zero duplication, but depends on repo visibility — confirm with maintainer). Keep the alert medium and plain-text/no-Markdown constraint unchanged for this PR (the header comments in both files mandate it). The source-file headers already say "keep the two in sync" — preserve them.
- **Files:** `src/ui/help/help-doc-urls.ts` (new); `src/ui/help/connection-help.ts` (modify); `src/ui/help/safety-notice.ts` (modify); `src/ui/help/connection-help.test.ts` (modify); `src/ui/help/safety-notice.test.ts` (modify); if hosting choice (a): `public/docs/connection-troubleshooting.md` + `public/docs/safety.md` (new).
- **Tests:** Not a behavior bug — copy change. Update the existing pinned assertions that lock the dead path: `connection-help.test.ts:34` (`expect(...).toContain('docs/connection-troubleshooting.md')`) and `safety-notice.test.ts:33` (`toContain('docs/safety.md')`) to assert the new absolute URL constant instead. Assert both text constants import the URL from `help-doc-urls.ts`.
- **ADR:** NEEDED — canonical hosting/shipping location for in-app long-form help guides (public/docs copy vs GitHub link), and whether the alert-medium migration to the Dialog kit is a later step.
- **Effort:** M  ·  **Depends on:** none (URL constant is reused by DOC-08; land this first if both go)
- **Risk:** Hosting choice (a) duplicates the two .md files (public/docs can drift from source `docs/`) — an anti-pattern; mitigate by keeping the "keep in sync" header note or a build copy step, or prefer choice (b). Must confirm the chosen URL actually resolves before merge (do not ship a guessed path). No G-code impact. The medium-term fix (move these texts into the `Dialog` kit like `ShortcutsDialog` so links/scrolling work) is a separate, larger ticket — note it, don't bundle it.

### DOC-02 · Surface a "Can't connect? Troubleshooting" affordance at the connect-failure site
- **Fixes:** Connect failure is a dead end — the failure site never points at the troubleshooting guide that exists one menu away — severity major (verified: CONFIRMED)
- **Root cause:** `src/ui/laser/ConnectionBar.tsx:46` renders only `Failed: {connection.error}` in the failed state with no help affordance. The most common new-user path (cancelled/empty picker) silently returns to `disconnected` (`src/ui/state/laser-connection-actions.ts:69-71`), a hard failure stores the raw thrown message (`:98-101`), and the useful 2 s handshake-timeout guidance ("Check baud rate…") is pushed only to the console log (`:172-181`) — never to the button. The good troubleshooting content already exists (`CONNECTION_HELP_TEXT`, `docs/connection-troubleshooting.md:34-57` driver table) but is one menu away.
- **Approach:** Add an optional `onShowHelp?: () => void` prop to `ConnectionBar`; when `connection.kind === 'failed'`, render a small text button "Can't connect? Troubleshooting" next to the error that calls it. Keep `ConnectionBar` presentational (its header says so) — do not import the store there. Wire it in `src/ui/laser/LaserWindow.tsx:72` where `ConnectionBar` is rendered: `onShowHelp={() => jobAwareAlert(CONNECTION_HELP_TEXT)}` (add the two imports; both are `ui`, no boundary issue). Scope the affordance to `failed` only — extending it to the silent cancelled-picker path would contradict F-B1's documented "silent return to disconnected," so leave that out (or track separately with a WORKFLOW update).
- **Files:** `src/ui/laser/ConnectionBar.tsx` (modify); `src/ui/laser/LaserWindow.tsx` (modify).
- **Tests:** `src/ui/laser/ConnectionBar.test.tsx` (new — none exists today). Test-first: render with `connection = { kind: 'failed', error: 'x' }` and a spy `onShowHelp`; assert the troubleshooting button renders and clicking it calls the spy; assert it is absent for `connected`/`disconnected`/`connecting`.
- **ADR:** none
- **Effort:** S  ·  **Depends on:** none (independent of DOC-01, though both improve help reachability)
- **Risk:** Minimal, additive UI. If the maintainer later wants the same link after a cancelled picker, that needs a WORKFLOW.md F-B1 update first. No G-code impact.

### DOC-03 · Sync the shortcut reference (and WORKFLOW F-A15) with shipped bindings + add a coverage test
- **Fixes:** Shortcut references drifted from shipped shortcuts — again, and the doc says the opposite of the code — severity minor (verified: not independently graded; CONFIRMED from code)
- **Root cause:** `src/ui/app/shortcuts.ts:199-217` binds Ctrl+C/X/V (`copySelection`/`cutSelection`/`pasteClipboard` — implemented in `src/ui/state/scene-clipboard-actions.ts:22-26`) and Ctrl+G / Ctrl+Shift+G (`groupSelection`/`ungroupSelection`); `:317-320` binds Ctrl+Shift+B (Convert to Bitmap). None of these appear in `src/ui/common/shortcut-list.ts` (its families end at File/Tools/Edit/Transform/View/machine — no clipboard/group/bitmap rows), so both the Shortcuts dialog and the toolbar hover hint omit them. `WORKFLOW.md:485-487` still says "Cut (not implemented)" and "no scene-object clipboard yet," the opposite of the code. `shortcut-list.ts:4-6` even warns a prior audit (M27/A.5) caught this class of omission; no sync test guards it (unlike `help-topics.test.ts`).
- **Approach:** (1) Add the missing rows to `shortcut-list.ts` — an Edit-family addition of Ctrl+C copy / Ctrl+X cut / Ctrl+V paste, Ctrl+G group / Ctrl+Shift+G ungroup, and a Tools/Edit row for Ctrl+Shift+B "convert to bitmap." (2) Correct `WORKFLOW.md` F-A15 lines 485-487 to reflect the shipped clipboard (drop "not implemented" / "no scene-object clipboard yet"). (3) Add `src/ui/common/shortcut-list.test.ts` mirroring `help-topics.test.ts`: assert every chord bound in `shortcuts.ts` (and `use-job-shortcuts.ts`) appears in `shortcutFamilies()`, so the two can't drift again.
- **Files:** `src/ui/common/shortcut-list.ts` (modify); `WORKFLOW.md` (modify, F-A15 §485-487); `src/ui/common/shortcut-list.test.ts` (new).
- **Tests:** The new `shortcut-list.test.ts` IS the regression guard — write it first asserting the currently-missing rows are present (fails against today's list), then add the rows to make it pass. Docs edit has no test.
- **ADR:** none
- **Effort:** S (slightly more than "S" only because the sync test needs a small shared enumeration of shipped chords)
- **Depends on:** none
- **Risk:** The sync test needs a machine-readable list of shipped chords; `shortcuts.ts` binds via `match(e)` predicates, not a declarative table, so the test likely asserts against a curated expected-set rather than reflecting predicates. Keep the test's expected-set co-located and commented. WORKFLOW.md is prettier-ignored — preserve CRLF/EOL (edit in place, check `git diff --stat`).

### DOC-04 · Reword SVG import toasts to drop stale internal "Phase D/E" jargon
- **Fixes:** Import toasts leak stale internal roadmap jargon ('wait for Phase D', 'Phase E will support these') — severity minor (verified: not independently graded; CONFIRMED from code)
- **Root cause:** `src/ui/app/import-toasts.ts:41` emits "…text element(s) ignored — convert to paths, or wait for Phase D" and `:49` "…embedded image(s) ignored — Phase E will support these." Those features shipped: the toolbar exposes `tools.add-text` and `file.import-image` (`src/ui/common/Toolbar.tsx:126,123`), and `CONTRIBUTING.md:3` states the app ships through Phase K. A user can't decode "Phase D," and the promise is stale — the capabilities exist via other doors. (`parse-svg.ts:35-36` still legitimately counts `ignoredTextElements`/`ignoredImageElements`; the counting is correct, only the copy is wrong.)
- **Approach:** Replace the two message strings with actionable copy that names the real in-app door: text → "…text element(s) ignored — convert to paths in your design tool, or use Tools → Add Text"; images → "…embedded image(s) ignored — import the image file directly (File → Import Image)." Pure string change in the existing pure function `describeImportResult`; no signature or count-logic change.
- **Files:** `src/ui/app/import-toasts.ts` (modify).
- **Tests:** `src/ui/app/import-toasts.test.ts` (modify — file exists). Test-first: update/add cases asserting the ignored-text and ignored-image toast messages contain "Add Text" / "Import Image" and do **not** contain "Phase". Failing against current strings, then reword to pass.
- **ADR:** none
- **Effort:** S
- **Depends on:** none
- **Risk:** Trivial; UI copy only. No G-code impact. Confirm no other test pins the old "Phase D/E" wording (grep before edit).

### DOC-05 · Update WORKFLOW F-C7 to the shipped seven-step Device Setup wizard and real blocking split
- **Fixes:** WORKFLOW F-C7 has drifted from the shipped Device Setup wizard — severity minor (verified: not independently graded; CONFIRMED from code)
- **Root cause:** `WORKFLOW.md:817` documents six steps ("Connect & read → Identify machine → Confirm detected settings → Placement & safety → Sync to controller → Review & finish"), but the code has seven: `DEVICE_SETUP_STEP_ORDER = ['connect','identify','confirm','safety','probe','firmware','review']` (`src/ui/laser/device-setup/device-setup-flow.ts:29-37`). An undocumented `probe` step ("Set work zero (probe)") exists, and step 4's shipped title is "Homing & options," not "Placement & safety" (`src/ui/laser/device-setup/DeviceSetupWizard.tsx:39-40`). `WORKFLOW.md:830` also claims the empty-state checklist flags "every safety item (bed, origin, power scale, homing, identity)," but the code hardcodes identity/origin/homing as `status:'confirmed', blocking:false` (`device-setup-readiness.ts:67-75,148-168`) — only `bed` and `power-scale` are `blocking:true` and gate Finish (`:91-95,108-112`).
- **Approach:** Docs-only. Rewrite F-C7's step list (817) to the seven-step order with the shipped titles, insert the probe step (noting it self-gates to a skip note in laser mode and is always optional — flow.ts:18-19,177-181), and correct the empty-state paragraph (829-830) to say only bed and power-scale block Finish; identity, origin, and homing are informational (non-blocking). Per WORKFLOW.md's own "source of truth" header, this is the doc catching up to shipped, deliberate behavior.
- **Files:** `WORKFLOW.md` (modify, §F-C7 lines ~815-836).
- **Tests:** docs-only, no test.
- **ADR:** none
- **Effort:** S
- **Depends on:** none
- **Risk:** Docs-only; prettier-ignores `.md` — preserve existing CRLF/EOL (edit in place, verify `git diff --stat` shows no whole-file EOL flip).

### DOC-06 · Unify the supported-browser message across the three surfaces and resolve the Brave caveat
- **Fixes:** Brave caveat specified in WORKFLOW is missing from every shipped message — severity minor (verified: not independently graded; CONFIRMED drift from code)
- **Root cause:** Three surfaces give three different browser lists. `WORKFLOW.md:36` specifies "Chrome, Edge, Brave (may require enabling under Brave Shields/flags), or Arc"; the shipped WebSerial-unsupported hint says "Chrome, Edge, Brave, or Arc" with no caveat (`src/ui/laser/LaserWindow.tsx:119-122`); `CONNECTION_HELP_TEXT` says "Chrome, Edge, Brave, or Arc" no caveat (`src/ui/help/connection-help.ts:12-14`); and the wizard connect step says only "use Chrome or Edge" (`src/ui/laser/device-setup/DeviceSetupConnectStep.tsx:64-68`). If Brave gates Web Serial as the doc asserts, a Brave user passes `isSupported()` yet gets a blocked/empty picker with no hint.
- **Approach:** Two parts, one concern (consistent browser guidance). (1) **Verification gate (maintainer/hardware):** confirm Brave's current Web Serial default before choosing wording — either add the caveat everywhere or, if Brave now ships it enabled, drop the caveat from WORKFLOW.md. Do not assert Brave's behavior from memory. (2) **Code/docs:** define one shared constant for the supported-browser sentence (e.g. in a small `src/ui/help/supported-browsers.ts`, new) and reference it from `LaserWindow` ConnectionHints, `CONNECTION_HELP_TEXT`, and `DeviceSetupConnectStep` so all three read identically (currently the wizard even omits Brave/Arc). Keep the plain-text vs JSX shapes thin around the shared string.
- **Files:** `src/ui/help/supported-browsers.ts` (new); `src/ui/laser/LaserWindow.tsx` (modify); `src/ui/help/connection-help.ts` (modify); `src/ui/laser/device-setup/DeviceSetupConnectStep.tsx` (modify); `WORKFLOW.md` (modify only if verification says the caveat is wrong).
- **Tests:** `src/ui/help/connection-help.test.ts` (modify) — the existing browser-name assertions (`:9-14`) should assert against the shared constant so it stays authoritative. Add a small unit asserting all three surfaces render the same browser list (or assert each imports the constant).
- **ADR:** NEEDED — records the Brave/Web-Serial guidance decision and the single-source-of-truth for the supported-browser list (only if the caveat wording is changed as a deliberate call).
- **Effort:** S (code), gated by an external verification step
- **Depends on:** none; touches `connection-help.ts` — coordinate with DOC-01 if both edit that file (sequence, don't conflict)
- **Risk:** The wording decision is blocked on real-hardware Brave verification — flag prominently; ship the unification (single constant) even if the caveat text stays as-is. WORKFLOW.md EOL trap if edited.

### DOC-07 · Add a Basic/Advanced disclosure to the laser layer cut-settings surface (parity with CNC ADR-111)
- **Fixes:** Beginner mode exists only for CNC; the laser side has no simplified disclosure — severity minor (verified: not independently graded; CONFIRMED from code)
- **Root cause:** ADR-111's Basic/Advanced disclosure (`DECISIONS.md:4998-5030`) is CNC-scoped by design: `CncAdvancedToggle` returns `null` outside CNC (`src/ui/layers/CncAdvancedToggle.tsx:10-14`), gating the advanced field group behind the persisted `showCncAdvanced` flag (`src/ui/state/ui-store.ts:194-196,231-235`; consumed at `CncLayerFields.tsx:33,80-90`). The laser cut-settings surface (`CutSettingsDialog` → `CutSettingsCommonFields.tsx`) always exposes every field: mode/power/speed/passes plus advanced Kerf Offset and the Tabs/Bridges fieldset (`CutSettingsCommonFields.tsx:58,63-129`) and image dithering fields. ADR-111 explicitly scopes to CNC, so the laser gap is unaddressed, not deliberately rejected.
- **Approach:** Design a laser-side Basic/Advanced disclosure reusing the persisted-flag pattern. Add a second ui-store flag (e.g. `showLaserAdvanced`, localStorage-persisted, default Basic=false) mirroring `showCncAdvanced` (`ui-store.ts` `uiToggleSlice`), plus a laser-mode `LaserAdvancedToggle` sibling of `CncAdvancedToggle` shown in `CutsLayersPanel`. Gate the advanced group in the laser cut-settings surface: Basic keeps Mode/Power/Speed/Passes/Visible/Output; Advanced adds Kerf Offset, Tabs/Bridges, and image-tuning fields. Note: the laser cut-settings live in a modal dialog (`CutSettingsDialog`, opened per layer via `LayerRowCutSettings`), not inline cards like CNC — the toggle likely lives inside the dialog (or the panel) rather than on each card; resolve this placement in the ADR. Keep new field-grouping in a **new** file to respect size caps, not by growing `CutSettingsCommonFields.tsx`.
- **Files:** `src/ui/state/ui-store.ts` (modify — add flag + setter to `uiToggleSlice`); `src/ui/layers/LaserAdvancedToggle.tsx` (new); a new laser advanced-fields grouping component under `src/ui/layers/` (new); `src/ui/layers/CutSettingsCommonFields.tsx` and/or `CutSettingsDialog.tsx` (modify — gate the advanced group); `src/ui/layers/CutsLayersPanel.tsx` (modify — render the toggle in laser mode).
- **Tests:** New `LaserAdvancedToggle.test.tsx` (renders only in laser mode; reflects/sets the persisted flag) and a `CutSettingsDialog`/common-fields test asserting the advanced fields are hidden when the flag is off and shown when on. Persistence test mirroring `layer-default-settings.persistence.test.ts`. Not a bug — feature; still write tests alongside.
- **ADR:** NEEDED — laser-side Basic/Advanced disclosure (extends ADR-111 to laser; records the Basic field set, the persisted flag, toggle placement given the dialog-vs-card difference, and the LightBurn Beginner-Mode parity intent).
- **Effort:** L (larger than a copy fix; genuinely a small feature with an ADR — as the finding rates it)
- **Depends on:** none (independent of the other DOC tickets)
- **Risk:** Output-neutral (disclosure only; never changes emitted G-code) — make that an explicit invariant/test so no snapshot churn. Watch component/file size caps in the dialog. Boundary-clean (all `ui`). Verify perceptually against a rendered layer card — green tests won't prove the Basic set feels right.

### DOC-08 · Add a "Help → Online documentation" entry and consider a Keyboard Shortcuts help entry
- **Fixes:** Help menu contents lag the marketed feature set — no in-app path to any feature guide — severity minor (verified: not independently graded; CONFIRMED from code)
- **Root cause:** The help family has exactly three commands — `help.about`, `help.connection`, `help.safety` (`src/ui/commands/command-families.ts:382-410`; `src/ui/commands/command-types.ts:94-96`). The hardest-marketed features (Place Board, Registration Jig, tracing, camera — `README.md:22-82`) have no in-app help beyond tooltips, and there is no "Online documentation" link to the hosted README/docs, so the substantial getting-started material is invisible from inside the app.
- **Approach:** Add a `help.docs` command ("Online documentation") whose callback opens the hosted docs/README URL in a new tab. There is no platform capability for external URLs today (`src/platform/types.ts` has none; the existing external-link pattern is a plain `<a target="_blank" rel="noopener noreferrer">`, `src/ui/common/DownloadDesktopLink.tsx:22-24`). Since a menu command fires a callback (not an anchor), open via `window.open(HELP_DOCS_URL, '_blank', 'noopener,noreferrer')` from the `CommandShell` wiring (`ui` may touch `window`), reusing the URL constant introduced in DOC-01 (`help-doc-urls.ts`). Register the command in `command-families.ts` + add the id to `command-types.ts` + wire the callback in `CommandShell.tsx` alongside `showAbout`/`showConnectionHelp`/`showSafety`. Keep the "Keyboard Shortcuts" Help-menu entry as a **separate** follow-up PR (it needs the existing `ShortcutsDialog` open-state lifted from the Toolbar or a command that toggles it — a distinct concern; do not bundle).
- **Files:** `src/ui/commands/command-families.ts` (modify); `src/ui/commands/command-types.ts` (modify — add `'help.docs'` to `CommandId`); `src/ui/commands/CommandShell.tsx` (modify — wire callback); `src/ui/commands/use-app-commands.ts` + `app-command-context-types.ts` + `command-registry-test-helpers.ts` (modify — thread the new callback, matching the `showConnectionHelp` plumbing at `use-app-commands.ts:272,281`).
- **Tests:** `help-topics.test.ts` already asserts help exists for every command id — so the new `help.docs` id forces a `COMMAND_HELP['help.docs']` entry (that test fails until added; add the help topic). Add a command-registry test asserting `help.docs` is present and enabled in the help family. For the `window.open` callback, a small CommandShell/handler test with a `window.open` spy.
- **ADR:** none (reuses DOC-01's hosting decision) — but the docs URL must come from the same constant/ADR as DOC-01.
- **Effort:** S
- **Depends on:** DOC-01 (shares the `help-doc-urls.ts` URL constant; land DOC-01 first or introduce the constant here and let DOC-01 consume it)
- **Risk:** `window.open` in `ui` is acceptable but is mild platform-conditional behavior; in Electron it should open the system browser — verify the desktop shell handles `window.open` to an external URL (or note a follow-up for a platform `openExternal` capability). No G-code impact. Every consumer of the command context type must be updated or typecheck fails (there are several test helpers).

### DOC-09 · Suppress the PWA Reload banner while a job is disconnected-but-uncleared
- **Fixes:** [Codex M-14] PWA Reload can appear in disconnected-but-incomplete job states — severity minor (verified: PARTIAL — mechanic confirmed, harm overstated; corrected to minor)
- **Root cause:** `PwaUpdatePrompt` suppresses the Reload banner only via `isActiveJob(s.streamer)` (`src/ui/app/PwaUpdatePrompt.tsx:29,69`), and `isActiveJob` covers only `['streaming','paused','done','errored']` (`src/ui/state/laser-store-helpers.ts:38-40`). A mid-job port close routes through `buildPortClosePatch`, which sets the streamer to status `'disconnected'` (`laser-store-helpers.ts:252-282` → `disconnect()` in `src/core/controllers/grbl/streamer.ts:271-273`) and raises the disconnect-during-job safety notice — but `'disconnected'` is not in `isActiveJob`, so the Reload banner CAN appear in that interrupted, uncleared state, contradicting the component's own contract (`PwaUpdatePrompt.tsx:4-7`: "never shown while a terminal job state still needs operator handling"). The verifier refuted the broader harm (a reload can't abort motion the port already lost) and refuted an off-by-one file path; the surviving kernel is: banner shows during a disconnected-but-uncleared job, and it's untested.
- **Approach:** Add a dedicated pure predicate (do **not** widen `isActiveJob` — it also gates the Stop button and status polling, and re-adding `'disconnected'` there would wrongly re-enable stop commands to a dead port). New helper in `laser-store-helpers.ts`, e.g. `jobNeedsOperatorAttention(streamer)` = `streamer !== null && [...isActiveJob statuses, 'disconnected'].includes(status)`, and have `PwaUpdatePrompt` gate on it instead of `isActiveJob`. Scope to `'disconnected'` (the involuntary interrupted case the finding identifies); leave `'cancelled'` (deliberate user Stop) showing the banner unless the maintainer wants otherwise.
- **Files:** `src/ui/state/laser-store-helpers.ts` (modify — add predicate); `src/ui/app/PwaUpdatePrompt.tsx` (modify — use it at line 29/69).
- **Tests:** `src/ui/app/PwaUpdatePrompt.test.tsx` (modify). Test-first: add a case mirroring the existing status cases (`:85-111`) — set `h.streamer.status = 'disconnected'` with `needRefresh = true` and assert the banner is suppressed (`querySelector(BANNER)` is null). It fails today (banner shows), then the predicate change makes it pass.
- **ADR:** none
- **Effort:** S (corrected down from M — one predicate + one call site + one test)
- **Depends on:** none
- **Risk:** Need to confirm when a `'disconnected'` streamer clears back to null (a fresh connect/new job resets it) so the banner isn't suppressed forever after an interrupted job — verify against `connect`/reset paths; if it can linger, note the banner reappears on the next clean connect. No G-code impact; `laser-store-helpers.ts` is `ui/state` (not core), so no pure-core constraint.

#### Polish (deferred, one-liners)
| finding | one-line fix | effort |
|---|---|---|
| help-topics.ts past soft file-size limit (388 raw lines) — mixes registry types with two data tables (`src/ui/help/help-topics.ts:19-62,145-335`) | Extract `CONTROL_HELP` (+ its key union) to a new `control-help-topics.ts`, mirroring the existing `command-help-topics.ts` split; re-export from `help-topics.ts` to keep call sites and `help-topics.test.ts` imports stable. Under the 400 hard cap, so genuinely deferrable. | S |

---

## Performance & robustness (static analysis) — implementation tickets

Sector grade B-. No criticals; six majors, five minors, one polish. Findings 1 and 3
share a root cause (the object-returning `currentOutputScope` selector, store.ts:414-423);
PRF-01 introduces the shared fix that PRF-03 reuses. None of these touch G-code
correctness or safety — all are responsiveness/memory. Cited line numbers were verified
against the current tree.

---

### PRF-01 · Stop the CNC 3D pane recomputing compile + removal grid on every store update
- **Fixes:** CNC 3D pane recomputes full compile + removal grid on every store update — severity major (verified: CONFIRMED)
- **Root cause:** `Cnc3DPane` subscribes `useStore((s) => currentOutputScope(s))` (Cnc3DPane.tsx:32); `currentOutputScope` builds a fresh object + spread array per call (store.ts:414-423), so zustand 4.5's Object.is selector equality (package.json:52) fails on *every* store update — including `setCursorMm` on hover. That fresh `outputScope` is a `useMemo` dep (Cnc3DPane.tsx:103), so `buildPreviewToolpath` + `computeRemovalGrid` over a ~500×500 grid (Cnc3DPane.tsx:76-101) re-runs per pointer-move in CNC mode. `s.project` (line 31) is stable across hover (setCursorMm touches a different field), so the selector is the *sole* re-render driver here.
- **Approach:** Add a value-stable `useOutputScope()` hook in a new file `src/ui/state/use-output-scope.ts` that subscribes to the four primitive fields (`outputScopeSettings.cutSelectedGraphics`, `.useSelectionOrigin`, `selectedObjectId`, `additionalSelectedIds`) and `useMemo`s the `OutputScope` — the exact pattern already inlined in use-preview-toolpath.ts:33-43 (so this is an extract-on-second-use, per CLAUDE.md). Export it from `src/ui/state/index.ts`. Replace Cnc3DPane.tsx:32 with `const outputScope = useOutputScope();`. The useMemo at line 103 now has a referentially-stable dep and no longer fires on hover. `additionalSelectedIds` is an array whose reference is stable except on real selection change, so Object.is holds across mousemoves.
- **Files:** `src/ui/state/use-output-scope.ts` (new), `src/ui/state/index.ts` (modify), `src/ui/workspace/Cnc3DPane.tsx` (modify)
- **Tests:** new `src/ui/state/use-output-scope.test.tsx` — assert the returned reference is `===` across a store update that does not change selection (drive `setCursorMm`), and changes when `selectedObjectId` / `additionalSelectedIds` change. Fails today because `currentOutputScope` yields a new object each call.
- **ADR:** none
- **Effort:** S · **Depends on:** none (introduces the hook PRF-03 also consumes)
- **Risk:** Verify the pane still updates when selection actually changes (test covers). No G-code impact. Hook lives in `ui/state`, imports only the store — boundary-clean.

---

### PRF-02 · Stop the preview toolpath recompiling every 250 ms status poll
- **Fixes:** Preview toolpath fully recompiles every 250 ms status poll while a machine is connected — severity major (verified: CONFIRMED)
- **Root cause:** `usePreviewToolpath` lists the raw `statusReport` object in its rebuild-effect deps (use-preview-toolpath.ts:29,81); every 250 ms poll stores a brand-new report object (laser-status-line.ts:130-147 stores `statusReport: report` unconditionally), so with Preview open + a controller connected the effect re-runs 4×/s — it calls `setToolpath(null)` (line 50) then a full `buildPreviewToolpath` (compile → optimize) via `setTimeout(0)` (lines 52-70,90-93). In the default `'absolute'` start mode `resolveJobPlacement` reads only `workOriginActive`/`wcoCache`, never `mPos`/`wPos` (job-placement.ts:44,69-77), so the resolved placement is byte-identical across polls; the rebuilds are pure waste, and the `setToolpath(null)` blanks the route each cycle.
- **Approach:** Resolve the placement during render (`useMemo` on `jobPlacement`, `statusReport`, `workOriginActive`, `wcoCache` — cheap) and derive a stable string `placementKey` from the *resolved* placement (`ok` flag + `jobOrigin` + `preflightMotionOffset`). Key the rebuild effect on `placementKey` instead of the raw `statusReport`/`workOriginActive`/`wcoCache` objects. In absolute / user-origin / verified-origin modes `placementKey` is constant across polls → no rebuild; in `'current-position'` mode `jobOrigin.currentPosition` changes as the head moves → key changes → rebuild (correct). Pass the already-resolved placement into the scheduled build (via a ref) rather than re-reading `statusReport` inside it. Also stop the unconditional `setToolpath(null)` at line 50 — keep the previous toolpath until the new build resolves so a genuine rebuild doesn't blank the route for a paint.
- **Files:** `src/ui/workspace/use-preview-toolpath.ts` (modify)
- **Tests:** `src/ui/workspace/use-preview-toolpath.test.tsx` (exists) — inject the `scheduleBuild` spy the hook already accepts; feed two different `statusReport` objects that resolve to the same absolute placement and assert `scheduleBuild` fires once, not per report. Add a `'current-position'` case asserting a moved position *does* rebuild.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** Must preserve current-position live tracking (test it) and the `externalGcodePreview` branch. Preview only — no G-code / snapshot impact. Do not drop legitimate rebuilds (project / outputScope / jobPlacement stay in deps).

---

### PRF-03 · Kill the App-root + Workspace re-render storm from useShortcuts / useJobEstimate
- **Fixes:** App-root re-render storm: object-returning selector in useShortcuts re-renders the whole tree per mousemove — severity major (verified: CONFIRMED)
- **Root cause:** `useFileEditShortcuts` (mounted at the App root, App.tsx:44) subscribes `useStore((s) => currentOutputScope(s))` (use-shortcuts.ts:45) plus laser-store `statusReport`/`wcoCache` (use-shortcuts.ts:70-72). The fresh-object selector re-renders App on every store update (every `setCursorMm`), and the 4 Hz `statusReport` churn adds a 4 Hz App re-render while connected; App's children (App.tsx:51-75) are unmemoized, so each is a full reconcile. `useJobEstimate` (use-job-estimate.ts:26) carries the same `currentOutputScope` selector inside Workspace. Both hooks already read this state at *event time* (use-shortcuts via `bindingsRef`, use-job-estimate via a debounce), so the subscriptions exist only to keep those reads fresh.
- **Approach:** Two access patterns, two sub-fixes:
  - **use-shortcuts.ts** — stop subscribing to the churny read-only state. Remove the `currentOutputScope` (line 45) and laser `statusReport`/`workOriginActive`/`wcoCache` (lines 70-72) subscriptions; build those ctx fields inside `onKeyDown` from `currentOutputScope(useStore.getState())` and `useLaserStore.getState()` — the use-workspace-wheel.ts:26-40 pattern (action refs are stable, so event-time reads are equivalent). This removes both the mousemove and the 4 Hz re-renders.
  - **use-job-estimate.ts** — must stay reactive to selection, so replace the `currentOutputScope` selector with the value-stable `useOutputScope()` from PRF-01; the debounce already absorbs project churn, and `outputScope` now only changes on real selection change.
- **Files:** `src/ui/app/use-shortcuts.ts` (modify), `src/ui/laser/use-job-estimate.ts` (modify)
- **Tests:** new `src/ui/app/use-shortcuts.test.tsx` — render the hook, dispatch N `setCursorMm` updates, assert the owner does not re-render (render-count spy) while a `keydown` still dispatches against current state (fire Ctrl+S and assert it read the live project/selection). `src/ui/laser/use-job-estimate.test.tsx` (exists) — add a case asserting no re-estimate on a cursor-only store update.
- **ADR:** none
- **Effort:** M · **Depends on:** PRF-01 (the `useOutputScope` hook)
- **Risk:** use-shortcuts must still see fresh state at keydown — the `getState()` reads guarantee it; verify Save-G-code / undo / paste chords act on the current project + selection. Cleanly splits into two PRs (a: use-shortcuts, b: use-job-estimate) if the reviewer wants tighter diffs. No G-code impact.

---

### PRF-04 · GRBL streamer: replace the shrinking queue with a frozen lines array + index cursor
- **Fixes:** GRBL streamer queue is O(N²) over a job: queued.slice(1) copies the whole remaining array per line sent — severity major (verified: CONFIRMED)
- **Root cause:** `step()`'s refill loop does `queued = queued.slice(1)` per line sent (streamer.ts:175), copying the entire remaining `ReadonlyArray<string>` (state field streamer.ts:52) each time; `step()` runs on every ack (advanceStream, laser-stream-ack.ts:39-41) and every `'ok'` routes there, so a job of N sendable lines does O(N²) array copying (+ GC churn) on the main thread. A photo raster (10⁵–10⁶ lines) copies a multi-MB array per ack early in the job, concurrent with rendering.
- **Approach:** Change `StreamerState` from `queued: ReadonlyArray<string>` to `lines: ReadonlyArray<string>` (the full frozen array, set once in `createStreamer`) + `queuedIndex: number` (head cursor). `step()` advances `queuedIndex` by the number of lines sent — O(1) per line, no copy; reads the next line as `state.lines[queuedIndex]`. The three "queue empty" checks (streamer.ts:166 loop guard, :225, :256) become `queuedIndex >= lines.length`. `cancel`/`disconnect`/`markErrored` set `queuedIndex = lines.length` (equivalent to clearing `queued`). `onAck`'s `inFlight.slice(1)` (streamer.ts:212) stays — it's buffer-bounded (≤ a few lines). Add an exported helper `remainingQueuedCount(state) = state.lines.length - state.queuedIndex` and update the two consumers in laser-store-helpers.ts:142,179 (`streamer.queued.length` → `remainingQueuedCount(streamer)`). Observable `step`/`onAck`/`pause`/`resume`/`cancel` behavior is byte-identical.
- **Files:** `src/core/controllers/grbl/streamer.ts` (modify), `src/ui/state/laser-store-helpers.ts` (modify), plus test migration: `src/core/controllers/grbl/streamer.test.ts`, `src/ui/state/laser-line-handler.test.ts`, `src/ui/state/laser-error-line.test.ts`, `src/ui/state/laser-store.test.ts` (all read `.queued`)
- **Tests:** `streamer.test.ts` — add the failing-first invariant: run a full job's `step`/`onAck` cycle over a large `lines` array and assert `state.lines` reference is preserved (`===`) across every `step` (proves no per-line re-copy). This fails today (no `lines` field; `queued` re-allocates each step). Then migrate existing `.queued` length/equality assertions (lines 20,46,58,65,72,109,139,146,162,181,206,247,266,297) to `lines` + `queuedIndex` / `remainingQueuedCount`.
- **ADR:** none (behavior-preserving internal-representation refactor; note the public `StreamerState` shape change in the PR body)
- **Effort:** M · **Depends on:** none
- **Risk:** Wide test surface (5 files read `.queued`). The state-machine tests pin exact semantics — keep them green. G-code byte stream is unchanged → no snapshot churn. Pure-core preserved (no new impurity, no new throw-for-control-flow). This is effectively a tidy that happens to fix the perf bug.

---

### PRF-05 · Cache the raster luma decode and replace the char-wise base64 decoder
- **Fixes:** Raster (image-mode) compile is uncached and its pure-JS base64 decode is pathologically slow — severity major (verified: CONFIRMED)
- **Root cause:** `compileRasterGroup` re-runs decode → adjust → resample → mask → orient → dither with zero memoization (compile-job-raster.ts:36-97). `decodeBase64Luma` does a per-char `BASE64_ALPHABET.indexOf` (line 153) and `cleanBase64Luma` does a *second* per-char `indexOf` plus char-wise `clean += char` string concat (lines 173-183) — two O(64) scans + a multi-MB string build per base64 char; ~tens of millions of ops for a 4 M-px image. Fills got ADR-050's bounded WeakMap caches (compile-job.ts:38-46, fill-hatching-cache.ts:4-13) but rasters did not, and every `prepareOutput` consumer (preview, live estimate, job-intent-warnings.ts:50, MachineSetupRasterDiagnostics.tsx:125, Save, Start) re-pays it independently.
- **Approach:** Two changes, in a new file `src/core/job/raster-luma-decode.ts` (keeps compile-job-raster.ts under the 250-line soft cap — it's already 207 lines):
  1. **Decode cache (dominant win):** a module-level `WeakMap<RasterImage, Uint8Array>` keyed on the `obj` (ADR-050's narrow module-mutable exception — identity-keyed, GC-bounded, output-invariant because decode depends only on `obj.lumaBase64` + `obj.pixelWidth*obj.pixelHeight`, both intrinsic to `obj`). Wrap the `decodeBase64Luma` call site (compile-job-raster.ts:42-44). Structural sharing keeps `obj` identity stable across the 4 Hz rebuild loop and across the independent consumers → they all hit; a real image edit replaces `obj` → natural miss. No inner cap needed (one entry per live obj).
  2. **Decoder speed:** build a 256-entry `Int8Array` lookup table (charCode → 6-bit value, -1 = invalid) once at module load; iterate the raw base64 with `charCodeAt` + table lookup, skipping whitespace and validating inline, writing straight into the output `Uint8Array` — eliminating `cleanBase64Luma`'s per-char concat entirely.
- **Files:** `src/core/job/raster-luma-decode.ts` (new — cache + LUT decoder), `src/core/job/compile-job-raster.ts` (modify — call the new module; remove the old decode helpers)
- **Tests:** `src/core/job/compile-job-raster.test.ts` (exists) — (a) decode-cache reuse: compile the same `RasterImage` twice and assert the decoded luma is reused (call-counter / instrumented decode); (b) LUT-decoder parity: byte-identical output to the current decoder across valid / `=`-padded / whitespace inputs, and still rejects malformed input the same way.
- **ADR:** none (extends the existing ADR-050 caching decision; reference it in the PR)
- **Effort:** M · **Depends on:** none — complementary to PRF-02 (once the 4 Hz rebuild stops, per-frame decode cost drops too)
- **Risk:** Cache is output-invariant by construction. Keep the decoder's existing malformed-input rejection behavior (pre-existing throw-for-control-flow in core — out of scope, do not change). sValues byte-identical → no snapshot churn. Watch the file-size cap → new logic goes in the new file, not compile-job-raster.ts.

---

### PRF-06 · Guard the synchronous vector/fill compile on Start / Save (share the complexity gate)
- **Fixes:** [Codex M-09] Complexity and output-size protection is not shared by all consumers — severity major (verified: CONFIRMED)
- **Root cause:** `scenePreparationTooComplex` (preparation-complexity.ts:22-27) has only two consumers, both *display* paths — the canvas preview (draw-preview.ts:130) and the live estimate (live-job-estimate.ts:37-40); its header scopes it to "UI-only checks." The shared `prepareOutput` pipeline runs only `runPreEmitPreflight` (prepare-output.ts:73-76), which checks rasters + registration exclusively (pre-emit.ts:20-55) — no vector/fill segment budget. So Save (`emitGcode`) and Start (start-job-readiness.ts — `emitGcode` at :97 always; `prepareOutput` at :151 and :182 in current-position / verified-origin modes) synchronously compile + optimize an over-budget vector/fill job with no gate — the exact main-thread freeze the display paths guard against.
- **Approach:** This is a decision + a cleanup; it needs a maintainer call because a hard block would diverge from LightBurn (which runs any valid job, it does not refuse a big-but-valid one). Recommended scope:
  - **Do not hard-block Start/Save** (LightBurn parity). Instead surface a *non-blocking* warning when `scenePreparationTooComplex(scene)` holds, via `detectMachineJobWarnings` (machine-job-warnings.ts) so the operator is told "large job — preparing may take a moment" but the burn still emits.
  - Separately, **dedupe the redundant compiles in the Start path**: in current-position / verified-origin modes `prepareOutput` runs at :151 and/or :182 *and* again inside `emitGcode` at :97 — thread one prepared job/gcode through instead of recompiling. (In the common `'absolute'` path only `emitGcode` compiles, so this win is mode-specific — state that honestly.)
  - If the maintainer instead wants a hard uniform gate, add `scenePreparationTooComplex` to a shared preflight so all consumers refuse identically — but that changes Start/Save behavior and is a deliberate divergence.
- **Files:** `src/ui/laser/machine-job-warnings.ts` (modify — large-job warning), `src/ui/laser/start-job-readiness.ts` (modify — dedupe compiles). Split recommended: **PRF-06a** dedupe the Start-path multi-compile (pure perf, no behavior change — lands first as a tidy); **PRF-06b** add the warning (behavior + ADR).
- **Tests:** `start-job-readiness.test.ts` — assert `prepareOutput`/compile is invoked once per Start in the affected modes (spy). `machine-job-warnings.test.ts` — assert an over-budget scene yields the large-job warning (Option A) or that Start rejects with too-complex (Option B).
- **ADR:** NEEDED — "scene-complexity budget is a UI-responsiveness guard, warned-not-blocked on Start/Save (LightBurn parity)" — record warn-vs-block and the compile-dedupe rationale.
- **Effort:** M · **Depends on:** none
- **Risk:** Two concerns bundled by the finding — split as above. `emitGcode` output must stay byte-identical (no snapshot churn). Verify Start still preflights identically after the dedupe.

---

### PRF-07 · Bound the raster-preview canvas cache to one variant per dataUrl
- **Fixes:** Raster-preview canvas cache grows without bound across settings changes — severity minor (verified: not adversarially re-checked; kept minor)
- **Root cause:** `previewCanvasCache` keys entries by `dataUrl` **plus** every burn setting (power, minPower, linesPerMm, dither, negative, mask hash — draw-raster-preview.ts:108), but `pruneRasterPreviewCache` only evicts entries whose `dataUrl` is no longer live (draw-raster-preview.ts:70-73). Each entry is a full-resolution canvas (up to 4 M px ≈ 16 MB RGBA). Scrubbing a power / lines-per-mm slider through N values accumulates N full-size canvases for the image's lifetime (~800 MB across 50 steps).
- **Approach:** In `schedulePreviewCanvasBuild`'s completion (draw-raster-preview.ts:126-132), before inserting the new entry, delete any existing `previewCanvasCache` entries whose `entry.dataUrl` equals `obj.dataUrl` (keep at most one settings-variant per dataUrl — or a tiny fixed LRU of 2 if flicker on a slider round-trip is a concern). The key already embeds `dataUrl`, so the scan is cheap. The sibling caches (draw-raster.ts:21-43) already key by dataUrl only and prune correctly; this brings the preview cache in line.
- **Files:** `src/ui/workspace/draw-raster-preview.ts` (modify)
- **Tests:** `src/ui/workspace/draw-raster-preview.test.ts` (exists) — build previews for the same dataUrl at 3 different settings and assert `previewCanvasCache` holds ≤ 1 (or ≤ N) entry for that dataUrl afterward.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** Stepping back to a prior setting re-renders async (acceptable). Keep `pendingPreviewBuilds` consistent with the eviction. No G-code impact.

---

### PRF-08 · Preview route: cumulative-length slice, batched strokes, cached faint objects
- **Fixes:** Preview route rendering re-slices the toolpath and issues one stroke() per step every playback frame — severity minor (verified: not adversarially re-checked; kept minor)
- **Root cause:** rAF playback advances `scrubberT` per frame (use-preview-playback.ts:42-61); each frame calls `sliceToolpath` — a linear scan that also materializes a fresh `whole` array of all completed steps (toolpath-slice.ts:9-29) — and `drawPreview` strokes one `beginPath`/`stroke` per step plus per-travel `setLineDash` toggles (draw-preview.ts:100-113,154-193,242-287). `drawWholeSteps` only decimates above 120 k (draw-complexity.ts:10), so up to 120 k `stroke()` calls per frame are allowed — the same one-stroke-per-primitive pathology the design canvas fixed with per-color batching (draw-scene.ts:363-370). `drawObjectsFaint` also bypasses the DisplayPolylineCache (draw-preview.ts:80 vs draw-scene.ts:375-380).
- **Approach:** (1) Precompute cumulative step arc-lengths once per toolpath (memo keyed on toolpath identity, in a new `src/core/job/toolpath-cumulative.ts`) and binary-search the cut index per frame instead of rebuilding `whole`. (2) Batch cut strokes into one `beginPath`/`stroke` per color and travels into one dashed path (reuse the `strokePolylinesBatched` technique from draw-vector-strokes.ts / draw-scene.ts:363-370). (3) Route `drawObjectsFaint` through the DisplayPolylineCache by accepting a cache param like `drawObjects` does.
- **Files:** `src/core/job/toolpath-cumulative.ts` (new) or `src/core/job/toolpath-slice.ts` (modify — index-cursor slice), `src/ui/workspace/draw-preview.ts` (modify — batching + faint cache)
- **Tests:** `src/core/job/toolpath-slice.test.ts` — parity/property test: the cumulative-length + binary-search slice returns identical `whole`/`partial`/`head` to the linear version across fractions. `src/ui/workspace/draw-preview.test.ts` (exists) — assert batched stroke count is O(colors), not O(steps), if observable via a ctx spy.
- **ADR:** none
- **Effort:** M · **Depends on:** none — shares the batched-stroke helper with PRF-11
- **Risk:** Preview is the operator's approval surface (roadmap P1-C) — slicing math must stay byte-exact; property-test the parity. No G-code impact.

---

### PRF-09 · Move autosave off synchronous localStorage; make quota failure a persistent banner
- **Fixes:** Autosave serializes the whole project synchronously to localStorage — janks and silently ceases to protect photo-heavy projects — severity minor (verified: not adversarially re-checked; kept minor)
- **Root cause:** `startAutosaveLoop` runs `serializeProject` + `JSON.stringify` + a synchronous `localStorage.setItem` on the main thread every 30 s while dirty (autosave.ts:83,147-158); the ~5 MB cap is noted in the header (autosave.ts:10). A project with one imported photo (`dataUrl` + `lumaBase64`, easily several MB) both janks the write each tick and permanently fails with `'quota'` (surfaced via `onWriteFailure`, autosave.ts:157) — so exactly the highest-invested projects get no crash recovery.
- **Approach:** (1) Move autosave persistence to IndexedDB (async, hundreds of MB) behind an io-layer adapter (`src/io/project/autosave-store.ts`), keeping `localStorage` as a legacy *read* fallback for existing slots. Move/serialize on an idle callback so the 30 s tick doesn't jank. (2) Surface a quota/`unavailable` failure as a **persistent** banner ("Autosave off — crash recovery disabled"), not a transient toast, since it means recovery is off until resolved.
- **Files:** `src/io/project/autosave-store.ts` (new — IndexedDB adapter, io/platform layer), `src/ui/state/autosave.ts` (modify — call the async adapter; core stays pure), the recovery hook + a banner component (modify)
- **Tests:** `src/ui/state/autosave.test.ts` (exists) — adapt to the async write; add a quota-path test asserting a *persistent* failure signal (not a transient toast). New `src/io/project/autosave-store.test.ts` for the adapter (fake-indexeddb).
- **ADR:** NEEDED — "autosave persistence: IndexedDB primary, localStorage legacy read-fallback; quota/unavailable surfaced persistently."
- **Effort:** L (was stated M — it's a new storage backend + async plumbing + migration + UI banner). Split recommended: **PRF-09a** persistent quota banner (small, high-value — recovery-off must be loud); **PRF-09b** IndexedDB migration (large).
- **Depends on:** none
- **Risk:** Widest-scope item here — touches io + ui + recovery. Existing localStorage slots must remain readable (legacy fallback). Async timing changes tests. Boundary discipline: serialize stays pure (core/io), IndexedDB access in io/platform, never in core.

---

### PRF-10 · Fix WORKFLOW.md display-simplification + raster-sim budget drift (docs-only)
- **Fixes:** WORKFLOW.md documents a 10,000-segment display-simplification threshold; code uses 120,000 — severity minor (verified: not adversarially re-checked; kept minor)
- **Root cause:** WORKFLOW.md:318 states "> 10,000 path segments"; the code deliberately raised the budget to `LARGE_SCENE_SEGMENT_THRESHOLD = 120_000` because 10 k tripped on a single traced logo (draw-complexity.ts:6-10). WORKFLOW.md:323 also claims raster-sim live updates land "within the same 100 ms budget" — no such enforced deadline exists; the preview canvas builds via `setTimeout(0)` with no deadline (draw-raster-preview.ts:115-157).
- **Approach:** Docs-only. Update WORKFLOW.md:318 "10,000" → "120,000" path segments (matching draw-complexity.ts:10, which is the better answer). On WORKFLOW.md:323 delete the false "within the same 100 ms budget" phrase and reword to a truthful "re-renders asynchronously without blocking the canvas."
- **Files:** `WORKFLOW.md` (modify — lines 318 and 323)
- **Tests:** docs-only, no test.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** EOL trap — WORKFLOW.md is prettier-ignored; edit in place and verify `git diff --stat` shows only the two intended line changes with no CRLF→LF flip (use a CRLF-preserving edit per MEMORY.md's doc-EOL note).

---

### PRF-11 · Coalesce canvas redraw with rAF; batch the grid into one path
- **Fixes:** Canvas is fully cleared and redrawn on every state change with no rAF coalescing — severity minor (verified: not adversarially re-checked; kept minor)
- **Root cause:** `drawScene` does `clearRect` + full repaint (bed, grid, stock, no-go, all objects, overlays, rulers) on every draw-effect run (draw-scene.ts:92-141); the effect fires per relevant store change (Workspace.tsx:248-296) with no rAF coalescing, so two same-tick updates escaping React batching paint twice. `drawGrid` issues one `beginPath`/`stroke` per grid line (draw-scene.ts:226-240, ~300 strokes on a large bed); `strokePolylinesBatched` re-applies the object transform per vertex in JS (draw-vector-strokes.ts:16-24,78-81) instead of `ctx.setTransform`; `liveRasterDataUrls` rebuilds a Set over all objects per frame (draw-scene.ts:93,200-206).
- **Approach:** Lowest-cost wins first, kept to one concern (fewer paints, cheaper grid): (1) batch `drawGrid` into a single `beginPath` (all vertical then all horizontal lines) + one `stroke`; (2) wrap the Workspace draw-effect body in a one-frame rAF coalescer — schedule at most one paint per frame, cancel-and-reschedule on re-entry, flush/cancel on unmount. The offscreen static-layer cache (bed/grid/rulers keyed on view+bed) and `ctx.setTransform`-per-object are noted as a larger follow-up, out of scope here.
- **Files:** `src/ui/workspace/draw-scene.ts` (modify — batch grid), `src/ui/workspace/Workspace.tsx` (modify — rAF coalescer around the draw effect)
- **Tests:** new `src/ui/workspace/draw-scene.test.ts` (or extend draw-preview.test.ts) — assert the grid draws with one `stroke()` (ctx spy). Coalescer: with an injected scheduler, assert two synchronous state changes trigger one paint and the final paint is not dropped.
- **ADR:** none
- **Effort:** M · **Depends on:** none — shares the batched-stroke technique with PRF-08
- **Risk:** rAF coalescing must not drop the final paint and must flush on unmount (test). Preserve the draw-effect's primitive-dep discipline (Workspace.tsx:123-135). No G-code impact.

---

#### Polish (deferred, one-liners)

| finding | one-line fix | effort |
|---|---|---|
| CNC preview scrub recomputes the removal grid from scratch per bucket (use-cnc-removal-grid.ts:21-66) — each new `scrubberT` bucket recomputes the whole ~1M-cell grid from length 0, on the render path, ~4×/s during playback | Make the sim incremental: keep the previous bucket's grid and stamp only the toolpath interval since; recompute from zero only on backward scrub, or move grid computation off-render into an effect + worker | M |

---

## Architecture & code health (cross-cutting) — implementation tickets

Sector grade A-. No criticals. The debt is drift between what the docs claim is *enforced* and what `eslint.config.mjs` + `scripts/` actually enforce. Findings 1 and 3 each decompose into more than one reviewable PR (noted per ticket). Verified corrections to the source findings are called out inline.

---

### ARC-01 · Add a shared `Result<T, E>` type to core (tidy, no behavior change)
- **Fixes:** "Result<T,E> discipline does not exist…" — severity major (verified: CONFIRMED). This is the *tidy-first* half; the behavior change is ARC-02.
- **Root cause:** `grep 'Result<' src/core` = 0 files. Core geometry ops throw user-facing strings for expected user input (`vector-path-booleans.ts:47,59,79,91,114`), which CLAUDE.md's "Pure core" section bans ("return a `Result<T, E>`… no throwing for control flow"). There is no shared type to convert them to; ~46 files hand-roll `{ok:true}`/`{kind:'ok'}` shapes instead.
- **Approach:** Create one pure-core module exporting `type Result<T, E> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'error'; readonly error: E }` plus `ok(value)` / `err(error)` constructors. Match the discriminated-union house style (`kind` tag, so `assertNever` works on the error arm). No consumers in this PR — pure addition, so it lands clean and unblocks ARC-02. Do **not** attempt to migrate the 46 ad-hoc sites here; that is out of scope and would be a batch diff.
- **Files:** `src/core/result.ts` (new); export it from `src/core/index.ts` only if a core barrel exists and is the import convention (verify — do not create a barrel just for this).
- **Tests:** `src/core/result.test.ts` (new) — trivial: `ok(1).kind === 'ok'`, `err('x').error === 'x'`. Type-level only; no behavior to fail-first.
- **ADR:** NEEDED — topic: adopt a canonical `Result<T,E>` for core control-flow errors (records the convention so the 46 ad-hoc shapes converge over time).
- **Effort:** S  ·  **Depends on:** none
- **Risk:** None (additive). Keep the file pure — no DOM/clock/throw.

---

### ARC-02 · Convert vector geometry ops to `Result` and handle the error variant in the store actions
- **Fixes:** "Result<T,E> discipline does not exist…" — severity major (verified: CONFIRMED). The fix half of ARC-01.
- **Root cause:** `combineVectorObjects`/`offsetVectorObjects` (`src/core/geometry/vector-path-booleans.ts:47,59,79,91,114`), `weldVectorObjects` (`vector-path-tools.ts:46,55,72,98`), and `dogboneVectorObject` (`dogbone.ts:36,51,77`) throw for expected user-input conditions. The four store actions swallow them with bare `catch { return state; }` — `vector-path-actions.ts:76-80` (dogbone), `131-135` (weld), `163-167` (boolean), `195-199` (offset) — which is literally CLAUDE.md's banned `try { parseX() } catch { return null }` shape. Nothing in the type system marks these as throwing, so every future caller must rediscover it. The JSDoc at `vector-path-booleans.ts:35-38` ("callers surface the message") is stale — no caller surfaces anything.
- **Approach:** Change the four ops to return `Result<ImportedSvg, VectorOpError>` where `VectorOpError = { readonly kind: 'too-few-objects' | 'open-contours' | 'empty-result' | 'collapsed' | 'no-corners' | 'bad-distance'; readonly message: string }` — preserves today's exact user strings while typing the failure modes. Replace every `throw new Error(msg)` with `return err({ kind, message: msg })` and wrap success in `ok(...)`. In `vector-path-actions.ts`, replace each `try/catch` with an explicit `if (result.kind === 'error') return state;` (behavior stays the documented silent no-op per WORKFLOW.md F-CNC22:2088-2095 — this ticket does **not** change UX, only removes throw-based control flow). Delete the stale JSDoc line. Internal helpers `closedWorldPaths`/`collectClosedRings` that also throw must return `Result` too (or the op catches them at the boundary — prefer threading `Result`).
- **Files:** `src/core/geometry/vector-path-booleans.ts` (modify), `vector-path-tools.ts` (modify — weld only; leave `materializeVectorObject`/`boundsForPaths` alone), `dogbone.ts` (modify), `src/ui/state/vector-path-actions.ts` (modify), and a new `VectorOpError` type (co-locate in `vector-path-tools.ts` or a small `vector-op-error.ts`).
- **Tests:** test-first. In `src/core/geometry/vector-path-booleans.test.ts` add a case: intersect of two disjoint squares returns `{ kind: 'error', error: { kind: 'empty-result' } }` (today it throws → fails first). Mirror in `vector-path-tools.test.ts` (weld of open contours) and `dogbone.test.ts` (no qualifying corners). Add/extend `src/ui/state/vector-path-actions.test.ts` asserting the action returns unchanged state (no thrown exception escapes) on an error result.
- **ADR:** none (ARC-01 carries the ADR).
- **Effort:** M  ·  **Depends on:** ARC-01
- **Risk:** Callers of these ops outside the four actions (grep `combineVectorObjects`, `weldVectorObjects`, `offsetVectorObjects`, `dogboneVectorObject` before editing) must all be updated to the `Result` shape in the same PR or `tsc` breaks — this is what makes it one atomic concern. No G-code snapshot churn (geometry output identical; only the error channel changes).

---

### ARC-03 · Make the 250-line soft limit visible (correct the finding: two ESLint severities cannot stack on `max-lines`)
- **Fixes:** "The 250-line soft tier is fiction…" — severity major (verified: CONFIRMED, with a mechanism correction).
- **Root cause:** `eslint.config.mjs:115` configures a single `max-lines: ['error', 400, {skipBlankLines, skipComments}]`. CLAUDE.md's size table, PROJECT.md non-negotiable 15, and DECISIONS.md ADR-015 all promise a 250 soft tier surfaced as a lint *warning*; it does not exist. 76–81 of ~872 non-test src files exceed 250 counted lines; `io/svg/parse-svg.ts` and `ui/library/DesignLibraryDialog.tsx` sit at ~400 (zero headroom).
- **Correction to the recommendation:** The finding says "add a second `max-lines` entry at warn/250." **That is not achievable** — ESLint keys rules by name; a second `max-lines` config for the same files *replaces* (last-wins), it does not stack, so you cannot have warn/250 AND error/400 on the built-in rule simultaneously. The soft tier must be a separate mechanism.
- **Approach:** Add `scripts/check-soft-line-limit.mjs` mirroring the existing `scripts/check-file-size-policy.mjs` structure (same `walk`, but count *ESLint-style* lines — skip blank and comment-only lines to match the 250 semantics, not raw physical). Emit the list of files >250 counted lines to the CI job summary and **exit 0** (report-only, so it never blocks) — or gate only *new* files over 250 if a ratchet is wanted. Wire it into `package.json` as `check:soft-size` and reference it (non-failing) from `release:check`. Keep the ESLint `error/400` untouched.
- **Files:** `scripts/check-soft-line-limit.mjs` (new), `package.json` (modify — add script).
- **Tests:** docs/build-only tooling; no unit test required (the script is the check). Manually verify it lists the known ~76 files and the two 400-pinned files.
- **ADR:** NEEDED — topic: record that the 250 soft tier is a report-only script (not an ESLint warn tier) because ESLint can't stack severities on `max-lines`; update ADR-015's wording to match.
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Splitting the two 400-pinned files (`parse-svg.ts`, `DesignLibraryDialog.tsx`) is **out of scope** here — those are separate concept-driven `tidy` PRs; flag them as the real hazard (the next edit to either forces an unplanned mid-feature split). Do not batch a file split into this tooling PR.

---

### ARC-04 · Create `core/geometry/index.ts` barrel and route the ui deep-importers through it
- **Fixes:** "index.ts public-API caps… core/geometry has no barrel at all" — severity major (verified: CONFIRMED). One of three concerns split out of this finding (see also ARC-05, ARC-06).
- **Root cause:** `ls src/core/geometry` confirms no `index.ts`. Cross-module consumers must deep-import into geometry internals, violating CLAUDE.md "cross-module imports must go through index.ts". `src/ui/state/vector-path-actions.ts:1-12` deep-imports `../../core/geometry/dogbone`, `.../vector-path-booleans`, `.../vector-path-tools`.
- **Approach:** Add `src/core/geometry/index.ts` re-exporting only the currently cross-module-consumed surface: from `vector-path-booleans` (`combineVectorObjects`, `offsetVectorObjects`, `VectorBooleanOp`), `vector-path-tools` (`isVectorPathObject`, `materializeVectorObject`, `weldVectorObjects`, `VectorSceneObject`), `dogbone` (`dogboneVectorObject`, `DOGBONE_MAX_CORNER_DEG`). Grep every `core/geometry/<file>` import from outside `src/core/geometry/` (ui + any core-other module) and repoint to `../../core/geometry`. Keep the export count comfortably under the 20-symbol ADR-015 cap. Leave intra-geometry imports (e.g. `dogbone.ts` → `vector-path-tools`) as direct module paths — same-module deep imports are fine.
- **Files:** `src/core/geometry/index.ts` (new), `src/ui/state/vector-path-actions.ts` (modify), plus any other outside-geometry importers grep surfaces.
- **Tests:** pure refactor (import-path only, no behavior). Flag as `refactor:` in the PR so the "source-without-test" CI gate is satisfied. Existing geometry tests must stay green.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** ARC-02 recommended to land first (it edits the same import block in `vector-path-actions.ts`; sequencing avoids a conflict) — otherwise none.
- **Risk:** Coordinate ordering with ARC-02 to avoid touching `vector-path-actions.ts:1-12` twice. No `import/no-cycle` risk (barrel re-exports leaf modules).

---

### ARC-05 · Export `raster-budget` and `raster-units` from the raster barrel; retire the deep imports
- **Fixes:** "index.ts public-API caps… ui bypasses barrels" — severity major (verified: CONFIRMED). Second concern split from the finding.
- **Root cause:** `src/core/raster/index.ts` (verified) exports dither/emit/luma/mask/rasterize but **not** `raster-budget` or `raster-units`. 17 occurrences across 11 files deep-import `../../core/raster/raster-budget` / `raster-units` (correcting the finding's "17 ui files" — it is 17 occurrences over 11 files, some tests), e.g. `src/ui/raster/bitmap-conversion-plan.ts`, `src/ui/layers/LayerImageFields.tsx`, `src/ui/app/save-processed-bitmap.ts`.
- **Approach:** Add `export`s for the public symbols of `raster-budget.ts` and `raster-units.ts` to `src/core/raster/index.ts` (read those two files first to export exactly the used symbols, not everything). Repoint the 11 importers from the deep path to `../../core/raster`. Confirm the raster barrel stays under the 20-symbol cap after the additions (it currently has ~11 statements — plenty of headroom).
- **Files:** `src/core/raster/index.ts` (modify), the 11 deep-importers (modify). Enumerate from the grep: `save-processed-bitmap.ts`, `cut-settings-draft.ts`, `CutSettingsImageFields.tsx`, `AdjustImageDialog.tsx`, `AdjustImageDialog.fields.tsx`, `bitmap-conversion-plan.ts`, `processed-bitmap.ts`, `LayerImageFields.tsx` (+ their co-located tests).
- **Tests:** pure refactor; mark `refactor:`. Keep raster tests green.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none
- **Risk:** Low. Do not export internals the barrel wasn't meant to expose — read the two modules and export only what the 11 sites use.

---

### ARC-06 · Add index.ts export-count enforcement (report-only → ratchet) and split the over-cap barrels
- **Fixes:** "index.ts public-API caps (10 soft / 20 hard) are unenforced and heavily violated" — severity major (verified: CONFIRMED). Third and largest concern from the finding.
- **Root cause:** ADR-015 caps public exports at 20 hard / 10 soft "enforced by ESLint" (DECISIONS.md:277), but no rule or script checks it — `scripts/check-file-size-policy.mjs` has no export logic and `package.json release:check` runs no such gate. Verified counts: `src/core/camera/index.ts` = 40 export statements (~86 symbols) in 79 lines, `core/job` 37, `core/scene` 34, `controllers/grbl` 23, `core/devices` 22 — all past the hard cap.
- **Approach (multi-PR — do not batch):**
  1. **PR1 (S):** `scripts/check-index-exports.mjs` mirroring `check-file-size-policy.mjs`: walk `**/index.ts` under `src`, count exported *symbols* (expand `export { a, b, c }` blocks and `export const/function/type X`), and **report** those over 10 (soft) / 20 (hard). Exit 0 for now (report-only) so it lands without first fixing the barrels; wire into `package.json` as `check:index-exports`.
  2. **PR2/PR3/PR4 (L each, ADR NEEDED):** split `core/camera`, `core/job`, `core/scene` barrels along existing sub-domains (camera: calibration / alignment / warp; job: compile / bounds / fill) — each split is its own PR because it re-points many importers and is an architectural change. These are close to their own epic; recommend the maintainer schedule them, not land under duress.
  3. **PR5 (S):** flip `check:index-exports` to `exit 1` on hard-cap violations and add it to `release:check`.
- **Files:** `scripts/check-index-exports.mjs` (new), `package.json` (modify); later `src/core/camera/index.ts`, `src/core/job/index.ts`, `src/core/scene/index.ts` (+ importers).
- **Tests:** tooling; no unit test. The barrel-split PRs are refactors (mark `refactor:`) and must keep the full suite green.
- **ADR:** NEEDED — topic: entry-point export-cap enforcement mechanism + the camera/job/scene barrel decomposition (each split records the new sub-module boundaries).
- **Effort:** L (overall)  ·  **Depends on:** ARC-04, ARC-05 (so `core/geometry` and `core/raster` are barrel-clean before the gate goes live)
- **Risk:** The barrel splits touch many files and risk `import/no-cycle` if sub-barrels re-cross; keep leaf modules acyclic. Report-only PR1 is safe to land immediately.

---

### ARC-07 · Delete the four orphan modules and reconcile the four dead controller barrels
- **Fixes:** "Eight verifiably dead modules…" — severity minor (verified: CONFIRMED by import-graph grep this session).
- **Root cause:** Grep confirms zero importers for `src/ui/laser/LaserLog.tsx` (only comment refs at `use-active-job-wake-lock.ts:4`, `LaserWindow.tsx:241`), `src/core/trace/edge-reconnect.ts`, `src/io/project/project-validator-primitives.ts`, `src/ui/layers/material-library-panel-test-helpers.tsx`. Separately, `src/core/controllers/{marlin,smoothieware,fluidnc,grblhal}/index.ts` are never imported — `select-controller-driver.ts:7-12` and `controllers/index.ts:23-27` reach directly into `./<driver>/driver`. (Correctly excludes `ruida/index.ts`, which *is* imported by `io/rd/emit-rd.ts` — verified.)
- **Approach (two PRs):**
  1. **Orphan deletion:** delete the four orphan files. Per CLAUDE.md "let the maintainer choose", `LaserLog.tsx` is the one judgment call — confirm `ConsolePanel.tsx` fully supersedes its GRBL-console role before deleting (or re-wire it if it was meant to ship); the ticket should surface this as a decision, not silently delete.
  2. **Controller-barrel convention:** pick ONE convention and apply it — either delete the four unused sub-barrels, or route `select-controller-driver.ts` + `controllers/index.ts` imports through them. Align the choice with ARC-06's entry-point enforcement (prefer routing-through-barrel if ARC-06 lands; prefer deletion otherwise).
- **Files:** delete `src/ui/laser/LaserLog.tsx`, `src/core/trace/edge-reconnect.ts`, `src/io/project/project-validator-primitives.ts`, `src/ui/layers/material-library-panel-test-helpers.tsx`; modify or delete `src/core/controllers/{marlin,smoothieware,fluidnc,grblhal}/index.ts` + `select-controller-driver.ts` + `controllers/index.ts`.
- **Tests:** dead-code removal is a pure refactor (mark `refactor:`); no test needed (nothing imports them). Confirm `tsc`, `pnpm test`, and the Worker-URL load paths still resolve after deletion.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** ARC-06 (only for the barrel-convention half, to stay consistent) — orphan deletion depends on nothing.
- **Risk:** LaserLog re-wire vs delete is the only ambiguity; everything else is provably unreferenced.

---

### ARC-08 · Move AppState's ~120 inline members into their owning slice files (store.ts → pure composition)
- **Fixes:** "AppState is a ~200-member god-interface…" — severity minor (verified: no adversarial verdict; reproduces from `store.ts:132-318` intersection + `425-466` 38 spreads).
- **Root cause:** `src/ui/state/store.ts` composes 38 slice factories but also declares ~120 state members and action signatures inline in the `AppState` intersection (`:155-318`), making `store.ts` a mandatory edit for every feature while it sits ~19 counted lines under the 400 hard cap. Slices can't import `AppState` (circular), so each action file re-declares the subset it touches as a structural type (`vector-path-actions.ts:34-39` `VectorPathState`, `scene-mutations.ts:44-47` `StateSlice` "Restating just the fields used") — duplication that can silently drift.
- **Approach:** For each slice that currently has inline members in `store.ts`, move those member declarations into the slice's own file as an exported `type XState` (state) alongside its existing `type XActions`, then have `AppState` intersect `XState & XActions` instead of listing members. `store.ts` becomes near-pure composition. Do this **one slice per PR** (e.g. registration/board members first, then clipboard/group, then layers) — never all 120 at once. This is the enabler for later carving big domains (layers, board, clipboard) into sub-stores like `laser`/`ui`/`camera` already are.
- **Files:** `src/ui/state/store.ts` (modify, shrinks each PR) + the one slice file being migrated per PR.
- **Tests:** pure refactor per slice (mark `refactor:`); the type system is the guard — `tsc` must stay green and the store's runtime shape unchanged. Add a `store.test.ts` assertion that `useStore.getState()` exposes the migrated action if not already covered.
- **ADR:** none (mechanical; if you go further and carve a sub-store, that carve is ADR-worthy — flag separately).
- **Effort:** L (many small PRs)  ·  **Depends on:** none
- **Risk:** `exactOptionalPropertyTypes`/`readonly` mismatches when relocating member types; migrate incrementally so a regression is one slice wide. The structural re-declaration duplication (`VectorPathState` etc.) is only *reducible* here, not fully removable, without a sub-store.

---

### ARC-09 · Guard the frame-vs-job bounds mirror with a property test; then DRY the AABB/clamp primitives
- **Fixes:** "Geometry/math micro-duplication…" — severity minor (verified: no verdict; `clamp` confirmed verbatim in 6 core files — `trace-boundary.ts:78`, `canny-gradient.ts:120`, `edge-trace.ts:103`, `camera-profile.ts:340`, `compile-job-raster.ts:204`, `object-power-scale.ts:33`; `MutableBounds`+infinity-init+extend in `job-bounds.ts:28,46-51,174-182` and `frame-bounds.ts:29,121-141`).
- **Root cause:** No shared numeric/geometry primitives module. The riskiest instance: `computeFrameBounds` (`frame-bounds.ts:1-6`) *hand-mirrors* `compileJob`'s layer/object inclusion rules — if they drift, Frame traces a different area than the burn, and only comments keep them aligned.
- **Approach (two PRs, higher-value first):**
  1. **PR1 (test-first, the real value):** add a property/corpus test asserting the frame area and the compiled-job burn bounds stay consistent across the fixture corpus. **Caveat the invariant before coding:** `computeFrameBounds` uses raw object AABBs while `computeJobBounds` uses actual cut/fill/raster segments, so strict `frame ⊆ job` may not hold for fills/rasters — validate against fixtures and pick the invariant that actually holds (likely `frame ⊆ computeJobMotionBounds` within tolerance, or bidirectional near-equality on line-only scenes). The test is the drift alarm the comment currently substitutes for.
  2. **PR2 (tidy):** add `src/core/geometry/aabb.ts` (`Bounds` + `emptyBounds`/`extendPoint`/`union`/`center`) and a single shared `clamp` in a core numeric-utils module; migrate the 6 clamp sites and the `MutableBounds` re-implementations. Pure refactor.
- **Files:** PR1: `src/core/job/frame-bounds.test.ts` (new) reusing the fixture corpus. PR2: `src/core/geometry/aabb.ts` (new), `src/core/math/clamp.ts` (new), + the 6 clamp files and `job-bounds.ts`/`frame-bounds.ts`/`island-fill.ts` (modify).
- **Tests:** PR1 is the test (fail-first only if a real drift exists today — otherwise it is a regression guard, which is acceptable and should be stated as such in the PR). PR2 keeps existing tests green.
- **ADR:** none.
- **Effort:** M  ·  **Depends on:** ARC-04 (PR2's `aabb.ts` should be reachable via the geometry barrel).
- **Risk:** PR1's invariant must be empirically chosen, not assumed, or it will be flaky/wrong. No G-code change in either PR.

---

### ARC-10 · Model the laser store's mutually-exclusive operations as one discriminated union
- **Fixes:** "Laser store models mutually-exclusive operations as five parallel fields…" — severity minor (verified: no verdict; reproduces from `laser-store.ts:96-101`).
- **Root cause:** `LaserState` carries `autofocusBusy: boolean` (`:96`), `probeBusy: boolean` (`:98`), `motionOperation` (`:99`), `controllerOperation` (`:100`), `streamer` (`:101`) side by side. Their mutual exclusion is enforced only at runtime by guard helpers (`assertAutofocusIdle`, `motionOperationCommandBlockMessage`, `activeJobCommandBlockMessage` in `laser-store-helpers.ts`; `controllerOperationCommandBlockMessage`). Illegal states like `probeBusy && streamer !== null` are representable — exactly the N-states-of-one-thing case CLAUDE.md's discriminated-union rule targets, in the app's most safety-sensitive store.
- **Approach:** Introduce `activeOperation: { kind: 'idle' } | { kind: 'autofocus' } | { kind: 'probe' } | { kind: 'motion'; op: LaserMotionOperation } | { kind: 'controller'; op: LaserControllerOperation } | { kind: 'job'; streamer: StreamerState }`, replacing the five fields. Collapse the guard helpers into one exhaustive `switch (state.activeOperation.kind)` with `assertNever`. Every action that reads/writes those five fields (connection, jog, probe, job, autofocus, override, setup actions) must migrate together.
- **Files:** `src/ui/state/laser-store.ts` + `laser-store-helpers.ts` + every laser action slice that touches the five fields (grep `autofocusBusy|probeBusy|motionOperation|controllerOperation|\.streamer`). Large surface.
- **Tests:** test-first — add `laser-store-helpers.test.ts` cases asserting a `probe` active-op blocks jog/autofocus/job-start (the current guard behavior) via the new union, and that no two operations can be active. Then migrate.
- **ADR:** NEEDED — topic: unify laser live-operation state into one discriminated union (state-model change to the safety-critical store; records the illegal-states-unrepresentable rationale).
- **Effort:** L (corrected from the finding's M — this touches every laser action + all guards and is safety-critical)  ·  **Depends on:** none
- **Risk:** **High** — this is the store that gates Stop/Pause/beam-on safety. Green tests will NOT prove it works (per CLAUDE.md rule 2); requires the maintainer's hardware/perceptual pass before merge. Recommend deferring behind the higher-confidence tickets. Note it interacts with ARC-12 (same file's mutable `refs`).

---

### ARC-11 · Fix CLAUDE.md doc drift: drop the false Immer claim (component-limit sub-claim is refuted)
- **Fixes:** "CLAUDE.md doc drift: Immer… + 150/250 React-component limits are unreachable" — severity minor (verified: PARTIAL — the Immer half CONFIRMED; the component-limit half REFUTED, see below).
- **Root cause (confirmed half):** CLAUDE.md "Mutable state" says use "`produce` from Immer (already a Zustand dependency)". `immer` is only an *optional* peer of zustand and `node_modules/immer` is **absent** (verified this session) — following the doc yields an unresolvable import. This is a hard doc-vs-tree contradiction, which CLAUDE.md itself says must stop a session.
- **Correction (refuted half):** The finding claims the "150 soft / 250 hard React-component" limits are dead because `max-lines-per-function` is 80. That conflates *file* and *function*: the 150/250 row governs a component **file** (which can hold an ≤80-line main function plus sub-component helpers), not a single 150-line function. So the row is a tighter *unenforced soft target* — the same category as ARC-03's 250 file-soft tier — not an impossibility. Do **not** rewrite it as "dead"; at most add a clarifying note that it is an unenforced soft target and that any single component function is still capped at 80 lines.
- **Approach:** Edit CLAUDE.md "Mutable state" section: change the Immer sentence to spread-only (matching actual practice — the whole store uses spreads, zero `produce` calls) OR, if the maintainer prefers, add `immer` as a real dependency. Recommend spread-only (no new dependency). Optionally add the one-line clarification to the component-limit row. If DECISIONS.md ADR-015 or PROJECT.md restate the Immer claim, align them in the same PR.
- **Files:** `CLAUDE.md` (modify); check `DECISIONS.md`/`PROJECT.md` for a mirrored Immer claim (grep `Immer`) and align if present.
- **Tests:** docs-only, no test.
- **ADR:** none.
- **Effort:** S  ·  **Depends on:** none
- **Risk:** EOL trap — `.md` is prettier-ignored; preserve the file's existing CRLF/LF endings (edit in place, verify `git diff --stat` shows only the intended lines, not a whole-file EOL flip).

---

### ARC-12 · Record (or eliminate) the module-level mutable `LiveRefs` — the ADR-050 exception gap
- **Fixes:** "[Codex M-25] Store ownership and subscription boundaries…" — severity minor (verified: CONFIRMED for the LiveRefs half; the "CommandShell broad subscription" sub-claim had no file:line in the verdict and is not verified in this planning pass — scope this ticket to LiveRefs).
- **Root cause:** `laser-store.ts:236-249` declares a module-level `const refs: LiveRefs` whose non-readonly fields (`connection`, `driver`, `unsubscribeLine/Close`, `pollHandle`, `settingsCollector`, `nextTranscriptId`, `stallProbe`, + lifecycle/reset-cleanup fields) are mutated after construction across ≥6 files (`laser-connection-actions.ts:51-52,76,81,194,204-213,221,225`; `grbl-settings-actions.ts`; `laser-line-handler.ts:246`; `detected-settings-action.ts`; `laser-console-actions.ts`; `laser-setup-actions.ts`). CLAUDE.md bans module-level mutable state outside Zustand slices, and DECISIONS.md ADR-050 (~lines 2641-2691) states "Any other module-level mutable still violates the rule and needs its own ADR" — no ADR covers `LiveRefs` (grepped). ESLint does not catch this (the object binding is `const`; only its fields mutate), so it is a convention violation, not a lint failure.
- **Approach:** Two honest options; the ticket should present both and let the maintainer choose (the restructure is high-risk on the live serial path):
  1. **Low-risk (recommended):** write an ADR recording `LiveRefs` as a *deliberate, justified* module-level-mutable exception (these hold the live `SerialConnection`, active `ControllerDriver`, `setInterval` handle, and unsubscribe callbacks — genuinely non-React-observable lifecycle state that must not trigger re-renders, exactly ADR-050's rationale). Add a comment at `laser-store.ts:236` pointing to the new ADR.
  2. **Higher-risk (optional):** move `refs` inside the `create<LaserState>((set, get) => …)` factory closure so it is per-store-instance rather than module-global, threading it to the action factories (they already receive `refs` as a parameter). This removes the module-level binding without changing behavior — but touches the store bootstrap of the safety-critical laser path.
- **Files:** `DECISIONS.md` (new ADR) + `src/ui/state/laser-store.ts:236` (comment) for option 1; additionally `laser-store.ts` factory wiring for option 2.
- **Tests:** option 1 is docs-only. Option 2 is a refactor — the existing laser-store/action tests must stay green and (per CLAUDE.md rule 2) it needs the maintainer's live/hardware verification since it reshapes the serial lifecycle.
- **ADR:** NEEDED — topic: `LiveRefs` module-level mutable as a documented exception under ADR-050's rule (or its removal).
- **Effort:** S (option 1) / M (option 2)  ·  **Depends on:** none (but shares `laser-store.ts` with ARC-10 — sequence them)
- **Risk:** Option 2 touches beam-safety lifecycle; prefer option 1 unless the maintainer wants the structural change. The CommandShell sub-claim is unscoped here — recommend a separate investigation ticket if the maintainer wants it pursued.

---

#### Polish (deferred, one-liners)

| finding | one-line fix | effort |
|---|---|---|
| Lint warnings are invisible to CI (`pnpm lint` = bare `eslint .`, no `--max-warnings`) | Change `package.json:15` to `eslint . --max-warnings 0` (repo currently has zero warnings) and ratchet, or print a warning-count line in the CI summary so soft-tier drift becomes visible. Pairs with ARC-03. | S |

---

## Test & CI quality — implementation tickets

### TST-01 · Enforce the G-code snapshot-acknowledgment gate in CI
- **Fixes:** "Snapshot change acknowledged / source-without-tests gates are claimed as CI-enforced but are convention-only" — severity major (verified: CONFIRMED)
- **Root cause:** `.github/workflows/ci.yml:16-46` is one job whose only gate is `pnpm release:check` (package.json:27), which chains guard/typecheck/lint/format/license/audit/test/build/file-size — none reads the PR body or diffs `.snap` files. CLAUDE.md:176 promises CI rejects an unacknowledged G-code snapshot change; nothing does. The snapshot corpora that matter (`src/io/gcode/__snapshots__/emit-gcode.snapshot.test.ts.snap`, `emit-gcode-layer-settings.snapshot.test.ts.snap`, and the Phase-A `src/io/svg/__snapshots__/pipeline.snapshot.test.ts.snap`) can be re-recorded and merged silently.
- **Approach:** Add a `pull_request`-only step/job to ci.yml (guarded `if: github.event_name == 'pull_request'`): `git fetch --no-tags origin ${{ github.base_ref }}`, then `git diff --name-only origin/${{ github.base_ref }}...HEAD`; if any changed path matches `__snapshots__/.*\.snap$`, require `${{ github.event.pull_request.body }}` to contain the literal `Snapshot change acknowledged:` and `exit 1` otherwise. Keep it a tiny shell step so it fails fast and independently of `release:check`. Push-to-main has no PR body, so the guard skips there (parity with existing review flow).
- **Files:** `.github/workflows/ci.yml` (modify); optionally `scripts/check-snapshot-ack.mjs` (new) if the shell grows past a few lines (honor the file-size posture by extracting).
- **Tests:** docs-only for product code; the workflow is self-verifying. If a script is extracted, co-locate `scripts/check-snapshot-ack.test.mjs` asserting the diff+body predicate over fixture inputs.
- **ADR:** NEEDED — "G-code snapshot changes require an acknowledgment line, enforced in CI (which snapshot globs, PR-event only)."
- **Effort:** S · **Depends on:** none
- **Risk:** `base_ref` only exists on `pull_request`; fork PRs still expose `pull_request.body`. Do NOT gate on push (no body). Scope the glob to snapshot dirs so ordinary `.snap` churn elsewhere isn't caught. Once landed, CLAUDE.md:176 becomes true — no doc change needed for that line.

### TST-02 · Correct CLAUDE.md's "CI rejects source without tests" claim to match reality
- **Fixes:** same finding (major, CONFIRMED) — the second, non-mechanically-enforceable half
- **Root cause:** CLAUDE.md:175 states "CI rejects PRs that: Modify source without modifying or adding tests." No CI step does this (it is a semantic judgment CI can't make reliably), and PROJECT.md #16 (PROJECT.md:271) already says honestly "CI does not enforce a strict sibling rule … PR review rejects untested source changes." CLAUDE.md contradicts its own companion doc.
- **Approach:** Edit CLAUDE.md:174-175 so the source-without-tests line reads "PR review rejects" rather than "CI rejects," matching PROJECT.md:271 and CLAUDE.md:169. Leave the snapshot line (176) as-is since TST-01 makes it true; if TST-01 is declined, soften 176 the same way here instead.
- **Files:** `CLAUDE.md` (modify, lines 174-176 heading + first bullet).
- **Tests:** docs-only, no test.
- **ADR:** none
- **Effort:** S · **Depends on:** TST-01 (if TST-01 lands, keep line 176 as "CI rejects"; if not, this ticket softens 176 too)
- **Risk:** Docs-only. CRLF/EOL trap — CLAUDE.md is prettier-ignored; preserve existing line endings (edit in place, don't reflow).

### TST-03 · Add a perceptual fidelity test for Image-mode raster engrave
- **Fixes:** "Raster engrave (Image mode) has zero perceptual coverage" — severity major (verified: PARTIAL → confirmed major; the surviving kernel is exactly "no IoU/orientation instrument on raster output")
- **Root cause:** Raster has property tests for laser-off/determinism/bounds (`src/core/raster/emit-raster.property.test.ts:57-144`) and one 2×2 byte-pinned fixture (`src/io/gcode/emit-gcode.snapshot.test.ts:101-118`), but nothing rasterizes emitted raster G-code back to a mask and compares it to the source luma. An inverted-luma / mirrored-row / dither-mapping regression stays green and shows only as churn on the 2×2 snapshot — churn that (pre-TST-01) needs no acknowledgment.
- **Approach:** New perceptual test reusing existing instruments. Build a `raster-image` `SceneObject` (like `rasterObject`, emit-gcode.snapshot.test.ts:103-118) with a *larger, asymmetric* luma (e.g. an "F"-glyph or a monotone gradient) on an image-mode layer with `dither: 'threshold'` (binary → exact analytic truth). Run the shipped `emitGcode`, parse the output with `rasterizeGcodeBurn` (`src/__fixtures__/perceptual/gcode-rasterize.ts:28` — already handles M4-armed G1 with modal S>0), and `compareMasks` (compare.ts) against the threshold of the source luma. Assert `iou >= 0.9` AND a specific asymmetric pixel (e.g. top-left ink, bottom-right blank) to catch mirror/inversion that IoU alone can miss. Use `origin: 'rear-left'` (no machine-Y flip, per toolpath-rasterize.test.ts:24) so the source row-major frame maps straight into the mask frame.
- **Files:** `src/__fixtures__/perceptual/raster-image.test.ts` (new). Optional tiny truth helper `raster-truth.ts` (new) if the luma-threshold mask builder exceeds ~15 lines.
- **Tests:** this IS the test (perceptual, test-only addition). No product change unless it exposes a real orientation/inversion bug — then follow bug-fix workflow (the failing perceptual assertion is the demonstrator) and fix in `src/core/raster/`.
- **ADR:** none (extends the ADR-025 harness with its established pattern)
- **Effort:** M · **Depends on:** none
- **Risk:** Truth mask must match the dither module's exact threshold mapping — use pure threshold (not diffusion) so the truth is analytic. `rasterizeGcodeBurn` inks whole burn segments, so grayscale would blur the comparison; keep the fixture binary. Not verified: I have not confirmed the emitted raster orientation is correct — this test is precisely the instrument that would confirm it.

### TST-04 · Parametrize the strategy property suite over Marlin + Smoothieware
- **Fixes:** "Marlin and Smoothieware dialects get one laser-off fixture each; GRBL gets 100-seed fuzz" — severity major (verified: CONFIRMED)
- **Root cause:** `marlin-strategy.test.ts:62-65` and `smoothieware-strategy.test.ts:45-48` each run `findLaserOnTravelIssues` on exactly one hand-built job; neither imports fast-check, and `grbl-strategy.property.test.ts:110-236` (100-seed determinism/laser-off/bounds over `arbJob`/`arbMixedJob`) never routes to the other dialects. Laser-on-travel is fire-safety invariant #3; a Marlin fan-mode (M106/M107) regression on some input class passes CI green.
- **Approach:** Tidy-first (separate PR, no behavior change): extract `arbJob`, `arbMixedJob`, `arbSegment`, `arbFillSpan` from grbl-strategy.property.test.ts into a shared arbitraries module (e.g. `src/core/output/__fixtures__/job-arbitraries.ts`) and re-import them in the GRBL suite. Then add `marlin-strategy.property.test.ts` and `smoothieware-strategy.property.test.ts` running the determinism (#5), laser-off (#3), and bounds (#1) fuzz over each strategy's `.emit`. The `findLaserOnTravelIssues` predicate already understands M107 (`predicates.ts:46-49,62`), so marlin-fan output validates unchanged. Power-scale (#7) stays dialect-specific (marlin S/255, smoothie fractional) — assert it with each dialect's known expected S rather than the shared GRBL expectation.
- **Files:** `src/core/output/__fixtures__/job-arbitraries.ts` (new, tidy PR); `src/core/output/grbl-strategy.property.test.ts` (modify to import shared arbs, tidy PR); `src/core/output/marlin-strategy.property.test.ts` (new); `src/core/output/smoothieware-strategy.property.test.ts` (new).
- **Tests:** the new property files are the deliverable; the tidy PR must keep GRBL suite byte-green (pure refactor, flag as such for PR review).
- **ADR:** none
- **Effort:** M · **Depends on:** none (tidy extraction lands first, then this)
- **Risk:** marlin-fan strips S from motion lines and uses M106/M107 — the bounds/determinism props are S-agnostic and fine; only the power-scale assertion must branch per dialect. Keep arbitraries in a `__fixtures__` file so the boundary/import lint stays satisfied (core←core only).

### TST-05 · Add Marlin + Smoothieware device fixtures to the emitGcode snapshot corpus
- **Fixes:** same finding (major, CONFIRMED) — the byte-pinning half
- **Root cause:** The production-composition snapshot corpus (`emit-gcode.snapshot.test.ts:184-189`) uses `createProject()`'s default GRBL device (line 39-41), so `emitGcode` → `selectOutputStrategy` never routes to Marlin/Smoothie in any byte-pinned output; a silent emitter change in those dialects produces zero snapshot churn.
- **Approach:** Add two CORPUS entries: a Marlin-fan-device project and a Smoothie-device project (set `device.controllerKind` + `maxPowerS`/dialect as in marlin-strategy.test.ts:34-44 and smoothieware-strategy.test.ts:31-35, over the existing `lineObject`/`donutObject` geometry). They flow through the same `describe` snapshot loop AND the invariants loop (laser-off / in-bed / determinism, lines 206-225), so they gain both byte-pinning and free invariant coverage.
- **Files:** `src/io/gcode/emit-gcode.snapshot.test.ts` (modify — add `marlinProject`/`smoothieProject` builders + CORPUS entries); `src/io/gcode/__snapshots__/emit-gcode.snapshot.test.ts.snap` (regenerated — new entries).
- **Tests:** the fixtures are the test; regenerate snapshots via `vitest -u` and eyeball the new Marlin M106/M107 and Smoothie fractional-S output for sanity before committing.
- **ADR:** none
- **Effort:** S · **Depends on:** none (independent of TST-04; pairs with it). Once TST-01 lands, this PR's snapshot addition needs `Snapshot change acknowledged: new Marlin/Smoothie dialect fixtures` in the body.
- **Risk:** New snapshot content (additions, not mutations) but still governed by the snapshot-ack convention/gate. Verify `emitGcode` actually honors `device.controllerKind` routing (the finding asserts it does — confirm the added fixtures produce M106/fractional-S, not GRBL, output).

### TST-06 · Add a minimal browser-level E2E smoke harness for the canvas golden paths
- **Fixes:** "No browser-level/E2E test harness at all — jsdom canvas is a no-op stub" — severity major (verified: CONFIRMED)
- **Root cause:** All 653 src tests run under vitest+jsdom (`vitest.config.ts:12`), and `src/__fixtures__/jsdom-canvas-setup.ts:50-119` installs a Proxy no-op 2D context (all draw calls silently succeed, `getImageData` returns zeroed pixels). Glob confirms no `playwright.config.*`, no `e2e/`, and package.json:54-83 has no browser-test dep. The canvas workspace — the primary UI surface — can regress to blank/garbled while every test stays green.
- **Approach:** Introduce a smoke-level Playwright harness (new top-level `e2e/`, its own config, added to devDependencies) exercising 3-4 WORKFLOW.md golden paths against the dev/preview build: (1) import a fixture SVG → assert an object node appears on the canvas/scene; (2) assign a layer; (3) Save G-code → assert a non-empty file/download. Add at least one workspace screenshot-diff to catch blank-canvas regressions (real Chromium renders canvas, unlike jsdom). Run it as a *separate, non-release-gating* CI job initially (keep `release:check` unchanged) so flakiness can't block deploys while the harness stabilizes. Honor collaboration rule 4: the harness must drive throwaway fixtures and its own dev-server instance, never the maintainer's live scene.
- **Files:** `e2e/` (new dir: `import-to-gcode.spec.ts`, fixtures); `playwright.config.ts` (new); `package.json` (add `@playwright/test` devDep + `test:e2e` script); `.github/workflows/e2e.yml` (new, non-blocking) or a new non-gating job in ci.yml.
- **Tests:** the specs are the deliverable. No product source change; if a spec exposes a real render regression, that's a separate bug-fix PR.
- **ADR:** NEEDED — "Adopt Playwright as a smoke-level E2E layer; scope, dev-server hygiene, and whether it gates deploy."
- **Effort:** L · **Depends on:** none. Cross-cutting: coordinate with any epic touching CI job structure (see TST-12) to avoid two conflicting ci.yml rewrites.
- **Risk:** New tooling + browser download in CI (cost on 2-vCPU). `e2e/` sits outside `src/`, so module-boundary/size lint doesn't apply — confirm eslint `include` doesn't sweep it unintentionally. Keep it non-gating until green-stable. Not verified: this introduces a capability that does not exist yet; the harness itself must be perceptually reviewed by the maintainer per rule 2.

### TST-07 · Test the Save path's "no partial output" preflight early-return (invariant #4)
- **Fixes:** "PROJECT.md #13 overstated; Save-path 'no partial output' has no test" — severity minor (verified: no adversarial verdict; reproduced directly)
- **Root cause:** `src/ui/app/file-actions.ts:142-147` early-returns with a `jobAwareAlert` when `emitSaveGcode`'s preflight fails, before any picker/write — implementing non-negotiable #4 (PROJECT.md:256). But `file-actions.test.ts` has no case for it: grep for `preflight` there returns nothing, and the Start path is the only side tested (`start-job-readiness.test.ts:221`).
- **Approach:** Add a `file-actions.test.ts` case using the existing `mockPlatform`/`toasts` harness (lines 19-34, 201-238 show the pattern): build a project whose geometry lies outside the bed so `emitGcode` preflight returns `ok:false` (e.g. a line at `x: 999999`), pass `save = vi.fn(async () => null)`, spy `window.alert` (jobAwareAlert wraps it), call `handleSaveGcode`, then assert `save` was never called and the alert fired with the "Cannot save G-code" copy. This pins the invariant #4 early-return against regression.
- **Files:** `src/ui/app/file-actions.test.ts` (modify — one new `it`).
- **Tests:** this is a test-only addition (the code is correct); no product change. Not a "source without tests" case.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** Confirm `jobAwareAlert` routes to `window.alert` in the test env (it may proxy through a store — if so, spy the `job-aware-dialogs` module instead). Choose out-of-bed coords that reliably trip preflight, not a different error path.

### TST-08 · Add origin round-trip (#2) and unit-scale (#6) property tests; footnote PROJECT.md #13
- **Fixes:** same finding (minor) — the "invariants 2/6 example-tested only" and "#13 overstated" parts
- **Root cause:** #2 origin honesty is example-tested only (`origin-transform.test.ts` covers the five origins by example); #6 units honest has no sibling property test for `svg-units.ts`. PROJECT.md:268 claims "All invariants property-tested," which is not literally true (2/4/6 are example-based; #4 is inherently not a natural property).
- **Approach:** (a) `origin-transform.property.test.ts` — fast-check that `toSceneCoords(toMachineCoords(p, dev), dev) ≈ p` for arbitrary origin ∈ the five variants, arbitrary in-bed point, arbitrary bed size (the inverse is exact per origin-transform.ts:32-47). (b) `svg-units.property.test.ts` — fast-check the scale laws of `parseSvgLengthMmOrNull` (svg-units.ts:76-86): `mm→v`, `cm→10v`, `in→25.4v`, `pt→25.4v/72`, `px/unitless→v*25.4/96`. (c) In the same PR, footnote PROJECT.md:268 that #4 (no partial output) is example-tested by nature, so the claim reads honestly. Origin test lives in pure core; units test in io.
- **Files:** `src/core/devices/origin-transform.property.test.ts` (new); `src/io/svg/svg-units.property.test.ts` (new); `PROJECT.md` (modify line 268 footnote).
- **Tests:** the property files are the deliverable.
- **ADR:** none
- **Effort:** S · **Depends on:** TST-07 (same finding; land together or sequentially). PROJECT.md edit: preserve CRLF (prettier-ignored).
- **Risk:** `center` origin is not its own inverse (origin-transform.ts:42-43,64-67) — the round-trip property must use the real `toSceneCoords`, not re-apply `toMachineCoords`. Floating-point: assert within a small epsilon, not equality.

### TST-09 · Close the local-green/CI-red prettier trap in session hygiene
- **Fixes:** "`pnpm lint` does not include the repo-wide prettier check that gates CI" — severity minor
- **Root cause:** CI runs `pnpm release:check` → `pnpm format:check` (`prettier --check .`, package.json:20,27), but `pnpm lint` is `eslint .` only (package.json:15) and CLAUDE.md's Session hygiene (CLAUDE.md:304-308) tells agents to run only test/lint/typecheck — none catches a formatting violation in `.md`/`.yml`/`.json` that eslint never sees. Following the documented checklist can push a CI-red (and, on main, deploy-blocking) commit.
- **Approach:** Docs-first (safest, zero script-semantics change): add `- Run \`pnpm format:check\` before declaring work done.` to CLAUDE.md's Session hygiene list (after line 307). This mirrors the exact gate CI runs. (Alternative considered and rejected as a separate concern: folding `prettier --check .` into the `lint` script would double lint time and duplicate the `format:check` step already in `release:check` — do not batch that here.)
- **Files:** `CLAUDE.md` (modify, Session hygiene bullet list ~line 307).
- **Tests:** docs-only, no test.
- **ADR:** none
- **Effort:** S · **Depends on:** none
- **Risk:** Docs-only. CLAUDE.md is prettier-ignored — preserve CRLF; add the bullet in place.

### TST-10 · Move the blocking dependency audit out of the per-PR release gate
- **Fixes:** "`pnpm audit --audit-level=low` sits inside the PR gate, before tests" — severity minor
- **Root cause:** `release:check` (package.json:27) runs `pnpm audit:deps` (`pnpm audit --audit-level=low`, package.json:25) as step 7, before `pnpm test`, with `&&` chaining. Any newly-published advisory — even severity low — against any transitive dep turns every PR, every main push, and the CI-gated Cloudflare deploy red, unrelated to the diff, and masks the test signal (tests never run) for that run. No DECISIONS.md ADR records this placement as deliberate.
- **Approach:** Remove `pnpm audit:deps` from the `release:check` chain and run it in a dedicated scheduled workflow (`.github/workflows/audit.yml`, weekly cron) that surfaces findings (job annotation or an opened issue) without blocking PRs/deploys. Keep the `audit:deps` script for local/manual use. This decouples upstream-advisory timing from code-review CI. (Alternatives: run after tests with `continue-on-error`, or keep blocking at `--audit-level=high` with a `pnpm.auditConfig` allowlist — call out in the ADR.)
- **Files:** `package.json` (modify `release:check` — drop `pnpm audit:deps &&`); `.github/workflows/audit.yml` (new, scheduled).
- **Tests:** docs/CI-only; no product test.
- **ADR:** NEEDED — "Dependency audit is non-blocking / scheduled, not part of the PR release gate."
- **Effort:** S · **Depends on:** none. Note: `deploy:web`/`deploy:web:preview` (package.json:39-40) also call `release:check` — removing audit from the chain intentionally unblocks deploys the same way; confirm that's desired in the ADR.
- **Risk:** Weakens per-PR supply-chain signal by design; the scheduled leg must be visible enough that lows aren't ignored forever. Deploy parity: since deploy reuses `release:check`, verify no separate deploy-time audit assumption exists.

### TST-11 · Add a scheduled Windows CI leg so platform drift is caught between releases
- **Fixes:** "PR CI runs on Linux only; the Windows target is only exercised at release-tag time" — severity minor
- **Root cause:** `ci.yml:19` runs `ubuntu-latest` for every PR/push; `release-desktop.yml:16-19,31` re-runs `release:check` on `windows-latest` but only on `v*` tags or manual dispatch. CRLF/path-separator/case-sensitivity differences (the repo already normalizes `\r\n` explicitly in `scripts/check-file-size-policy.mjs:30`) therefore surface at the most expensive moment.
- **Approach:** Add a `windows-latest` job running `pnpm release:check`, triggered on a weekly `schedule` (cron) and/or a `windows` PR label — NOT on every PR (avoid doubling CI cost on the 2-vCPU plan). Reuse the exact setup steps from ci.yml (pnpm/action-setup@v4, node 22, frozen-lockfile install). This catches platform drift between releases cheaply.
- **Files:** `.github/workflows/ci.yml` (add a conditional `windows` job) or `.github/workflows/ci-windows.yml` (new).
- **Tests:** CI-only; no product test.
- **ADR:** none
- **Effort:** S · **Depends on:** none. Overlaps with TST-12 (CI job structure) — coordinate to avoid conflicting ci.yml edits.
- **Risk:** Scheduled runs use the default branch; a label-trigger needs `pull_request` `labeled` event wiring. Windows `release:check` includes both builds — longer wall-clock, acceptable off the PR hot path.

### TST-12 · Split the monolithic CI job into parallel fail-fast jobs
- **Fixes:** "Single monolithic CI job serializes 11 gates; one early failure hides all downstream signal" — severity minor
- **Root cause:** The whole gate is one `pnpm release:check` invocation (package.json:27) with `&&` chaining, so a prettier or audit failure teaches the author nothing about tests or build, and `check:file-size` (the 600-raw-line backstop) runs dead last after the ~4k-test suite and two builds. Combined with `maxWorkers:1` on CI (`vitest-workers.ts:12`) and always-on perceptual tests carrying 120s timeouts (`arch-house-baseline.test.ts:25-27`, `trace-benchmark-loop.test.ts:11-13`), feedback is slow and all-or-nothing.
- **Approach:** Split ci.yml into 2-3 parallel jobs sharing the install/cache: (a) static — `guard:repo` + `typecheck` + `lint` + `lint:electron` + `format:check` + `license-check` + `check:file-size`; (b) tests — `pnpm test`; (c) builds — `build:web` + `build:electron-main`. Each fails independently so the test result stays visible when formatting fails, and the cheap file-size backstop fails fast. Keep `release:check` intact as the single command for `deploy:web` and `release-desktop.yml` so deploy/release parity is preserved.
- **Files:** `.github/workflows/ci.yml` (restructure into jobs); no package.json change (jobs call the existing granular scripts).
- **Tests:** CI-only; no product test.
- **ADR:** NEEDED — "CI is split into parallel jobs; the deploy gate's required-status-checks contract must list all jobs (not just a single `ci` job name)."
- **Effort:** M · **Depends on:** none, but MUST reconcile with the deploy gating contract. I did not read `deploy.yml`/branch-protection — verify whether deploy keys on the workflow-run conclusion (safe) or a specific job name (must update the required checks) before merging.
- **Risk:** If deploy or branch protection references the old single job name, splitting silently ungates deploy — the ADR + a verification step must confirm required-checks are updated. Each job re-hydrates deps (mitigated by pnpm cache). Coordinate with TST-06/TST-11 which also touch CI.

### TST-13 · Add an end-to-end camera-undistort perceptual test (analytic checkerboard)
- **Fixes:** "Camera and relief pipelines have no image-level fidelity coverage" — severity minor (camera half)
- **Root cause:** Camera tests are linear-algebra units (`src/core/camera/*` — matrix3d, mat3, homography, fisheye) plus budgeted calibration sweeps; grep for `camera` under `src/__fixtures__/perceptual/` returns no test files. Nothing runs a distorted synthetic frame through the full undistort→homography→overlay path and checks the result, so a sign flip that keeps individual matrix tests green could place overlays mirrored. Hardware passes are CLAIMED, so a synthetic fidelity test is the only available instrument.
- **Approach:** Extend the ADR-025 analytic-truth pattern: synthesize a checkerboard frame with known distortion parameters, run the composed camera pipeline (undistort + homography), and IoU-compare the rectified board against the analytic grid, plus a corner-identity assertion (a known-labeled corner lands where expected) to catch sign flips/mirroring that IoU alone tolerates.
- **Files:** `src/__fixtures__/perceptual/camera-undistort.test.ts` (new); optional `camera-truth.ts` (new) for the analytic-grid builder.
- **Tests:** the perceptual test is the deliverable; a failing assertion → separate bug-fix PR in `src/core/camera/`.
- **ADR:** none
- **Effort:** M · **Depends on:** none
- **Risk:** Not verified — I read only that the matrix/homography primitives exist; I did NOT confirm a single composed undistort→homography→overlay entry point. If only primitives exist, the test composes them itself (still valid). Choose distortion params mild enough that the rectified grid is unambiguous.

### TST-14 · Add a relief heightmap-vs-carve perceptual test (analytic hemisphere)
- **Fixes:** same finding (minor) — relief half
- **Root cause:** Relief/STL has a G-code snapshot (`src/core/relief/__snapshots__/relief-roughing.test.ts.snap`) and marching-squares units but no heightmap-vs-carve perceptual check analogous to the V-carve analytic-groove proof (`vcarve-perceptual.test.ts`). A depth/orientation regression in the removal grid stays green.
- **Approach:** Mirror the vcarve-perceptual analytic pattern: stamp a known analytic heightmap (a hemisphere with closed-form depth at each cell), run the relief roughing pass, and compare the produced removal grid against the analytic removal, asserting depth agreement within tolerance and an orientation check (deepest cell at the hemisphere center) to catch mirror/sign errors.
- **Files:** `src/__fixtures__/perceptual/relief-heightmap.test.ts` (new); optional `relief-truth.ts` (new) for the analytic hemisphere.
- **Tests:** the perceptual test is the deliverable; a failing assertion → separate bug-fix PR in `src/core/relief/`.
- **ADR:** none
- **Effort:** M · **Depends on:** none (independent of TST-13; shares the analytic-truth approach)
- **Risk:** Not verified — I did not read the relief roughing entry point; confirm it exposes a removal grid / heightmap-in shape the test can drive purely. Keep the hemisphere coarse so marching-squares discretization error stays inside the tolerance.

#### Polish (deferred, one-liners)
| finding | one-line fix | effort |
|---|---|---|
| Coverage is collected but ungated (vitest.config.ts:23-28 has no `thresholds`; `release:check` runs plain `pnpm test`, not `test:coverage`) — coverage can silently decay | Add per-directory `thresholds` for `src/core` to the vitest coverage config and run `test:coverage` in a non-blocking CI leg, OR record an ADR that coverage is intentionally ungated so the omission is a decision. | S |

---
