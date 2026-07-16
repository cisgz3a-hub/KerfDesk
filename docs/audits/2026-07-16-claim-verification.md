# Claim-verification audit — 2026-07-16 (post-remediation)

**Scope.** The maintainer's consolidated list of ~80 claims from Codex/Claude chats (2026-07-12 → 2026-07-16), covering PRs #53–#207. Each claim was verified against the tree at `main` @ `933fabc4` and live GitHub PR states — not against the chats.

**Method.** 9 parallel auditor agents (one per claim group), every verdict requiring file:line / commit / PR-state evidence; 4 adversarial refute agents re-derived every verdict that contradicted the maintainer's list.

**Verdict key.** MATCHES = claimed status and mechanism confirmed. DIVERGES = evidence contradicts the claim. PARTIAL = split. Severity rates the underlying issue, not the claim error.

**Original audit tally: 69 MATCHES · 9 PARTIAL · 4 DIVERGES (all 4 upheld on adversarial re-check).**

> **This document was regenerated after remediation.** Every actionable finding was fixed under the maintainer's `fix all` directive and re-verified on the current tree. Section 0 below is the remediation ledger; sections 1–6 are the original audit, preserved as the underlying detail. Where a finding was fixed, its section 1–6 text describes the *pre-fix* state — read section 0 for current status.

---

## 0. Remediation & re-verification

**14 fixes across 13 PRs, all merged to `main`** (tip advanced from `933fabc4` → `5f4b2d44`, which also carries later #225/#227 recovery work). A second, independent **adversarial re-verification pass** (13 agents, run `wf_4033e63e-091`) then re-checked each fix on the merged tree — mechanism present at HEAD, original defect gone tree-wide, no regression from the later commits.

**Re-verify tally: 11 RESOLVED · 2 PARTIAL (both low residual).** All 13 fix commits confirmed ancestors of HEAD via `merge-base`. **Both PARTIALs were then closed by follow-up PRs — C7 → #231 (`c69a564d`), C6 → #241 (`3e85f7b1`), both MERGED** — so all 82 claims now sit at RESOLVED / MATCHES / gated-non-code.

| Finding | Sev | Fix PR (squash) | What changed | Re-verified on `5f4b2d44` |
|---|---|---|---|---|
| **A5** full-perimeter tabs cut the part free | high | #208 `3ac9f42` | `tabs-bridges.ts` splitters return `[]` (skip the pass, keep one full bridge) instead of the unsplit loop when tab windows cover the perimeter; non-blocking `detectCncFullTabCoverageWarnings` advisory | **RESOLVED** — file byte-identical to fix; every caller iterates pieces so `[]`→no pass; #225/#227 touch no tab/emit file |
| **B18** energized USB-yank tests in the protocol | med | #209 `b99ed8e` | acceptance-protocol prereq 8 + FAL-07/08 rewrite (de-energized, transcript-based); SECURITY.md transport-sever exclusion | **RESOLVED** — old "low-power air motion" disconnect text gone tree-wide; all sever cases inherit prereq 8 |
| **A6** no persistent Laser Off while Fire latched | med | #210 `ad2ab18` | `LiveMotionBar` shows **LASER FIRING** + **LASER OFF**→`setFireActive(false)` when `fireActive`, after job/motion precedence | **RESOLVED** — off-path sound (`M5`); job precedence pinned by test; visual/hardware NOT verified |
| **A7** corrupt-save had no salvage | med | #212 `ce20943` | `salvage-export.ts` writes raw project to a **new** `-recovery.lf2` (never the canonical copy → ADR-204 intact); offered on refusal before `markSaved` | **RESOLVED** — structurally cannot reuse/mark the good file; other "could not save" sites are post-`ok`, correctly no salvage |
| **A8** raster preflight re-scanned full G-code | med | #213 `7fce753` | laser preflight splits the emitted G-code **once** (`preflight.ts:127`), threads the array through all scanners | **RESOLVED** — single split; CNC-preflight re-split is a documented out-of-scope follow-up |
| **E3** orphaned layer-draft store surface (#193 fallout) | low | #214 `6dee384` | removed dead `commitLayerDraft`/`applyLayerDraft`/`layer-draft.ts` (zero UI callers); docs say text output is edited post-insert | **RESOLVED** — tree-wide grep: zero live surface remains |
| **F5** drawing migration recognition byte-fragile | low | #215 `5f3b2ff` | migration keys on a stamped `fairingVersion` marker, not byte-identical re-derived JSON | **RESOLVED** — every `createPolyline` born-stamped; re-derive compare only for unstamped legacy, below the marker short-circuit |
| **C7** wPos+cached-WCO stale window (`job-placement`) | low | #216 `ffc3a92` → **#231 `c69a564d`** | `currentWorkPosition` prefers the frame's own WCO over the cache | **RESOLVED** — re-verify found the same pattern in sibling `infer-machine-position.ts`; closed test-first in **#231 (MERGED)** (`report.wco ?? wcoCache`) so both call sites agree |
| **C8** resume hardcoded G54 (dropped G55–G59) | med | #217 `facbaff` | `resume-program.ts` preamble preserves the scanned active WCS; modal scanner tracks G54–G59 | **RESOLVED** — no hardcoded G54 in `buildPreamble`; unreachable today (resume laser-only, imports preview-only) — future-proofing |
| **B4-lease** recovery claim could permanently lock | low | #220 `d4d6330` | recovery claim carries a 5-min lease/expiry; both gates (claim mutation + banner Review) check it | **RESOLVED** — post-crash reload re-enables Review; unparseable timestamp fails closed by design |
| **B21** origin WCO-timeout silently recorded stale | low | #222 `491e0e2` | `waitForOriginWcoFrame` returns a boolean; timeout logs an "unconfirmed" notice + leaves `wcoCache` null instead of accepting a stale offset | **RESOLVED** — non-blocking flag, matches expected "flagged evidence"; no regression across 5 later commits |
| **A1** supervised-recovery qualification un-archived | med | #223 `02b6bc3` | operator attestation/qualification record persisted verbatim into the run artifact (`recoveryQualification`) | **RESOLVED** — archive chain intact through #225; auto-resume still refused (intended); supervised-only |
| **C6** active-G55 vs emitted-G54, no warning | med | #224 `fc52aa2` → **#241 `3e85f7b1`** | `detectActiveWcsMismatchWarnings` fires on Save/Start when active WCS ≠ G54; non-blocking | **RESOLVED** — #224 covered the console selection; **#241 (MERGED)** added passive `[GC:...]` capture + a connect-time `$G` read via a new **`ackless`** query primitive, so an external/`$N` WCS is detected with no operator action |

### Residuals after re-verification — both now closed

- **C7 → #231 (MERGED):** the re-verify pass found the same fresh-WPos-with-cached-WCO pattern in the sibling `src/ui/state/infer-machine-position.ts` that #216 had fixed only in `job-placement.ts`. Closed test-first in #231 (`inferCurrentMachinePosition` now prefers `report.wco ?? wcoCache`), so the two placement functions can no longer diverge. Largely latent in practice — `laser-status-line.ts` updates `wcoCache` atomically on any WCO-bearing frame — but the latent trap is removed.
- **C6 → #241 (MERGED):** previously `store.activeWcs` was set only from the operator's **console** G54-G59 selection, so a non-G54 frame left active by a `$N` startup block or an external sender was invisible. #241 closes it in two parts: (1) the line handler **passively captures any `[GC:...]` modal report** (`captureActiveWcsFromModalReport` + core `parseActiveWcsFromModalResponses`) into `activeWcs`; (2) the handshake **issues `$G` at connect** so an external/`$N` WCS is detected with no operator action. The connect read can't use a normal write — a queued line owes a terminal ack that would fence Start until the reply — so it uses a new **`ackless` query primitive** (`SafeWriteOptions` on `safeWrite`): the query owes zero fence acks, its reply is consumed passively, and its trailing `ok` is an Idle no-op (`$` payloads are blocked during a job, so it can never phantom-advance one). The send is guarded on a quiescent ledger (`pendingUntrackedAcks === 0`) so the unaccounted `ok` can never settle another command's ack (F1). GRBL-only, non-fatal. **Remaining sliver (documented, not shipped):** an external sender flipping WCS *mid-session* while connected — the connect read covers connect/reconnect only; the passive capture catches it just if a `[GC:...]` happens to arrive. Rare; not worth added connect I/O.

### Not fixed — genuinely gated (unchanged from the original audit)

- **A2 / B17** beam-off after a physical USB unplug — needs a hardware interlock/watchdog; no software path exists once the transport is gone (ADR-212). Nothing to code.
- **A9** Electron download pipeline — the CI/signing workflow is complete and fail-closed; the blockers are external (Cloudflare R2 token, Authenticode cert).
- **C9** MPG-latch — correct as-is; clearing a stale latch is recoverable by reconnect/reset. Needs hardware transcripts to qualify further.
- **B24 / D16-adaptive / F10** — qualified-setup bundle, trochoidal/island-aware clearing, closed-outline variable-depth V-carve fonts: feature-scale work, not fixes.
- **Hardware qualification** of the merged coordinate/recovery work (G54/WCO, probing, recovery motion): machine time, not code. See the hardware-verification procedure recorded with this audit.

---

## 1. Corrections to the maintainer's list

### Stale in the good direction — work is further along than the list says

- **A3 / C7 — "G54/fresh-WCO implemented locally, needs publication" → it IS on main.** #123 (`80852f8f`, bind setup/motion to G54), #157 (`cb62a55f`, pin G54+G94 in job/resume preambles), #129 (`fbd64955`, Set Origin awaits the post-G92 work-offset frame, `laser-origin-actions.ts:133-137`, 3 s bounded, gated on `wcs==='g92-and-g10'`), #170 (`0897dcf1`, owned G54–G59 offset readback, `work-offset-readback.ts:14`, ADR-203) and #144 are all ancestors of HEAD. #113 was CLOSED unmerged but fully superseded by #123. **Only hardware qualification remains genuinely open** (ADR-185 still records it pending; no transcripts in-repo).
- **C3 — "fresh disconnect/handshake built locally, publication unrecorded" → published.** #198–#200 (merged 07-15) created `laser-controller-handshake.ts` + `laser-controller-qualification.ts`; every connect bumps `controllerSessionEpoch` and nulls statusReport/wcoCache/homingState/frameVerification (`laser-connection-actions.ts:166-199`); Start refuses until re-qualified at that epoch. The store is non-persisted Zustand, so a browser refresh cannot preserve a controller session.
- **D12 — hosted-web camera exposure → fixed by #131.** `camera-platform-capability.ts:3-10` gates machine/RTSP sections off hosted web; `HostedNetworkCameraNotice` explains Desktop is required. (Rendered behavior on the Cloudflare deployment not visually verified.)
- **D16 — "inlays and adaptive clearing outstanding" → both shipped v1s on 07-13.** Straight inlay pairs: `inlay-pair.ts` female pocket + mirrored male insert with allowance/spacing (#78, ADR-155). Adaptive: constant-load ring planner + independent engagement verifier (#77, ADR-154). Still true: no trochoidal/medial-axis island-aware planner (ADR-154 says so itself); V-carve-taper inlays excluded; hardware status CLAIMED.
- **A1 / B1 — "recovery preview-only, live motion disabled" → stale after #173.** A *supervised* executable CNC recovery path exists: `cnc-recovery-policy.ts:90-99` (`executable:true`) → `cnc-supervised-recovery-stream.ts:60` calls `laser.startJob(...)` — real motion, hardened by #198–#203. Arbitrary/automatic resume is still refused (`resume-program.ts:51-53`, `CNC_AUTOMATIC_RECOVERY_DISABLED_REASON`; ADR-143). ⚠️ The gate is operator attestation: an 8-item checklist plus a free-text qualification record that is only checked non-empty (`cnc-supervised-recovery-flow.ts:281-283`) — nothing verifies it against a controller or hardware run.

### Diverges against the list — a real gap

- **B18 — corrected pull-test guidance never landed in the repo (medium).** No in-tree doc requires physically disabling laser output for disconnect tests. Worse: `docs/hardware/laser-9-acceptance-protocol.md:68-69` **FAL-07/FAL-08 still prescribe energized USB-disconnect tests** ("Disconnect USB during a low-power air motion test"), unchanged since #58 — even though ADR-212 (`DECISIONS.md:8780-8824`) documents that exact scenario leaving the beam asserted on real hardware. `SECURITY.md:40-42` only conditions energized testing; it never requires de-energizing. The corrected advice exists only in chat.

### Feature-of-record regressions — #193 deleted two shipped features

- **E2 (partial, low)** — #161's `TextLayerEditor.tsx` (+`TextLayerField.tsx`, `text-layer-options.ts`) was deleted ~20 h later by #193. The user problem stays solved via a different surface (`SelectedOperationInspector.tsx:124-191` — cut type/depth/feeds/V-carve/power/speed), but the #161 component no longer exists.
- **E3 (partial, medium)** — #166's *edit-text-output-before-insert* draft flow was **removed** by #193: `AddTextDialog.tsx` has no output/operation fields and `text-layer-machining.test.tsx:78-79` now asserts the dialog contains NO "Output layer" control. Settings are edited only after insertion. `commitLayerDraft`/`applyLayerDraft` survive in the store with **zero UI callers** (dead surface worth pruning). Anyone reading the claim list would wrongly believe pre-placement editing exists.

### Attribution nuances (status itself holds)

- **B11** — dead-streamer ack fix split across PRs: #182 fixed the reset-banner path; the general fence (`settleUntrackedAck` routing acks away from disconnected streamers, `laser-stream-ack.ts:30-35`) landed in **#186**.
- **B12** — polling/Start-fence gate introduced by #182, generalized by #196 (`controllerOperationOwnsPolling`).
- **F4** — #188/#191 were indeed ineffective for sparse drawings, but **#194 was not metadata-only**: it added real centripetal Catmull-Rom rounding (survives as `fitLegacyCentripetalCubics`, labeled legacy). #191 introduced the migration; #197 finalized it with the true tracer least-squares fitter.
- **F7** — Hershey landed in **#156** (ADR-194); #159 added the EMS family only.
- **B7** — Work-Z recovery was created standalone in #170 (probe panel); #198 fixed the naming collision and moved it, it was never literally inside job recovery.
- **D3** — clickable wizard steps arrived with #180, not #172 (claim named no PR, so it holds).
- **C2** — homing→absolute default existed since #153; #205 closed the residual carry-over path (explicit Current Position surviving a profile switch).
- **E12** — "#165 awaiting CI" is stale: it merged 2026-07-14.
- **E7** — #206 content matches the claim exactly (numbered badge + short open accent line, strokeRect count asserted 0) and its checks are green, but it is **still OPEN** — main still draws the old rectangle.

---

## 2. Confirmed-open defects (claims that MATCH — these are real, with mechanism)

Ranked by severity; all verified present at `933fabc4`.

1. **A5 — full-perimeter tabs cut the complete loop (HIGH).** When requested tab windows cover the whole perimeter, `splitContext` returns null (`tabs-bridges.ts:149`) and every caller falls back to `[polyline]` (`tabs-bridges.ts:86,122,131,141`), so `appendTabbedPasses` (`compile-cnc-job.ts:361-371`) emits the full closed contour below tab top — freeing the part/slug with the spindle running. Realistic trigger: 6 mm tool + 3 mm tabs × 6 on a ~20 mm-perimeter part. No diagnostic warns; manual-tab and finishing-aligned paths share the fallback. Safe degenerate behavior would be to skip the pass (leave a full bridge) and/or surface a diagnostic.
2. **A7 — corrupt-project save refusal is data-loss shaped (medium).** ADR-204 refusal is deliberate, but an invalid-in-memory project can neither Save, Save-As, nor autosave (`prepare-project-persistence.ts:13-38`, `file-actions.ts:260-264`, `autosave.ts:74-77`) — no salvage/export-anyway/raw-JSON path exists.
3. **A6 — no persistent Laser Off in fire mode (medium).** Only the momentary hold-to-fire control exists (`MomentaryFireControl.tsx`); the persistent `LiveMotionBar` ignores `fireActive` (`LiveMotionBar.tsx:121-145`). Mitigations: release always sends M5 (multiple global listeners), failed release raises a notice, crash-screen abort counts fire as live motion.
4. **A8 / D11 — raster preflight full-string scans (medium).** `emit-gcode.ts:77-91` materializes the whole body; ≥7 independent full-string `split('\n')` passes follow (predicates, blank-feed, non-finite, cnc-motion, no-go zones, relative envelope). #175's pre-emit budget (250k segments / 96 MB, `compiled-work.ts:5-6`) caps the window, but an in-budget raster near the cap still freezes the UI thread.
5. **C6 — active-G55 vs emitted-G54 mismatch still structurally possible (medium).** Emission pins G54 (#157/#123) but placement/preflight math can compute in the active frame (console `G55`, `$N` startup block, external session) while emission selects G54.
6. **C8 / A4 — resume forces G54 (medium, currently unreachable).** `buildPreamble` hardcodes G54 (`resume-program.ts:139-152`) and the modal scanner has no G54–G59 handling. Today no streamable program can carry G55–G59 (resume is laser-only over project-recompiled code; external .nc is preview-only) — becomes a real wrong-frame hazard the day imported-program streaming ships. Cheap future-proofing: preflight-reject G55–G59 words in resume input.
7. **C9 — MPG latch (medium).** A missed `MPG:0` leaves `mpgActive=true` for the session (`laser-status-line.ts:251-279`); only explicit MPG:0, reset/alarm, or reconnect clears it. Hardware transcript qualification still required (matches claim).
8. **B24 — qualified setup snapshot still open.** No unified WCS/tool/TLO/stock/fixtures/modal bundle exists (greps empty); ADR-185/188 themselves record TLO/G92 readback and corner probing as not production-qualified.
9. **A2 / B17 — USB-unplug beam risk: hardware interlock still the only guarantee.** ADR-212 records the CH340 incident and the boundary; all software hardening is link-dependent (heartbeat freeze+quarantine, Safety-Door pause, reset-before-close, hard-off recovery re-entry). Accurate as claimed.
10. **A9 — Electron pipeline blocked externally.** Workflow is fully implemented and now fail-closes on missing cert secrets (`release-desktop.yml`); blockers (R2 token 403, Authenticode cert) are external — matches.

---

## 3. Additional correctness concerns found en route (not in the claim list)

- **wPos-only status frames pair fresh wPos with cached WCO** (`infer-machine-position.ts:9-14`, `job-placement.ts:195-203`). GRBL pushes WCO on the first report after an offset change, which narrows but does not eliminate a missed-frame window. (Both the C7 auditor and its refuter flagged this independently.)
- **Origin WCO wait degrades silently on timeout** — after 3 s it records "with whatever is available" (`laser-origin-actions.ts:239-247`); ack-gating still holds, but a status-silent controller yields a less-fresh origin record.
- **F5 migration fragility** — legacy-drawing recognition depends on byte-identical JSON of re-derived output (`JSON.stringify` comparisons in the upgrade path); any future change to the fitter or tolerances silently breaks recognition.
- **Recovery claim without lease** — a crash between `claimRecovery` and `armClaimedRecoveryStart` leaves a persistent claim with no expiry; banner then permanently disables Review (deliberate fail-closed, but a lease/expiry would recover it).
- **Non-GRBL fallbacks** — Pause/Resume confirmed-resume and fail-dark forced reset apply to the GRBL family; Marlin/Smoothie/Ruida take documented unconfirmed/no-realtime-reset fallbacks.
- **RTSP** — credentials scrubbed from persistence and UI, but the raw credentialed URL still flows in-memory to the localhost bridge as a frame-proxy query param.
- **Dead code** — orphaned `commitLayerDraft`/`applyLayerDraft` store surface after #193 (zero UI callers).
- **Doc drift** — `font-registry.ts:26-33` comments predate the #204 Forge family.

## 4. Governance spot-check (ADR-206)

Clean where sampled: ADR-206 present (`DECISIONS.md:8437-8473`, via #176, with CLAUDE.md rule 7 + PROJECT.md #21). The one new guard in the batch — #192 hard capability enforcement — is recorded as **ADR-210 with the necessity case and the maintainer's explicit "build" approval quoted**; ADR-208/209 document maintainer-directed guard *removals* citing the same governance. Nit: #180 shipped its capability model with no DECISIONS entry; it was ADR-documented later by ADR-210.

## 5. What this audit did NOT verify

- **Hardware behavior.** No machine was connected; every "on the machine" property (G54/WCO behavior, probe cycles, recovery motion, MPG transcripts, interlock presence) is unverified. ADR-185/188/212 themselves record the pending hardware qualifications.
- **Visual/perceptual fidelity.** All UI claims were verified as code + tests only (wizard usability, panel clipping, font appearance, badge rendering, marker visibility). Per CLAUDE.md rule 2: green tests are not proof the output looks right.
- **Deployment state.** `e23cb15e` is on main (which feeds deploy), but no deployment artifact was checked.

## 6. Verdict table (all 82)

| ID | Verdict | ID | Verdict | ID | Verdict | ID | Verdict |
|---|---|---|---|---|---|---|---|
| A1 | PARTIAL | B7 | MATCHES | C5 | MATCHES | E1 | MATCHES |
| A2 | MATCHES | B8 | MATCHES | C6 | MATCHES | E2 | PARTIAL |
| A3 | **DIVERGES** | B9 | MATCHES | C7 | **DIVERGES** | E3 | PARTIAL |
| A4 | MATCHES | B10 | MATCHES | C8 | MATCHES | E4 | MATCHES |
| A5 | MATCHES (high) | B11 | PARTIAL | C9 | MATCHES | E5 | MATCHES |
| A6 | MATCHES | B12 | MATCHES | D1 | MATCHES | E6 | MATCHES |
| A7 | MATCHES | B13 | MATCHES | D2 | MATCHES | E7 | MATCHES |
| A8 | MATCHES | B14 | MATCHES | D3 | MATCHES | E8 | MATCHES |
| A9 | MATCHES | B15 | MATCHES | D4 | MATCHES | E9 | MATCHES |
| B1 | PARTIAL | B16 | MATCHES | D5 | MATCHES | E10 | MATCHES |
| B2 | MATCHES | B17 | MATCHES | D6 | MATCHES | E11 | MATCHES |
| B3 | MATCHES | B18 | **DIVERGES** | D7 | MATCHES | E12 | MATCHES |
| B4 | MATCHES | B19 | MATCHES | D8 | MATCHES | E13 | MATCHES |
| B5 | MATCHES | B20 | MATCHES | D9 | MATCHES | E14 | MATCHES |
| B6 | MATCHES | B21 | MATCHES | D10 | MATCHES | F1–F3 | MATCHES |
| — | — | B22 | MATCHES | D11 | MATCHES | F4 | PARTIAL |
| — | — | B23 | MATCHES | D12 | PARTIAL | F5, F6 | MATCHES |
| — | — | B24 | MATCHES | D13–D15 | MATCHES | F7 | PARTIAL |
| — | — | — | — | D16 | PARTIAL | F8–F10 | MATCHES |

Raw per-claim evidence (full notes, file:line for every verdict, refute transcripts): workflow journal `wf_59a6bd71-08f/journal.jsonl` under the session directory; digest in the session tool-results.

**Status update (post-remediation):** the original recommendation below is retained for the record, but every actionable finding has since been fixed and merged — see §0. A5 (`tabs-bridges.ts` degenerate-coverage skip + compile diagnostic) shipped in #208, B18 (FAL-07/08 de-energized rewrite) in #209, and the remaining 14 fixes across #210–#241. The only work left is **non-code**: on-router hardware qualification of the coordinate/WCS/recovery behavior, plus the external-infra/feature-scale items (hardware interlock A2/B17, R2/cert A9, adaptive clearing / inlays / closed-outline V-carve fonts).

_Original closing recommendation (superseded):_ fix A5 first — add the degenerate-coverage handling in `tabs-bridges.ts` (skip the pass / keep the bridge when tab windows cover the perimeter, plus a compile diagnostic); it is the only confirmed high-severity defect in the batch. Immediately after, the one-file doc fix for B18 (rewrite FAL-07/08 to require physically disabled laser output).
