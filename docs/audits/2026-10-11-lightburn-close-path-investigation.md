# LightBurn Close Path investigation

Date: 2026-10-11. Status: static native investigation and independent KerfDesk reproductions complete. The existing closure commands have a local geometry correction with 54 focused tests passing. The general tolerance-closure feature below is proposed, not implemented. This report makes no merge or release claim.

## Evidence boundary

Documentation claims concern official LightBurn 2.1 documentation. Native observations come from REA/Ghidra 12.1.4 analysis of installed LightBurn 2.1.02, `C:/Program Files/LightBurn/LightBurn.exe`, SHA-256 `a0836cc167ff4402e68d35ef3384a2042c4ddb7aa83a428fb754371f4290b0c6`. Decompiled procedures are static evidence, not original source or native UI/runtime verification. Names assigned to helpers and fields are interpretations unless supported by the linked data flow. No decompiled implementation or proprietary assets are included.

The KerfDesk reproduction artifacts are external: `C:/Users/Asus/Tools/rea-install-verification/close-path-review/repro.ts` and `result.json`. The fixture imports the pre-correction implementation from worktree `0175`; the saved JSON records that run. It is not evidence of LightBurn behaviour or of the corrected branch. Raw native evidence is retained under `C:/Users/Asus/Tools/rea-install-verification/lightburn-close`. The native session was closed after saving `analysis.snapshot.json`, which contains 18 evidence records and zero reusable primitive/workflow entries.

## Documented joining contracts

| Tool | Official LightBurn 2.1 contract |
| --- | --- |
| Auto-join selected shapes | Select segments and use Edit → Auto-join or Alt/Option+J. Endpoint gaps must be within 0.05 mm; joined line/curve segments become one path. [Documentation](https://docs.lightburnsoftware.com/2.1/Reference/AutoJoinSelectedShapes/) |
| Close Path | Adds a line between each path's own endpoints within 0.5 mm. It cannot connect separate paths. [Documentation](https://docs.lightburnsoftware.com/2.1/Reference/ClosePath/) |
| Close selected paths with tolerance | Sets a maximum endpoint distance; offers Move Ends Together or Join with Line; shows open/closed/remaining counts and OK/Cancel. Each path must already be connected except at its two ends. Endpoint placement and handle policy are not specified. [Documentation](https://docs.lightburnsoftware.com/2.1/Reference/CloseSelectedPathsWithTolerance/) |
| Node joining | Drag disconnected nodes onto one another to join them. The page supplies no numeric join tolerance or handle-adjustment rule. [Documentation](https://docs.lightburnsoftware.com/2.1/Reference/EditNodes/#mouse-actions) |

## Installed-binary closure findings

- **Thresholds use transformed coordinates.** C11 forms the endpoint distance using the object's transform, composing a parent transform when present, and accepts distance less than or equal to the supplied threshold. The dialog update C09 maps slider value `v` to `(v * 0.05)^2` and labels the value in millimetres, or converts the display to inches. C08 sets the slider maximum to 200. The observed setup label of 0.5 mm is not evidence of the effective initial slider value.
- **Move Ends Together uses a midpoint.** With the move flag set, C11 averages the two endpoint coordinates, transfers the incoming control coordinates to the surviving node, and redirects the previous segment to that node. C12 reads the four cubic coordinate pairs, and C16 applies affine translation to both control pairs; together they support interpreting these as absolute control positions. The direct merge branch preserves those control positions rather than translating them with the midpoint, so its adjacent tangent vectors can change. C16 bakes the object's transform into endpoints and controls before the dialog's closure call. The C19 assembly follow-up resolves the subsequent PathShape virtual calls: slot 0xa8 marks status bytes and slot 0xc8 dispatches linked-object notifications. Neither directly writes controls, and an unlinked PathShape receives no further handle translation through these calls. Linked-object callbacks and final native UI behaviour remain unqualified.
- **Join with Line has a small-gap exception.** With the move flag clear, C11 inserts a subtype-0 segment for an accepted gap at least 0.00025 mm. Smaller accepted gaps merge the nodes instead, retaining the surviving endpoint coordinate and transferring the incoming control. This threshold is measured after transforms; it is distinct from KerfDesk's defective local-coordinate snap. C12 and the earlier Trim segment reader establish subtype 0 as a line and subtype 1 as a cubic.
- **Preview rebuilds candidate results.** C10 clones each candidate, applies closure and collects original/replacement pairs in a command labelled `Close Shapes`. C09 invokes a history helper before rebuilding when its previous-change flag is set, then updates found/closed/remaining counts. Reverting the previous preview is the interpretation of this call pattern. Cancel and final Undo behaviour remain documentation-backed, not native-runtime-tested. C15 deduplicates complete node records and rebuilds segment indexes; it does not show control-coordinate translation.

This also identifies `0x1402e8c80`, left unresolved in the earlier Trim investigation, as an endpoint-gap closure helper. The Trim caller's effective mode still requires its own calling-convention check.

## KerfDesk baseline and independently reproduced defects

KerfDesk already has configurable cross-artwork **Join paths**, defaulting to 0.05 mm. It preserves canonical curves, bridges gaps with lines, requires compatible operations/settings and skips ambiguous endpoints or manually tabbed paths. Generic **Close Path** has no maximum-gap threshold. The existing reviewed tolerance dialog closes **Fill contours** only. These are source observations, not missing-feature assumptions based solely on command names.

Source anchors: `src/core/geometry/vector-path-join.ts` (`joinOpenVectorPaths`), `path-endpoint-join.ts` (`joinCurveEndpointsWithin`), `path-direction-edits.ts` (`closeOpenPaths`), `src/ui/commands/JoinPathsDialog.tsx`, `CloseOpenFillContoursDialog.tsx`, and `src/ui/state/close-open-fill-contours-actions.ts`.

The saved fixture establishes two independent Close Path defects:

1. **Closure can deform an existing cubic depending on its coordinate representation.** A local final endpoint `(0.00005,0)` with scale X=10000 produces a 0.5 mm world gap. The fixture also uses scale Y=5000, rotation 37 degrees, X reflection and translation `(21,-13)`. The original implementation treats the small local gap as already meeting, moves the cubic endpoint onto the start and adds no closing line. The endpoint moves 0.5 mm; the cubic midpoint moves 0.0625 mm. Baking the identical physical geometry into world coordinates instead preserves both and appends a fourth segment. The discrepancy demonstrates representation-dependent geometry, not a LightBurn parity difference.
2. **Reported gap can use stale compatibility geometry.** A fixture whose canonical endpoint gap is 10 mm but whose compatibility-polyline gap is 0.1 mm reports `longestGapMm` near 0.1 while adding the canonical closing line. The report therefore understates the actual gap by a factor of 100 in this case.

The first defect also reproduces through the Fill tolerance action: tolerance 0.51 mm closes the contour with the same deformation and one Undo entry. At 0.49 mm the action correctly leaves it unchanged with no Undo entry. The stale-gap fixture at Fill tolerance 0.5 mm also remains unchanged with no Undo entry: the evidence supports a generic gap-reporting defect, not a claim that Fill eligibility used the stale gap.

The local correction preserves every distinct pre-existing endpoint and curve control when adding a closing line, and derives physical gap reporting from canonical endpoints when present. Exact coincident endpoints close without an extra zero-length segment. Unlike LightBurn's observed tiny-gap exception, KerfDesk's corrected line-closure contract never moves an existing endpoint. Four new geometry regressions failed before the correction; afterward, 54 tests across six geometry/state files pass, including actual Close Path and Fill actions, threshold no-ops, repeated no-ops and exact Undo/Redo. TypeScript, scoped lint, formatting and file-size checks pass; independent diff review found no further defect. Existing eligibility and Fill tolerance gates are unchanged.

## Proposed next feature: general tolerance closure

Add **Close selected paths with tolerance…** for editable selected vector contours across operation types. Measure each contour's own endpoint gap in world millimetres; do not connect distinct contours or objects. Default the proposed maximum gap to 0.5 mm, show eligible/will-close/remaining counts, and commit one Undo step on Apply. Cancel and no-op create no history. Existing unrestricted Close Path and cross-artwork Join paths keep their established behaviour.

The first feature increment should use **Join with Line**: append the required closing segment while retaining existing curve controls, endpoints, transforms and operation ownership. Skip locked, malformed or unsupported derived/parametric geometry with clear counts. Use canonical curves over compatibility polylines and do not guess when their indexes cannot be paired. Preserve existing tab-anchor semantics when contour length changes.

**Move Ends Together is not part of that first increment.** Static LightBurn evidence supports midpoint placement with controls left at their existing absolute positions for an ordinary unlinked PathShape; linked-object callbacks and final native-runtime behaviour remain unqualified. A future KerfDesk mode should explicitly preview the resulting curve deformation and define its handle policy before implementation.

Reuse the closure geometry in `path-direction-edits.ts`, the reviewed-dialog structure in `CloseOpenFillContoursDialog.tsx`, and selection/history handling in `path-cleanup-actions.ts`. Extract operation-independent contour eligibility and canonical gap measurement rather than carrying the Fill filter into the new feature. The existing Fill repair entry point should remain available.

Substantive acceptance checks:

- Equal physical geometry with baked and nonuniformly scaled/mirrored/rotated representations yields equivalent closure, unchanged original curves and equal reported gaps.
- Threshold cases below, exactly at and above the chosen gap use canonical world endpoints, including stale compatibility geometry.
- Cubic/arc closures preserve their source segments; exact coincident ends avoid duplicate segments; a lone straight line does not become a doubled-back closed contour.
- Mixed selections close only eligible contours, preserve separate paths and metadata, and leave locks/unsupported geometry unchanged.
- Counts match committed edits; invalid input and Cancel do not mutate; Undo/Redo restores the full edit and tab state; no-op creates no history.

## Native evidence ledger

Each C-number is the corresponding numbered JSON file in the external `lightburn-close` directory; the suffix is the REA operation. Navigation records C01-C07 and C17 identify strings and callers. C13-C14 report that the dialog accept/reject thunk addresses were not in analyzed procedures; no behaviour is inferred from those failed resolutions.

| ID | Procedure | Evidence ID |
| --- | --- | --- |
| C08 | Dialog setup `0x14040f140` | `ev_fa8c49a6b65a539d6a46b00a3af944c486a529566a81d85310018ce3e95936ec` |
| C09 | Preview update `0x1403a77e0` | `ev_d72375879574ee6a23528b6c7fc133b7fb2288c2665004b92ee742edc937779b` |
| C10 | Closure transaction `0x1401a5b00` | `ev_66242f4e482034929a813ba5702b0f67b83ad2b715c33ee84905b2e78e1ba895` |
| C11 | Endpoint-gap closure `0x1402e8c80` | `ev_3d9b76af72fb714b5cf3d8ee4f07f6a5125a11e91d814bba15ee74d7f8fcb14a` |
| C12 | Cubic control reader `0x1402e2350` | `ev_2a4a93630a6adf6f9257f3568956c90aef0d922c70638a68aff1f70df6c91241` |
| C15 | Node/index cleanup `0x140307aa0` | `ev_e9966caff839b293d246d828e464f9fad478ce192d65e1e790505578e9c2cca6` |
| C16 | Transform baking `0x1402e1910` | `ev_41b93ffa9519757b8d198950a38f9f7f7f11b8b241bf69670f7e3dfdc7d6ccc7` |
| C18 | Dialog constructor `0x140397320` | `ev_0197a5b699d3a4691ab0b2bcef3cc1d932f20fdf6064b529808290df3290ba1b` |

C19 is a separate targeted PE/RTTI/Capstone trace in external `19-targeted-post-merge-trace.json`, with a qualified explanation in `19-post-merge-addendum.md`. It is not an additional REA session record. The executable digest was rechecked. RTTI, clone slot 0x20 and constructor vptr assignment establish PathShape vtable `0x140d82508`; C11 call sites `0x1402e9130` and `0x1402e913f` resolve to `0x14030bea0` and `0x140305a40`. The latter can notify a link at object offset 0xd0, which C10 copies into its clone. Therefore an absent link cannot be assumed universally. The next composite-object trace is that linked receiver's dynamic slots 0xa8/0x90/0xc8 at `0x140305a67`, `0x140305a73` and `0x140305a7f`; GroupShape has additional member callbacks. No Ghidra reimport or native launch was needed for C19.

C20, external `20-targeted-link-provenance.json` and `20-link-provenance-addendum.md`, further distinguishes ordinary grouping from those notification links. RTTI-bound GroupShape cloning assigns its parent to child offset 0xb8 at `0x1402eef25`, separate from 0xd0 and gated 0xc8. Ordinary group membership alone therefore does not introduce control translation through the inspected clone/close callbacks. An observed 0xd0 writer is called by `UndoEditArray`; its ArrayShape callbacks at slots 0xa8/0x90 return immediately, while slot 0xc8 (`0x1403058f0`) marks derived state dirty and forwards notifications without direct control writes. An observed gated 0xc8 writer belongs to cropping dependencies; the ordinary closure clone does not inherit that link or its gate. These are bounded static observations with a rechecked executable digest, not a complete inventory of writers. Arbitrary dependency chains, deferred array regeneration and native runtime behaviour remain unqualified.

This scope concerns drawing geometry and its editor workflow. It makes no hardware, licensing, output qualification or release claim.
