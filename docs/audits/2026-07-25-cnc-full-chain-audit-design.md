# CNC Full-Chain Settings & Correctness Audit — design

Baseline: worktree `canvas-default-black-image-70553f`, HEAD `ff57587b`, tree clean.

## Question the audit must answer

For every CNC-affecting setting from the tracer to the last emitted G-code byte:

1. **Is the value correct?** Does the compiled toolpath / emitted G-code do what the
   setting says it does?
2. **Is the default correct?** Is the shipped default the safe, industry-standard
   starting point a router operator would expect (Easel / Vectric / Fusion / Carbide
   conventions), and is it internally consistent with the other defaults?
3. **Does it survive the round trip?** Type → UI → compile → emit → `.lf2` save → load.
4. **Is it reachable?** Does every field in the type have a UI control, correct units,
   and the right binding?

## Rules the audit runs under

- **Read-only.** Report findings; the maintainer chooses fixes (CLAUDE.md rule 1).
- **No new guards.** A finding that proposes blocking/refusing/clamping/gating is itself
  a violation (CLAUDE.md rule 7 / PROJECT.md #21). Findings go to Job Review warnings.
- **No invention.** Every claim carries `file:line`. Unverifiable → say so.
- **Green tests are not proof** (rule 2). A dimension that is only test-verified must
  say what was NOT perceptually verified.

## Dimensions (12 finders, each independently adversarially verified)

| # | Dimension | Primary anchors |
|---|---|---|
| D1 | Tracer → CNC geometry handoff | `core/trace/trace-presets.ts`, `lightburn-trace-settings.ts`, `fit-cubics.ts`, `core/cnc/line-art-contours.ts` |
| D2 | Settings schema + shipped defaults | `core/scene/machine.ts` (`DEFAULT_CNC_*`) |
| D3 | Feeds/speeds + material seeding chain | `core/cnc/feeds-calculator.ts`, `machine-starters/resolve-cnc-auto-settings.ts`, `resolve-cnc-machine-starter.ts`, `cnc-machine-starter-catalog.ts` |
| D4 | Profile / pocket / engrave geometry | `profile-paths.ts`, `pocket-paths.ts`, `depth-passes.ts`, `motion-polish.ts`, `profile-lead*.ts`, `cnc-tabs.ts`, `finish-allowance.ts` |
| D5 | V-carve / relief / drill / inlay / adaptive / rest / surfacing / helical | `vcarve-ladder.ts`, `compile-cnc-relief.ts`, `drill-peck.ts`, `inlay-pair.ts`, `adaptive-pocket.ts`, `rest-pocket.ts`, `surfacing.ts`, `helical-entry.ts` |
| D6 | G-code emission | `core/output/cnc-grbl-*.ts`, `io/gcode/standalone-cnc-gcode.ts` |
| D7 | Machine / device / controller settings sync | `core/devices/device-profile.ts`, `ui/machine/cnc-detected-apply.ts`, `ui/state/cnc-controller-caps.ts`, `cnc-machine-catalog.ts` |
| D8 | `.lf2` persistence round-trip | `io/project/normalize-layer.ts`, `deserialize-project.ts`, `normalize-cnc-feed-source.ts` |
| D9 | UI reachability / units / bindings | `ui/layers/Cnc*.tsx`, `ui/machine/Cnc*.tsx` |
| D10 | Preflight / Job Review / warnings + rule-7 compliance | `core/preflight/cnc-*.ts`, `ui/laser/cnc-*-warnings.ts` |
| D11 | Run / stream / pause / resume / recovery | `ui/state/cnc-pause-resume-policy.ts`, `core/recovery/cnc-*.ts`, `cnc-live-start-readiness.ts` |
| D12 | External reference ground truth (web research) | manufacturer chipload charts, Easel/Vectric/Carbide defaults, GRBL `$30`/`$32` semantics |

## Method

`pipeline(D1..D12, finder, adversarial-verifier)` — each dimension's findings are
attacked as soon as that dimension completes (no barrier). Verifier is instructed to
**refute by default**; a finding survives only if the verifier can reproduce the defect
from the code. Survivors go to one synthesis agent that dedupes, ranks, and separates
"code is wrong" from "default is wrong".

## Output

P1 = wrong/unsafe machine motion or lost operator settings.
P2 = wrong default or wrong value that produces a bad-but-not-dangerous cut.
P3 = cosmetic / label / unreachable setting.
Plus an explicit **NOT VERIFIED** list (nothing here is hardware-verified).
