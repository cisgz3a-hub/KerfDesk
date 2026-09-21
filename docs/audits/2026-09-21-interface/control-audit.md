# Button-by-button functional audit

Completed 2026-09-22 in `D:\LaserForge\ui-audit-20260921`, branch `codex/ui-audit-20260921`.

This report preserves the audit snapshot before integration with main through `9d72ba798`.
[The PR integration supplement](pr-integration.md) covers the subsequently added Appearance
commands, machine-setup redesign, all 94 current commands, and the integrated toolbar. The baseline records and digest
below are retained so their evidence remains reproducible.

All **805 baseline control definitions/component calls** across **22 UI areas** are accounted for, plus **91 registered commands** clicked through their actual menu rows. This is a control-level audit with exact outcomes and evidence, rather than an inference from nearby passing test files. A reusable button can appear in multiple records, and one mapped definition can produce many visible buttons.

| Disposition | Control records | Meaning |
| --- | ---: | --- |
| defect-fixed | 9 | A reproduced defect was repaired and has passing regression evidence. |
| intentionally-unavailable | 6 | An unmounted legacy control or explicitly unsupported feature, with its reason recorded. |
| not-action-control | 7 | A container, label or gesture surface included by the scanner; not counted as a working button. |
| verified-behaviour | 421 | The stated local UI, store, geometry or explicitly simulated outcome passed. |
| verified-boundary | 362 | The stated callback, adapter, shared component or availability boundary passed; downstream effects remain outside that case. |

The separate command matrix records 89 callback/navigation boundary passes, one real Learn-store outcome, and one deliberately unavailable Focus Test. These command checks overlap the menu/toolbar definitions and must not be added to the control count as unique visible buttons.

## Findings repaired in this deeper pass

1. **Image Studio layer buttons:** Up/Down remained enabled at the stack ends, and Merge was enabled on the bottom layer. Those clicks silently did nothing. Availability now follows the active layer index, and the last layer cannot be deleted. DOM/store regressions and a Chrome add/move/merge workflow pass.
2. **Material preset wizard:** Back discarded uncommitted settings/details. It now reads the current step into the draft before moving back. Power, air and tabs survive Back/Next and final Save; Cancel still preserves the saved preset. Invalid numeric drafts use the existing parser's normalization. Chrome and focused tests pass.
3. **Network camera alignment:** “Save & show on canvas” only persisted alignment. It now says “Save alignment” and explains source selection, Update still, and turning Overlay on when hidden. Actual camera acquisition remains a separate explicit action; this repair does not claim a live camera test.

The earlier setup-navigation, image-menu keyboard/transform-state, run-order accessibility, compact dock and Done changes remain part of this worktree. Done clears only a settled successful run's display; it preserves editable artwork, undo, history, Frame state and saved execution data. Software/simulator evidence for that lifecycle is in [the completion report](completion.md).

## Inspect the evidence

- [Complete filterable CSV](control-audit.csv): one row per baseline control, including current source location, expected effect, availability and test boundary.
- [Complete machine-readable record](control-audit.json): all controls, all command expectations, exact test names and retained raw results.
- [Shell/workspace](control-audit-shell.md), [machine/calibration](control-audit-machine.md), [artwork/materials](control-audit-artwork.md), and [studios/camera/text](control-audit-studios.md).
- [All 91 command dispatch expectations](control-audit-commands.md).
- [Current source inventory](current-source/buttons.json) and [retained baseline](buttons.json).
- [Integration checks, browser results and original failure dispositions](verification.md).

Initial failed reproductions and fixture failures remain in the raw JSON. The combined validator requires every cited passing assertion to exist in its named report, each baseline ID exactly once, and a one-to-one current-source reconciliation. Independent review narrowed mocked Frame/Start, origin, Home, Abort, Fire and persistence claims to their proven software boundaries.

## Limits

No physical controller, homing/probing/firing/cutting, live camera or optical calibration, native OS installer/updater, or production deployment was exercised. Button dispatch is not proof of those external effects. Native file/clipboard/permission dialogs and renderer/camera/worker adapters use the boundaries named in each record. Exhaustive combinations of firmware, imports and application state are outside this audit.

At audit completion the changes were local and unmerged; publication is tracked in the associated
PR. The existing dirty primary checkout was preserved. The rebuilt preview is at
http://127.0.0.1:57283/ on this machine.

## Reproduce the report

Keep the baseline inventory: its IDs identify the audited records even where source lines moved.
To reproduce this dated report, use audit commit `2b67903c` and the commands below. Later main
integration changed setup controls, so its scan belongs in `pr-integration-source`, as documented
in the supplement; do not overwrite these historical snapshots from the integrated source.
Each generator validates its evidence selectors.

```powershell
node docs/audits/2026-09-21-interface/inventory-buttons.mjs docs/audits/2026-09-21-interface/current-source
node docs/audits/2026-09-21-interface/build-shell-control-audit.mjs
node docs/audits/2026-09-21-interface/build-machine-control-audit.mjs
node docs/audits/2026-09-21-interface/build-artwork-control-audit.mjs
node docs/audits/2026-09-21-interface/build-studios-control-audit.mjs
node docs/audits/2026-09-21-interface/build-command-control-audit.mjs
node docs/audits/2026-09-21-interface/combine-control-audit.mjs
```

Baseline source SHA-256: `8f5e258f3e7949843c05b7660e08060bb5a479e70615177c15a40d757c11d217`. Current source SHA-256: `e886c12cb5eb8f9163de8d49a247ddd79a4d1a1e73233285647458595776e5d3`.
