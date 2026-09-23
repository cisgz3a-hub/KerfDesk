# LightBurn artwork audit: silhouette union and cross-artwork path repair

Base: `90c791c5f0d4a6b6d7b25901d250e3f4f42c46e8`.
Worktree: `D:/LaserForge/lightburn-geometry-fixes-20260923`.
Branch: `codex/lightburn-geometry-fixes-20260923`.

This is local implementation and software evidence. It does not claim deployment, native desktop qualification, or a physical cut. The dirty canonical checkout and other worktrees were preserved. No dependency installation, machine action, publication, or merge was performed.

## Behaviour

- **Tools > Union silhouette...** combines the selected closed vector shapes across operation and colour boundaries. The operator chooses one existing operation from the selection. The result is explicitly bound to that operation and uses its base settings, including its sublayers; source artwork overrides and power scales are replaced. The dialog explains this. Existing operation-aware **Weld** keeps its existing partitions and settings; its tooltip now describes that distinction.
- Union uses the established region normalisation and 0.001 mm boolean precision. Each source retains its own even-odd/nonzero fill interpretation before the regions are combined. Object transforms are baked in world coordinates. Open input or an empty/failed result leaves the source project unchanged.
- **Tools > Join paths...** joins and closes nearby open paths in one or several selected artworks. **Maximum gap (mm)** defaults to 0.05 and accepts any finite nonnegative value. The dialog shows the number of joins, closures and remaining open paths before applying. A nonzero gap is bridged with a straight segment, without moving the original endpoints.
- Join preserves operation ownership. Binding precedence is path IDs, object IDs, then legacy colour. The complete binding set, source colour, power-scale intent, artwork override intent, fill rule and transformed stroke metadata must match. IDs referring to distinct operations do not match merely because those operations currently have equal settings. Empty and orphan bindings are retained, rather than converted into executable output.
- Endpoint matches must be mutual and unique inside the tolerance. Branch junctions are left for manual editing. Curves with manual holding tabs are not joined, but their endpoints still participate in ambiguity detection; unaffected tab indices are remapped when earlier paths are removed.
- Cubic and elliptical segments remain canonical. Scale, mirrors and rotation are baked without replacing curves with compatibility polylines. Closed and unrelated paths remain intact. Changed parametric/text/traced objects become editable imported paths, as expected for this geometry edit; unchanged objects retain their original representation.
- Both actions commit one undo transaction, clear stale node selection, update object/group/order references and leave the resulting artwork selected. The result replaces the relevant sources only after complete geometry succeeds. Undo/redo and project save/reopen are covered.

## Verification

All commands used the existing `node_modules` junction, without `pnpm install` or mutation of the shared dependency tree.

- Six focused files: **34 tests passed**, including independent area/perimeter checks, transformed ellipses against parametric samples, exact cubic control points, 5,000 joined fragments, operation-binding/override rules, protected tabs, undo/redo, compilation, save/reopen and mounted dialog controls.
- Twelve existing regression files: **205 tests passed** covering Weld, booleans, vector actions, engine failure, node Join, selection eligibility, command routing and every application menu command.
- After the ambiguity/refactoring changes, the three affected geometry/state/dialog files were rerun: **19 tests passed**. This is a subset of the 34 tests above, not an additional unique-test count.
- Full TypeScript checking passed. Scoped ESLint, Prettier and `git diff --check` passed. Source file-size and public-export ratchets passed; the report-only soft line-limit check completed.
- The whole repository suite, web build, browser visual check, installed desktop check and hardware checks were not run in this lane. Integration owns the combined checks.

The audited rectangle fixture is tested with two separate operations: 60 x 40 mm at (40,40) and (70,60). Explicit silhouette union has area **4,200 mm²** and perimeter **300 mm**; operation-aware Weld retains **400 mm**. The state test independently sums compiled cut lengths and confirms the chosen operation's power/speed. A reflected, rotated, nonuniformly scaled ring retains its hole; adding a shape into half of the hole fills precisely that half.

## Deliberate limits

- Join is available across artworks through **Tools > Join paths...**. The node toolbar's manually selected two-anchor Join retains its existing same-artwork workflow.
- Compatibility is deliberately conservative: equivalent current output encoded with different override intent may remain separate. The operator can first assign matching artwork settings; Join never silently replaces differing settings.
- Ambiguous endpoint junctions and manual-tab contours need manual editing. Join does not trim, extend to intersections, remove duplicate segments or consolidate separate operations.
- The silhouette operation picker lists the selected artwork's assigned operations. Unassigned artwork needs an operation before this action can apply.
- Extremely complex compatibility flattening or invalid/singular transformed geometry reports an unchanged result. This is a geometry preparation failure, not a machine policy gate.
- Large-path software evidence is the deterministic 5,000-fragment test, not a general performance certification.

## Central documentation follow-up for integration

The lane intentionally does not edit `PROJECT.md`, `WORKFLOW.md` or the central ADR files.

1. Reconcile the stale claim that general geometry booleans are outside product scope with the existing and newly implemented tools.
2. Add the explicit chosen-operation silhouette contract, including replacement of source artwork overrides and its distinction from operation-aware Weld.
3. Add the cross-artwork Join workflow, physical tolerance, compatibility rules, ambiguity/tab behaviour and single undo transaction. Keep the existing two-node Join workflow separately documented.
4. Include these tools in the appropriate drawing tutorial/help entry if the integration is updating tutorials. Command tooltips are already included here.
