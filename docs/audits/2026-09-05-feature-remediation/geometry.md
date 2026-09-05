# Geometry, text, operation and Design Studio remediation

Baseline: `ccaa3064d9efe904821307f0603ce842d903b586`.
Branch: `codex/feature-quality-geometry-20260905`.

This lane fixes nine findings from the September 5 feature audit. It changes no
Frame/Start policy and makes no hardware or provider calls.

| Finding | Result | Regression evidence |
| --- | --- | --- |
| F04-01 | Horizontal/vertical Flip reflects both orientation and placement in world axes. | `selection-flip.test.ts` checks every vertex of differently rotated, mirrored, nonuniformly scaled shapes, plus two-flip reversibility. |
| F04-02 | Break Apart retains each path's operation binding, canonical curves, stroke width and object metadata; holding-tab indices are remapped to the corresponding part. Groups and artwork run order expand the original member into its parts. Removed mask/path-text references use the existing dependency repair and warning behavior. | `geometry-operation-preservation.test.ts` verifies distinct compiled settings and undo; `break-apart-actions.test.ts` verifies curves, exact curve bounds, tabs, stored path-text geometry and restored dependency links on undo. |
| F05-01 | Dogbone unions and relieves each operation's own region. Shared geometry participates in each assigned operation, while geometry belonging only to one operation stays exclusive to it. Settings, power scale and object overrides survive. | Store-to-CNC compilation checks two disjoint operations remain on their respective sides and retain distinct cut depths. A separate shared-path case verifies one operation has one contour and the other has two. |
| F06-01 | Text rendering belongs to its dialog request and document epoch. Escape, unmount, replacement dialogs and New/Open replacement retire completion; document replacement also closes the old dialog. Stale errors do not appear in a newer dialog. | `AddTextDialog.ownership.test.tsx` uses deferred rendering through the real dialog, including StrictMode and a successful same-document edit. |
| F06-02 | Text rerender preserves power scale, effective override, lock state and holding-tab metadata alongside existing transform/binding preservation. | The text edit regression retains a 50% scale and compiles the intended scaled power and speed. Existing text machining/dialog tests remain green. |
| F07-01 | Make Unique and Add Operation preserve each selected object's effective override. Cloning the base operation does not reset differing member overrides or mutate unselected members. | Multiple selected members retain different effective power/speed/inversion values when separated from an unselected member. |
| F14-01 | Rectangle-to-path chamfer retains identity, construction state and carve-layer identity. | `design-apply-lifecycle.test.tsx` verifies nondefault depth/tool/cut-type routing into Apply and the same layer after undo; construction geometry remains excluded. |
| F14-02 | An empty or construction-only replacement can clear surviving output owned by the previous Apply. Only unused owned operations are removed; shared operations remain. Group/dependency references are reconciled, selection becomes empty, and the returned ownership record becomes empty in the same undoable transition. | Real Apply-hook tests cover deleting the last entity and making it construction, unrelated artwork preservation, disabled no-op Apply afterward, and project undo. Pure mutation tests preserve operations still used by unrelated artwork. |
| F14-03 | Persistence carries `dirtySinceApply`, including subscription flush on unmount. Explicitly applied drawings restore clean; pending drawings restore applyable. Older payloads without the flag conservatively offer replacement Apply when work or an apply record exists. | Restored clean/dirty drawings drive actual button eligibility; pending replacement does not duplicate output. Never-applied work survives persistence with pending state. |

Design Apply keeps its mutation free of reporting side effects: dependency repair
counts return to the store action, which uses the existing warning helper. Existing
empty sketches with no surviving owned output remain no-ops. Legacy persistence
cannot prove that a saved drawing matches its old Apply, so one extra replacement
Apply is offered rather than requiring a dummy geometry edit.

## Verification

- Dependencies installed with `pnpm install --offline --frozen-lockfile --ignore-scripts`.
- Focused baseline/acceptance run: 15 files, 102 tests. One new CNC assertion initially
  addressed a point array as an object; it was corrected to the actual typed model.
  All affected tests were rerun.
- Subsequent geometry, text, dependency and Design Studio run: **8 files, 49 tests passed**.
- Final Design Studio mutation, lifecycle, reapply, multi-tool and emitted G-code run:
  **5 files, 36 tests passed**.
- The first run's unaffected files also passed: existing vector operation actions,
  operation actions, text machining, corner operations, selection transforms,
  session storage, session transitions and the new two-axis reflection test.
- `pnpm typecheck`, changed-file ESLint, changed-file Prettier, and `git diff --check`
  passed.

Evidence is source, jsdom interaction, compiler and emitted-byte testing. No browser
visual pass, machine motion, air cut or material qualification was performed in this lane.
The parent owns integration, the consolidated ADR, PR creation and merge.
