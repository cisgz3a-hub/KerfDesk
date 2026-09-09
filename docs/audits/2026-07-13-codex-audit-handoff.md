> Historical archive added 6 September 2026. The report below retains its original July baseline, findings, priorities, source claims and reported checks. Those claims were not rerun or refreshed for this publication. Original task instructions are historical context; current Frame-first and Job Review warning policy remains governing. Its child-element LightBurn settings fix is already published in PR #101. Other findings and task instructions below remain historical; this archive neither reopens those tasks nor adopts their proposals.

# Codex handoff — audit of the last-2-day PR fleet (#52–#82)

**Date:** 2026-07-13
**Author:** Claude Code (audit) · **For:** Codex
**Scope:** PR #58 (deep audit) + the 29 PRs Codex opened/merged 2026-07-11→13 (#52–#82, excluding Claude's #50/#51).
**How produced:** two multi-agent risk-ranked sweeps (14-domain deep audit on #58; 29-PR fleet triage), each finding adversarially verified, plus hand-verification of the safety/governance hits against real code and fixtures.

**Top line:** No P0. One **P1** (in the *open* #56 — E-stop reachability). The dominant, repeated problem is **governance**, not code quality — several CNC *feature* PRs are well-engineered. Fix in the priority order below.

---

## 0. Rules of engagement (READ FIRST — these are why half this list exists)

Follow `CLAUDE.md`, `PROJECT.md`, `DECISIONS.md`, `WORKFLOW.md`. The recurring failures across this fleet were process, not logic:

1. **One PR = one concern.** No more 97-/243-file mega-PRs (#57, #58). Small, individually-reviewable diffs.
2. **Architecturally-significant change ⇒ an ADR in `DECISIONS.md`** *in the same PR*, using the next free number. As of main the ceiling is **ADR-140**; **next free = ADR-141**. Check for collisions before claiming a number.
3. **Persisted-format change (`schemaVersion` bump, new persisted field) ⇒ ADR + migration**, and note back/forward-compat.
4. **Out-of-scope feature ⇒ a `PROJECT.md` revision + ADR *before* code.** Out-of-scope today: variable text (CSV/counter/date), node editing of imported paths, boolean ops, LightBurn `.clb` compat + linked presets, system/user-uploaded fonts.
5. **Change to emitted G-code ⇒ `Snapshot change acknowledged: <reason>` line in the PR body** (only when snapshot fixture bytes change).
6. **New dependency ⇒ `RESEARCH_LOG.md` entry** (license, version, maintenance).
7. **Bug fix ⇒ test-first:** write the failing test, then fix, include both in the PR (CLAUDE.md bug-fix workflow).
8. **Run `pnpm release:check` and report what was NOT verified** (hardware, perceptual/G-code fidelity — green tests prove structure, not fidelity).

---

## 1. Already fixed (apply to main — #58 merged WITHOUT this fix)

**T1 — LightBurn project import silently drops every layer's cut settings.** `src/io/lightburn/lbrn-import.ts:82` read the cut index as an attribute, but LightBurn stores it as a child element (`<index Value="0"/>`), so the settings map stayed empty and every imported layer fell back to defaults. Confirmed against fixture `acwright-plate.lbrn2` (imported power/speed were defaults, not the file's `maxPower=50`/`speed=15`). A regression test + the one-line fix are ready — port them to a small PR off `main`:

```diff
--- a/src/io/lightburn/lbrn-import.ts
+++ b/src/io/lightburn/lbrn-import.ts
@@ -79,7 +79,10 @@ function importedLayers(root: Element, usedColors: ReadonlyArray<string>): Layer
   for (const element of [...root.children]) {
     if (normalized(element.tagName) !== 'cutsetting') continue;
-    const index = finiteNumber(element.getAttribute('index') ?? element.getAttribute('Index'));
+    // LightBurn stores the cut index as a child element (`<index Value="0"/>`),
+    // not an attribute — resolve it the same element-aware way as speed/power,
+    // or every imported layer silently falls back to default cut settings.
+    const index = numericField(element, ['index']);
     if (index !== null) settings.set(Math.trunc(index), element);
   }
```
Add the regression test in `lbrn-import.test.ts` using **real child-element format** (`<CutSetting type="Scan"><index Value="1"/><maxPower Value="50"/><speed Value="15"/><numPasses Value="3"/></CutSetting>` + a `Shape CutIndex="1"`), asserting the `#0000ff` layer imports `mode:'fill', speed:900, power:50, passes:3`. The existing test uses a synthetic *attribute* form and hid the bug. Verified: 25 lightburn tests + typecheck + lint + prettier green.

---

## 2. Must fix before merge (open PRs — do NOT merge as-is)

**T2 — 🔴 P1: #56 unmounts the machine rail (Stop/E-stop) mid-job.** `src/ui/app/WorkspaceSidePanels.tsx` renders `<LaserWindow/>` (which owns Stop/E-stop) only when the active tab ≠ `'cuts'` in compact mode (`:51`) and only when `machineOpen` on desktop (`:77`). During a running job the operator can be on the Cuts tab (the default) or have hidden the panel, and the Stop button disappears. Violates **PROJECT.md non-negotiable #9 (E-stop reachable always; no window state hides it during a job)** and regresses the fail-visible guard #63 established (ADR-139). **Fix:** while a job is active (or always), keep the machine Stop control mounted and reachable regardless of tab/collapse state — e.g. force the machine panel visible during an active job, or hoist a persistent Stop affordance outside the collapsible region. Add a test asserting Stop is in the tree across every panel state during a job.

**T3 — ADR-number collisions (open PRs).** #65 claims **ADR-139** (already used by #63) and #66 claims **ADR-140** (already used by #62). On merge `DECISIONS.md` gets duplicate headings. Renumber #65 and #66 to the next free numbers (≥ ADR-141) after rebasing on main, and fix their summary-table rows + "numbering note".

**T4 — #82 supersession edit targets the wrong ADR.** #82 correctly disables unsafe automatic CNC recovery and records ADR-141, but its `DECISIONS.md` status edit marks **ADR-135 (desktop code-signing gate)** as Superseded instead of **ADR-136 (retract-first recovery)**. Left as-is, a future reader concludes the auto-update signing gate was retracted. Point the supersession at ADR-136. Otherwise #82 is sound — **merging it is recommended** (it removes automatic CNC recovery motion at the core; a GRBL `ok` ≠ physical execution).

---

## 3. Live-on-main correctness/safety (from the #58 deep audit — now shipped)

These landed with #58 (squash-merged to main 2026-07-13) and are live. Each is a small, test-first fix:

**T5 — SVG import: a single zero-length arc crashes the whole file.** `src/io/svg/flatten-curves.ts` `arcToCubics` has a zero-*radius* guard but no zero-*length* guard. For `A` where endpoint == current point (e.g. `M5,5 A2,2 0 0 1 5,5`), `denominator = 0 → NaN` control points → the import-budget assertion throws → the entire SVG fails to import. Per SVG 1.1 F.6.2 the segment must be **omitted**. Fix: if `start ≈ end`, return `[]` (skip the arc) before the center-parameterization math.

**T6 — DXF import DoS/OOM via MINSERT.** `src/io/dxf/dxf-expand.ts:206-207` clamps MINSERT `columns`/`rows` only at the lower bound (`Math.max(1, …)`), then multiplies them in a nested loop that allocates geometry per cell. A ~200-byte DXF with `rows=columns=100000` → ~1e10 instances → tab hang/OOM before any preflight. `MAX_INSERT_DEPTH=8` does not cover the grid product. Fix: cap `rows*columns` (e.g. `MAX_MINSERT_INSTANCES`) and return a Result error / skip with a warning when exceeded.

**T7 — Linked material presets grow the project file unboundedly.** `src/ui/state/material-library-actions.ts:114` sets `lastResolved: { ...target, ...recipe }`, where `target` already contains its own `materialBinding.lastResolved`. Every Link/Refresh nests the prior binding one level deeper. Fix: strip `materialBinding` (and any nested `lastResolved`) from the snapshot before storing it.

**T8 — Variable-text edit round-trip loses data.** `src/core/variables/template-source.ts:70` drops the serial token prefix/offset on source round-trip; CSV column names containing `}` or whitespace also break it. (Also see T13 — variable text is out-of-scope and needs a scope decision regardless.)

**T9 — Load-time DoS budget ignores v2 curves.** `src/io/project/project-scene-integrity-validator.ts` (`:~90`) counts polylines but not the new authoritative `curves` subpaths/segments, so a hostile `.lf2` with huge curves bypasses the load budget. (The *pre-emit* budget does check curves; the *load* validator must too.)

**T10 — #62 finishing/roughing tab misalignment (severing risk).** `src/core/cnc/compile-cnc-job.ts` — the finishing pass runs the true contour while roughing runs `allowanceMm` proud; the same tab-split parameters on differently-offset paths can land tab gaps at different physical spots, severing the part. **This is documented in ADR-140 as a residual risk ("test cut first")** — acceptable governance, but worth hardening: derive finishing tab positions from the same *physical* locations as roughing, not the same split-parameters.

---

## 4. Governance debt to retire (the pattern that repeats #58)

**T11 — Retroactive ADRs for architecturally-significant changes already merged / in flight.** Write one ADR each (small doc PRs) for:
- **Schema v1→v2 canonical curve kernel** (`src/core/scene/project.ts:10`, `curve-path.ts`, `curve-edit.ts`) — the biggest change in #58, no ADR. Document the dual `polylines`+`curves` representation, that `curves` is authoritative for compile (`flattenColoredPathCurves`), the invalidation rule (mutators must drop `curves`), and the v1→v2 migration.
- **#57**: rotary raster (reverses ADR-127's "vectors-only" — needs an *amending* ADR), Momentary low-power Fire, the Labs gating subsystem, and the cut-planner expansion from 1 lever to 5 (contradicts DECISIONS.md:4234).
- **Open CNC batch** — each needs its ADR *before* merge: #74 (helical entry — PROJECT.md:130 explicitly deferred this to an ADR), #75 (rest machining), #77 (adaptive clearing), #78 (inlay), #79 (drag tabs), #81 (controller-profile compatibility gate), #73 (outline nesting — new default behavior).

**T12 — E2E-as-deploy-gate + dependency provenance.** #57 wired `pnpm test:e2e` (Playwright) into `release:check`, contradicting PROJECT.md ("E2E is NOT in CI"), and added `@playwright/test` with no `RESEARCH_LOG.md` entry. Either (a) update PROJECT.md to adopt E2E-in-CI via an ADR and add the RESEARCH_LOG row, or (b) move E2E to a non-blocking job. A flaky headless-chromium run currently blocks every production deploy.

**T13 — Out-of-scope features need a scope decision, not accretion.** Variable text (#58/#72), node editing of imported paths (#58), `.clb` import + linked presets (#58), user-font embedding (#58, contradicts ADR-018 "no user-uploaded fonts"). Each is shipping/extending by stacked PRs with no PROJECT.md revision. Get an explicit maintainer decision (revise PROJECT.md + ADR to adopt, or revert).

**T14 — Unacknowledged G-code snapshot change (#58).** The `curve-bearing-svg` emit snapshot changed sparse→dense (curves now flatten at 0.025 mm at emit-time) with no `Snapshot change acknowledged:` line. Add the acknowledgment retroactively (doc/PR note) and add a **rounded-rect + ellipse G-code fixture** so future curve-output changes are guarded. NOTE: the shape output change itself is *intended and within tolerance* — not a bug — but it was never eyeballed against LightBurn; do a perceptual comparison.

---

## 5. Non-safety bugs worth a fix

**T15 — #74 helical entry re-bores air + full-depth link.** `src/core/cnc/helical-entry.ts:48` forces every offset ring at every depth through one shared center helix, so the 2nd..Nth ring re-bores already-cut air, and each ring is reached by a full-depth straight link move. Fix: one entry per pocket (or per ring at its own location), and lift/relocate between rings rather than a full-depth link.

**T16 — #73 outline-nest unbounded main-thread cost.** `src/core/nesting/outline-compact-nest.ts:314` runs `~items × candidates × clipper-intersections × seeds × passes` synchronously; ~150 concave parts blows the 2 s budget and freezes the tab. Bound the work (candidate/point caps with a logged truncation) or move off the main thread.

---

## 6. Per-PR disposition

| PR | Branch | State | Risk | Action |
|----|--------|-------|------|--------|
| #56 | agent/full-sweep-v3-fixes | open | 🔴 P1 | **Fix T2 (E-stop) before merge** |
| #57 | codex/laser-9-foundations | merged | 🟠 | ADRs T11/T12 (retroactive) |
| #72 | codex/text-9-sequence-controls | open | 🟠 | Scope decision T13 (out-of-scope) |
| #74 | codex/cnc-9-helical-entry | open | 🟠 | ADR T11 + bug T15 before merge |
| #75 | codex/cnc-9-adaptive-rest | open | 🟠 | ADR T11 before merge |
| #77 | codex/cnc-9-adaptive-clearing | open | 🟠 | ADR T11 before merge |
| #78 | codex/cnc-9-inlay-automation | open | 🟠 | ADR T11 + scope check before merge |
| #79 | codex/cnc-9-drag-tabs | open | 🟠 | ADR T11 (+persisted field) before merge |
| #81 | codex/machine-profiles-9-acceptance | open | 🟠 | ADR T11 (safety gate) before merge |
| #66 | codex/ux-9-context-setup | open | 🟠 | ADR collision T3 + orphaned help id |
| #73 | codex/layout-9-outline-nest | open | 🟡 | ADR T11 + perf T16 |
| #65 | codex/ux-9-console-disclosure | open | 🟡 | ADR collision T3 |
| #82 | agent/disable-unsafe-cnc-recovery | open | 🟡 | Fix T4 then **merge (recommended)** |
| #62 | feat/cnc-finish-allowance | merged | 🟡 | Harden T10 (documented residual) |
| #61 | agent/cnc-router-controller-recovery | merged | 🟡 | OK (safety improvement); superseded by #82 |
| #76 | fix/checkpoint-disconnect-during-fire | merged | 🟡 | OK (minor: fix mis-cited ADR in test comment) |
| #60 | feat/cnc-coolant | merged | 🟡 | OK (well-scoped) |
| #53 | codex/tracer-reliability-improvements | merged | 🟡 | OK (see agent notes) |
| #54 | codex/desktop-update-trust-gate | merged | 🟡 | OK (see agent notes) |
| #80 | codex/preview-9-acceptance | open | 🟡 | Minor (see agent notes) |
| #67 #68 #69 #71 | codex/ux-*, design-curve-corpus | open | 🟡 | Minor / OK |
| #52 | ci/bump-actions-node24 | merged | 🟡 | OK |
| #59 #63 #64 #55 | params/rails/toolbar/win-release | merged | 🟢 | Clean — no action |

---

## 7. Clean — do not touch
#55, #59, #63, #64 are clean. The CNC *feature* PRs (#59 params, #60 coolant, #63/#64 rails/toolbar with ADR-138/139, #76 fire-disconnect) are well-engineered and properly ADR'd — this is the standard to hold the rest to.

---

## 8. Verification checklist (per fix)
- [ ] Failing test written first (for T1, T2, T5–T10, T15, T16), then fix, both in the PR.
- [ ] `pnpm release:check` green (typecheck, lint, prettier, license, audit, unit, e2e, builds, file-size).
- [ ] Any G-code output change carries `Snapshot change acknowledged: <reason>`.
- [ ] Any architectural/persisted/out-of-scope change carries an ADR (+ PROJECT.md/WORKFLOW.md edits) using a **non-colliding** number ≥ ADR-141.
- [ ] PR body states what was NOT verified (hardware, perceptual/G-code fidelity).
- [ ] One concern per PR.
