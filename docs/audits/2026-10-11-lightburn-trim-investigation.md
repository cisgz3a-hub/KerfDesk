# LightBurn Trim investigation

Date: 2026-10-11. Status: static investigation complete; the independently reproduced KerfDesk line/curve contact defect is corrected and regression-tested locally.

## Scope and evidence boundary

REA/Ghidra static evidence concerns installed LightBurn 2.1.02, `C:/Program Files/LightBurn/LightBurn.exe`, SHA-256 `a0836cc167ff4402e68d35ef3384a2042c4ddb7aa83a428fb754371f4290b0c6`. These are decompiled procedures, assembly and cross-references, not original source or native UI/runtime verification. PDB symbols were not imported. Helper names below are descriptive interpretations; addresses and evidence IDs are the stable anchors. No proprietary code or assets were copied into KerfDesk.

KerfDesk comparison baseline is commit `3ae294b284142f7e421bb2c15f3915489a8f6211`. Source references below describe that baseline. Raw REA records and the original tangent reproduction are retained outside this repository under `C:/Users/Asus/Tools/rea-install-verification/lightburn-trim` and its parent directory. No decompiled implementation is included here.

The native session was closed after saving `analysis.snapshot.json`. The snapshot contains 16 evidence records but zero reusable primitive/workflow entries; it is an evidence ledger, not a verified replacement for the imported Ghidra database. The private analysis runtime was removed, and the installed executable hash was verified unchanged.

## Two distinct LightBurn contracts

**Node Edit T:** hover a line/curve and press T to trim back to the next intersection. Node editing requires ungrouped paths; text, primary shapes and barcodes need prior conversion. The page does not define no-hit, overlap or modifier behaviour. [Official Edit Nodes documentation](https://docs.lightburnsoftware.com/latest/Reference/EditNodes/#keyboard-actions)

**Standalone Trim Shapes:** Ctrl/Cmd+K enables red hover preview and click deletion. No intersection deletes the whole shape. Primary shapes convert automatically. It joins remaining vectors where possible; Ctrl/Cmd disables joining. Shift preserves the removed segment on the current layer, with a same-layer warning. Grouped shapes must be ungrouped. [Official Trim Shapes documentation](https://docs.lightburnsoftware.com/latest/Reference/TrimShapes/)

These current documentation claims are separate from installed-binary observations below.

## Installed-binary findings

- **Node no-hit is a no-op.** E02 returns false when its accumulated contact count is zero; E01 calls commit only after success. A closed run whose chosen boundary offsets are identical also returns false, logging an invalid-offset diagnostic. A single physical self-crossing can supply two distinct parameters and is a different case.
- **Bracketing is along path order.** E02 converts contacts to segment index plus local parameter, sorts them, and chooses the nearest offsets strictly before and after the picked position. This predecessor/successor interpretation follows the decompiled comparison logic. Exact parameter 1 is changed to 0.999999 before indexing. Missing open-side contacts use run endpoints; closed runs wrap to the last/first contact. The run is gathered by adjoining segment coordinates; closure uses equality of its first/last endpoint coordinates.
- **Straight and cubic geometry are explicit.** E05 handles subtype 0 as a transformed line and subtype 1 as a transformed cubic, including both controls and parent-transform composition. E04 subdivides a cubic at 0.5, intersects its halves in both orders and discards the artificial midpoint parameter exactly equal to 0.5. Other returned self-contact points/parameters are collected. E16 performs repeated linear interpolation matching de Casteljau subdivision at an arbitrary parameter, preserving cubic geometry mathematically subject to float precision. This does not establish complete tangency or overlap robustness.
- **Slicing preserves curve segments.** E13 clones the original path, traverses the source segment run cyclically when required, inserts nodes for line cuts and calls E16 for cubic cuts. The branch structure is consistent with retaining the outside pieces for ordinary cut order and the inside interval for wrapped order; these retained-region labels are interpretation of the traversal and deletion logic. A same-segment wrapped cubic cut uses a second split parameter `t2/t1` after the first subdivision. Single and multiple output paths are observed; automatic separation of disconnected output remains an inference pending helper `0x1402e9600`. Results containing zero segments are discarded by the ordinary commit path in E10. Final processing calls helper `0x1402e8c80` with approximately 0.02; its purpose and units are unestablished, so it is not evidence of a particular flattening, joining or simplification tolerance.
- **Node flags are now assembly-supported.** E07 at `0x14037a81d`–`0x14037a827` sets R8D=0 and DL=1 before calling E03. E15 sets DL when modifier bit `0x04000000` is absent and R8B when `0x02000000` is present. Correlating this with E06/E11's Ctrl/Shift hint and E03's preserve dispatch supports: node T enables autojoin and disables preservation; standalone Ctrl disables autojoin and Shift requests preservation. Decompiled call signatures omit arguments, so the assembly is essential here.
- **Ordinary commit is grouped.** E10 invokes slicing, queues replacement/deletion/selection commands within a named `Trim Path` command group, and conditionally runs the joining branch. Command grouping strongly supports a single undoable operation, but native Undo/Redo was not exercised and command-constructor identities are inferred from call flow.
- **Standalone failure differs from node failure.** E11 stores a hovered object even when query success is false and rejects grouped shapes. E14/E15 then queue whole-object deletion on the no-success branch. Shift instead queues a layer change when the selected layer is valid and differs from the object's layer. If that condition is not met, this branch falls through to deletion. E11 also clears success for a result covering the entire source span, so the branch is broader than a literal zero-contact case. The partial-trim preserve branch in E03 has a separate same-layer warning.

## KerfDesk comparison checklist

| Area | Current implementation and inspected coverage | Follow-up |
| --- | --- | --- |
| Picking | `trim-shapes.ts:64` picks closest flattened contour; topmost wins ties. `trim-shapes-tool.ts:19` uses 8 canvas pixels. Entry is standalone click routing. | Compare native node-selection scope and exact-crossing ambiguity separately. |
| Neighbouring intersections | `trim-shapes.ts:124` uses previous `<=` and next `>` parameter, wrapping closed contours. | At an exact contact this differs from the inferred native strict predecessor/successor logic. |
| Open/closed cuts | `trim-shape-edit.ts:74` keeps up to two open pieces from an open contour or one from a closed contour. `trim-curve-split.ts:61` preserves cubic/arc segment geometry. Tests at `trim-shapes.test.ts:113,150` and `trim-curve-split.test.ts:78,98`. | Preserve canonical geometry while improving contact detection. |
| Curve contacts | `trim-contours.ts:57` uses 0.02 mm world chords, capped at 2048 per segment. `trim-shape-edit.ts:91` refines a source curve against the boundary chord, not an exact curve-curve solve. | Tangency reproduction below demonstrates missed contact. Curve-curve precision remains unqualified. |
| Self-intersections | `trim-crossings.ts:71` tests nonadjacent chords and retains both source positions. Figure-eight test at `trim-shapes.test.ts:188`. | Test cubic self-contact and adjacency rejection independently. |
| Overlap/no hit | `trim-crossings.ts:108` rejects parallel/collinear pairs. `trim-shapes.ts:116` deletes a whole open contour with zero crossings, or a closed contour with fewer than two. Pointer miss changes nothing. | Overlap-only geometry may become whole deletion. Closed single-contact behaviour differs from node T; standalone native route has whole-delete fallback. |
| Modifiers/joining | `trimShapeAt(point,tolerance)` in `trim-shapes-actions.ts:23`; `trimAtPointer` passes no modifiers. Mutation changes only the clicked object's geometry. | No current autojoin or Shift-preserve parity. Group handling also differs: no equivalent grouped-source rejection was found in this route. |
| Undo | `trim-shapes-actions.ts:59` pushes one snapshot and clears redo; misses push none. `trim-cut-shapes-actions.test.ts:136,159,167` asserts trim, miss and exact Undo restoration. | Trim-specific Redo and multi-object joining/preservation remain unqualified. |

All KerfDesk filenames above under `src/core/geometry/`, except `trim-shapes-tool.ts` under `src/ui/workspace/` and `trim-shapes-actions.ts` / `trim-cut-shapes-actions.test.ts` under `src/ui/state/`.

## Mathematical tangent reproduction at the baseline

Original artifacts: `trim-tangent-repro.ts`, `trim-tangent-repro.json`, and generated `trim-tangent-repro.cjs` in `C:/Users/Asus/Tools/rea-install-verification`. The fixture imports the baseline KerfDesk core functions; it is not a LightBurn runtime test.

The boundary is the cubic representation of `x(t)=10t`, `y(t)=(t-0.3)^2`, for `0<=t<=1`. Its four control points are `(0,0.09)`, `(10/3,-0.11)`, `(20/3,0.09-0.4+1/3)`, `(10,0.49)`. It touches the horizontal source line `(0,0)`–`(10,0)` at `(3,0)`: the y polynomial has a double root at t=0.3 and zero first derivative there. This establishes the contact independently of either implementation.

At the baseline, hovering `(1,0)` with 0.01 tolerance produces `objectId: source`, `whole: true`, null start/end, and zero remaining paths after `trimEdit`. The saved Extend analytic-contact comparator reports distances near 3 (three numerical root estimates); that is corroboration, not three distinct contacts. The missed tangent therefore made Trim propose and perform whole-line deletion in this fixture. This is a KerfDesk reproduction, not a LightBurn tangent-parity claim.

## Bounded KerfDesk correction

Mixed line/cubic and line/elliptical-arc pairs on different contours now use the original analytic contact maths shared with Extend. Contacts retain their canonical segment parameter, so trimming a curve uses the solved parameter directly rather than a sign-change search against a flattened chord. Existing near-contact deduplication makes the numerical estimates of one tangent a single cut boundary. Object and contour broad-phase bounds include canonical curve extrema; sampled chords can lie inside a real tangent. Hover highlights terminate at the same solved point used by the edit.

The original fixture now leaves `(3,0)`–`(10,0)` when clicked at `(1,0)`, preserving the boundary curve. Tests cover both sides of the line, a cubic source sliced at the tangent, ellipse contacts in both sweep directions, reversed lines, reflections/rotation/unequal scaling, conservative bounds, finite boundary clipping, a true near miss, three distinct cubic roots, and existing overlap/open-end behaviour. The independent store regression failed before the correction and passes afterward, including one-step Undo and Redo with exact project restoration.

The implementation remains deliberately bounded: curve/curve and self-intersections use the existing chord grid; collinear overlap and no-contact deletion semantics are unchanged. Autojoin and Shift-preserve are not added. Tests establish software geometry and history behaviour, not native LightBurn runtime parity or machine qualification.

## Evidence ledger

Every numbered JSON filename is in the external `lightburn-trim` evidence directory identified above; `.normalized_result` holds the inspected result. E08/E09/E12 establish navigation/caller links, not behaviour independently. E13's slicing interpretation is supported by E16's subdivision arithmetic; retained-region and disconnected-output helper meanings remain qualified in the findings above.

| ID | File / procedure or query | REA evidence ID |
| --- | --- | --- |
| E01 | `01-node-trim-handler.json`, `0x14037a7b0` | `ev_08d7a916646ef1134cc1e8b6d601013bca16b4e01a4b34b4f1c4dfadde405196` |
| E02 | `02-trim-core.json`, `0x1401c4f30` | `ev_d0771bd28255d1ef09b59e4d5aa66e6f551f2859d9810dbea3c2c1b2ba436d2e` |
| E03 | `03-trim-commit.json`, `0x1401a8fa0` | `ev_f52008f10bd6e150e24cb1a6b8491a32330b94ed11743ba07c271e90bb40487a` |
| E04 | `04-cubic-self-contacts.json`, `0x140022d50` | `ev_e53b3798b7ac6b4ead5636aa586141588b9fda655ba070397e6d24fb311cec08` |
| E05 | `05-source-segment-setup.json`, `0x1401ae720` | `ev_e35c70a7dc1b020c0bebc35b6118655a9b4662ca48abcbf9ebc8b0c65f2f5505` |
| E06 | `06-trim-strings.json`, literal Trim search | `ev_aae7a80ebe355ca32fac80147f79d6a98b072d42514917a9c0d79175d61c243a` |
| E07 | `07-node-trim-assembly.json`, `0x14037a7b0` | `ev_ef452faead5397d367b0cb7ee6441900b69adc0a94676bae4c9a1cdb82ee44fe` |
| E08 | `08-standalone-hint-xrefs.json`, `0x140dc83c0` | `ev_c3f05eae1edcc214bb0c0c9fcd3bdf4e29bfa49aa43bc14ae31bfe3007424f1b` |
| E09 | `09-core-callers.json`, callers of `0x1401c4f30` | `ev_d1eb4ec3a185351625610d33eb1afe8107bd6c7e2d218d221e746532083aeefd` |
| E10 | `10-trim-remove.json`, `0x1401c21d0` | `ev_2ab7e39f72f5d0ef10662dc24969b9480b3bec8589d0191407d5f4348fda32e7` |
| E11 | `11-standalone-query.json`, `0x140380ae0` | `ev_5fce581977389ca58bd5c0edf52287962b638504eebba2bf25cfa46133b2a3c9` |
| E12 | `12-commit-callers.json`, callers of `0x1401a8fa0` | `ev_3740465d833d9230b05894e295c4f8b8f9712645ed2805e9cdec7c6b5e9ae1d5` |
| E13 | `13-trim-slicing.json`, `0x1401c3230` | `ev_3ae3a9411c0a9733b581d9d3c454c69850614e1c60bbf7ac7b2efebe009058ab` |
| E14 | `14-standalone-commit.json`, `0x14036ce10` | `ev_e39011c7d10537382d88c7de92ae8544d7f3178142d8a96ec05bf81cfcf86707` |
| E15 | `15-standalone-commit-assembly.json`, `0x14036ce10` | `ev_b2a14ea6feae2d014ecc480438d6b258abd98cf62c1f5b3a07e685a8a9404b3b` |
| E16 | `16-cubic-split.json`, `0x140029c50` | `ev_99e164c4c23c6498ccd9ad2f1253b9f7e8609935cfedb722c620230f41500182` |

Further work could qualify curve/curve contacts and design autojoin or Shift-preserve with multi-object Undo. Native UI behaviour, exact LightBurn curve-contact numerical tolerances, hidden/locked candidate scope and hardware/output effects remain outside this evidence.
