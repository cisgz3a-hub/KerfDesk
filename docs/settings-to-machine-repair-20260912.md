# Settings-to-machine audit repair — 12 September 2026

The eight recorded audit findings are addressed in branch
`codex/fix-settings-machine-audit-20260912`, initially based on main
`d843225f1ca44cc9f97564691ea773a7eda4715b` and rebased onto
`339e0ab019af61d4775c40f0a48a26d8a49af1a0` after the independent V-carve work merged.
Seven needed additional repairs;
UI-F05 was already fixed on this base and receives inspector-level regression coverage.
The original audit examined `9134c3e74dbe1f4760729660e4d7ba56264b90fa` plus a separately
identified older running browser build. This ledger does not replace that historical evidence.

## Finding closure

| Finding | Result | Discriminating verification |
| --- | --- | --- |
| UI-F01: first artwork represented a mixed selection | Differing numeric fields show Mixed; booleans use an indeterminate state; mixed process/dither is explicit. Bulk and Advanced edits preserve unrelated artwork settings. | Power 17/83 and speed 601/1801 remain independent; entering 17 explicitly updates both powers in one undo. No edit on blur or untouched Advanced acceptance. Pending edits cannot overwrite newer mixed state. |
| UI-F02: switching profiles overwrote destination defaults | Restore the destination profile slot on every profile-name change, with empty defaults for absent/corrupt slots; suppress persistence during restoration. | A23 → B81 → A23 retains 23/81; absent destinations cannot inherit 23. |
| UI-F03: defaults copied Startup-owned CNC bindings | Existing artwork-copy rules preserve destination material and every cutter role. Six image/trace creation paths also use those rules. | Legacy defaults with source bindings cannot replace destination assignments; new operations resolve to the same Startup material/cutter as no-default creation. Saved artwork numbers remain exact. |
| UI-F04: corrupt JSON-shaped defaults were trusted | Validate partial layer records with project rules and require CNC values to satisfy canonical normalization without repair. | Invalid semantic values are rejected and the corrupt slot is cleared best-effort; legitimate speed 7, passes 777, pitch 0.025 and overscan 26.75 survive. |
| UI-F05: untouched numeric values changed on blur in older running build | Retain the already-merged edited-draft behavior. | Full Inspector preserves speed 7777, pitch 0.025 and overscan 26.75 on blur without changing project/undo state. |
| SETUP-001: false green firmware comparison | Show compared/expected count and missing/invalid codes. Only complete numeric coverage and agreement earns the match message. | Corrupt `$30`, unknown-only and partial readback cannot produce complete agreement; valid mismatches retain their existing write eligibility. |
| F-compiler-001: requested settings described as effective | Separate requested override comments from resolved hatch/image plans, including calibration fallback, minimum pitch, normalized angle and pass-through image density. | Comment-only changes leave executable command lines identical; 0.049 requested fill pitch discloses 0.05 planned pitch and actual one-way fallback. |
| BROWSER-001: Inspector counted S0 runways as Cut | Classify laser-off feed/arc movement as travel using compiled snapshot context. Preserve feed rate, CNC semantics, fan control and imported-program uncertainty. | Independent 106-row, three-pass fixture reports 1908 mm unpowered feed travel and 6360 mm powered cut; CNC/unknown/fan cases verify classification boundaries. |

Independent review extended UI-F01 closure to dependent image bounds and removed Advanced
controls that could not commit artwork overrides. A minimum-power edit to 60 on artwork
with powers 83/17 now stores 60/17. A 0.15 dot-width edit at densities 5/10 stores 0.15/0.1.
Reversing selection order produces the same per-artwork results. Increasing density only
reduces dot widths that exceed the new limit. Changing process drops edits to controls no
longer present instead of copying the first artwork's fallback.

## Verification

Desired-behavior tests reproduced each repaired defect before its fix. Focused cohorts
cover defaults, all six image creation paths, firmware comparison, mixed editing,
provenance, inspection workers/fallback and neighboring output/streaming behavior.
The separate cohorts overlap and their counts must not be added.

Integrated checks and browser observations are recorded here after completion.

## Evidence and scope

Local execution evidence is retained outside the source checkout at
`D:\CodexWorktrees\settings-machine-fix-evidence-20260912-01a095a3`, with delegate reports
under `delegated`. It includes red and green test reports, exact commands and source hashes.
The original immutable audit evidence remains at
`D:\CodexWorktrees\settings-machine-audit-20260912-01a095a3\audit-evidence`.

No firmware settings, physical motion, laser/spindle state, Frame/Start policy, provider
configuration, publication or deployment is changed by this repair. Hardware/material
qualification and deploying the repaired application remain separate actions.
