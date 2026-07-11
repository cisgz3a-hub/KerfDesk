# KerfDesk consolidated full-sweep audit — v2 (2026-07-10)

> **Authoritative report.** This supersedes both the Claude 14-sector report (`2026-07-10-full-sweep-audit.md`, preserved as Appendix A of the base-checkout consolidation) and the base-checkout consolidation that merged it with the independent Codex source. v2 adds (a) four previously-unaudited subsystems, now first-class sectors, and (b) independent adversarial verification of every new Codex claim and every new gap-sector finding. **Report-only — no product source was modified.** Branch `claude/multi-sector-audit-3447b9`.

## 1. What is new in v2

Three prior evidence streams plus two new verification waves are reconciled here:

1. **Claude wave 1** — 14 sector auditors (static reading), 51 adversarial verifiers. Report `2026-07-10-full-sweep-audit.md`.
2. **Codex source** — an independent source + live-UI + release-gate audit (ran the full gate: 4,107 tests, both builds, lint, prettier, license/dep audit). Contributed 31 numbered items (M-01…M-31) and a reconciled register.
3. **Claude wave 2 (this document)** —
   - **Gap sweep:** 4 auditors + adversarial verifiers on the four subsystems no first-wave sector opened (persistence/recovery, Electron platform, non-GRBL controllers, device profiles). **19 critical/major verdicts: 16 CONFIRMED, 2 PARTIAL, 1 REFUTED.**
   - **Codex-claim verification:** 16 independent verifiers, one per new Codex static claim, each instructed to refute against the tree and DECISIONS.md. **12 CONFIRMED, 4 PARTIAL, 0 fully refuted** — but several severities corrected, one biggest-item downgrade, and one invented citation caught.

**Net new confirmed criticals since v1: one** (File → New resets the machine profile). **Net new confirmed majors: ~18**, spread across CNC recovery, machine control, the four gap subsystems, and Electron update integrity.

## 2. Document control

| Field | Value |
|---|---|
| Audited commit | `d0d84c01` (main), same base for all streams |
| Remote movement | `origin/main` later advanced to `40bd8194` (rotary/emitter) — **not covered by any stream** |
| Evidence basis | Static source reading (both Claude waves) + live-UI/release-gate (Codex). **No hardware, no perceptual/fidelity rendering, no packaged-Electron run by anyone.** |
| Verification | 51 (wave 1) + 16 (Codex claims) + 19 (gap sweep) = **86 independent adversarial verdicts** |
| Consolidation rule | Deduplicate root causes; propagate verifier corrections into severities and totals; separate confirmed defects from defense-in-depth gaps, doc drift, and reference-product parity; distinguish static from live from hardware evidence |

## 3. Evidence legend

| Mark | Meaning |
|---|---|
| **SC** | Confirmed by tracing source at the pinned commit |
| **TV** | Confirmed by an automated test or completed quality gate |
| **LB** | Confirmed in the live browser application (Codex only) |
| **STATIC** | Mechanism visible in code; runtime magnitude not measured |
| **HW** | Requires a controller, camera, spindle, laser, or physical stock to verify — not done |
| **REF** | Comparison with LightBurn/Easel/Carbide, not independently exercised |
| **DOC** | Documentation or ADR drift rather than a runtime defect |
| **VERIFIED✓** | An independent adversarial verifier reproduced the claim from code this wave |
| **PARTIAL~** | Verifier confirmed the mechanism but corrected severity or a sub-claim |
| **REFUTED✗** | Verifier could not reproduce the headline claim; downgraded or withdrawn |

## 4. Executive verdict

**The spine is excellent; the edges have drifted — and the four subsystems nobody had audited are where the drift is deepest.** The compile/emit pipeline (one pure `prepareOutput` shared by Preview/Save/Start/Estimate), the streaming state machine, the command registry, the ADR-101 mode gate, and the enforcement machinery (lint + typecheck clean across 872 source files, and Codex confirmed the full release gate green — 4,107 tests) remain the strongest parts of the product and repeatedly earned A-/A grades. Both audits independently reached the same one-line verdict.

The follow-up wave changes the risk picture in three concrete ways:

1. **A second confirmed critical.** `File → New` rebuilds app state but silently drops `project.device` while deliberately carrying material libraries, layer defaults, and the CNC library. A user who configured a rear-left 300×200 machine and starts a new file gets **G-code with a flipped Y axis, bounds preflight against the wrong bed, and silently discarded no-go zones and camera calibration** — with no warning on the offline Save-G-code path. This is wrong output and safety-data loss, not friction. (Wave-2, device profiles; CONFIRMED critical.)

2. **The desktop platform's one real security hole is update integrity.** The Electron shell is otherwise unusually well hardened (zero-IPC, no preload, custom `app://` scheme, strict CSP, deny-by-default permissions, SSRF-hardened camera bridge). But `electron-updater` ships **unsigned with no code-signature verification**, so a tampered `latest.yml` + `.exe` on the pinned feed (via feed/DNS/TLS compromise or a leaked R2 token) is silently downloaded and installed on quit — an RCE window ADR-024 §5 acknowledges but leaves without any compensating control. (Wave-2, Electron; CONFIRMED major, effort L.)

3. **Codex found four real CNC/machine-control seam bugs wave 1 missed** — all verified this wave: duplicate Connect surfaces drive Marlin/Smoothie boxes with GRBL semantics (M-02), CNC resume re-plunges at a hard-coded F300 (M-03), tiled export skips the $30/$32 readiness gate and provenance metadata (M-04), and a new CNC layer defaults to a full-depth through-cut with tabs off that preflight accepts (M-17).

Balancing that, verification also **corrected the risk down** in several places: Codex's single highest-ranked recovery item (M-05, "checkpoint deleted before physical completion") is a documented ADR-118 decision whose worst realistic outcome is a *false* resume banner, not lost recovery — downgraded from P1 to minor. My own wave-1 headline "Result discipline does not exist" was softened to "inconsistent at seams," and four of my majors that my own verifiers had flagged PARTIAL are now correctly demoted. And one gap-sector major (checkpoint never re-validates work zero) was **refuted** — the placement gate already refuses a custom-origin resume when the controller no longer reports that origin.

**There is no P0 that leaves the machine actively unsafe while streaming.** Both confirmed criticals are "wrong setup → wrong output" flows with an operator or controller-side backstop in at least the connected case. The work below is: fix the two criticals and the verified CNC/connect seam bugs, close the update-integrity and camera-bridge holes, then pay down the parity, feedback, performance, and doc-drift debt that spans every sector.

## 5. Unified scorecard (18 sectors)

Wave-1 sectors carry their original grades except where verification moved them; the four gap sectors are new.

| # | Sector | Grade | Notes from reconciliation |
|---|--------|:---:|---|
| 1 | Import & file I/O | B+ | Mature hostile-input handling; universal-import/embedded-image/repeat-import parity lag |
| 2 | Canvas & content creation | B+ | Broad and coherent; S2-F1 boolean-swallow demoted major→minor (documented + tested no-op) |
| 3 | Layers & cut settings | B | Capable model; selection collapse, preset-block-vs-ADR-045, hidden overrides hurt workflow |
| 4 | Preview, simulation & planning | B+ | Output parity excellent; placement-error copy + shade-by-power the main gaps |
| 5 | G-code generation & motion safety | A- | Strongest spine; NaN-at-emit defense-in-depth hole survives (found 3×) |
| 6 | Machine control | A- → **B+** | Downgraded: Codex's verified M-02 Connect divergence is a real safety-adjacent seam wave 1 missed |
| 7 | Camera & board/registration | B+ → **B** | Letterbox click mis-map + unpinned-resolution alignment (M-07) confirmed; all accuracy still HW-unverified |
| 8 | CNC / Easel mode | B+ → **B-** | Two confirmed criticals-adjacent (M-01 tool-change, M-17 through-cut default) + M-03 resume plunge |
| 9 | Trace & raster fidelity | B+ → **B** | Raster rotation blocked, nearest-neighbor resample, zero raster perceptual coverage |
| 10 | Architecture & code health | A- | Clean gate; "Result discipline does not exist" softened to seam-inconsistency |
| 11 | UI information architecture | B+ → **B-** | Codex live run confirmed fixed-rail canvas compression (M-19), tiny targets, buried features |
| 12 | Onboarding, help, error UX & docs | B | Standout error copy; long-form help routes to unshipped docs via `alert()` |
| 13 | Performance & robustness | B- | Several confirmed static hot loops; no production-scale profile collected by anyone |
| 14 | Test & CI quality | B+ | Very large passing suite + strong gate; no browser E2E, dialect/fidelity asymmetry |
| **15** | **Persistence, migration, autosave & recovery** | **B+** | New. Disciplined .lf2 gate; seam gaps: phantom-restore, resume mis-diagnosis, +Infinity def-in-depth |
| **16** | **Electron desktop platform & parity** | **B+** | New. Excellently hardened shell; **unsigned-update integrity** is the one real hole |
| **17** | **Non-GRBL controller stack** | **B** | New. Great driver seam; capability-gating breached (override bytes, settle dwell), .rd verified only circularly |
| **18** | **Device/machine profile lifecycle** | **B-** | New. Strong $$ cross-check; **File→New device reset (critical)**, no app-level device list, zones don't gate jog |

## 6. Authoritative priority register

Every item carries its source stream(s) and this-wave verification verdict. IDs prefixed `C` = confirmed critical, `P1`/`P2` = reconciled priority. Codex `M-xx` numbers preserved for cross-reference.

### Tier 0 — confirmed criticals (fix before shipping new machine-control surface)

**C1 · CNC M0 tool-change cannot be completed in-app** — *S8-F1 = Codex M-01 · SC/TV · VERIFIED✓*
The emitter retracts, stops the spindle, parks, and writes M0, but the streamer drops the comment lines, never enters an app-side tool-change state, and keeps filling the controller buffer; no Resume is shown for a non-app-paused hold, and jog/probe/Zero-Z are all blocked while a job is active. The documented bit-swap + Z re-zero flow (F-CNC14/15) is impossible from the app, and a physical cycle-start can continue with the wrong tool-length reference → wrong-depth cut. **Fix:** structured tool-change boundary in compile/stream metadata; stop queue-fill, keep a safe non-cutting state, name the bit, temporarily permit guarded jog/probe/Z-zero, require explicit continuation. **Effort L.**

**C2 · `File → New` silently resets the machine profile to Default 400×400** — *Wave-2 device-profiles · SC · VERIFIED✓ (CONFIRMED critical)*
`newProject()` rebuilds `AppState` and deliberately carries over material libraries, saved libraries, layer defaults, and the CNC library — but **not** `project.device`, which reverts to `DEFAULT_DEVICE_PROFILE` (400×400, front-left origin, maxPowerS 1000, no zones, no scan offsets, no camera alignment). A rear-left 300×200 machine then produces **Y-mirrored G-code** (origin drives the axis flip), bounds preflight checks the wrong bed, and no-go zones + camera calibration are silently discarded. The connected path has partial backstops ($30 readiness, setup nudge); the **offline Save-G-code path warns nothing.** WORKFLOW F-A13 specifies only "workspace returns to empty"; no ADR records a device reset. LightBurn devices are app-level and survive File→New. **Fix:** persist the last-committed device app-side (the exact `currentLayerDefaultsState`/`currentCncLibraryState` pattern already in `newProject`) and seed New/boot from it; add F-A13 device semantics. **Effort M.**
_Evidence: `src/ui/state/store.ts:403-410`; `src/core/scene/project.ts:35-44`; `src/core/devices/origin-transform.ts:49-70`; verifier confirmed `store.test.ts:161-181` asserts scene/selection reset but never the device reset._

### Tier 1 — confirmed P1 (verified this wave)

**P1-a · Duplicate Connect surfaces select different controller behavior** — *Codex M-02 · SC · VERIFIED✓ major*
Menu Connect calls `laser.connect(platform)` with no options → `selectControllerDriver(undefined)` → GRBL driver at 115200, even for a Marlin profile catalogued at 250000; the capabilities snapshot also becomes GRBL's, so Pause/Stop realtime bytes Marlin ignores appear available. Menu Connect also lacks the file-only guard the rail has, violating ADR-097. The repo *already documents this exact hazard* in `DeviceSetupConnectStep.tsx:49-51` — the wizard caller was fixed, the menu caller missed. **Fix:** one profile-aware connect command behind every entry point; reject non-connectable profiles. **Effort S.**

**P1-b · CNC resume re-plunges at a hard-coded F300** — *Codex M-03 · SC · VERIFIED✓ major (trimmed from critical)*
Both manual and checkpoint resume pass `RESUME_PLUNGE_MM_PER_MIN = 300`; the re-entry Z-down is emitted at that feed and the program's own modal F is restored only *after* the plunge. A job configured at F50 (the app's own feeds calculator recommends 25–30 mm/min for aluminium/small bits) re-enters at 6–12× the intended plunge. Default jobs (layer default is also 300) see zero divergence, which is why it's major not critical. **Fix:** reconstruct the last safe downward Z feed from modal state or the compiled group; refuse CNC resume if none can be established. **Effort M.**

**P1-c · Tiled CNC export bypasses controller-readiness confirmation + provenance metadata** — *Codex M-04 · SC · VERIFIED✓ major*
The tiled path early-returns before `confirmControllerMismatch` and metadata composition; its context type structurally has no `controllerSettings` field. The skipped gate makes `$30 ≠ spindleMaxRpm` and `$32 = 1` blocking errors — and its code comment records it was added *specifically for files run from SD cards/other senders*, which is the tiled use case. It **does** run prepareOutput + per-tile CNC preflight before any write, so it is not a general preflight bypass. **Fix:** share the standard readiness + metadata layer with normal Save; keep the all-tiles-preflight-before-any-write invariant. **Effort S.**

**P1-d · Complexity/output-size budgets are not shared by Start, Save, and Frame** — *Codex M-09, rel. S13 · SC/STATIC · VERIFIED✓ major*
The vector/fill complexity gate has only two consumers, both display paths (Preview, live estimate). Start (which compiles up to 3× per click), Save, and Frame synchronously compile unbounded vector/fill work on the main thread; raster budgets bound pixels but not emitted-command count or final string size (the pass multiplier's UI clamp max is `Infinity`). **Fix:** move input/segment/command/byte budgets into `prepareOutput`; worker/chunk where cancellation matters. **Effort M.**

**P1-e · New CNC layer defaults to a full-depth outside profile with tabs off; missing settings compile through the same fallback** — *Codex M-17 · SC/TV · VERIFIED✓ major*
Stock and layer depth both default to 6.35 mm, `profile-outside`, `tabsEnabled: false` — a through-cut that releases the part with no tabs. `compile-cnc-job.ts` uses `layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS` on a routine path (createLayer never sets `cnc`), and `cnc-preflight.test.ts:85-89` *pins* exactly-default settings as `ok: true`. Partially mitigated by machining order (profiles last, inner before outer). Against ADR-111's own premise that beginner-hostile defaults are bugs. **Fix:** default to a shallow/non-releasing op or require explicit through-cut/no-tabs acknowledgement. **Effort S.**

**P1-f · NaN/non-finite coordinate words are invisible to the final preflight scanner** — *S1-F1 = S5-F1 = Codex M-11 · SC · VERIFIED✓ major (defense-in-depth)*
Import boundaries now guard non-finite coordinates, but if any non-import producer ever yields NaN, `parseGcodeWord` returns null for the malformed word and `appendAxisBoundsIssue` skips null — so `G1 XNaN` is stringified into output and sails through every preflight scanner. No currently-reachable producer was demonstrated by any stream; this is the surviving half of a long-standing lead. **Fix:** reject a *malformed-present* word distinctly from an *absent* word; assert `Number.isFinite` at the emit-formatting boundary. **Effort S.**

**P1-g · Camera alignment is not bound to displayed frame geometry** — *S7-F1 + S7-F2 = Codex M-07 · SC · VERIFIED✓ major (HW-unverified path)*
Manual 4-point clicks are mapped across the full element rectangle though the image is letterboxed (`contain`); persisted alignment records frame dimensions but overlay/trace paths don't reject a mismatched resolution, and USB capture pins no resolution. Non-4:3 streams or a later resolution change silently shift registration — in the one accuracy-critical path never hardware-proven. **Fix:** map pointer coords through the rendered image rectangle; make calibration resolution/crop an enforced compatibility key. **Effort M.**

**P1-h · Autosave re-prompts "Restore?" with stale work forever after a manual save** — *Wave-2 persistence · SC · VERIFIED✓ major*
`readAutosave()` returns the newest snapshot across *all* per-session slots; restoring keeps the source slot armed, but `clearAutosave()` clears only the current + legacy keys. A dead session's slot survives forever: crash A → restore in B → edit → Save (.lf2 is now truth) → every later empty-project launch re-offers A's stale pre-crash copy, which an unwary user can restore and Save over the newer file. The code comment claims a contract ("drop it so the recovery prompt doesn't fire next boot") the code does not meet. **Fix:** clear `record.storageKey` after the restored project's first successful write; age out indexed slots. **Effort S.**

**P1-i · Crash resume dead-ends with a wrong "project was edited" refusal for selective/placed jobs** — *Wave-2 persistence · SC · VERIFIED✓ major*
The checkpoint fingerprint covers `prepared.gcode`, which depends on `jobPlacement` and `currentOutputScope` — neither persisted, so both reset to defaults after a crash. A job burned with "cut selected graphics" or a non-default placement recompiles to different bytes, and resume refuses with an alert blaming project edits, sending the operator hunting for a nonexistent change. Recovery of a multi-hour selective burn is impossible exactly when it matters. **Fix:** persist scope + placement in the checkpoint and re-apply at resume; at minimum name scope/placement/selection in the refusal and fix F-B16. **Effort M.**

**P1-j · Electron auto-update has no signature verification** — *Wave-2 Electron · SC/STATIC · VERIFIED (single-agent, HW-unverified)· major, effort L*
v1 ships unsigned; `electron-updater` performs no code-signature check, so a tampered `latest.yml` + `.exe` on the pinned R2 feed is silently downloaded and installed on quit — an RCE window ADR-024 §5 acknowledges without a compensating control. Maps to Electron security-checklist item 16 (signed updates). **Fix:** code-sign the build and enable signature verification, or add a manifest hash/public-key pin the updater validates before applying. **Effort L.** _HW: needs a packaged Windows run to confirm the updater path end-to-end._

**P1-k · Loopback camera bridge is drivable cross-origin by the hosted site and every `*.pages.dev` preview** — *Wave-2 Electron · SC · VERIFIED✓ major*
The RTSP/frame bridge is loopback-only with an Origin gate, but the allow-list trusts the hosted site and all `*.pages.dev` previews; a malicious or compromised preview origin can drive it as a private-network + localhost scanner. **Fix:** tighten the bridge Origin allow-list to the exact packaged origin; do not trust wildcard preview subdomains at runtime. **Effort M.**

**P1-l · Realtime override bytes and settle dwell ignore the driver seam for non-GRBL families** — *Wave-2 controllers · SC · VERIFIED✓ major (two findings)*
The mid-job Feed/Spindle/Rapids override buttons are mounted for every controller family and write GRBL-only realtime bytes into Marlin/Smoothieware streams; and the post-job settle hardcodes GRBL's `G4 P0.01` instead of `driver.commands.settleDwell` (Marlin's `M400`), directly contradicting ADR-095 and the repo's own simulator. The excellent driver seam is breached in the two places it most matters. **Fix:** gate overrides on `controller-capabilities`; route settle through the driver. **Effort S each.**

**P1-m · No app-level laser machine list; connected profile-apply keeps stale numbers** — *Wave-2 device-profiles · SC · VERIFIED✓ major (two findings)*
Custom laser profiles live only inside the current project (the CNC side already has an app-level library), compounding C2. And applying a catalog/imported profile while connected spreads the *old* profile's machine-reported numbers into the new one with no provenance gating, so the card misrepresents fields the controller never reported. **Fix:** add an app-level device library (mirror the CNC one); gate the machine-reported merge on provenance. **Effort L + S.**

### Tier 2 — confirmed, lower severity / defense-in-depth / doc (abridged; full list in the sector reports)

`M-08` arc-extrema bounds gap — latent, no production compiler emits G2/G3 yet (**verified unreachable**; downgraded to minor); the verifier additionally found the sampled placement check never runs in Absolute mode. · `M-12` operator warnings written to an unmounted `LaserLog` (S6-F1). · `M-13` no proactive Frame-verified indicator (**demoted**: motion gates + ADR-031 exist). · `M-14` PWA Reload can appear in a disconnected-mid-job state (**demoted**: checkpoint persists; cited path wrong). · `M-18` autosave serializes whole project synchronously to localStorage with a never-latching over-quota retry (minor; known). · `M-25` module-level mutable `LiveRefs` + broad `CommandShell` subscription (minor). · `M-30` planner ETA can price a block's exit velocity above its target — estimate-only underestimate (minor). · **+Infinity normalizer gap** (wave-2, **PARTIAL**: real for `safeZMm`/`spindleSpinupSec`, but the cited field is actually *blocked* by preflight — the true hole is sibling unvalidated fields; def-in-depth, effort S). · `streamingMode`-not-coupled-to-`controllerKind` (wave-2 controllers, major→verify as design gap). · `.rd` verified only circularly + encoder comment claims non-existent "golden hex fixtures" (wave-2 controllers). · `.lbdev` importer built against a guessed schema, zero real-file provenance (wave-2 device-profiles). · Safety zones don't gate jog/click-to-position motion (wave-2 device-profiles). · Laser jobs never cross-check bounds/feed vs the live controller's reported travel, though CNC does (wave-2 device-profiles).

### Withdrawn / refuted this wave

- **Checkpoint never re-validates work zero** (wave-2 persistence, claimed major) — **REFUTED → polish.** The resume path runs the same `resolveJobPlacement` gate as Start, which refuses a user-origin resume when the controller no longer reports a custom origin; disconnect/alarm/reboot all invalidate the cached origin, so the power-loss case is already handled. A stored-vs-current WCO check would also false-pass on non-homed machines. Surviving kernel: a resume-specific "re-set origin at the same physical corner" message.
- Four wave-1 majors my own verifiers had flagged (S2-F1 boolean-swallow, S8-F4 CNC feeds, S7-F4 registration-jig scope, S14-F2 raster mapping) are **demoted** per those verifiers and Codex; the raster *resample/composition* fidelity gap survives as a real major.

## 7. Codex-claim verification results (16 new static claims)

Each new Codex finding was handed to an independent verifier told to refute it against the tree and DECISIONS.md, and to check for invented citations (a known prior failure mode of external audits on this repo).

| ID | Codex claim | Verdict | Correction |
|---|---|---|---|
| M-02 | Duplicate Connect selects different controller behavior | **CONFIRMED** | Strengthened — repo documents the exact hazard; ADR-097 violated |
| M-03 | CNC resume hard-codes F300 plunge | **CONFIRMED** | Critical→major (default jobs unaffected) |
| M-04 | Tiled export bypasses readiness + provenance | **CONFIRMED** | Scope accurate (not a general preflight bypass) |
| M-05 | Checkpoint deleted before physical completion | **PARTIAL → minor** | Documented ADR-118 decision; worst case is a *false* resume banner, not lost recovery |
| M-08 | Arc-extrema bounds gap unreachable from production | **CONFIRMED** | Unreachability confirmed; +found sampled check skipped in Absolute mode |
| M-09 | Complexity/output budgets not shared | **CONFIRMED** | Worse — pass multiplier clamp max is `Infinity` |
| M-13 | Frame verification state invisible | **PARTIAL → minor** | Motion gates + ADR-031 exist; only the proactive indicator is missing |
| M-14 | PWA Reload in incomplete-job states | **PARTIAL → minor** | Real gap, but checkpoint persists; cited file path is wrong (`src/ui/pwa/` → `src/ui/app/`) |
| M-17 | CNC through-cut default, tabs off | **CONFIRMED** | Preflight test pins the unsafe default as `ok:true` |
| M-18 | Autosave synchronous to localStorage | **CONFIRMED → minor** | Known/tested degradation; never-latching retry loop noted |
| M-19 | Fixed rails compress canvas (static half) | **CONFIRMED** | Arithmetic ~322px vs Codex's live 292px; no `@media` in `src/` |
| M-22 | Electron adapter contract drifted | **PARTIAL → minor** | One-web-path is a *recorded* decision (ADR-024/107/117); only ADR-011 text + "native menus" promise are stale |
| M-25 | Store ownership/subscription boundaries | **CONFIRMED → minor** | `LiveRefs` unrecorded exception; "streamer" example wrong (it's in Zustand) |
| M-26 | ADR index omits later decisions; stale licensing | **CONFIRMED → minor** | Index has 19 rows vs 90 ADRs; ADR-018 still "Accepted" though ADR-120 reversed it |
| M-30 | Planner ETA exit-velocity > target | **CONFIRMED → minor** | Estimate-only underestimate; "inflating" half does not occur |
| M-19b | Tools ~29 entries; STL drag-drop only; Library="Lib" | **CONFIRMED** | Exactly 29 tools commands; STL has no menu/toolbar id |

**Takeaway:** Codex's static findings are substantially sound — 12/16 clean, and its two most important new items (M-02, M-17) verified. Its recovery/PWA/Electron findings over-reached (M-05, M-14, M-22), consistent with those being read without the ADR context the gap-sweep agents had. One invented citation (M-14's file path) was caught.

## 8. Reconciliation of disagreements

**Where Codex corrected Claude (accepted):** Codex's demotions of S2-F1, S8-F4, S7-F4, and S14-F2 are legitimate — in each case Claude's *own* wave-1 verifier had already returned PARTIAL with the same fine print, and those corrections simply hadn't been propagated into the wave-1 headlines and the "157 findings" total. v2 propagates them. The raw 157 was never a unique-defect count; it includes cross-sector duplicates (S1-F1=S5-F1, S1-F4=S11-F4, S3-F2=S11-F1, S9-F4=S14-F2).

**Where Claude corrected Codex (this wave):** M-05 (Codex's #5 Phase-0 item) is a documented decision whose realistic failure is a false resume prompt — demoted to minor and removed from Tier 0/1. M-13, M-14, M-22 over-reached against recorded ADRs — demoted. This is the value of running the gap agents *with* DECISIONS.md context before verifying Codex's reads of the same areas.

**Where they agree and reinforce:** C1 (M0 tool-change), M-07 (camera), M-09 (budgets), M-12 (orphan log), M-19/M-21 (UI compression + buried features), the NaN def-in-depth hole, and the systemic WORKFLOW/PROJECT/ADR drift were found independently by both — these are the highest-confidence items.

## 9. What must be preserved (unchanged across all streams)

One prepared-output spine · emitted-text safety checks (laser-off travel, bounds, CNC plunge/over-depth) · core purity + dependency direction · streamer terminal-state discipline and the untracked-ack ledger · mode-gated command registry with test-enforced tooltips · hostile-input `.lf2` loading (independently re-verified deep this wave) · **the Electron hardening** (zero-IPC, no-preload, `app://` scheme, strict mirrored CSP, deny-by-default permissions, SSRF-hardened bridge — genuinely strong) · **the ControllerDriver seam** (pure data+functions; grblHAL a 4-line delta, FluidNC 8-line, test-pinned) · **the profile↔controller power-scale Start gate** (stronger than LightBurn) · offline/local-first behavior · perceptual-harness instrument-first discipline.

## 10. Prioritized roadmap

**Phase 0 — machine & data integrity (the two criticals + verified seam bugs):** C1 tool-change barrier · C2 device-profile persistence across File→New · P1-a unified profile-aware Connect · P1-b resume plunge reconstruction · P1-c tiled-export readiness/provenance · P1-e safe CNC initial-operation/tabs policy · P1-f malformed-word emit guard.

**Phase 1 — safety-adjacent & data-loss seams:** P1-d shared complexity/output budgets · P1-g camera frame/calibration binding · P1-h autosave restored-slot lifecycle · P1-i resume scope/placement persistence · P1-j Electron signed-update integrity · P1-k camera-bridge origin allow-list · P1-l non-GRBL override/settle capability gating · P1-m app-level device library + provenance-gated apply.

**Phase 2 — operator trust & performance:** mount/replace the orphaned log channel (M-12) · Frame-verified indicator (M-13) · guard PWA reload across all incomplete states (M-14) · fix the confirmed hot loops (CNC 3D pane, 250 ms preview recompile, O(N²) streamer queue, uncached raster luma) then profile · raster resample upgrade + realistic-scale perceptual instrument · keep Layers/Material context on selection · universal Import + visible STL command.

**Phase 3 — parity & governance:** decide LightBurn/Easel parity feature-by-feature (Fire button, continuous/keyboard jog, color palette, Open Recent, `.lbrn`) · reconcile WORKFLOW/PROJECT/help/shortcuts with shipped UI · generate the ADR index and flip ADR-018's superseded status · formalize the Result/throw convention at geometry seams · add browser E2E + packaged-Electron smoke + Marlin/Smoothie property parity · resolve `.lbdev` schema against a real sample · enforce or delete the fictional soft line/export caps.

## 11. Validation record

**Claude wave 1** — static reading, 14 sectors; 51 adversarial verifiers (47 confirmed / 4 partial / 0 refuted); lint + typecheck clean. No live app, tests, hardware, or perceptual verification.

**Codex** — canonical checkout verified; source + live-UI (1024×768, 1280×720, 1366×768) + full release gate: **651 test files (12 skipped), 4,107 tests passing (17 skipped)**, typecheck, ESLint, Electron lint, Prettier, license check, dependency audit, web build, Electron-main build, file-size policy — all green. No hardware, packaged-Electron, or perceptual verification.

**Claude wave 2** — static reading, 4 gap sectors; **19 gap verdicts (16 confirmed / 2 partial / 1 refuted)** + **16 Codex-claim verdicts (12 confirmed / 4 partial / 0 refuted)**. No live app, tests, hardware, or perceptual verification.

**Not verified by anyone:** physical laser/CNC execution · camera calibration against real stock · real multi-bit tool changes / power-loss recovery · perceptual comparison with LightBurn output · packaged Electron install/update/runtime · production-scale performance profiling · the later `origin/main` commit `40bd8194`.

---

# Appendix A — Claude wave-2 gap-sector reports (full)

> The four subsystems no first-wave sector opened. Findings sorted by severity; every critical/major carries its adversarial verdict. Strengths listed to mark what must be preserved.

## A.1 Project persistence, save-format migration, autosave & crash/job recovery — grade B+

The persistence layer is one of the most disciplined subsystems read so far: a strictly validated, Result-typed .lf2 gate with real DoS caps (verified, not just claimed by the first wave), a pure-core checkpoint whose fingerprint design makes resume provably consistent with the deterministic compile pipeline, and corrupt-storage handling that can never brick startup. The gaps cluster at the seams the tests don't reach: checkpoint resume trusts a one-line confirm instead of re-validating the volatile G92 work zero after power loss, the fingerprint gate dead-ends with a wrong diagnosis when unpersisted output-scope/placement state changed, the per-window autosave slot design breaks its own 'no re-prompt after save' contract and lets a stale copy nag (and potentially overwrite) forever, and the machine/CNC normalizers accept +Infinity that rides all the way into emitted G-code. Documentation drift is real but bounded: autosave shipped with F-C3 still a stub and no ADR, while the migration registry sits empty at schemaVersion 1 with no historical fixture corpus and no downgrade protection. Nothing here is fire-critical — every dangerous path has at least an operator confirm or a controller-side error in front of it — but three of the four majors are exactly the data-loss and wrong-position surfaces this sector exists to catch. Hardware crash-resume remains CLAIMED, as ADR-118 itself admits.

**What's great:**

- **Fingerprint-gated resume built on byte-deterministic G-code** — The checkpoint stores only an FNV-1a fingerprint + sendable/acked line counts (~200 bytes) and the resume flow RE-COMPILES the project, refusing on any byte difference — so resume can never replay line numbers against a silently different program, and raster jobs can never blow the localStorage quota by persisting G-code text. Two line-numbering systems (sendable vs raw) are explicitly modeled with a single shared isSendableGcodeLine definition and a rawResumeLine converter, closing the classic off-by-comment-line resume bug. _(src/core/recovery/job-checkpoint.ts:1-32,110-124; src/ui/laser/start-job-flow.ts:95-108; DECISIONS.md:5495-5518)_
- **Laser vs CNC resume preambles are safety-differentiated from a real audit bug** — buildResumeProgram detects Z-awareness and orders re-entry per machine: a router arms + spins up before moving (bit at speed before plunge), a laser travels to the resume XY with no spindle word and only then re-arms — with the comment recording the audit C1 incident (shared CNC order fired a stationary dot then travelled armed). It also refuses G91/G53/G28/G30 programs it cannot replay, as a Result union, never a throw. _(src/core/controllers/grbl/resume-program.ts:106-118,127-174)_
- **The .lf2 trust boundary is genuinely defended in depth (first-wave claims verified)** — Strict shape validation before normalization: 1e6 mm coordinate cap and 1e5 scale cap, inverted-bounds rejection, scene array budgets, layer-identity collision rejection, a 256M-pixel raster source cap that specifically defuses the pixelWidth*pixelHeight allocation integer bomb, and luma-length cross-field validation — all exercised by a dedicated security test corpus. _(src/io/project/project-validator-primitives.ts:3-4,49-61; src/io/project/project-shape-validator.ts:41-48,273-293,352-372; src/io/project/project-security-validation.test.ts:44-155)_
- **Corrupt persistence cannot brick startup** — The checkpoint slot strict-parses and discards+clears a corrupt record once ('a corrupt slot can only nag forever'); every autosave read path wraps getItem/JSON.parse in try/catch and routes through the Result-returning deserializer; both hooks mount inside effects behind global error handlers. A malformed localStorage record degrades to 'no recovery offered', never a boot crash. _(src/ui/state/job-checkpoint-storage.ts:19-31; src/ui/state/autosave.ts:104-123; src/core/recovery/job-checkpoint.ts:130-171; src/ui/app/App.tsx:36-47)_
- **Autosave failure is surfaced, not swallowed, and the M15 lesson is encoded** — Quota/private-mode write failures produce a once-per-session warning toast telling the operator to save manually ('image-heavy projects can exceed browser storage') instead of silently pretending recovery exists; a restored project is immediately marked dirty and its slot kept armed because the slot is the only durable copy — a previous audit's data-loss bug (M15) is documented at the exact line that fixes it. beforeunload writes synchronously even mid-stream, with the rationale for overriding the streaming guard written down. _(src/ui/app/use-autosave.ts:33-45,69-80,109-117; src/ui/state/autosave.ts:49-58)_
- **Resume re-enters through the full start-readiness gate, not a shortcut** — Both resume flows share prepareStartJob's complete gauntlet: alarm/Idle/busy-operation blocks, scoped pre-emit preflight, placement bounds + no-go-zone check with the trusted motion offset, emit-time preflight, verified-frame gate, and $30/$32 controller readiness — so a crash-recovery run gets every protection a fresh Start gets. _(src/ui/laser/start-job-flow.ts:114-142; src/ui/laser/start-job-readiness.ts:77-124,142-196)_

**Findings:**

#### A.1.1 [MAJOR] Checkpoint resume never re-validates work zero; custom-origin jobs re-burn at the wrong physical position after controller power loss

_Area: mechanism · Effort: M · verified: REFUTED → polish_

JobCheckpoint stores only fingerprint + line counts + machineKind + timestamps — no WCO/origin snapshot. KerfDesk work origin is G92-based (ADR-021), which is volatile across a controller power cycle. Because the G92 offset is applied controller-side, the re-compiled G-code bytes are identical, so the fingerprint gate PASSES even though the physical zero is gone; the resume gate (prepareResume -> prepareStartJob) checks alarm/Idle/bounds/controller settings but never compares the controller's current WCO to the one the original run used. The only guard is one sentence in a native confirm ('The work zero must be UNCHANGED since the original run'). The app caches WCO per status frame (laser.wcoCache is already passed into prepareStartJob) so a mechanical check is cheap.

- **Evidence:** src/core/recovery/job-checkpoint.ts:36-54 (no WCO field); src/ui/laser/start-job-flow.ts:162-165 (confirm text is the only guard), 114-142 (gate contents); src/ui/laser/start-job-readiness.ts:198-225 (machine issues checked); WORKFLOW.md:781-782 (operator-only contract); DECISIONS.md:5564-5565
- **Reference:** LightBurn has no crash-checkpoint resume at all (recovery is manual 'Start Here' from preview), so the feature exceeds LightBurn; the in-code baseline is gSender-style resume (resume-program.ts:1). But KerfDesk already caches the data needed to detect the most common failure (custom origin lost on power cycle) and does not use it.
- **Recommendation:** Persist wcoCache + workOriginActive into the checkpoint at job start; at resume, refuse (or show a specific red warning) when the original run had a custom origin that the connected controller no longer reports, telling the operator to re-set origin at the same physical corner first.
- **Verifier (REFUTED):** The headline scenario (silent wrong-position re-burn of a custom-origin job after controller power loss) is not reproducible, and the claim "the only guard is one sentence in a native confirm" is contradicted by code. The resume path runs the same placement gate as Start: prepareResume -> prepareStartJob -> resolveJobPlacement (src/ui/laser/start-job-readiness.ts:87-88 -> src/ui/job-placement.ts:103-127), which REFUSES a user-origin resume when the controller no longer reports a custom origin ("User Origin needs a custom work origin. Click 'Set origin here' first.") and refuses with CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE when the origin flag is set but its WCO is unknown. After controller power loss that gate reliably fires because origin state is invalidated on every relevant path: disconnect wipes wcoCache/workOriginActive (src/ui/state/laser-connection-actions.ts:130-147), Alarm/Sleep reports wipe them (src/ui/state/laser-status-line.ts:35-70), and a post-reboot WCO=0 frame clears workOriginActive via hasCustomOrigin (laser-status-line.ts:130-147). So the app already does exactly what the recommendation asks ("refuse ... telling the operator to re-set origin first") — the finding's claim that KerfDesk "does not use" the cached WCO is false: wcoCache feeds resolveJobPlacement and findVerifiedFrameGateIssue (start-job-readiness.ts:175-196), and for verified-origin placements resume literally compares live WCO against the recorded frame WCO (src/ui/state/frame-verification.ts:30-45) and forces a physical re-frame after disconnect/alarm. The proposed checkpoint WCO snapshot also would not detect what the current gates miss: on non-homed machines (the ADR-053 rationale in job-placement.ts:129-137) machine zero is arbitrary after power-up so a stored-vs-current WCO comparison is meaningless, and in the one genuinely silent case (persisted G54 origin on a non-homed machine) the WCO values are equal, so the recommended check false-passes. Wrong-position burn requires the operator to re-set an origin at a different physical spot first, against a contract stated in three places (confirm at start-job-flow.ts:162-164, banner tooltip CheckpointResumeBanner.tsx:43, WORKFLOW.md:781-782) and explicitly recorded as the deliberate ADR-118 design at the exact cited lines (DECISIONS.md:5564-5565: "Work zero must be unchanged — same contract as manual Start-from-line"). The auditor's individual citations are accurate (no WCO field in job-checkpoint.ts:36-54; fingerprint is origin-blind since user-origin translation targets work 0,0, job-origin.ts:145-157) but the analysis missed the resolveJobPlacement origin gate that handles the power-loss case. Surviving kernel is at most polish: a resume-specific message ("re-set origin at the same physical corner") or an approximate origin-drift warning on homing-enabled machines after the operator re-sets an origin.

#### A.1.2 [MAJOR] Restored autosave slots are never cleared after manual save — phantom 'Restore?' prompts offering stale work on every subsequent launch

_Area: workflow · Effort: S · verified: CONFIRMED_

readAutosave() returns the newest snapshot across ALL per-session slots (current key + index + legacy). Restoring keeps the source slot armed (deliberate, M15), but handleSaveProject/handleOpenProject call clearAutosave() with no args, which clears only the CURRENT session's key + the legacy key (keysForClearScope). The dead session's slot the restore came from survives forever. Sequence: session A crashes -> session B restores + edits + manually saves (.lf2 now newest truth) -> every later launch with an empty project re-prompts 'KerfDesk found an auto-saved project from N minutes ago. Restore?' with A's stale pre-crash copy; an unwary user can restore it and Save over the newer .lf2. The code comment 'Drop it so the recovery prompt doesn't fire on the next boot' (file-actions.ts:253-255) states a contract the code does not meet. autosave.test.ts covers per-window write isolation but not this cross-session clear lifecycle.

- **Evidence:** src/ui/state/autosave.ts:95-102 (newest-across-slots), 125-136 + 180-183 (clear scope = current session + legacy only); src/ui/app/use-autosave.ts:109-117 (restore keeps slot, storageKey dropped); src/ui/app/file-actions.ts:253-255, 292-293; src/ui/state/autosave.test.ts:67 (isolation covered, lifecycle not)
- **Reference:** LightBurn's crash-recovery prompt offers the auto-saved session once; it does not keep re-offering a copy the user has already saved past (exact LightBurn slot lifecycle not verified this session).
- **Recommendation:** On restore, clear record.storageKey after the current session's first successful write of the restored project (or remember it and clear it in handleSaveProject); additionally age out indexed slots older than N days.

#### A.1.3 [MAJOR] Crash resume dead-ends with a misleading 'project was edited' refusal when the interrupted run used non-default output scope or job placement

_Area: workflow · Effort: M · verified: CONFIRMED_

The checkpoint fingerprint covers prepared.gcode, which depends on jobPlacement and currentOutputScope (cutSelectedGraphics + live selection ids). Neither is part of the Project, so neither survives autosave restore or relaunch — after a crash they reset to defaults. If the operator was burning with 'cut selected graphics' or a non-default placement (a normal LightBurn-style workflow), the recompile produces different bytes, and runCheckpointResumeFlow refuses with an alert that blames project edits ('it was edited since'). WORKFLOW F-B16 documents only the edited-project cause. Recovery of a multi-hour selective burn is thus impossible via the banner exactly when it matters, and the diagnostic sends the operator hunting for a nonexistent edit.

- **Evidence:** src/ui/laser/start-job-flow.ts:95-108 (refusal message), 50 (currentOutputScope input); src/ui/state/store.ts:414-423 (scope from unpersisted selection state); WORKFLOW.md:789-792 (only 'project changed' cause documented)
- **Reference:** Not applicable (LightBurn has no fingerprinted resume); the failure is against the feature's own recovery promise in WORKFLOW F-B16.
- **Recommendation:** Persist the output scope and placement used for the run inside the checkpoint and re-apply them at resume; at minimum, extend the refusal message to name scope/placement/selection as causes and update F-B16.

#### A.1.4 [MAJOR] Machine/CNC numeric normalization accepts +Infinity (JSON '1e999'), which reaches emitted G-code as 'G0 ZInfinity'

_Area: mechanism · Effort: S · verified: PARTIAL_

The shape-validator primitives all require Number.isFinite, but the normalizers do not: deserialize-project.ts positiveNumberOrDefault / nonNegativeNumberOrDefault ('typeof value === number && value > 0') and normalize-layer.ts isPositiveNumber / isNonNegativeNumber accept Infinity, and the layer 'cnc' block plus the 'machine' block are never shape-validated at all (validateProjectLayer has no cnc entry; validateProjectShape has no machine entry). JSON.parse('1e999') yields Infinity, so a hand-edited or corrupt .lf2 with machine.params.safeZMm=1e999 loads cleanly, compile keeps it (Math.max(0, Infinity)), and cnc-grbl-strategy's appendRetract emits fmt(Infinity) = 'G0 ZInfinity'. The validator file itself warns that values 'the G-code bounds-check regex can't read' defeat the bounds check, so preflight passes and the bad line reaches the saved file / stream; zPassDepths guards its own depth case but safeZ/feeds/spindle are unguarded. This also matches the still-open non-finite-before-emit gap noted in the 2026-07-06 DXF audit.

- **Evidence:** src/io/project/deserialize-project.ts:297-303 (non-finite-tolerant helpers), 141-151 (safeZMm path); src/io/project/normalize-layer.ts:199-209 (no isFinite), 38-66 (cnc block normalization only); src/io/project/project-layer-shape-validator.ts:21-53 (no cnc key); src/core/cnc/compile-cnc-job.ts:183; src/core/output/cnc-grbl-strategy.ts:43-45,360-361 (fmt/appendRetract); src/core/cnc/depth-passes.ts:12-16 (partial downstream guard); src/io/project/project-shape-validator.ts:51 (bounds-regex caveat)
- **Reference:** Industry baseline: reject non-finite numerics at the trust boundary (same policy the repo's own validator primitives apply everywhere else).
- **Recommendation:** Switch every numeric guard in deserialize-project.ts and normalize-layer.ts to finite-checking helpers, and add machine + layer.cnc coverage to the shape validator with a corrupt-fixture test (1e999 in each numeric field).
- **Verifier (PARTIAL):** Mechanism fully confirmed, headline consequence wrong for the cited field. Confirmed: positiveNumberOrDefault/nonNegativeNumberOrDefault accept +Infinity (deserialize-project.ts:297-303) and feed machine.params.safeZMm/spindleMaxRpm/spindleSpinupSec (141-151); normalize-layer.ts isPositiveNumber/isNonNegativeNumber (199-205) likewise; validateProjectShape has no machine key (project-shape-validator.ts:52-68) and validateProjectLayer no cnc key (project-layer-shape-validator.ts:21-53), while every shape primitive requires Number.isFinite (project-shape-primitives.ts:171-173) — the divergence is real, and DECISIONS.md cuts against it (ADR-125 'Finite-gap guard' records finite-at-boundary as deliberate policy). compile-cnc-job.ts:183 keeps Infinity and cnc-grbl-strategy.ts fmt=toFixed(3) renders 'Infinity', so the emitted BODY does contain 'G0 ZInfinity' (360-365). REFUTED sub-claims: (1) 'feeds/spindle unguarded' — capFeed and capSpindle explicitly check Number.isFinite (compile-cnc-job.ts:433-441; non-finite feed→MIN_FEED, spindle→0); only safeZMm and spindleSpinupSec lack guards. (2) 'preflight passes and the bad line reaches the saved file/stream' — for safeZMm it does NOT pass: parseAxis (\bZ(-?\d+...), cnc-motion.ts:81-84) cannot read 'ZInfinity', so modalZ is never established and findPlungedTravelIssues flags the first XY rapid ('G0 XY rapid before any Z retract was established', cnc-motion.ts:60-65) and every later rapid (finite modal Z < safeZ=Infinity, :67-72); save hard-blocks with no override (file-actions.ts:143-146 'Cannot save G-code'), as do tiled export (save-tiled-gcode.ts:74-82) and Start job (start-job-readiness.ts:102-104). The cited scenario yields a blocked export with misleading errors, not bad G-code on the machine. However the underlying issue IS real via sibling fields of the same unvalidated machine block, so the recommendation stands (see correctedEvidence).

#### A.1.5 [MAJOR] Autosave shipped with no WORKFLOW flow and no ADR; F-A12 error surface also drifted (modal vs toast)

_Area: workflow · Effort: M · verified: CONFIRMED_

WORKFLOW.md still lists 'F-C3. Autosave + recovery' as a STUB while the feature is live with substantial policy decisions encoded only in code comments: 30 s fixed interval, per-window session slots + a key index, restore-prompt-only-when-project-empty, decline-means-discard, pause-during-streaming, beforeunload flush. The DECISIONS.md ADR index has no autosave entry (the design is governed by scattered audit tags like M15). Per repo law, flows must document success/error/empty/edge and architectural choices need ADRs. Separately, F-A12 specifies a Modal for 'file is not a valid .lf2' but the code shows an error toast, and the F-A12 edge 'device profile not on this machine -> status bar warning' has no visible implementation in the load path.

- **Evidence:** WORKFLOW.md:805-812 (F-C3 stub), 420-421 (modal spec), 423-425 (profile-warning edge); src/ui/app/file-actions.ts:307 (toast, not modal); src/ui/state/autosave.ts:1-29 (policy in comments); DECISIONS.md ADR heading list (no autosave ADR; grep of '## ADR-' headings)
- **Reference:** LightBurn exposes auto-save as a user preference (interval setting) and prompts to restore after an abnormal exit; KerfDesk hardcodes 30 s with no setting (exact LightBurn defaults not verified this session).
- **Recommendation:** Write F-C3 with the four states, record an ADR for the slot/index/prompt design, fix or re-spec the F-A12 modal-vs-toast divergence, and consider an autosave-interval preference for LightBurn parity.

#### A.1.6 [MINOR] Single global checkpoint slot: starting any other job silently destroys a valid crash-recovery record

_Area: mechanism · Effort: S_

runStartJobFlow unconditionally overwrites the checkpoint once a new stream starts, and streamResumeFromRawLine (manual Start-from-line, ungated) stamps resumeInFlight on WHATEVER checkpoint is stored — even one belonging to a different interrupted job — after which that unrelated run reaching 'done' clears the record (use-job-checkpoint clears on any done). An operator who crashes mid-job A, then burns a quick unrelated job B (test cut, frame scrap) before resuming, loses A's recovery record with no warning; the manual line-number escape hatch remains but requires the operator to know the line.

- **Evidence:** src/ui/laser/start-job-flow.ts:70-76 (unconditional overwrite), 166-169 (stamps foreign record); src/ui/app/use-job-checkpoint.ts:42-46 ('any run finishing' clears); DECISIONS.md:5540-5549 (single-slot v1 design)
- **Reference:** Not applicable (no LightBurn equivalent); single-slot is the recorded ADR-118 v1 design, but silent destruction is not called out there.
- **Recommendation:** Confirm before overwriting a checkpoint that has ackedLines > 0 ('Starting a new job discards the interrupted-job record — continue?'), and only stamp resumeInFlight when the resumed program's fingerprint matches the stored checkpoint.

#### A.1.7 [MINOR] Schema-version machinery is dormant while the format grew five phases of surface; no historical .lf2 corpus in CI and downgrades silently drop data

_Area: architecture · Effort: M_

PROJECT_SCHEMA_VERSION is still 1 and the MIGRATORS registry is empty; every shipped schema change (machine/CNC block, groups, relief, camera profile/alignment, notes, subLayers, operationOverride, shapes) landed as additive normalization with defaults — a recorded policy, and old v1 files do load. Two consequences: (a) because the number never moves, the schema-too-new gate cannot protect against downgrade — an older build (pre-CNC, pre-groups) opens a newer file as v1, silently drops the blocks it doesn't know, and a re-save destroys them; (b) 'every historical version loads' is proven only by synthetic per-feature fixtures (each project-*.test.ts constructs the old shape by hand) — there is no committed corpus of real .lf2 files from each shipped era loaded in CI, so a normalization regression against a genuine Phase-A/D/E file would not be caught as such.

- **Evidence:** src/io/project/migrations.ts:25 (empty registry); src/core/scene/project.ts:8 (version 1); DECISIONS.md:527, 683, 2741, 4660 (additive-no-bump policy); src/io/project/migrations.test.ts (synthetic registry only); src/io/project/project-registration-jig.test.ts (feature tests build fixtures programmatically)
- **Reference:** LightBurn keeps old .lbrn files loading across years of releases and warns on newer-version files; KerfDesk matches for upgrade but has no mechanism for the downgrade direction.
- **Recommendation:** Commit era fixtures (one real .lf2 per shipped phase) with a loader round-trip test, and define the first-bump policy now (e.g., bump when a block that would be silently dropped by an older build is added, so too-new detection actually fires).

#### A.1.8 [MINOR] Recovery prompt's Cancel is a one-click permanent discard of the only backup

_Area: ui-layout · Effort: S_

runAutosaveRecovery uses a native confirm() at boot: OK restores, Cancel immediately deletes the slot ('Click Cancel to discard the auto-save and start fresh'). After a crash the autosave slot is the ONLY durable copy (the code's own M15 comment says so), and a reflexive Cancel — or a user who just wants to defer the decision — destroys it irreversibly. The checkpoint banner got this right (persistent banner, explicit Dismiss button); the autosave prompt is the more valuable record with the more dangerous UI.

- **Evidence:** src/ui/app/use-autosave.ts:103-119 (confirm + clear on decline); src/ui/laser/CheckpointResumeBanner.tsx:46-56 (contrast: explicit Dismiss)
- **Reference:** LightBurn's restore-session prompt declines without deleting the backup file outright (exact behavior not verified this session).
- **Recommendation:** Make decline keep the slot for this session (no re-prompt until next launch) and reserve deletion for an explicit 'Discard backup' action — or replace the native confirm with a small three-option dialog (Restore / Not now / Discard).

#### A.1.9 [MINOR] io/project files are at the size-limit cliff: project-shape-validator.ts is 4 counted lines under the hard 400 CI failure

_Area: architecture · Effort: S_

project-shape-validator.ts measures 396 counted code lines (449 raw) — over the 250 soft limit and one small addition from the hard-400 lint error; deserialize-project.ts is 276 counted, also over soft. The validator grows with every SceneObject variant and shape kind (its own comment says ellipse/polygon/polyline 'add arms here'), so the next variant will trip CI mid-feature. Precedent for the split already exists in-folder (project-device-profile-validator.ts, project-layer-shape-validator.ts, project-operation-override-validator.ts).

- **Evidence:** Line counts measured this session: src/io/project/project-shape-validator.ts raw=449 code=396; src/io/project/deserialize-project.ts raw=328 code=276; CLAUDE.md size-limits table (soft 250 / hard 400 counted)
- **Recommendation:** Tidy-first PR: extract per-object-kind validators (vector/text/raster/shape/relief) into a project-object-validators module, and the machine/tiling normalizers out of deserialize-project.ts.

#### A.1.10 [POLISH] Corrupt or superseded autosave slots linger in localStorage forever

_Area: mechanism · Effort: S_

readAutosaveAtKey returns null for corrupt JSON / wrong schema / undeserializable projects but never removes the slot or its index entry — asymmetric with the checkpoint slot, which discards a corrupt record once ('a corrupt slot can only nag forever'). Dead per-session keys accumulate against the ~5 MB quota that autosave itself needs for image-heavy projects, and a schema-bumped or future-version autosave silently vanishes from recovery with no message anywhere.

- **Evidence:** src/ui/state/autosave.ts:104-123 (null without cleanup), 10 (5 MB cap comment); src/ui/state/job-checkpoint-storage.ts:28-30 (discard-once contrast)
- **Recommendation:** Mirror the checkpoint policy: on read, remove slots that fail parse/schema/deserialize (and unregister them from the index); optionally log one console warning naming the reason.

#### A.1.11 [POLISH] Resume banner offers no 'back up a few lines' affordance for the controller-also-lost-power case

_Area: ui-layout · Effort: S_

The banner text correctly explains that acked lines may include a buffer's worth GRBL never executed and that 'backing up re-burns, skipping leaves gaps', and WORKFLOW says 'when in doubt, resume earlier via the manual control' — but the one-click Resume always uses the exact mapped line, and backing up requires the operator to compute rawResumeLine themselves and retype it into the separate Start-from-line control. A small 'resume N lines earlier' stepper (defaulting to ~a buffer's worth) on the banner would make the documented conservative path one click.

- **Evidence:** src/ui/laser/CheckpointResumeBanner.tsx:30-45; WORKFLOW.md:794-797; src/ui/laser/JobControls.tsx:60-61 (banner sits directly above StartFromLineControl)
- **Recommendation:** Add an optional offset field (or a second 'Resume earlier…' action pre-filling Start-from-line with the mapped line) to the banner.

#### A.1.12 [POLISH] Truncated comment in project-shape-validator.ts leaves the coordinate-cap rationale half-missing

_Area: architecture · Effort: S_

Line 51 is a dangling sentence fragment ('// which the G-code bounds-check regex can't read — defeating the bounds') with no first half — the explanation of WHY MAX_COORDINATE_MAGNITUDE_MM exists (non-finite/huge values defeating the bounds regex) was evidently lost in an edit. Given this comment documents a security invariant, restore it.

- **Evidence:** src/io/project/project-shape-validator.ts:49-52
- **Recommendation:** Restore the full sentence (e.g., 'Coordinates are capped because absurd magnitudes serialize to exponent notation, which the G-code bounds-check regex can't read — defeating the bounds check').

**Not verified in this sector:**

- Any hardware behavior: a real crash + resume on the machine (ADR-118 itself marks this CLAIMED), and whether GRBL/grblHAL actually rejects 'G0 ZInfinity' with an error rather than misparsing it — inferred from GRBL parser behavior, not tested.
- How runControllerReadiness behaves under prepareResume's omitted settingsCapability (defaults to 'grbl-dollar' at start-job-readiness.ts:126-128) on Marlin/Smoothie/FluidNC — the readiness module itself was not read, so I cannot say whether resume is wrongly blocked or wrongly relaxed on non-GRBL controllers.
- LightBurn's exact autosave default interval, backup-file lifecycle, and crash-restore dialog wording — stated from general product knowledge, not verified this session.
- Whether the F-A12 edge ('device profile not on this machine' status-bar warning) exists anywhere else in the app — the load path shows none, but I did not search the whole UI.
- Electron-side persistence details (localStorage partition/persistence configuration in electron/) — not read; autosave/checkpoint were verified on the shared renderer path only.
- Whether an older shipped KerfDesk build actually drops the machine/groups blocks on load — inferred from the current tree's normalizeMachineValue contract; historical builds were not checked out.
- The remaining ~10 project-*.test.ts feature files were spot-checked (project.test.ts, migrations, registration-jig, security), not individually read.
- Behavior of the fingerprint/resume flow when prepared gcode contains the provenance metadata header only on Save (file-actions comment says the streamed Start path omits it) — I did not verify emitGcode metadata does not differ between the checkpointed start and the resume recompile.

---

## A.2 Electron desktop platform: security posture, auto-update & web-vs-desktop parity — grade B+

The Electron shell is unusually well-hardened for its class: contextIsolation/sandbox/nodeIntegration/webSecurity are all set correctly AND there is no preload, no contextBridge and no ipcMain surface at all, so the renderer is a pure Chromium web page whose every capability (serial, File System Access, camera, wake-lock) flows through deny-by-default permission handlers gated to trusted origins. The renderer runs on a custom secure `app://` scheme with a path-traversal guard, CSP is set via onHeadersReceived with `script-src 'self'` (no eval/inline JS) and is deliberately mirrored between web and desktop, and the RTSP/frame camera bridge is loopback-only with an Origin gate that fires before side effects, a private-network egress guard, redirect:'error', and array-arg ffmpeg spawns (no shell injection). The headline weakness is the auto-update channel: v1 ships unsigned and electron-updater performs no code-signature verification, so a tampered `latest.yml`+`.exe` on the pinned feed (via origin/DNS/TLS compromise or a leaked R2 token) is silently downloaded and installed on quit — a real RCE window that ADR-024 §5 acknowledges but leaves without any compensating integrity control. Secondary issues are documentation drift on the authoritative security posture (PROJECT.md understates the permission allowlist and mislabels the build as signed) and the bridge's cross-origin trust of the hosted site plus every `*.pages.dev` preview. No critical safety or machine-output defect was found in this subsystem, and none of the desktop-only surfaces (updater, serial picker, bridge) can be, or were, verified without a packaged Windows run.

**What's great:**

- **Zero-IPC, no-preload renderer — capability by permission handler, not by bridge** — The window sets contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true AND ships no preload, no contextBridge and no ipcMain/ipcRenderer anywhere in electron/. The renderer therefore has no privileged escape hatch; serial, File System Access, camera (media/video-only) and screen-wake-lock are the only grants, each gated to the trusted main-frame origin. This removes the single largest Electron attack surface (unvalidated IPC) by construction rather than by validation. _(electron/main.ts:146-151, 225-278; trusted-renderer-policy.ts:63-121; grep confirms no preload/contextBridge/ipcMain in electron/**)_
- **Custom app:// secure scheme with path-traversal guard replaces file://** — protocol.registerSchemesAsPrivileged marks `app` standard+secure so the renderer behaves like HTTPS, and the handler re-resolves every request under dist/web and 404s anything whose path.relative escapes the root — closing the ../../etc/passwd class while giving CSP a predictable origin. _(electron/main.ts:102-136, 396-404)_
- **Camera bridge SSRF hardening is layered and side-effect-ordered** — The bridge binds 127.0.0.1 only, refuses an untrusted browser Origin with 403 BEFORE any ffmpeg/RTSP work (not just via CORS), restricts every proxied URL to loopback/RFC1918 via a shared egress guard, uses fetch redirect:'error', blocks recursing into itself, bounds concurrent ffmpeg transcodes, caps frame bytes, and spawns ffmpeg with an argv array (no shell). Because only IP literals/`localhost` pass the guard, there is no DNS-rebinding window. _(electron/rtsp-camera-bridge.ts:46-52,190-262; camera-frame-proxy.ts:123-138; camera-frame-proxy-policy.ts:15-60; rtsp-camera-stream.ts:11-49)_
- **Burn-safe, pinned, packaged-only update model** — configureAutoUpdater is inert unless app.isPackaged, never calls quitAndInstall (install-on-quit only so it cannot abort a running burn per non-negotiable #9), routes check failures to onError instead of crashing startup, and the feed URL is pinned in electron-builder.yml — honoring 'no auto-update from arbitrary URLs'. _(electron/auto-update.ts:37-47; electron/main.ts:405-411; electron-builder.yml:44-47; DECISIONS.md ADR-024 §2-§4)_
- **One web adapter drives both targets, so web/desktop behavior is identical by construction** — main.tsx injects the same webAdapter for both platforms and only overrides id to 'electron' for cosmetic feature-gating; is-electron.ts is documented as a UI hint that never gates capability. This makes the laser/CNC/file/serial/camera pipelines provably the same on both surfaces rather than two code paths that can diverge. _(src/ui/app/main.tsx:24-27; src/platform/electron/is-electron.ts:1-26; src/platform/web/web-adapter.ts:96-103)_
- **Web and Electron CSPs are mirrored, transport-hardened, and script-src is strict** — Both surfaces use default-src 'self' with script-src 'self' (no unsafe-inline/eval), object-src none, base-uri self, form-action none, frame-ancestors none; the web _headers adds HSTS, X-Frame-Options DENY, nosniff, no-referrer and a Permissions-Policy that enables camera/serial only for self while denying microphone/usb/geolocation. 'unsafe-inline' is confined to style-src (React inline styles), not scripts. _(electron/main.ts:79-91; public/_headers:12-24)_

**Findings:**

#### A.2.1 [MAJOR] Auto-update channel has no signature verification — a tampered update on the pinned feed installs silently on quit

_Area: mechanism · Effort: L · verified: CONFIRMED_

v1 ships unsigned (CSC auto-discovery forced off) and the generic electron-updater feed performs no code-signature check; the only integrity control is the SHA512 in latest.yml, fetched over TLS from dl.kerfdesk.com (R2). Anyone who can serve that origin (R2/API-token compromise, DNS, or a mis-issued TLS cert + MITM) can publish a higher-version malicious latest.yml + .exe with a matching hash; autoDownload+autoInstallOnAppQuit then applies it on the next quit with no operator gate — remote code execution. ADR-024 §5 concedes the channel is unhardened until signing lands ('once signed, electron-updater verifies the publisher signature'). Downgrade is refused by electron-updater's default allowDowngrade=false, but tamper-with-higher-version is not. Maps to the Electron security posture's own 'no auto-update from arbitrary URLs' intent and the general secure-auto-update baseline (code-signed/verified updates).

- **Evidence:** electron/auto-update.ts:37-47; electron-builder.yml:44-47 (publish generic, no win signing block); .github/workflows/release-desktop.yml:88-90 (CSC_IDENTITY_AUTO_DISCOVERY false when no secret); DECISIONS.md ADR-024 §5
- **Reference:** Not a LightBurn parity question; baseline is code-signed/verified desktop auto-update (electron-builder + a signed publisher, or an out-of-band signature). ADR-024 §5 records shipping unsigned as a deliberate deferral.
- **Recommendation:** Until code signing lands, either switch to notify-only (drop autoInstallOnAppQuit and require an explicit user action to install) or add an out-of-band integrity check the app controls — e.g. sign latest.yml with a minisign/ed25519 key pinned in the app and refuse any update whose signature fails. Track the CLOUDFLARE_API_TOKEN as a high-value secret. Re-audit once win signing + verifyUpdateCodeSignature are enabled.

#### A.2.2 [MAJOR] Security-posture doc understates the actual Electron permission allowlist (camera + wake-lock omitted)

_Area: architecture · Effort: S · verified: CONFIRMED → minor_

PROJECT.md's Security posture states the permission handler 'returns false except for serial and any fileSystem* permission,' but the shipped policy also grants `media` (video-only camera capture) and `screen-wake-lock`. The code itself is correctly gated (main-frame + trusted origin, audio denied), but the authoritative security document a reviewer or downstream auditor would trust omits that the desktop shell enables camera capture and keep-awake. This is exactly the kind of doc/code drift the maintainer's 'no invention / verify' rules exist to catch, and it hides a real capability (camera) from the posture summary.

- **Evidence:** PROJECT.md:427 vs electron/trusted-renderer-policy.ts:94-121; DECISIONS.md ADR-117 (adds screen-wake-lock), ADR-107/ADR-108 (camera media)
- **Recommendation:** Update PROJECT.md line 427 (and the ADR-024 hardening note) to list the full allowlist: serial, fileSystem*, media (video-only, main-frame, trusted origin), screen-wake-lock — and cite ADR-117/ADR-107. Consider a test that asserts the allowlist set matches the documented list so the two cannot drift again.

#### A.2.3 [MAJOR] Loopback camera bridge is drivable cross-origin by the hosted site and every *.pages.dev preview; usable as a private-network + localhost scanner

_Area: mechanism · Effort: M · verified: CONFIRMED_

The bridge trusts Origin https://kerfdesk.com and any host ending in `.laserforge-2fj.pages.dev`, and opts into Private Network Access (Access-Control-Allow-Private-Network:true). While the desktop app runs the bridge, any such origin the operator visits in a normal browser can call /discover, /frame.jpg?url=, /probe and /stream.mjpg to enumerate RFC1918 and localhost hosts, read machine-camera frames, and spawn ffmpeg. The private-only egress guard blocks public SSRF and the content-type/JPEG-magic check limits exfiltration to image-shaped responses, but port-open/host-up detection via timing/errors remains, and the frame proxy allows loopback targets on any non-bridge port (only the bridge's own port is refused). The `.pages.dev` wildcard is the weakest link: every Cloudflare Pages preview build of this project (any branch/PR) is trusted. This is the documented ADR-121 design, so it is a residual-risk finding rather than a contract violation.

- **Evidence:** electron/rtsp-camera-bridge.ts:199-242 (isTrustedHostedAppOrigin wildcard, CORS), 30-52 (Origin gate); camera-frame-proxy-policy.ts:34-59 (loopback allowed, only own port blocked); DECISIONS.md ADR-121
- **Recommendation:** Drop the `.pages.dev` subdomain wildcard (pin the exact production origin, or gate previews behind a dev-only flag), and refuse ALL loopback targets in the frame proxy (not just the bridge's own port) so the proxy cannot read other localhost services. Consider requiring a per-session bridge token the desktop renderer knows, rather than trusting an Origin header a remote page controls.

#### A.2.4 [MINOR] Egress guard rejects all IPv6 private hosts except ::1 (no ULA/link-local) — IPv6 machine cameras silently unreachable

_Area: mechanism · Effort: S_

isAllowedPrivateNetworkHost accepts loopback (localhost, ::1, 127.x) and RFC1918 IPv4 only; fc00::/7 ULA, fe80::/10 link-local and any other IPv6 fall through to the IPv4 parser and are refused. This is safe (it is an under-allow, so it is NOT the over-allow class the earlier fc00::/fd00:: egress-guard bug was about), but it means a camera reachable only over IPv6 cannot be proxied or probed, with an opaque 'private-network hosts only' error. Note the earlier audit's isPrivateHost (ADR-123 LAN transport) is a different function/module not present in this tree, so that specific fix could not be cross-checked here.

- **Evidence:** electron/private-network-host-policy.ts:7-36; private-network-host-policy.test.ts:6-28 (no IPv6-ULA cases)
- **Recommendation:** If IPv6 cameras are in scope, extend the guard to accept fc00::/7 and fe80::/10 (parse the IPv6 literal rather than routing it through the dotted-quad parser) with tests; otherwise document the IPv4-only limitation in WORKFLOW F-CAM6. Keep the conservative default — do not broaden to 'any non-public IPv6'.

#### A.2.5 [MINOR] No OS file association / file re-open on desktop — double-clicking a project file does not open KerfDesk

_Area: workflow · Effort: M_

electron-builder.yml declares no fileAssociations and main.ts has no second-instance/open-file/argv handling, so a .lf2 project or SVG double-clicked in Explorer (or 'Open with') will not launch or load into the desktop app. LightBurn registers .lbrn/.lbrn2 and opens them on double-click, so this is a muscle-memory parity gap for a LightBurn user moving to the desktop build. It is not a web-vs-desktop asymmetry that is recorded anywhere, and the desktop app is the surface where users expect native file-open behavior.

- **Evidence:** electron-builder.yml:17-31 (nsis, no fileAssociations); electron/main.ts (no 'open-file'/'second-instance'/argv parsing); WORKFLOW.md F-DESK1/F-DESK3 do not mention associations
- **Reference:** LightBurn associates its project extensions and opens a file on double-click / drag-to-icon. KerfDesk desktop supports drag-into-window only (WORKFLOW.md line 72), not shell-launch.
- **Recommendation:** Add electron-builder win.fileAssociations for the project/SVG/G-code extensions and handle the launch path (Windows argv on first run, plus 'second-instance' to route the file to the running window). Document the flow in WORKFLOW.md; verify on real Windows (release-manual).

#### A.2.6 [MINOR] PWA service-worker update path is not platform-gated; desktop correctness relies on Chromium refusing SW on app://

_Area: architecture · Effort: S_

PwaUpdatePrompt/useRegisterSW mount in both targets (main.tsx renders App unconditionally). On the packaged app:// scheme, SW registration is expected to fail and onRegisterError logs 'Service worker registration failed; offline mode unavailable', so the web 'new version available' banner never appears and only electron-updater updates the desktop. That single-update-story is correct only as long as Chromium keeps rejecting service workers on the custom secure scheme; there is no explicit isElectronRenderer guard, and a future Chromium that allowed SW on app:// could surface a second update mechanism and let a cached precache mask electron-updater's on-disk swap. The desktop also logs a misleading offline-unavailable error every launch.

- **Evidence:** src/ui/app/main.tsx:24-37; src/ui/app/PwaUpdatePrompt.tsx:35-56; DECISIONS.md ADR-024 (mirrors ADR-060 but does not gate SW off on desktop)
- **Recommendation:** Skip useRegisterSW when isElectronRenderer() (the desktop is offline via the packaged bundle and updates via electron-updater), making the single-update-story explicit and silencing the per-launch error. Add a note to ADR-024/ADR-060 that SW registration is web-only.

#### A.2.7 [MINOR] will-navigate guard reads event.url.length and can throw before preventDefault (fail-open); no will-redirect/frame-navigate handling

_Area: mechanism · Effort: S_

installNavigationPolicy computes `const targetUrl = event.url.length > 0 ? event.url : url` — if event.url is undefined this throws inside the handler before preventDefault runs, which fails open (navigation proceeds). Real risk is low because the app is same-origin with no external links, but the pattern inverts the intended default of a security control. The handler also does not cover will-redirect or will-frame-navigate, so it is narrower than the Electron checklist's 'limit navigation' item.

- **Evidence:** electron/main.ts:280-293
- **Recommendation:** Use the second `url` parameter directly (it is always provided) and drop the event.url dereference; add will-redirect (and, if frames are ever introduced, will-frame-navigate) to the same trusted-origin check. Exact Electron Event.url nullability should be confirmed against the pinned Electron version.

#### A.2.8 [MINOR] Cross-boundary duplication: machine-camera host list and the two CSP strings are kept in sync by comment only

_Area: architecture · Effort: S_

The machine-camera candidate hosts are duplicated between electron/camera-frame-proxy.ts (MACHINE_CAMERA_FRAME_URL_CANDIDATES) and src/platform/web/web-camera.ts (NETWORK_CAMERA_HOSTS) because electron/ cannot import from src/; a comment says 'update both together' but no test pins parity. Separately, public/_headers and electron/main.ts each carry the full CSP with a 'keep aligned' comment, and csp-policy.test.ts only asserts a few substrings appear in both — not that the policies are equivalent — so a tightening in one surface could silently fail to reach the other.

- **Evidence:** electron/camera-frame-proxy.ts:26-33; src/platform/web/web-camera.ts:14-23; electron/csp-policy.test.ts:9-29 (substring-only); public/_headers:13 vs electron/main.ts:79-91
- **Recommendation:** Add a small structural test asserting the two host lists are identical and that the web/Electron CSP directive sets match (parse both, compare directive-by-directive), so the documented 'update both' invariant is enforced rather than trusted.

#### A.2.9 [MINOR] PROJECT.md drift: claims src/platform/electron/ does not exist and that the .exe is signed

_Area: architecture · Effort: S_

PROJECT.md line 299 states 'there is no src/platform/electron/', but that directory exists (index.ts, is-electron.ts, is-electron.test.ts, release-desktop-workflow-gate.test.ts). Line 305 lists the build output as 'signed Windows .exe', but ADR-024 §5 and the release workflow ship it unsigned. Both are low-impact but are the kind of unverified claims CLAUDE.md forbids, and they mislead a new contributor about where platform code lives and what the shipped artifact's trust level is.

- **Evidence:** PROJECT.md:299,305 vs src/platform/electron/ (Glob), DECISIONS.md ADR-024 §5, .github/workflows/release-desktop.yml:30,88-90
- **Recommendation:** Correct PROJECT.md: acknowledge src/platform/electron/ holds the renderer-side Electron detection/gates, and change 'signed Windows .exe' to 'unsigned in v1 (ADR-024 §5); signing is secret-gated'.

**Not verified in this sector:**

- Runtime behavior of the PWA service worker on the packaged app:// scheme (whether registration actually fails so the web update banner stays inert on desktop) — inferred from Chromium scheme rules and the onRegisterError path, not observed; I did not run the packaged app.
- electron-updater's actual signature and downgrade behavior on an unsigned generic R2 feed — derived from ADR-024 §5's own admission and the config, not executed; the exact allowDowngrade default and tamper path for the pinned electron-updater version were not run.
- Whether a packaged build actually grants serial / media(video) / screen-wake-lock at runtime — ADR-117 itself marks the packaged wake-lock grant CLAIMED; I read the policy code but ran nothing.
- The exact Electron Event.url nullability for will-navigate on the pinned Electron version (the fail-open throw is a static-read concern, not reproduced).
- The prior audit's isPrivateHost fc00::/fd00:: egress-guard fix could not be confirmed in THIS tree: that function belongs to the ADR-123 LAN-transport work on another branch and is absent here; only the camera-side isAllowedPrivateNetworkHost was reviewed (and it is conservative/safe).
- No packaged-installer / hardware verification of auto-update install-on-quit, the native serial-port picker dialog, or the camera bridge — all are release-manual and marked CLAIMED in WORKFLOW.md F-DESK3; per instructions I did not run the dev server, builds, or the test suite.
- The live R2/Cloudflare feed contents (latest.yml, .blockmap, stable-alias .exe) and DNS/TLS configuration of dl.kerfdesk.com were not inspected — only the CI workflow that publishes them.
- Whether the web app on the deployed https origin can in practice reach http://127.0.0.1:51731 (mixed-content + PNA acceptance) was reasoned from CSP/_headers and the bridge's PNA handling, not exercised in a browser.

---

## A.3 Non-GRBL controller stack: Ruida .rd binary path, grblHAL/FluidNC drivers & controller auto-detection — grade B

The multi-controller seam (ADR-094..097) is architecturally excellent and unusually honest: drivers are pure data+function objects resolved once at connect, grblHAL really is a 4-line delta and FluidNC an 8-line capability delta pinned by a divergence test, banner auto-detection is correctly ordered (FluidNC before generic GRBL, grblHAL cannot fall through) and advisory-only exactly as WORKFLOW F-H1 specifies, and the Ruida path refuses rasters, toasts EXPERIMENTAL on every save, and has no UDP socket anywhere in the tree so unverified bytes cannot reach a live laser. But the audit found the capability-gating promise breached in the one place it matters most: the mid-job Feed/Spindle/Rapids override buttons are mounted for every family and write GRBL-only realtime bytes into Marlin/Smoothieware streams; the post-job settle hardcodes GRBL's 'G4 P0.01' instead of the driver's settleDwell (Marlin's M400) in direct contradiction of ADR-095 and the repo's own simulator; and nothing couples streamingMode to controllerKind, so the wizard's own detection flow can mint a char-counted Marlin profile the catalog comment calls unsafe. The .rd encoder is verified only against the repo's own decoder (circular by construction, though honestly labeled everywhere except an encoder comment claiming nonexistent 'golden hex fixtures'), and every non-GRBL family remains simulator-verified only — no hardware or reference-file evidence exists in the tree.

**What's great:**

- **ControllerDriver seam is pure data + pure functions, and the delta discipline is test-pinned** — Each family is a plain object of command strings, nullable realtime bytes, and pure classifiers (controller-driver.ts:1-82); the store resolves it once at connect and snapshots capabilities into Zustand (laser-connection-actions.ts:52-62). grblHAL is literally {...grblDriver, kind, label} (grblhal/driver.ts:9-13) and grbl-family-drivers.test.ts:14-32 pins exactly which fields may diverge so an accidental fork fails loudly. _(src/core/controllers/controller-driver.ts:1-82; src/core/controllers/grblhal/driver.ts:9-13; src/core/controllers/grbl-family-drivers.test.ts:14-32)_
- **Capability flags encode failure modes, not feature lists** — probing is restricted to GRBL-grammar firmwares with the false-success/zero-Z-at-wrong-height rationale written into the type; cncJobs is gated on the G4-P-seconds-vs-milliseconds dialect trap (a 3 s spindle spin-up would become 3 ms on Marlin). Both are asserted per-family in tests, so the safety reasoning is executable. _(src/core/controllers/controller-capabilities.ts:57-66; src/core/controllers/grbl-family-drivers.test.ts:41-62)_
- **The untracked-ack ledger generalizes ack attribution across families** — Every non-job newline owes exactly one terminal ack — so a Marlin/Smoothie multi-line jog (G91\nG0…\nG90) counts three — and Start blocks until the ledger drains (1.5 s budget) so a stale ok can never phantom-refill a fresh job stream past the real RX buffer. This is the cross-family fix for the class of accounting bugs that corrupt char-counted streams. _(src/ui/state/laser-safe-write.ts:88-101; src/ui/state/laser-job-actions.ts:41-63; src/ui/state/laser-stream-ack.ts:22-28)_
- **Marlin queued-poll discipline implements ADR-095 exactly** — The M114 poll is suppressed whenever the streamer status is streaming/paused (not merely when lines are in flight, closing the refill race), whenever any in-flight line remains, and whenever a controller command awaits its ack; echo:busy is explicitly not an ack. The 'done' stream still polls so the post-job settle can observe Idle. _(src/ui/state/laser-connection-actions.ts:232-241; src/ui/state/laser-store-helpers.ts:46-56; src/ui/state/laser-line-handler.ts:69-71)_
- **Ruida honesty pipeline is enforced in code, not just prose** — encodeRdJob returns typed refusals for raster groups and empty jobs rather than guessing; every successful save toasts the EXPERIMENTAL not-hardware-verified warning; the catalog evidence note repeats it; the decoder names itself a test instrument proving only internal consistency; and grep confirms no dgram/socket code exists anywhere, so the sim-tested UDP session is physically unreachable from any build — exactly ADR-097's 'never stream unvalidated bytes to a live CO2 laser'. _(src/core/controllers/ruida/rd-encoder.ts:44-57; src/ui/app/save-rd-action.ts:11-12,43; src/core/devices/profile-catalog.ts:202-208; src/__fixtures__/controllers/ruida-decoder.ts:1-6; src/core/controllers/ruida/ruida-udp-session.ts:1-9)_
- **.rd export runs the identical prepareOutput pipeline as G-code** — emitRdFile calls the same prepareOutput used for preview/estimate/G-code save, then re-applies the geometry preflights that make sense for a binary format (job bounds, no-go zones) before encoding — so Ruida preview, estimate, and exported bytes derive from one Job and cannot disagree (ADR-040 preview=save carried into the binary path). _(src/io/rd/emit-rd.ts:1-46)_

**Findings:**

#### A.3.1 [MAJOR] Realtime override buttons are mounted for every controller family and write GRBL-only override bytes to Marlin/Smoothieware mid-job

_Area: ui-layout · Effort: S · verified: CONFIRMED_

ControllerCapabilities has no overrides flag (controller-capabilities.ts:40-67), and nothing in the mount or send path checks the family: JobRunControls mounts OverrideControls purely on isStreaming||isPaused (JobRunControls.tsx:60,67-69), OverrideControls fires GRBL 1.1 extended bytes (RT_FEED_OV_MINUS_10 etc., grbl/commands.ts:147 RealtimeOverrideByte) via sendRealtimeOverride, and override-actions.ts:12-18 writes the byte straight through safeWrite with no capability gate. ADR-095's own context says 'Marlin has NO realtime bytes' (DECISIONS.md ADR-095), yet a Marlin or Smoothieware job shows live Feed/Spindle/Rapids buttons. The Ov: readout stays '—' forever on those families (no Ov field is ever parsed), so the control also looks broken. This is the direct counterexample to the first wave's 'UI gates on capabilities not kind' praise.

- **Evidence:** src/ui/laser/JobRunControls.tsx:60,67-69; src/ui/laser/OverrideControls.tsx:22-25; src/ui/state/override-actions.ts:12-18; src/core/controllers/controller-capabilities.ts:40-67 (no override field); DECISIONS.md ADR-095 (Marlin has NO realtime bytes)
- **Reference:** LightBurn only offers live power/speed adjustment on controllers that support it; the repo's own ADR-094 rule ('capability gating, never kind-checking, in ui/') is the stated baseline and is violated here.
- **Recommendation:** Add an overrides capability to ControllerCapabilities (true only for grbl-v1.1/grblhal/fluidnc), gate the OverrideControls mount and sendRealtimeOverride on it, and pin the per-family values in grbl-family-drivers.test.ts. Note the raw 0x91-0x9D byte lands in Marlin/Smoothie's line buffer mid-stream — the exact firmware reaction (corrupt next queued line vs ignore) is unverified, which is itself the reason to never send it.

#### A.3.2 [MAJOR] Post-job settle bypasses the driver seam: hardcoded GRBL 'G4 P0.01' is sent to every family instead of driver.commands.settleDwell

_Area: mechanism · Effort: S · verified: CONFIRMED_

laser-post-job-settle.ts:21 defines SETTLE_DWELL_COMMAND = 'G4 P0.01\n' as a module constant and sends it after every job (line 51), ignoring driver.commands.settleDwell — the field ADR-095 created precisely because Marlin's marker must be M400 (marlin/commands.ts:11-13). The repo's own documentation says Marlin reads G4 P as MILLISECONDS (controller-capabilities.ts:62-66 and grbl-family-drivers.test.ts:54-55), and the repo's own Marlin simulator acks a G4 line immediately via handleMotion without draining pendingMotions (marlin-simulator.ts:86-87,133 — only M400 waits, lines 114-117). Combined with Marlin's synthesized always-'Idle' M114 report (marlin/response.ts:47-49), the post-job settle can log 'Controller settled after job' and clear the streamer while buffered motion is still executing. The home action uses the seam correctly (laser-home-action.ts:85), making this the one divergent call site.

- **Evidence:** src/ui/state/laser-post-job-settle.ts:21,51; src/core/controllers/marlin/commands.ts:11-13; src/core/controllers/controller-capabilities.ts:62-66; src/__fixtures__/controllers/marlin-simulator.ts:114-117,86; src/ui/state/laser-home-action.ts:85; src/core/controllers/marlin/response.ts:37-49
- **Reference:** Not a LightBurn-visible behavior; the baseline is the repo's own ADR-095 decision ('settle marker = M400') which this call site violates.
- **Recommendation:** Replace the constant with refs.driver.commands.settleDwell (already threaded through ControllerLifecycleRefs) and add a Marlin lifecycle simulator test asserting the post-job settle sends M400 and does not complete until pendingMotions drains.

#### A.3.3 [MAJOR] streamingMode is never coupled to controllerKind: the Device Setup wizard's detection overlay can produce a char-counted Marlin profile ADR-095 calls unsafe

_Area: workflow · Effort: M · verified: CONFIRMED_

Ping-pong for Marlin/Smoothieware exists only as data in the two catalog profiles (profile-catalog.ts:148,173, with the comment 'ping-pong is the only safe streaming mode' at 146-147). Nothing enforces it: initDeviceSetup overlays detectedControllerKind onto the draft without touching streamingMode (device-setup-flow.ts:97-101), so a user who starts from any GRBL profile (default streamingMode 'char-counted', device-profile.ts:240), connects to a Marlin board, and accepts the wizard's detection finishes with controllerKind:'marlin' + char-counted streaming. deserialize-project.ts normalizes the two fields independently (lines 225 and 246-249), and neither start-job-readiness nor startJob checks the combination (start-job-flow.ts:62-64 passes project.device.streamingMode verbatim). The streamer would then keep up to 128 unacked bytes in flight against a firmware with no buffer reporting.

- **Evidence:** src/ui/laser/device-setup/device-setup-flow.ts:97-101; src/core/devices/profile-catalog.ts:146-148,173; src/core/devices/device-profile.ts:240; src/io/project/deserialize-project.ts:225,246-249; src/ui/laser/start-job-flow.ts:62-64
- **Reference:** LightBurn ties buffering strategy to the device type chosen at device creation; a Marlin-type device never char-counts.
- **Recommendation:** Add a defaultStreamingMode (or forcedStreamingMode) to ControllerDriver; have the wizard's detection overlay and profile normalization derive it from the kind, and add a start-readiness refusal (or hard override) when controllerKind is marlin/smoothieware and streamingMode is char-counted.

#### A.3.4 [MAJOR] .rd verification is circular (encoder round-trips only through the repo's own decoder) and the encoder header claims 'golden hex fixtures' that do not exist

_Area: mechanism · Effort: L · verified: CONFIRMED_

The only checks on the Ruida byte stream are: swizzle round-trip, number-encoding round-trip, encode-twice determinism, and decode via src/__fixtures__/controllers/ruida-decoder.ts — which shares rd-numbers and mirrors the encoder's command vocabulary, so any systematic misreading of the public protocol (wrong opcode, wrong unit) round-trips green (ruida.test.ts:96-137; decoder self-labels as internal-consistency-only at ruida-decoder.ts:1-4). No LightBurn- or MeerK40t-produced reference .rd exists in the tree to diff against, and no test file exists for src/io/rd/emit-rd.ts or save-rd-action.ts at all (Glob src/io/rd/*.test.ts: none). rd-encoder.ts:4-5 claims determinism is pinned by 'golden hex fixtures' — no such fixture exists, violating the no-invention rule in the one subsystem whose whole story is honesty labeling. Additionally the encoder writes the single layer power into BOTH min (0xC6 0x31) and max (0xC6 0x32) power (rd-encoder.ts:68-69), a divergence from LightBurn's separate Min/Max Power layer controls on Ruida (min==max disables the DSP's cornering power ramp-down) that ADR-097 does not record.

- **Evidence:** src/core/controllers/ruida/rd-encoder.ts:4-5,68-69; src/core/controllers/ruida/ruida.test.ts:96-137; src/__fixtures__/controllers/ruida-decoder.ts:1-6; DECISIONS.md ADR-097 (round-trip verification, next step = validate against real controller or reference files); no files match src/io/rd/*.test.ts
- **Reference:** LightBurn is the de-facto reference producer of .rd files; its Ruida layers expose Min Power and Max Power separately. The experimental status itself IS recorded in ADR-097; the false fixture claim and the min==max mapping are not.
- **Recommendation:** Fix the rd-encoder.ts header (or add a real golden hex fixture). Acquire one LightBurn-exported .rd for a known simple job and add a comparison/decode test against it before any hardware pass; record the min==max power decision in ADR-097 or plumb a separate min power. Add emit-rd.ts tests (preflight refusals, bounds).

#### A.3.5 [MINOR] Smoothieware status parsing only accepts GRBL-1.1 pipe format; comma-delimited Smoothie reports would classify as unknown, killing DRO, Idle gating, and Alarm detection

_Area: mechanism · Effort: S_

classifySmoothieResponse delegates to the GRBL parseStatusReport (smoothieware/response.ts:24-27), which splits fields on '|' (status-parser.ts:104) — a comma-format report like <Idle,MPos:0.0,0.0,0.0,WPos:...> parses to null and falls to 'unknown'. The Smoothie simulator only ever emits the pipe/grbl-mode format (smoothie-simulator.ts:65), so the suite cannot catch this. If a real Smoothieware build emits the comma format (older/stable builds without the newer status format — NOT verified this session), the DRO never updates, controllerIdle stays false (JogPad disabled, LaserWindow.tsx:52,92-93), and the F-H3 halt flow cannot show the alarm banner from status state. ADR-096 already admits the driver is simulator-verified only.

- **Evidence:** src/core/controllers/smoothieware/response.ts:24-27; src/core/controllers/grbl/status-parser.ts:100-110; src/__fixtures__/controllers/smoothie-simulator.ts:59-66; src/ui/laser/LaserWindow.tsx:52,92-93; DECISIONS.md ADR-096 (simulator-verified only)
- **Reference:** LightBurn's Smoothieware device type works against stock Smoothie boards without requiring a status-format config change (its parser tolerates the classic format).
- **Recommendation:** Teach parseStatusReport (or a Smoothie-specific wrapper) to also split the classic comma format, and document any grbl_mode/new_status_format firmware requirement in the catalog profile note until a hardware pass settles which format real boards emit.

#### A.3.6 [MINOR] grblHAL driver comment claims extended error tables, but error codes stop at vanilla GRBL's 38 and unknown numeric codes are stripped to null

_Area: mechanism · Effort: S_

grblhal/driver.ts:1-4 says 'extended alarm/error code tables handled by the shared describe* lookups'. Alarms partially deliver (grblHAL codes 10-13 present, alarm-codes.ts:84-114), but error-codes.ts ends at code 38 (lines 15-135) — grblHAL's extended errors (39+) are absent — and matchError deliberately degrades any code without a table entry to { code: null } keeping only the raw string (response.ts:60-68). A grblHAL line rejection mid-job still terminates the stream safely, but the operator gets no explanation and structured state loses the code number. The comment overstates what exists.

- **Evidence:** src/core/controllers/grblhal/driver.ts:1-4; src/core/controllers/grbl/error-codes.ts:15-135; src/core/controllers/grbl/response.ts:60-68; src/core/controllers/grbl/alarm-codes.ts:84-114
- **Reference:** LightBurn ships grblHAL-aware error text for common extended codes on its GRBL device type.
- **Recommendation:** Either extend the error table with the documented grblHAL codes (39-79 range) or correct the driver comment to 'alarms only'; keep the numeric code in the error event even when undescribed so the UI/log can show 'error:45'.

#### A.3.7 [MINOR] Ruida save dispatch is a controllerKind check in ui/, the pattern ADR-094 bans

_Area: architecture · Effort: S_

file-actions.ts:137 routes Save to the .rd path via ctx.project.device.controllerKind === 'ruida'. ADR-094 decision 2 states 'kind === \'grbl\' in ui/ is the same anti-pattern class as platform conditionals', and the sibling gate in LaserWindow.tsx:60-61 already does it right (driver capabilities.transport === 'file-only'). A second binary-output family (e.g. a future .lbrn or Trocen format) would force shotgun edits at this call site instead of a capability/strategy lookup.

- **Evidence:** src/ui/app/file-actions.ts:136-141; src/ui/laser/LaserWindow.tsx:60-61; DECISIONS.md ADR-094 decision 2
- **Reference:** Not applicable (internal architecture); baseline is the repo's own ADR-094 rule.
- **Recommendation:** Gate on selectControllerDriver(kind).capabilities.transport === 'file-only' or introduce an outputFormat: 'gcode-text' | 'rd-binary' capability consumed by both the save action and LaserWindow.

#### A.3.8 [MINOR] File menu still says 'Save G-code...' on Ruida profiles even though it writes a binary .rd — the file-only hint itself has to explain the mislabel

_Area: ui-layout · Effort: S_

The command label 'Save G-code...' is static (command-families.ts:46) regardless of device; for Ruida it produces a .rd. The Laser-rail hint literally reads 'use Save G-code… to write an experimental .rd job' (LaserWindow.tsx:111-114) — the UI apologizing for its own label. WORKFLOW F-H4 documents the routing ('Save G-code… writes a .rd file instead') but not the label choice; LightBurn relabels the action per device.

- **Evidence:** src/ui/commands/command-families.ts:46; src/ui/laser/LaserWindow.tsx:111-114; WORKFLOW.md F-H4
- **Reference:** LightBurn's File menu shows 'Save RD file' when the active device is Ruida (stated from product knowledge, not re-verified this session).
- **Recommendation:** Make the command label device-aware ('Save .rd file…' when the active driver is file-only/rd), and update the LaserWindow hint to match.

#### A.3.9 [MINOR] FluidNC console still accepts numeric $N=value setting writes that the capability model says the app must not send

_Area: workflow · Effort: S_

fluidncDriver inherits GRBL's prepareConsoleCommand unchanged (fluidnc/driver.ts:10-19), whose SETTING_WRITE_RE path accepts '$32=1' etc. as a confirmable setting-write (console-command.ts:35,59-61). Meanwhile the settings capability is 'readonly-dump', the Guarded Writes panel refuses ('This controller does not accept numeric $ setting writes from the app', MachineSetupController.tsx:57-69), and the grbl-settings action blocks writes (grbl-settings-actions.ts:93). The driver's own header says FluidNC legacy-maps or IGNORES numeric writes — so the console can accept a write, show ok, and change nothing, silently desyncing the operator's mental model (and the app's harvested $$ snapshot on next read).

- **Evidence:** src/core/controllers/fluidnc/driver.ts:1-19; src/core/controllers/grbl/console-command.ts:35,59-61; src/ui/laser/MachineSetupController.tsx:57-69; src/ui/state/grbl-settings-actions.ts:93
- **Reference:** LightBurn lets console traffic through raw on all GRBL-family devices, so raw parity exists — but KerfDesk's own capability contract (readonly-dump) is the baseline being contradicted.
- **Recommendation:** Give fluidncDriver a prepareConsoleCommand override that rejects (or warns on) numeric $-writes with a pointer to FluidNC's YAML config, consistent with the panel's message.

#### A.3.10 [MINOR] .rd byte write relies on a fragile buffer cast and the whole save path has zero tests

_Area: mechanism · Effort: S_

save-rd-action.ts:41 writes new Blob([result.bytes.buffer as ArrayBuffer]) — passing the UNDERLYING buffer, which is only correct because swizzleBytes happens to allocate an exact-size Uint8Array (swizzle.ts:33); any future subarray/view would silently append or truncate bytes in the exported laser file. Blob accepts ArrayBufferView, so new Blob([result.bytes]) is strictly safer and drops the type assertion. No test exercises handleSaveRd or emitRdFile (no src/io/rd/*.test.ts; file-actions.test.ts covers only the G-code path), so a regression here — in a binary format destined for a CO2 laser — would only be caught on hardware.

- **Evidence:** src/ui/app/save-rd-action.ts:38-43; src/core/controllers/ruida/swizzle.ts:29-39; Glob src/io/rd/*.test.ts returned no files; src/ui/app/file-actions.test.ts:311 (gcode path only)
- **Reference:** Not applicable (implementation robustness).
- **Recommendation:** Pass the Uint8Array directly to Blob, delete the cast, and add tests for emitRdFile (raster refusal, bounds/no-go preflight, empty job) plus a handleSaveRd test asserting the saved Blob bytes equal encodeRdJob output.

#### A.3.11 [POLISH] Marlin and Smoothieware jog/frame builders are byte-identical copy-paste modules

_Area: architecture · Effort: S_

buildMarlinJogCommand (marlin/commands.ts:35-49) and buildSmoothieJogCommand (smoothieware/commands.ts:27-41) are the same function including comments (G21 lead, zero-delta drop, absolute handling), as are buildMarlinFrameLines and buildSmoothieFrameLines (marlin/commands.ts:52-62 vs smoothieware/commands.ts:44-54). CLAUDE.md's anti-pattern rule says extract on the second occurrence; a future fix (e.g. feed clamping) applied to one copy will drift the other.

- **Evidence:** src/core/controllers/marlin/commands.ts:27-62; src/core/controllers/smoothieware/commands.ts:21-54
- **Reference:** Not applicable (code health).
- **Recommendation:** Extract a shared core/controllers gcode-relative jog/frame builder module (e.g. relative-jog-commands.ts) consumed by both drivers.

**Not verified in this sector:**

- Any real-hardware behavior of the five non-GRBL families — grblHAL, FluidNC, Marlin, Smoothieware, Ruida are all simulator- or research-verified only, exactly as ADR-094..097 and the catalog evidence notes record; no tests, builds, or devices were run this session (read-only audit).
- Whether a real Ruida controller accepts the minimal command stream (no reference .rd from LightBurn/MeerK40t exists in the tree to diff; the encoder's only witness is the repo's own decoder). Also whether the minimal preamble (no layer-count/enable commands seen in third-party .rd dumps) is sufficient.
- Real Marlin's reaction to a stray 0x90-0x9D override byte mid-stream (corrupts the next buffered line vs silently discarded) — the finding stands on 'the byte has no realtime handler there' per ADR-095; the damage mode needs hardware confirmation.
- Whether stock/stable Smoothieware emits comma-format (GRBL-0.9-style) status reports by default versus the pipe format the parser and simulator assume, and whether real Smoothie prints a recognizable 'Smoothie' banner after Ctrl-X (the deferred beam-off cleanup in armResetCleanup waits for a banner to flush).
- Whether FluidNC's `$$` compatibility dump actually includes $30/$32 — the pause laser-mode gate (laser-job-actions.ts:99-103) and start readiness depend on harvesting them; the FluidNC 'simulator' is the GRBL sim with a FluidNC banner.
- LightBurn behaviors cited from product knowledge rather than a running copy this session: the 'Save RD file' menu label on Ruida devices and separate Min/Max Power layer defaults for Ruida.
- The Electron-packaged save path for binary .rd files (only src/platform/web/web-adapter.ts was read; pickFileForSave matched no electron-specific adapter in src/platform).
- Marlin M114 position semantics (logical/post-G92 coordinates recorded as mPos) and their interaction with placement math — accepted by audit F9 / ADR-095 as matching LightBurn's Marlin behavior, not re-derived here.
- pnpm test / lint / typecheck were not run (read-only rules; ~4000-test suite).

---

## A.4 Device/machine profile lifecycle & catalog data correctness — grade B-

The profile subsystem's data plumbing is genuinely strong: a pure $$ parser feeds an evidence-labeled catalog, a draft-commit wizard, and a Start gate that refuses to burn when the controller's $30/$32 disagree with the profile — a cross-check LightBurn does not perform. But the lifecycle around that core has real holes: File→New silently throws away the configured machine (bed, origin corner, zones, scan offsets) and reverts to a 400×400 front-left default, there is no app-level device list (LightBurn's most basic profile affordance; the CNC side already has one), the connected-mode profile-apply merge silently keeps old numbers the card claims to replace, and safety zones do not guard jog/click-to-position motion. The .lbdev importer is honest UX wrapped around an unverified guessed schema with zero research provenance, and the .lfmachine.json round-trip quietly drops baudRate and camera alignment. Documentation drift compounds it: F-A12's promised orphan-profile warning does not exist, and the entire Machine Setup dialog ships without WORKFLOW flows.

**What's great:**

- **Start is gated on proven profile↔controller power-scale agreement — stronger than LightBurn** — runControllerReadiness blocks job start when the live $30 differs from the profile's maxPowerS, when $32 laser mode is off (or ON for CNC — the inverted spindle rules are handled), and warns on nonzero $31; it is capability-aware (Marlin/Smoothie 'none' → explicit unverified warning; FluidNC read-only dump → absent-value warnings but strict verification of reported values). LightBurn silently trusts its device setting, so a $30 mismatch there mis-scales power; KerfDesk refuses with an actionable message. This directly satisfies non-negotiable #7 at the moment it matters. _(src/core/preflight/controller-readiness.ts:39-208; src/ui/laser/start-job-readiness.ts:111-123)_
- **Evidence-status provenance on every catalog profile, surfaced in the UI** — Each catalog entry carries typed ProfileEvidence (hardware-verified / simulator-tested / public-spec-starter / experimental / user-imported) with honest notes ('NOT hardware-verified', Ruida 'NO file has been accepted by a real Ruida controller yet'), rendered as badges on the catalog and wizard cards plus review notes. Legacy statuses stay loadable. This is a truthful trust-labeling system most CAM apps lack entirely. _(src/core/devices/device-profile.ts:67-83; src/core/devices/profile-catalog.ts:39-248; src/ui/laser/MachineSetupProfiles.tsx:100-101; src/core/devices/profile-confidence.ts:11-26)_
- **Device Setup wizard is a pure, draft-commit state machine** — The step flow (connect→identify→confirm→safety→probe→firmware→review) is a React-free reducer with assertNever exhaustiveness; the draft commits only on Finish via replaceDeviceProfile, Cancel is clean, Next is validity-gated on content steps, and Finish is gated by a readiness checklist scored against live $$ facts kept in sync by effect. Matches ADR-092 exactly and keeps every transition unit-testable. _(src/ui/laser/device-setup/device-setup-flow.ts:20-201; src/ui/laser/device-setup/DeviceSetupWizard.tsx:54-83)_
- **$$ settings collector is a disciplined pure parser with documented engineering choices** — parse-settings.ts is a pure state machine (idle→collecting→done) that guards against consuming a pre-$$ 'ok', parses each setting strictly (Number(), finite, sign-checked per field), and documents why maxFeed takes max($110,$111) while accel takes min($120,$121). Partial dumps still yield a useful patch. The dual outputs (profile patch + controller snapshot with homing/limit hints) feed the banner, suggestions, wizard, and readiness gates from one source of truth. _(src/core/controllers/grbl/parse-settings.ts:1-159)_
- **Scan-offset compensation defines off-table behavior LightBurn leaves unspecified** — offsetForSpeed documents and implements explicit semantics: linear-from-rest below the first calibration point (lag distance ∝ speed), clamped above the last (no wild extrapolation), zero for empty tables so uncalibrated machines keep byte-identical output; shiftAlongTravel applies the correction along each sweep's own travel vector so it stays correct at any hatch angle. The editor funnels every mutation through mergeScanOffsetTableBySpeed, preserving the sorted/deduped contract, and both persistence paths validate the table. _(src/core/job/scan-offset.ts:27-91; src/ui/laser/ScanOffsetEditor.tsx:91-114; src/core/devices/scan-offset-profile.ts:6-48)_
- **Firmware writes are allowlisted, single-shot, and verify-by-re-read** — The Firmware Writes tab only exposes $30/$31/$32 (COMMON_WRITE_IDS), requires an explicit per-row Confirm checkbox plus connected+idle+no-active-operation state, is capability-gated off entirely for firmwares that don't accept $ writes (FluidNC message tells the user to use its own tools), and the write path re-reads settings afterwards. Both .lf2 and .lfmachine.json import paths strictly validate profile shape (including per-zone no-go validation) and reject rather than fail open. _(src/ui/laser/MachineSetupController.tsx:20,50-158; src/io/machine-profile/machine-profile-io.ts:147-174; src/io/project/project-device-profile-validator.ts:18-23,75-80)_

**Findings:**

#### A.4.1 [CRITICAL] File → New silently resets the configured machine profile to the Default 400×400

_Area: workflow · Effort: M · verified: CONFIRMED_

newProject() rebuilds the whole AppState from initialState() and deliberately carries over material libraries, saved libraries, layer defaults, and the CNC library — but NOT the device profile, so project.device reverts to createProject()'s DEFAULT_DEVICE_PROFILE (Default 400×400, front-left origin, maxPowerS 1000, no zones, no scan offsets, no camera alignment). An operator who configured a rear-left 300×200 machine and then does File→New gets G-code whose Y axis is flipped relative to their machine (origin-transform maps by device.origin) and whose bounds preflight checks the wrong bed — with no warning in the offline save-G-code flow. Connected flows have partial backstops: the $30 readiness gate blocks on power-scale mismatch and the 'Set up device' nudge reappears, but bed size, origin corner, no-go zones, and scan offsets all revert silently. WORKFLOW.md F-A13 only says the workspace returns to the empty state; the device reset is neither specified nor recorded as a deliberate LightBurn divergence in DECISIONS.md.

- **Evidence:** src/ui/state/store.ts:403-410 (newProject omits device carry-over that lines 398-401 do for libraries); src/core/scene/project.ts:35-44 (createProject defaults device); src/core/devices/origin-transform.ts:49-70 (origin drives Y flip); src/ui/laser/device-setup/DeviceSetupControls.tsx:36-38 (nudge only evaluated when connected)
- **Reference:** LightBurn devices are app-level: File→New keeps the selected device, its bed, origin, and S-value max. A LightBurn user never re-picks their laser after starting a new file.
- **Recommendation:** Persist the last-committed device profile app-side (the currentLayerDefaultsState/currentCncLibraryState pattern already exists in the same function) and seed newProject/initial boot from it; alternatively carry s.project.device through newProject and add a WORKFLOW.md F-A13 clause defining device semantics.

#### A.4.2 [MAJOR] No app-level laser machine list — custom profiles live only inside the current project

_Area: workflow · Effort: L · verified: CONFIRMED_

The catalog is a fixed built-in array; every edit (DeviceSettings, wizard, catalog apply, import) writes only project.device. There is no saved-machines store, no quick device switcher, and duplicateProfileAsCustom() is exported from core but referenced by no UI — only its own test — so the 'save as custom profile' flow was never wired. A two-machine owner must export/import .lfmachine.json files by hand on every switch. The asymmetry is stark: CNC mode already has app-level machine profiles in localStorage (WORKFLOW.md F-CNC13 'Profiles are app-level (localStorage), usable across projects'), so the pattern exists in-tree but was never applied to the laser DeviceProfile.

- **Evidence:** src/core/devices/profile-catalog.ts:261-280 (duplicateProfileAsCustom unused: grep hits only profile-catalog.test.ts:97 and index.ts:49); src/ui/state/store-actions.ts:68-82 (replaceDeviceProfile writes project only); WORKFLOW.md:1854-1861 (F-CNC13 CNC app-level profiles)
- **Reference:** LightBurn maintains a persistent Devices list with a dropdown in the Laser window; profiles are created once via Find My Laser / Import and reused across all projects.
- **Recommendation:** Add a saved-machines slice (localStorage, following the F-CNC13 CNC precedent), wire duplicateProfileAsCustom into a 'Save as my machine' button in Machine Setup, and surface a device picker in the Laser rail.

#### A.4.3 [MAJOR] Applying a catalog or imported profile while connected silently keeps the OLD profile's machine numbers and misrepresents them on the card

_Area: mechanism · Effort: S · verified: PARTIAL_

profileWithControllerFacts spreads machineReportedProfilePatch(args.current) — which, because `current` is a full DeviceProfile, always contains all nine machine fields (bedWidth, bedHeight, maxFeed, maxPowerS, minPowerS, laserModeEnabled, accel, junctionDeviation, zTravelMm) — over the incoming profile whenever lastSettingsReadAt is non-null. Controller-reported values then override on top. Net effect: once any $$ read happened this session, clicking 'Use xTool D1 Pro' (card displays '430 x 390 mm') or 'Apply imported profile' keeps the CURRENT profile's bed/feed/power for every field the controller did not positively report — the current profile's hand-typed values are misclassified as machine facts. The catalog card and wizard PresetCard both render the catalog's own bed dims and never show the merged result; the Machine Setup catalog path applies live with no review step. The function has no test file (no profile-application.test.ts exists) and no ADR records this merge policy.

- **Evidence:** src/core/devices/profile-application.ts:12-31 (merge spreads current's full patch), 33-50 (patch includes all always-defined fields); src/ui/laser/MachineSetupProfiles.tsx:83-109 (one-click apply + card shows profile.bedWidth); src/ui/laser/device-setup/DeviceSetupIdentifyStep.tsx:59-64; src/ui/laser/MachineSetupImportExport.tsx:91-104; glob of src/core/devices shows no profile-application.test.ts
- **Reference:** Selecting a device in LightBurn applies that device's stored dimensions and S-max, period; controller settings are not silently merged over the chosen profile.
- **Recommendation:** Only merge fields the controller actually reported (drop machineReportedProfilePatch(args.current) or gate it per-field on the controller snapshot); show the effective post-merge numbers in the card/review before applying; add profile-application.test.ts pinning the tier order (controller > chosen profile > nothing).
- **Verifier (PARTIAL):** Mechanism confirmed exactly as cited: profile-application.ts:18-22 spreads machineReportedProfilePatch(args.current) whenever lastSettingsReadAt is non-null, and lines 33-50 emit 8 always-required DeviceProfile fields (device-profile.ts:145-188; zTravelMm is optional, so 'all nine' is marginally off) with no provenance gating — hand-typed current values do ride into the applied profile as machine facts for fields the controller did not report. Cards render pre-merge catalog dims (MachineSetupProfiles.tsx:104-105; DeviceSetupIdentifyStep.tsx:59-64), the dialog catalog path applies live one-click (MachineSetupProfiles.tsx:83-94,121), no profile-application.test.ts exists, and no ADR in DECISIONS.md records the merge policy. HOWEVER three findings weaken the framing: (1) in the dialog/import paths controllerSettings resets atomically with lastSettingsReadAt (grbl-settings-actions.ts:66-69,140-143; laser-connection-actions.ts:133-135,189-192; laser-console-actions.ts:55-58) and a standard GRBL-family $$ dump populates all nine mapped fields (parse-settings.ts:119-137), so the current tier is normally fully shadowed by genuine controller truth — and that controller-facts-beat-preset layering is deliberate, pinned by tests (device-setup-flow.test.ts:185-199 'A 400x400 catalog preset must not clobber the detected bed'; MachineSetupDialog.test.tsx:115-157; MachineSetupImportExport.test.tsx:147-199), refuting the implication that the merge itself is untested/accidental; (2) the merge never engages for Marlin/Smoothieware/Ruida (settingsQuery: null in src/core/controllers/{marlin,smoothieware,ruida}/driver.ts) — GRBL family only; (3) the wizard shows the merged draft in Confirm/Review before Finish commits (device-setup-flow.ts step order; DeviceSetupWizard.tsx:79-83). The genuinely unintended defect is narrower but real and reachable on a common path: device-setup-flow.ts:132-138 passes state.detected as BOTH controllerSettings and detectedSettings, and banner apply/dismiss nulls only detectedSettings (laser-store.ts:367-375) while lastSettingsReadAt persists, so a wizard opened after routine banner interaction has detected={} with controllerRead=true (DeviceSetupWizard.tsx:54-58) — every preset pick then keeps ALL old machine numbers under the new machine's name. Severity major stands for that path (bed dims feed bounds checks, maxPowerS feeds S-scaling), and the LightBurn divergence is indeed unrecorded in DECISIONS.md.

#### A.4.4 [MAJOR] Safety zones are not enforced on jog or click-to-position motion

_Area: mechanism · Effort: M · verified: CONFIRMED_

No-go zones gate Start (runPreflight → findNoGoZoneCollisions on emitted G-code), Frame (framePreflight zone intersection), export, and checkpoint/line resume (both re-run prepareStartJob). But the jog action sends $J directly with only readiness/alarm gating — no bed-bounds or zone check — and the 'Move laser here' click handler clamps to the bed yet ignores zones, so a single click can drive the head straight through a clamp keep-out at 3000 mm/min. Zones exist precisely to protect clamps and fixtures, and jogging is the most common way to hit one. The orphaned SafetyZonesPanel.tsx even documents the limitation ('checked by Start, Frame, and G-code export preflight') but the shipped MachineSetupSafetyZones panel says nothing about coverage.

- **Evidence:** src/ui/state/laser-jog-actions.ts:56-69 (jog: no zone/bounds check); src/ui/workspace/position-laser-click.ts:24-34,52-59 (clampToBed only); src/core/preflight/preflight.ts:147-176 and src/core/job/frame-preflight.ts:59-61 (where zones ARE checked); src/ui/laser/SafetyZonesPanel.tsx:12-16 (scope disclosure in the dead panel only)
- **Reference:** LightBurn has no no-go-zone feature, so the baseline is internal consistency: a keep-out advertised as a machine-coordinate safety feature should cover all app-initiated motion.
- **Recommendation:** Check the jog target (absolute jogs and click-to-position) and interpolated jog path against enabled zones in the jog action, refusing with the zone name; document remaining uncovered paths (relative jogs, homing) in the zones panel copy.

#### A.4.5 [MAJOR] LightBurn .lbdev importer is built against a guessed schema with no real-file evidence and silently defaults everything it cannot fish out

_Area: mechanism · Effort: M · verified: CONFIRMED_

The parser fishes for tag aliases (Name/DeviceName/DisplayName; Width/XSize/BedWidth/WorkWidth; SMax/MaxS/SpindleMax/SValueMax; Origin/HomeOrigin/StartFrom) via regex, and the only test fixture is a hand-invented '<LightBurnDevice>' XML. The repo contains no real .lbdev sample, and RESEARCH_LOG.md (822 lines), DECISIONS.md, and WORKFLOW.md contain zero 'lbdev' mentions — the feature shipped with no ADR, no flow spec, and no recorded schema research, violating the repo's own no-invention/RESEARCH_LOG rules. Fields not extracted (max feed, min S, baud, transfer mode) silently fall back to DEFAULT_DEVICE_PROFILE with no 'unrecognized fields' disclosure beyond start/end scripts; maxFeed is not imported at all. Origin mapping only matches textual names ('frontleft', 'lowerright'); if real exports store a numeric origin index the mapping always fails into needs-review. The review-card pattern itself (applied/needs-review/ignored) is good UX — it just cannot be trusted until validated against genuine LightBurn output.

- **Evidence:** src/io/lightburn/lbdev-import.ts:72-98 (alias fishing), 226-234 (regex extract), 244-253 (text-only origin map), 102-127 (defaults from DEFAULT_DEVICE_PROFILE, maxFeed absent); src/io/lightburn/lbdev-import.test.ts:4-16 (synthetic fixture only); grep of RESEARCH_LOG.md/DECISIONS.md/WORKFLOW.md for 'lbdev' returns nothing
- **Reference:** LightBurn's own device export is the authority; import fidelity can only be claimed after parsing files actually produced by LightBurn's Export Devices function.
- **Recommendation:** Obtain a corpus of real .lbdev exports (several LightBurn versions), add fixtures + a RESEARCH_LOG entry documenting the observed schema, list every unmapped source field in the Ignored section, and import max-speed if present.

#### A.4.6 [MAJOR] Laser jobs never cross-check bounds/feed against the live controller's reported travel — CNC does

_Area: mechanism · Effort: S · verified: CONFIRMED_

parse-settings harvests $130/$131 (travel) and $110/$111 (max rate) into controllerSettings on every connect, and CNC start/save surfaces 'stock exceeds reported travel' and 'feed above reported max rate' advisories from that live snapshot. Laser jobs get neither: detectMachineJobWarnings routes lasers to job-intent warnings only, and runControllerReadiness checks only $30/$31/$32. Bounds preflight tests emitted coordinates against the PROFILE bed alone, so a stale or mistyped profile bed larger than the machine's real travel passes every gate and the head slams the gantry (most hobby diode lasers ship with $20 soft-limits off — the exact scenario frame-preflight.ts's own comment describes). The data to warn is already sitting in the store at Start time.

- **Evidence:** src/ui/laser/cnc-machine-limit-warnings.ts:13-46 (CNC-only advisory); src/ui/laser/machine-job-warnings.ts:21-27 (laser branch omits controllerSettings); src/core/preflight/controller-readiness.ts:151-208 (laser checks limited to $30/$31/$32); src/core/preflight/preflight.ts:330-343 (bounds vs profile bed only); src/core/controllers/grbl/parse-settings.ts:124-136 ($130/$131 parsed); src/core/job/frame-preflight.ts:4-10 (soft-limits-off failure mode)
- **Reference:** LightBurn also trusts its device profile for size (parity), but KerfDesk's declared differentiator is 'KerfDesk reads the real values from $$ on connect' (catalog evidence notes) — the sector's own honesty bar.
- **Recommendation:** Extend the CNC advisory to laser starts: warn when job motion bounds exceed controller-reported $130/$131 or when profile bed differs from reported travel by more than a tolerance; reuse detectCncMachineLimitWarnings' shape.

#### A.4.7 [MAJOR] WORKFLOW.md drift: F-A12's orphan-profile warning does not exist in code, and the whole Machine Setup surface has no flows

_Area: workflow · Effort: M · verified: CONFIRMED → minor_

F-A12's edge case promises: 'Status bar warns: Project's device profile (xTool S1) is not configured locally. Add it in Settings.' No such string or mechanism exists anywhere in src (grep for 'configured locally' returns nothing) — the project simply loads its embedded device silently. This is the same orphan class the first wave flagged for imports, still open for .lf2 opens. Beyond that, the seven-tab Machine Setup dialog's profile lifecycle — Profile Catalog switching, Import/Export (.lfmachine.json and .lbdev), Safety Zones editing — has no WORKFLOW.md flows at all (only F-C7 for the wizard and F-B14 firmware-writes references exist), so success/error/empty/edge behavior for profile switching and import is unspecified. Per the repo's own rules WORKFLOW.md is the spec; these are shipped features without one.

- **Evidence:** WORKFLOW.md:423-425 (promised status-bar warning); grep 'configured locally' across src = 0 matches; WORKFLOW.md:805-836 (F-C1 still a stub; F-C7 only wizard flow); grep 'Catalog|Import / Export|Safety Zones' in WORKFLOW.md finds no Machine Setup flows
- **Reference:** Not applicable — this is doc-as-spec integrity, the repo's own standard (CLAUDE.md read-in-order contract).
- **Recommendation:** Either implement the F-A12 warning (compare loaded profileId against catalog + future saved-machines list) or amend F-A12; write F-Bxx flows for Profile Catalog apply, profile import/export, and Safety Zones with all four states.

#### A.4.8 [MINOR] .lfmachine.json export/import silently drops baudRate, cameraCalibration, and cameraAlignment

_Area: mechanism · Effort: S_

canonicalProfile() enumerates the fields it serializes and omits baudRate (the serial override the connect path reads), cameraCalibration, and cameraAlignment — all three of which the .lf2 project format round-trips and normalizes. Exporting a Marlin/ESP32 profile with a custom baud and re-importing it silently reverts to the driver default; a calibrated camera alignment saved to the device profile (per ADR-107/108 'persists on the device profile') is lost when sharing the machine file. The workflow round-trip test only asserts profileId equality, so the loss is invisible to CI.

- **Evidence:** src/io/machine-profile/machine-profile-io.ts:235-297 (canonicalProfile/canonicalMachineMetadata omit all three); src/io/project/deserialize-project.ts:231-232, 246-255 (.lf2 keeps them); src/io/project/project-controller-kind.test.ts:22-30 (baud round-trips in .lf2); src/io/machine-profile/machine-profile-catalog-workflow.test.ts:39-42 (round-trip asserts profileId only)
- **Reference:** LightBurn device export carries the transfer/baud configuration with the device.
- **Recommendation:** Add the three fields to canonicalProfile (validated in machine-profile-shape), and strengthen the round-trip test to deep-equal the canonical profile.

#### A.4.9 [MINOR] Orphaned duplicate Safety Zones editor plus copy-pasted catalog cards and slugify helpers

_Area: architecture · Effort: S_

Two near-identical zone editors exist: SafetyZonesPanel.tsx (imported by nothing except its own test — the dialog uses MachineSetupSafetyZones.tsx's export of the same-named component) with diverged behavior (default zone 10 vs 20 mm, W/H min clamp only in the live one, differing copy). Git history shows the orphan predates the 'stabilize machine setup integration' refactor and was never deleted. The catalog card is also duplicated nearly line-for-line (MachineSetupProfiles.CatalogCard vs DeviceSetupIdentifyStep.PresetCard, including the confidence-label helper), and slugify exists twice (MachineSetupImportExport, lbdev-import). CLAUDE.md names copy-paste duplication an anti-pattern to extract on second occurrence.

- **Evidence:** src/ui/laser/SafetyZonesPanel.tsx:6 vs src/ui/laser/MachineSetupSafetyZones.tsx:15 (same export name; grep shows only MachineSetupDialog.tsx:8 imports the latter); git log: SafetyZonesPanel first at c747c63b, superseded at 295ff734; src/ui/laser/MachineSetupProfiles.tsx:69-132 vs src/ui/laser/device-setup/DeviceSetupIdentifyStep.tsx:44-94; slugify at MachineSetupImportExport.tsx:214-221 and lbdev-import.ts:264-270
- **Recommendation:** Delete SafetyZonesPanel.tsx (+ its test) or make it the single shared editor; extract a shared ProfileCard component and one slugify helper.

#### A.4.10 [MINOR] Catalog machine numbers have no RESEARCH_LOG provenance entries

_Area: mechanism · Effort: S_

The brand starter profiles bake externally-sourced safety-relevant numbers (xTool D1 Pro 430×390, Sculpfun S30 410×400, Ortur LM3 400×400, Falcon maxFeed 10000) with only in-code notes ('from published specs'), and RESEARCH_LOG.md — the repo's designated ledger for 'external claims ... with source, version, date' — contains zero entries for any machine (grep for xtool/sculpfun/ortur/falcon/neotronics across its 822 lines returns nothing). The evidence-status system ('public-spec-starter' + confirm-before-first-job notes + $$ readback) is a genuine mitigation, but the numbers themselves are unverifiable from the tree and undated, so a spec change (xTool already 'lists up to 432×406' per the code comment) can never be audited.

- **Evidence:** src/core/devices/profile-catalog.ts:34-97 (spec claims + notes); src/core/devices/falcon-profiles.ts:11-12; RESEARCH_LOG.md grep = 0 machine entries; PROJECT.md:288 (RESEARCH_LOG rule)
- **Recommendation:** Add one RESEARCH_LOG entry per catalog machine: vendor spec URL/manual, retrieved date, chosen number and why (e.g., xTool 430×390 vs 432×406 rationale).

#### A.4.11 [MINOR] core/devices index exports ~35 values — far over the module public-API cap

_Area: architecture · Effort: M_

CLAUDE.md caps public exports from a module's index.ts at 10 soft / 20 hard ('if exceeded, the module is doing too much; split it'). core/devices/index.ts re-exports roughly 35 value bindings (plus ~25 types) spanning five concerns: dialects, profile identity/catalog, suggestions/confidence/application, origin/jog transforms, and grbl-streaming re-exports that belong to a sibling module. The re-export of ../grbl-streaming and ../camera through devices also blurs the module boundary story.

- **Evidence:** src/core/devices/index.ts:11-84 (count of value exports across the export blocks); CLAUDE.md size-limits table (Public exports from index.ts 10/20)
- **Recommendation:** Split the surface: keep DeviceProfile+catalog in devices, move dialect exports to their own module index, and have consumers import grbl-streaming helpers from their home module.

#### A.4.12 [POLISH] .lbdev import refuses Marlin/Smoothieware LightBurn devices the app can now drive

_Area: workflow · Effort: S_

canCreateProfile is gated on controller text containing 'grbl', so a LightBurn Marlin or Smoothieware device import lands review-only ('Only GRBL-compatible LightBurn devices can become KerfDesk profiles') even though ADR-094–097 shipped first-class Marlin and Smoothieware drivers with catalog starters. The imported profile also never sets controllerKind, so even a GRBL import can't carry grblHAL identity.

- **Evidence:** src/io/lightburn/lbdev-import.ts:97 (isGrbl gate), 166-175 (review copy), 102-127 (no controllerKind mapping); src/core/devices/profile-catalog.ts:137-188 (Marlin/Smoothie starters exist)
- **Reference:** LightBurn itself supports these controllers, so its exports legitimately contain them.
- **Recommendation:** Map recognizable controller strings to ControllerKind (marlin, smoothie, grblhal) and allow profile creation with the matching catalog starter's streaming/dialect defaults.

**Not verified in this sector:**

- The real LightBurn .lbdev file format (element names, numeric vs textual Origin encoding, units) — no genuine sample exists in the repo and no network access was used; the importer-fidelity finding is therefore about missing evidence, not a proven mismatch.
- Vendor-published bed dimensions for xTool D1 Pro / Sculpfun S30 / Ortur LM3 / Creality Falcon — could not check manufacturer specs this session.
- Whether ESLint's counted-code limits pass for profile-catalog.ts (410 raw lines) and DetectedSettingsBanner.tsx (411 raw lines), and whether the index-export cap rule counts type exports — lint was not run (read-only session).
- Any runtime/UI behavior (dialog rendering, nudge reappearance after File→New, toast flows) — static reading only; no dev server, no tests executed per the audit rules.
- Hardware truth of $$ detection and firmware writes on real controllers — the repo's own 'hardware-verified' claim for Falcon A1 Pro grblHAL was taken from its evidence text, not re-verified.
- Whether the Cuts/Layers speed input clamps to device.maxFeed at edit time (layers panel not read); the Start/preflight blocking path for over-max speed WAS verified in code.
- Whether any non-UI callers of the laser store's frame/jog actions (e.g., board-capture corner jogs) perform their own no-go-zone checks — only the primary JogPad/use-frame-action/position-laser-click paths were traced.
- Whether findNoGoZoneCollisions' G-code path math handles arcs (G2/G3) — the collision scanner internals were not read line-by-line.

---

# Appendix B — pointers to full detail from the earlier streams

- **Claude wave-1, all 14 sectors, every finding + strength + verifier note:** [`2026-07-10-full-sweep-audit.md`](2026-07-10-full-sweep-audit.md) in this folder.
- **Codex consolidated register (M-01…M-31) and its live-UI / release-gate validation record:** the base-checkout copy of `2026-07-10-full-sweep-audit.md` (sections 1–13). Its section 5/6 numbering is cross-referenced throughout §6–§8 above; where it conflicts with this v2 register, **v2 controls** (v2 adds independent verification of every M-xx claim).
