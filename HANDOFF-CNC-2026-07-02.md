# HANDOFF — CNC "Router" Phase H session (2026-07-02)

> **ADR RENUMBER (integration, 2026-07-03): the numbers in this file are
> HISTORICAL. At the merge to main the CNC ADRs became 094→098, 100→101,
> 101→102, 102→103 (controllers kept 094–097; trace kept 100) — see
> ADR-104. Next free ADR: 105.**

> **STATUS UPDATE 2026-07-03: §6 and §7 A/B/C/E/F are BUILT — see §9 "Session-2
> closeout" at the end of this file for what shipped, where, and what remains
> (hardware verification §7.D + the PROVISIONAL decisions list). Sections 1–8
> are kept verbatim as the historical kickoff brief; where §9 contradicts them,
> §9 wins.**

> Purpose: continue this work from another device. Read this file first, then the
> read-in-order list below. **CRITICAL: as of writing, everything this session
> produced is UNCOMMITTED in two local worktrees on the original machine — it does
> not exist on any other device until committed and pushed (see "Sync status").**

---

## 1. Read these files, in this order

On branch `claude/elated-edison-157186` (the CNC branch — this worktree):

| # | File | Why |
|---|---|---|
| 1 | `CLAUDE.md` | House rules. Non-negotiable; every rule below references it. |
| 2 | `HANDOFF-CNC-2026-07-02.md` | This file — session state + decisions. |
| 3 | `PROJECT.md` (Phase H, ~L113–138) | H.0–H.10 roadmap. NOTE: no per-sub-phase status markers; status truth is AUDIT.md + git log. |
| 4 | `DECISIONS.md` (ADR-094, ~L3596–3689) | The single CNC scope ADR: clean-room parsers, 4040 air-cut gate, laser non-negotiables extended to CNC. |
| 5 | `AUDIT.md` (CNC section, ~L836–867) | Verification ledger. CNC convention is STRICTER than the file-global one: VERIFIED = proven on the 4040 air-cut protocol; every Phase H row is still CLAIMED. |
| 6 | `WORKFLOW.md` (F-CNC flows, ~L1226–1445) | CNC user flows. F-CNC1–8 fleshed out; F-CNC9–19 are name-only placeholders. |
| 7 | `audit/reports/cnc-easel-parity-audit-2026-07-02.md` | Original Easel parity audit — PARTIALLY STALE: "no V-carve" and "no STL/relief" are closed by H.3–H.5; DXF/.nc/text, multi-tool, tiling, hardware validation still open. |
| 8 | `RESEARCH_LOG.md` (~L747–762) | Phase H dependency policy (ADR-017 evaluation): no parser libraries, clipper2-ts is the only geometry dep. |

On branch `claude/nice-fermat-55d508` (the multi-controller branch):

| # | File | Why |
|---|---|---|
| 9 | `DECISIONS.md` — **ADR-099** (near end of file, before "Future ADRs") | The Phase H collision resolution written this session (uncommitted there). Governs ADR numbering for BOTH branches. |

---

## 2. The one decision you must not re-derive: ADR numbering

Two tracks both independently took "Phase H", "v0.8", and ADR-094:
CNC router (`elated-edison-157186`) and multi-controller (`nice-fermat-55d508`,
ADR-094–097 = driver seam/Marlin/Smoothie/Ruida). Neither is on `main`
(main = Phase G / ADR-093).

**Maintainer resolution (recorded as ADR-099 on the nice-fermat branch):**
- CNC router KEEPS Phase H / ADR-094 / v0.8.
- Multi-controller becomes Phase I; its ADR-094–097 renumber to 095–098 —
  **deferred to integration** (when that branch rebases onto a main carrying
  CNC's ADR-094). Do NOT renumber early; do NOT "fix" its "Phase H"/"v0.8" labels.
- **On EITHER branch, the next free ADR number is ADR-100.** 095–098 are reserved
  for the renumbered controller ADRs; 099 is the resolution ADR. A fresh session
  on the CNC branch will see only ADR-094 and be tempted to write ADR-095 — don't.

---

## 3. Decisions made this session (maintainer-approved)

1. **Gate-and-hide separation** — CNC and laser share one shell, but laser-only
   surfaces hide in CNC mode (extends the existing Material-Library/CncSetupPanel
   pattern). A full separate CNC workspace was considered and rejected.
2. **Real 3D viewer for relief** — approved, BUT it requires three.js, and
   ADR-094 §2 says "no new runtime dependencies in Phase H." So the viewer is
   blocked behind **ADR-101** (ADR-017 dependency evaluation + explicit override
   of ADR-094 §2). Do not `pnpm add three` before ADR-101 is written and approved.
3. **No CNC-only shapes; no separate CNC tools button.** Shapes are machine-agnostic
   geometry sources (both compilers consume them). The fix for tool mixing is
   command-registry gating, not a parallel palette. CNC-specific *objects*
   (drill points, manual tabs) arrive with H.6/H.7.
4. **Integrated build order** (approved):
   1. Safety fixes — ✅ DONE this session (see §4)
   2. **ADR-100: gate-and-hide UI separation policy** + gating diffs ← NEXT
   3. H.6 — clean-room DXF import, clean-room `.nc` parser, CNC text defaults
   4. ADR-101 + 3D relief viewer + relief parameter editor
   5. H.7 → H.8 → H.9 → H.10 in canon order

---

## 4. Work completed this session (UNCOMMITTED, on `elated-edison-157186`)

Two safety bug fixes, both test-first (red observed → green), full gate passed
(431 test files / 2671 tests, lint, typecheck, format all clean):

**Diff 1 — one-click `$32=1` (GRBL laser mode) firmware write reachable in CNC mode.**
- `src/ui/state/laser-setup-actions.ts` — `configureGrblLaserSetup` refuses in CNC
  (reads app store machine kind at call time; throws before any byte is written).
- `src/ui/laser/GrblLaserSetupPanel.tsx` — panel returns null in CNC mode.
- Tests: `src/ui/state/laser-store-grbl-setup.test.ts` (action rejects, zero writes),
  `src/ui/laser/GrblLaserSetupPanel.test.tsx` (panel absent in CNC).
- Deliberately NOT changed: `FirmwareWritesPanel` guarded `$32` row (manual value
  entry; `$32=0` is legitimate on a router). Flag to maintainer if it should gate too.

**Diff 2 — Frame traced the job perimeter with XY-only jogs (no Z retract) in CNC.**
- `src/ui/state/laser-motion-operation.ts` — `buildFrameJogLines(bounds, feed, safeZMm?)`
  prepends `$J=G90 G21 Z<safeZ> F<f>` when safeZMm is provided; laser output byte-identical.
- `src/ui/state/laser-store.ts` — `frame` passes `machine.params.safeZMm` (default
  3.81 mm) when the project machine is CNC. Leg-by-leg dispatch guarantees the
  retract completes before the first XY leg.
- Tests: `src/ui/state/laser-motion-operation.test.ts` (NEW file — pure builder),
  `src/ui/state/laser-store-motion-operation.test.ts` (wire-level ordering).

**NOT verified:** any real-hardware behavior. Both fixes alter/gate emitted motion
paths ⇒ per ADR-094 §3 they are CLAIMED until the maintainer runs the 4040 air-cut
(frame a CNC job; confirm the Z lift happens before XY motion).

**⚠ Tech-debt flag:** `src/ui/state/laser-store.ts` is at ~399/400 counted lines
(hard ESLint limit). It needs a split refactor in its own tidy-first PR before it
next grows. Do not add lines to it casually.

Also uncommitted on `claude/nice-fermat-55d508`: the ADR-099 addition + a pointer
in the "Future ADRs → Numbering" note (DECISIONS.md only, docs-only change).

---

## 5. Sync status — what another device will and won't see

- Both branches ARE pushed to origin at their last commits
  (`elated-edison-157186` @ `200f632`, `nice-fermat-55d508` @ `e97b804`).
- **Everything in §4 is uncommitted local work.** To continue elsewhere, the
  original machine must commit + push:
  - `claude/elated-edison-157186`: the two safety diffs + this handoff file
    (suggested: `fix(cnc): block $32 laser-mode write + add Frame safe-Z retract in CNC`).
  - `claude/nice-fermat-55d508`: the ADR-099 docs change
    (suggested: `docs: resolve Phase H/ADR-094 collision (ADR-099, deferred renumber)`).
- Machine-local session memory (Claude's memory directory) does not travel;
  this file is the canonical handoff.

---

## 6. Next task, precisely

Write **ADR-100 — CNC/laser UI separation policy (gate-and-hide)** on the CNC
branch, then implement in small reviewable diffs:

1. Command-registry machine gating (`src/ui/commands/` has ZERO machine-kind
   awareness today): hide laser calibration generators (`tools.material-test`,
   `tools.scan-offset-test`, interval/focus tests), Fill Selection, Convert to
   Bitmap, Trace in CNC mode.
2. Hide per-object "Power Scale" (`src/ui/layers/SelectedObjectProperties.tsx`) in CNC.
3. Warn (preflight advisory) when an output-enabled layer contains raster images
   in CNC mode — CNC compile silently drops them (`compile-cnc-job.ts:87-89`).
4. Re-label the right rail ("Laser" heading/copy → machine-aware) — cosmetic, last.
5. Sync WORKFLOW.md (extend F-CNC1) + PROJECT.md so the separation work is canon.

Known open UI-separation questions a future session should NOT silently decide
(ask the maintainer): Auto-focus button fate in CNC; relief kept-but-inert on
CNC→laser toggle (warn/strip/block?); stale `previewable-content.ts:18-20` gate
that still blocks relief-only scenes from Preview even though H.5 landed;
relief parameter editor placement (no editing UI exists for
targetWidthMm/reliefDepthMm/emptyCells).

---

## 7. Complete remaining-work inventory to "CNC done"

Everything below is required for a completed CNC program, per the canon docs +
this session's verified findings. "Done" = all of A–E complete AND hardware-verified.

### A. Roadmap sub-phases (canon — PROJECT.md ~L117–129)
- **H.6** — Clean-room DXF import; clean-room `.nc` parser → feeds the simulator;
  CNC text defaults (the only CNC text-workflow mention in any doc — its concrete
  meaning is unspecified; ask the maintainer at kickoff).
- **H.7** — Tool library + feeds/speeds libraries (material-library pattern);
  multi-CNC-machine profiles (`src/core/machine-profile/` is empty today);
  multi-tool jobs: M0 tool change, Z-zeroing flow, drill/peck, two-stage V-carve
  (deferred marker in `vcarve-ladder.ts:12-13`). Flagged highest hardware risk.
- **H.8** — Relief finishing: ball-nose max-plus tip surface, scallop-driven
  stepover; consumes the reserved 0.5 mm allowance
  (`ReliefRoughingOptions.allowanceMm` exists but is hard-wired — `compile-cnc-relief.ts` never passes it).
- **H.9** — Motion polish: ramp/helical entry, climb vs conventional direction,
  lead-in/out, parking parity.
- **H.10** — Tiling: indexed tile grid, registration marks, per-tile export.

### B. UI separation (ADR-100, gate-and-hide) — full mixing-point list
Priority items are in §6 (next task). The complete verified list:
- Command registry (`src/ui/commands/` — zero machine-kind awareness): laser
  calibration generators (material/interval/scan-offset/focus tests), Fill
  Selection, Convert to Bitmap, Trace Image, image-mask tools, Registration Jig —
  all invocable in CNC mode today; right-click canvas menu ditto.
- Per-object "Power Scale" panel (`SelectedObjectProperties.tsx:31-59`) — visible
  and editable in CNC, does nothing (CNC compile ignores powerScale).
- Raster images: importable in CNC mode but silently dropped by CNC compile
  (`compile-cnc-job.ts:87-89`) — needs a preflight advisory or import warning.
- "Auto-focus" button visible in CNC (laser concept) — maintainer decision needed.
- Cosmetic re-labels: right rail "Laser" heading + aria-label
  (`LaserWindow.tsx:52-56`), laser-branded connect copy (`ConnectionBar.tsx:27,36`),
  "Estimated burn time" tooltip (`JobControls.tsx:143-145`), "Laser:" shortcut hint
  (`Toolbar.tsx:116`), AppMenuBar "Laser" family label.
- Device-setup laser fields (air-assist selector, $30 power range) reachable in
  CNC mode — decide hide vs re-label (interacts with H.7 CNC machine profiles).

### C. Relief / 3D completion (beyond H.8 math)
- **ADR-101** — three.js dependency evaluation (ADR-017 pattern) overriding
  ADR-094 §2, then the real-time 3D relief/stock viewer.
- Relief parameter editor — NO UI exists for targetWidthMm / reliefDepthMm /
  emptyCells (a code comment in `stl-import-action.ts:4-6` promised it "with H.5";
  H.5 shipped without it). Placement is an open maintainer question.
- Stale preview gate: `previewable-content.ts:18-20` still returns false for
  relief, so a relief-ONLY scene cannot enter Preview even though H.5 compiles
  real toolpaths — WORKFLOW.md:1346-47's promised "terraced relief forming"
  preview is unreachable without other geometry. Fix + pin with a test.
- Relief-in-laser-mode UX: relief objects survive a CNC→laser toggle silently
  inert (render+select but never output); laser save of a relief-only scene fails
  with a generic "no cuts" internal error; clipboard paste bypasses the
  CNC-only import gate. Decide warn/strip/block + name the error.
- Relief layer-card contract: Stepover drives roughing but only renders when
  cutType==='pocket'; "Cut depth" renders but is ignored for relief. Untangle.

### D. Hardware-verification debt (gates, not features — ADR-094 §3)
Every row below is CLAIMED until the maintainer logs a 4040 result in AUDIT.md:
- CNC MVP end-to-end air-cut ("no 4040 run yet").
- H.2 sim-vs-machine side-by-side air-cut.
- H.3 V-carve MDF caliper check (groove width = 2·depth·tan(θ/2)).
- H.4 depth-map canvas appearance visual review (not output-affecting; visual only).
- H.5 relief roughing foam/MDF terrace cut.
- This session's two safety fixes (frame-retract air-check especially).
- Every future output-affecting sub-phase ends with its own air-cut checklist.

### E. Still-open parity gaps (from the 2026-07-02 Easel parity audit)
Not all are scheduled into H.6–H.10 — anything not covered above needs a
maintainer scope decision, not silent adoption: richer CNC materials/bits/saved
settings; simulation depth completeness; font import as a CNC text workflow
(possibly = H.6 "CNC text defaults"). Standing directive: **do not market as
Easel-equivalent** until the maintainer lifts it.

### F. Doc work owed alongside the code
- Flesh out reserved flows F-CNC9–19 in WORKFLOW.md at each sub-phase kickoff
  (each needs success/error/empty/edge states before code, per CLAUDE.md).
- PROJECT.md Phase H table has no per-sub-phase status markers — consider adding
  Done/Pending columns so status stops living only in AUDIT.md + git log.
- ADR-051 doesn't mention the star shape/tool (exists in code) — backfill call.

Scope boundary: "complete" here = A–F per the canon docs. Anything beyond
(4th axis, CAM strategies not listed, new import formats) is NOT in scope and
requires a new PROJECT.md revision + ADR first.

---

## 8. Standing traps (verified this session — do not "fix" these)

- App brands itself **"KerfDesk"** in UI strings — intentional, leave alone.
- `AUDIT.md` file-global L10 says VERIFIED = tests-or-hardware, but the CNC
  section overrides to hardware-only. The CNC convention wins for Phase H rows.
- The controller branch's PROJECT.md still lists Marlin/Smoothie/Ruida under
  "Phase H — v0.8 Multi-controller" — correct until integration (ADR-099 §3).
- The star shape/tool exists in code but is absent from ADR-051 — known doc
  drift, maintainer's call whether to backfill.

---

## 9. Session-2 closeout (2026-07-03) — Phase H built end-to-end

Executed on worktree branch **`claude/determined-dewdney-7ec915`** (forked from
`elated-edison-157186` @ `200f632`; carries its full history). Everything below
is committed there. All Phase H sub-phases (H.6–H.10), ADR-100, ADR-101, and
the relief-completion items are BUILT with tests; suite grew 2671 → 2805, all
green with lint/typecheck/format at every commit.

### Commits (oldest first)
- `9c221ae` ADR-100 gate-and-hide — laser-only commands hidden in CNC mode
- `0cb6a07` hide laser-only object/device editors in CNC + dropped-raster advisory
- `6f9717e` machine-aware chrome labels — Router menu/rail/hints in CNC mode
- `af7210c` relief mode boundaries — preview gate, named laser error, paste gate
- `341add6` relief parameter editor + honest layer-card contract
- `9838d5e` clean-room DXF parser — tags, entities, splines, blocks (H.6a core)
- `b9b4faa` wire DXF import — File menu, drag-drop, context menu (H.6a)
- `530d7a5` .nc G-code program simulator — clean-room modal parser (H.6b)
- `fb009c7` CNC text defaults — fresh text layers v-carve or engrave (H.6c)
- `605c04d` ADR-101 — three.js 3D relief viewer, lazy-loaded and UI-only
- `7656b58` multi-tool jobs — per-layer bits, M0 changes, drill, 2-stage v-carve (H.7)
- `58e4807` tool library, feeds/speeds presets, machine profiles (H.7)
- `0e5e8f6` relief finishing — max-plus tip surface, scallop rows (H.8)
- `76bb63b` motion polish — ramp entry, climb/conventional, entry points, parking (H.9)
- `096a0c9` tiling — indexed tile grid, registration holes, per-tile export (H.10)
- (this commit) docs closeout: F-CNC11–19 flows, PROJECT.md status column,
  AUDIT.md CLAIMED rows, this section

**G-code snapshot corpus untouched** — every new pipeline feature is opt-in;
defaults are byte-identical, so no snapshot acknowledgment was needed.

### Doc state after this session
- WORKFLOW.md: F-CNC9–19 all fleshed out (success/error/empty/edge). §1's
  "name-only placeholders" note is stale.
- PROJECT.md: Phase H table now carries a Status column (all Built; ADR-100/101
  noted in the intro).
- AUDIT.md CNC inventory: every Phase H row CLAIMED with evidence; the five
  "pending" rows are gone.
- DECISIONS.md: ADR-100 (gate-and-hide policy) and ADR-101 (three.js, UI-only
  override of ADR-094 §2) appended. Next free ADR is **102** (095–099 still
  reserved/taken per §2).

### PROVISIONAL decisions awaiting maintainer review (flagged in ADRs/commits)
1. ADR-100 hide-list additions beyond the audit list (incl. optimization
   settings); Auto-focus hidden in CNC; device laser fields hidden (not
   re-labeled).
2. H.6c "CNC text defaults" interpreted as: new text layers default to v-carve
   when a v-bit is active, else engrave; existing layers untouched.
3. H.9: entry-point rotation to the longest segment ships as the v1 lead-in;
   arc lead-in/out and helical entry DEFERRED (ramp entry covers the plunge
   problem).
4. H.10: registration holes fixed at 3 mm depth; drilled at identical stock
   positions in the overlap strip.
5. Drill/peck chip-clear runs at plunge feed (GRBL has no G81/G83).
6. Simulator kernel uses the active bit only in multi-tool jobs (per-section
   bit diameters are not yet simulated).
7. Two pre-existing `signedArea` copies noticed (core geometry + motion
   polish) — tidy-first extraction candidate, NOT done (refactor ≠ feature).
8. ADR-051 star-shape backfill (§8) — still the maintainer's call; not done.

### What remains to "CNC done"
Only §7.D — hardware verification on the 4040. Impossible from a software
session by definition (ADR-094 §3): every AUDIT.md Phase H row stays CLAIMED
until the maintainer logs air-cut results. The highest-risk session is the
H.7 tool-change job; the AUDIT rows name each pending check.
