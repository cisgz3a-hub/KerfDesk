# T30 Join Paths — auditor report
Tree: origin/main @ f8c17f8c4. Command id: `tools.join-paths`.

## Map
- Menu: `src/ui/commands/vector-boolean-commands.ts:26-40` (enabled by `selectionCanJoinPaths`, `src/ui/commands/selection-command-state.ts:152-167`: every selected object a convertible vector (imported SVG, text, trace, shape), none locked, at least one open path). No `geometryToolSkipReasons` guard.
- Dialog: `src/ui/commands/JoinPathsDialog.tsx` (Maximum gap (mm), default 0.05; live preview through the same core call), hosted by `VectorRepairDialogHost.tsx` (closes only when the store returns true).
- Store: `joinSelection` in `src/ui/state/vector-repair-actions.ts:110-156` → `joinOpenVectorPaths` → replace sources, drop consumed objects, `removeObjectIdsFromGroups`, `repairRemovedObjectReferences(next).scene` (counts discarded), one undo entry.
- Core: `src/core/geometry/vector-path-join.ts` (signature per path: operation ids, colour, power scale, override, fill rule, stroke; result rebuilt as `imported-svg` at identity transform, curves kept) and `src/core/geometry/path-endpoint-join.ts` (grid search, mutual-unique endpoint pairs, chains, closure via `curveEndpointJoin.close`).
- Governing: ADR-350 §3 (and Amendment 1, which guards Weld/Booleans/Offset/Dogbone but does not list Join), ADR-494 (laser tabs), ADR-626 / ADR-672 reuse the pairing rule. WORKFLOW F-A6b step 2-4.
- Changes since 2026-10-16 on the join files: 8c771ce56 (2026-10-17, "only joins paths that cut identically"), f3e535e79 (2026-10-23, 34 editing fixes; dependency repair + name kept), 2c5f0e7da (2026-10-26, pairing rule reused by CNC profiles).
- LightBurn: "Auto-Join Selected Shapes" (Edit, Alt+J) joins segments whose nodes are "within .05 mm of one another" ([docs 2.1](https://docs.lightburnsoftware.com/2.1/Reference/AutoJoinSelectedShapes/)). KerfDesk's 0.05 mm default matches; LightBurn documents nothing about layers, ambiguity or connectors.

## October register re-check
Row 37 repaired "5 mm tab displacement under nonuniform scale". Still fixed: B6 places a laser + CNC tab on a closed contour of an object with scale 3×0.5, rotation 30°, mirror X, joins its open path to another object, and the tab's world position is identical before and after (-8.98076, 10.19615). The 5000-edge chain is now 50 000 pieces in 0.7 s (G8).

## Checks run
| Check | Method | Result |
|---|---|---|
| Gap at / under / over tolerance | script `zz-t30/t30-geom.test.ts` G1, float gaps logged | 0.0499 joins, 0.0501 not; "exactly 0.05" joins at x=0 and 100.1 but not at 333.3; 0.3 at x=10.3 fails (T30-P3-1) |
| Bad tolerance | G1c, dialog D1 | -1, NaN, Inf, empty, "abc" refused with one message; Apply disabled |
| Direction, reversed pieces, endpoints not moved, connector = gap | G2, own polyline oracle | 30.012 mm = sources 29.960 + gaps 0.052; 0 source vertices moved |
| T, X, near-ambiguous junctions | G3 | nothing joins, ambiguity counted (conservative, ADR-350) |
| Self closure; 4 edges one reversed | G4a/b, shoelace oracle | closed, 40.000 mm; area 100.05, length 40.010 (= sources 39.959 + gaps 0.051) |
| Doubled line, out-and-back path, tiny 3-point path | G4c/d, G7f | all become closed zero/near-zero-area loops (see T30-P1-2) |
| Curves and arcs under rotate, non-uniform scale, mirror | G5, own SVG F.6.5 arc sampler + own transform, Hausdorff | ≤ 5e-14 mm all 5 placements; cubic/arc segments kept (curve flattening, KNOWN T26-P2-1, does not apply here) |
| Tolerance in world mm after scale | G6 | local 0.004 ×10 joins, 0.006 ×10 does not; ×0.01 local 3 mm joins |
| Degenerate input | G7 | zero-length piece at junction → ambiguous, nothing joins; zero scale / NaN refused, artwork unchanged |
| Performance | G8 | 1k/10k/50k pieces: 14 / 114 / 707 ms, one chain of exact length |
| Burn decode, undo, redo, save/reopen | `t30-burn.test.ts` B1, decoder copied from zz-t29 | lit 139.930 → 140.000 (oracle), pierces 3 → 2, travel −0.01; Undo/Redo exact; reopen burns identically |
| Not joined: other op, power scale, override, colour, locked | B2 | all refused with a reason; locked disables the menu |
| Inheritance | B3, B10 | name, ops, override, power scale, library provenance kept and burned (F321 S400 both); `svgImport` lost; member names lost (T30-P3-3) |
| Variable text (single-line fonts) | B4, `prepareOutputSnapshot` + own renderer of "0042" | materialised (T30-P1-1) |
| Registration jig | B5, decoded piece order | copies whose jig identity is only the `registrationJig` field leave the jig (T30-P2-1); legacy-id copies keep it |
| Tabs | B6 | placed tab kept physically; tabbed open contour refused with a reason |
| Image mask, groups | B7 | mask keeps working (340 cells); emptied group dissolved like Delete |
| Kerf / lead-in / tabs / Fill on the closed slivers | `t30-sliver.test.ts` S1, S2 | kerf ±0.1 and +0.01 drop the doubled line from the G-code (T30-P1-2) |
| Boolean compound in selection | B9 | dialog previews 1 join, Apply refuses with a wrong reason (T30-P3-2) |
| Dialog | `t30-dialog.test.tsx` D1 (jsdom) | default 0.05, live counts, validation, submit applies 0.05, Cancel calls cancel; wording issues (T30-P3-5) |

## Findings

### T30-P1-1: Join Paths materialises variable text in a single-line font: the template "{{serial:4}}" burns on every record
- Severity: P1 — wrong burn on every piece (braces and the word "serial" instead of the number, 64.49 mm wide instead of 38.09 mm), the serial stops advancing, and nothing says so. Same defect class as T26-P1-1 / T28-P1-1, which ADR-350 Amendment 1 fixed for Weld, Booleans, Offset and Dogbone only; Join is not in its list.
- Where: `src/ui/commands/selection-command-state.ts:152-167` (gating without `geometryToolSkipReasons`), `src/ui/state/vector-repair-actions.ts:110-120,182-192` (`selectedRepairObjects` keeps text), `src/core/geometry/vector-path-join.ts:140-150` (any edited object is rebuilt as `kind: 'imported-svg'`, dropping `variableTemplate`).
- Repro: `C:\Users\stolk\kd-t1\zz-t30\t30-burn.test.ts` B4, log `t30-burn.log`. Text "SN {{serial:4}}", 10 mm, font Relief SingleLine, op L, serial 42; select it, Join paths 0.05. Menu enabled; plan "0 joins, 2 closures"; toast "Joined 0 gap(s), closed 2 path(s)". Object becomes `imported-svg`, no template. Burn before: serial 42 lit 105.897 mm, width 38.090; serial 43 lit 106.737. After: serial 42 and 43 both lit 177.867 mm, width 64.490. Same for EMS Nixish (41.80 → 67.82 mm), EMS Casual Hand, and a bare "{{serial:4}}".
- Oracle: independent single-line render of "SN 0042" is 38.090 mm wide (Nixish 41.802); the template render is 64.490 mm, matching what burns after Join.
- Suggested fix: run Join's sources through `geometryToolSources(scene, objects, 'variable')` (store, dialog preview and `selectionCanJoinPaths`) and show `geometryToolSkippedNotice`; add Join to ADR-350 Amendment 1.

### T30-P1-2: A doubled line (or out-and-back path) is "closed" into a zero-area loop that kerf offset drops from the G-code
- Severity: P1 — a cut the canvas still shows is silently missing from the burn. Doubled entities are common in DXF imports, and Join is the tool users run on those imports.
- Where: `src/core/geometry/path-endpoint-join.ts:34-52` (a component with no free endpoint is closed regardless of the area it encloses; `canPair` at `:111-122` only stops a one-segment curve from pairing with itself).
- Repro: `C:\Users\stolk\kd-t1\zz-t30\t30-sliver.test.ts` S2, log `t30-sliver.log`. Line op, kerf offset 0.1 mm, a closed 60×30 frame plus two identical lines (10,10)→(40,10) as separate objects. Select all, Join 0.05: toast "Joined 1 gap(s), closed 1 path(s). 0 open path(s) remain." Lit before 240.800 mm (frame 180.8 + line twice 60.0); after 180.800 mm, 0 lit moves on y=10, and preflight gives no new issue. S1: the same with kerf −0.1 and +0.01, and with the doubled line as two subpaths of one object; an out-and-back path 0.01 mm wide vanishes with kerf −0.1 (with +0.1 it becomes a 60.81 mm loop). With no kerf it still burns 60 mm.
- Oracle: the user's geometry is a 30 mm line; any burn must include it (before Join it burned 60 mm). A hand-closed two-point line also burns nothing under kerf (control row in S1), so the kerf engine's treatment of zero-area contours is the mechanism; Join is what creates them.
- Suggested fix: do not close a component whose closed result has (near) zero enclosed area or whose members overlap their own reverse; leave it open (or, for exact doubles, count it as a duplicate and say "use Delete Duplicates"). Consider a kerf-offset preflight warning for zero-area closed contours.

### T30-P2-1: Joining jig artwork whose membership is held only in `registrationJig` takes it out of the jig and changes the burn order
- Severity: P2 — same harm as T28-P2-1 (piece-by-piece runs dissolve, burn order changes, no notice); the trigger is narrower: legacy-id copies keep membership through their id, but copies with `registration-jig-copy-v2:` ids (the allocator's fallback past 200 characters or on an id clash, `registration-jig-artwork.ts:146-149`) and explicit-only members lose it.
- Where: `src/core/geometry/vector-path-join.ts:155-188` (`repairMetadata` copies name, ops, override, power scale, locked, provenance and tabs; not `registrationJig`).
- Repro: `t30-burn.test.ts` B5. Two registration outlines; source "L" (two strokes, 0.02 mm gap) in box A with a copy made by `withRegistrationJigChild`, plus an engraved square and its copy. Join the copy (or source + copy). v2 id: identity after NONE, jig runs 4 → 3, order `F2222@A > F1111@A > F2222@B > F1111@B` → `F2222@A > F2222@B > F1111@A > F1111@B`. Legacy id: field dropped but identity kept, runs 4 → 4.
- Oracle: ADR-606 / ADR-350 Amd 1 — jig artwork compiles piece by piece; the order before Join is the expected one.
- Suggested fix: carry `registrationJig` (re-keyed to the kept id) in `repairMetadata`; or refuse cross-object chains that mix jig instances.

### T30-P3-1: "Exactly at the maximum gap" joins or not depending on where the art sits
- Severity: P3 — boundary only; the dialog says Maximum gap and ADR-626 calls the rule inclusive.
- Where: `path-endpoint-join.ts:121` (`hypot(...) <= radius`, no epsilon).
- Repro: G1/G1b in `t30-geom.log`: gap 0.05 at x=0 and 100.1 joins; at x=333.3 (float 0.05000000000001137) it does not; 0.3 at x=10.3 does not; 0.5 does.
- Suggested fix: compare against `radius + 1e-9`.

### T30-P3-2: Dialog previews a join for a selection that Apply then refuses with a wrong reason
- Severity: P3 (rare selection).
- Where: `JoinPathsDialog.tsx:15-24` and `selectionCanJoinPaths` accept boolean compounds; `vector-repair-actions.ts:186` excludes them and toasts "Select unlocked vector artwork to join paths."
- Repro: B9 — menu enabled, dialog plan 1 join, Apply returns false; the dialog stays open.
- Suggested fix: one shared source filter for menu, dialog and store; name the compound in the message.

### T30-P3-3: Join drops SVG re-import identity and silently turns single-line text into plain artwork
- Severity: P3 — loses editability, no wrong burn (non-variable text burns the same).
- Where: `vector-path-join.ts:140-188`.
- Repro: B3 — `svgImport` missing after Join; B4 — text becomes `imported-svg` with no notice (the toast only counts joins).
- Suggested fix: keep `svgImport` on the leader; say "Text was converted to paths" when a text object is rebuilt.

### T30-P3-4: A text-on-path guide absorbed by Join detaches with no notice (READ ONLY)
- Severity: P3. Detaching is by design (`artwork-audit-regressions.test.ts` "detaches an absorbed Join guide"), but `joinSelection` discards `repairRemovedObjectReferences`' counts, so the toast Delete shows ("… reference was removed …") never appears.
- Where: `vector-repair-actions.ts:150-154`.
- Suggested fix: call `reportDependencyRepairs` as the jig action does.

### T30-P3-5: Dialog wording
- Severity: P3.
- Repro: D1 in `t30-dialog.log`. At a 100 mm gap: "6 endpoints have more than one nearby match. No matching endpoints within this gap. Assign paths to the same operation …, or increase the gap." — the cause is ambiguity, and increasing the gap makes it worse. "1 joins". No figure for the widest gap bridged, so a large gap can lay long straight connectors (burned) with only a count shown (same suggestion as T08-P3).
- Suggested fix: show the ambiguity advice instead when ambiguity > 0; singular forms; "widest gap bridged: X mm".

## Not a defect / limits
- Only mutual, unique matches join; T/X junctions stay open (ADR-350 §3). Conservative, documented.
- Curves stay `cubic`/`elliptical-arc` and are exact to 5e-14 mm after rotate/non-uniform scale/mirror; the KNOWN chord flattening (T26-P2-1, v7 L1-P3-1) does not affect Join.
- Members' names vanish because members are merged into the first object; leader keeps its own. Emptied groups dissolve as with Delete.
- Image masks: a mask can only be lost if all its curves are open and joined into an earlier object, but a mask needs a closed-enough contour, which then pairs with itself or is ambiguous; B7 found no loss.
- Not checked: inch display of the Maximum gap field (the label is mm only); browser run and keyboard Escape (jsdom document keydown did not reach the kit Dialog — inconclusive, not raised); CNC profile output of joined slivers.

## Totals
Raised 8; P1 2; P2 1; P3 5; known 0 (T26-P2-1 curve flattening checked and does not apply).
