# T33 Offset Shapes — refuter report
Tree: origin/main @ eeac725e8 (`C:\Users\stolk\kd-t1\t31-main`). Command id: `tools.offset-shapes`.
Auditor report: `C:\Users\stolk\kd-t1\reports\T33-offset-shapes.md`.

Method: my own Vitest file `C:\Users\stolk\kd-t1\zz-t33r\r33.test.ts` with my own fixtures. It drives the real store action (`offsetShapesSelection`), the real `selectAllObjects`, `unlockAllObjects` and `setRegistrationOutput`, and the real `prepareOutput` → `emitPreparedGcode`. The G-code is decoded by my own decoder, `C:\Users\stolk\kd-t1\zz-t33r\gdec.ts`. It sums the lit G1/G2/G3 length per `F… S…` pair, counting a move only when the laser is on and S > 0. I did not reuse the auditor's `decode.ts` or `common.ts`. The log is `C:\Users\stolk\kd-t1\zz-t33r\r33.log`: 7/7 tests pass, run with `--maxWorkers=1` at 1.96 to 2.40 GB free.

To run it from the tree root:
`NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config C:/Users/stolk/kd-t1/zz-t33r/vitest.config.mts --maxWorkers=1 r33`

## Verdicts

| Claim | Auditor | Verdict | Final |
|---|---|---|---|
| T33-P2-1 mixed selection → one clone of the first source's operation | P2 | **UPHELD, narrowed.** The result being one object on one operation is documented (ADR-410 item 3) and matches LightBurn. The defect is that the operation is picked silently by scene order: the dialog neither shows it nor offers a choice, and nothing warns when the operation it picks has output off. The jig sub-case needs Unlock All. | P2 |
| T33-P2-2 Inward + Delete originals silently deletes shapes that made no offset | P2 | **UPHELD.** Reproduced with a collapsed square, a thin bar and an open line. Neither the preview nor any toast shows it. LightBurn's docs suggest it also deletes every selected object, so the fix is a notice, not a change to Delete. | P2 |
| T33-P3-1 distance 0 refused (LightBurn uses 0 to repair) | P3 | CONFIRMED (R5, and the LightBurn page's Tips) | P3 |
| T33-P3-2 result drops the source name | P3 | CONFIRMED (R5) | P3 |
| T33-P3-3 dialog does not say which operation the results use | P3 | CONFIRMED (READ). It is the fix surface for P2-1, so fold it into that fix. | P3 (fold into P2-1) |
| T33-P3-4 any distance is accepted (1e7) | P3 | CONFIRMED (R5: 1e5 mm gives a 200,010 mm outline in 18 ms) | P3 |
| #1900 closed the dialog guard gap | — | CONFIRMED (R7, plus a read of `OffsetShapesDialog.tsx:66` and `offset-shapes-actions.ts:126`) | — |
| **T33R-P2-1** (new) in a registration jig left in Outline only (new jigs start there), the offset of the artwork lands on an output-off operation that Artwork only never turns back on | — | REPRO (R6) | P2 |

## Evidence per claim

### T33-P2-1 — UPHELD at P2, narrowed

**Intent (documented).**
- ADR-410 item 3 (`docs/decisions/ADR-410-everyday-editing-tools.md:53-61`) says the selection is "unioned as one design". It also says: "The results get their own operation cloned from the first source (ADR-103 behaviour)."
- So there is one result per direction on one operation, by decision. The ADR never considers a selection that spans operations, or a first source whose operation has output off.
- ADR-350 item 2 is the counterpart for Union Silhouette: "The operator chooses one selected operation for the result." The project already decided that a unioned result spanning operations needs an explicit choice. Offset has the same one-design shape, but it chooses silently.
- ADR-350 Amd 1 item 2 says "Offset adds a new object … so they may still work on jig artwork". Offsetting jig artwork without Delete is therefore allowed on purpose.

**LightBurn.**
- The Offset Shapes page (2.2 guide, read 2026-11-14) does not say which layer the results go on. The brief's premise is that they go on the current layer.
- On that premise, LightBurn also puts every ring of a mixed selection on one layer, so "one layer for everything" is parity.
- The difference is that LightBurn's current layer is one the user sets on purpose and can see. KerfDesk uses the first source in scene order, which the dialog does not show (`OffsetShapesDialog.tsx:84-92`: fields, preview, skip notice and the status "Adds one new shape: …" only).

**The dialog.** It has no operation readout and no picker. P3-3 is the auditor's note on that.

**Repro (R1, R2, R3), own numbers.** "Before" and "after" are the decoded burn.

| Case | Before | After | New operation | Toast |
|---|---|---|---|---|
| R1: A 30×10 on Line 600/50 %, B 20×20 on Fill 2000/25 %, Outward 1, keep originals, order A,B | 2080.000 (F600 S500 80 + F2000 S250 2000) | 2252.559 (the B ring is cut at F600 S500) | line, output on, 50 %/600 | none |
| Same, order B,A | 2080.000 | 6410.320 (the A outline offset is hatched: F2000 S250 2000 → 6330.320) | fill, 25 %/2000 | none |
| R2: guide G 100×60 on an output-off line operation (scene first), part P 15×15 on cut 400/95 %, Delete **on** | 60.000 | **0.000** | line, output **off** | none |
| R2: same order, Delete off | 60.000 | 60.000 (the part's offset never burns) | output off | none |
| R2: order P,G, Delete on | 60.000 | 378.279 (the guide's 102×62 ring is **cut at 95 %**) | output on, 95 %/400 | none |
| R2 control: part alone, Delete on | 60.000 | 66.279 | output on | — |
| R3: jig in Artwork only, Select All with **locked** outlines | 160.000 | 332.559 (correct: the art clone burns) | output on | — |
| R3: jig in Artwork only, **Unlock All** + Select All, Outward 1 | 160.000 | 160.000 (4 rings on a clone of Registration jig, output off, 30 %/1500) | output off | none |
| R3: jig in Outline only, Unlock All + Select All | 480.000 | 1116.559 (the art rings burn at the jig scribe settings in the outline run) | output on, 30 %/1500 | none |

**Reachability of an output-off first source.**
- A guide or template operation with output off, drawn first, is an ordinary layout. Select All → Offset outward with Delete, done to grow everything by a kerf, then empties the burn, and nothing says so. Job Review has no warning for artwork on an output-off operation (searched `src/core/preflight`, `src/ui/laser/job-review`).
- The jig sub-case is reachable only after Unlock All, a deliberate step. With the outlines locked (the default), Select All picks only the art, and the art's clone burns correctly (R3, locked rows).

**Grade.** The general effect, one operation for a mixed selection, is documented and matches LightBurn. Alone it would be P3 wording, the same as T33-P3-3. P2 still holds for two reasons:
- The choice is invisible and depends on scene order.
- When the operation it picks has output off, the user's cut leaves the burn (60 → 0 mm with Delete) with no notice. When a guide is in the selection, the guide's ring is cut at full power (378 mm instead of 66).

That is "a wrong result … or a missing warning". It is not P1, because the new operation appears in the operation list with its output state and colour, and Undo restores the project exactly (R4 checks show `undo restores: true`).

**Fix correction.** Do not batch per source operation. That would contradict ADR-410's "unioned as one design", because overlapping sources on different operations would stop merging. Instead:
- Show the result operation in the dialog, defaulting to the first source.
- Let the user pick from the selected operations, as Union Silhouette does.
- Warn, or refuse Apply, when the chosen operation has output off.

### T33-P2-2 — UPHELD at P2

**Repro (R4).** Cut is 500 mm/min at 80 %, distance 1.5 mm.

| Case | Delete | Before | After | Objects left | Toast |
|---|---|---|---|---|---|
| plate 40×30 + square 2.5×2.5, Inward | on | 150.000 | 128.000 (the square's 10 mm cut is gone) | `offset-inward-paths` | none |
| plate + thin bar 2×40, Inward | on | 224.000 | 128.000 (the bar's 84 mm cut is gone) | `offset-inward-paths` | none |
| plate + open line 25 mm, Inward | on | 165.000 | 128.000 (the line is gone) | `offset-inward-paths` | none |
| plate + square + line, Both | on | 175.000 | 356.254 (the square and the line get outward rings only) | 2 results | none (the "inward collapsed" notice fires only when the whole inward result is empty) |
| each of the above | off | (sources kept) | — | — | none |

**Preview and notice.**
- `OffsetShapesPreview.tsx:41` draws every source faint whether or not Delete is ticked. Nothing marks the sources that will be deleted with no replacement.
- The status line is built by `summary()` (`OffsetShapesDialog.tsx:193-200`), and it reports only the result sizes ("Adds one new shape: inward …").
- A careful user could notice that a small source has no green inner ring. With text or a dense design, they would not.

**Own rules.**
- ADR-410 item 3 tells the user on full collapse under Both ("a notice says so") and refuses Inward on open lines alone ("explains that it needs a closed shape").
- The partial cases fall between those two rules. The same open line is refused when it is alone, and silently deleted when it is in a selection.

**LightBurn.**
- The page says only "You can only create Inward offsets for shapes that are closed". It says Delete original objects deletes "the objects that you had selected before opening this dialog".
- It does not document collapse, and I found no notice in it. LightBurn very likely deletes these shapes too, so deleting is not the defect. The missing notice is.

**Grade.** P2 (missing warning; cut lines leave the burn). The severity table names "a missing warning" under P2. Undo restores the project exactly, which keeps it out of P1.

**Fix.**
- Count the sources that contributed nothing (closed sources fully eroded, and open paths under Inward). Name them in a notice, or keep them.
- Have the preview mark sources that Delete will remove without a replacement.

### P3 spot-checks (R5, R7)
- **P3-1.** `offsetShapes` refuses 0 and 0.0009 with "Offset distance must be a positive number of millimeters." 0.001 works. The LightBurn page's Tips do suggest a 0 distance to repair broken vectors. Confirmed P3.
- **P3-2.** A source named "Bracket" gives a result with `name` undefined and `source` "Offset outward (1 mm)". Confirmed P3.
- **P3-3.** Confirmed by reading. It is the UI half of P2-1, so fold it into that fix.
- **P3-4.** A distance of 1e5 mm is accepted: the outline is 200,010.000 mm wide and takes 18 ms. Confirmed P3.
- **#1900 guard.** `offsetShapesTargets` is the call both the dialog and the action use.
  - Delete off: it keeps the jig outlines, the art and its copy, and drops variable text with "Variable text was left as text: …".
  - Delete on: it keeps only `plain`, and the notice also says "The registration jig was left as it is: …".
  - This matches ADR-350 Amd 1/2. **Confirmed fixed.**

## Extra findings

### T33R-P2-1: A registration jig in Outline only (where a new jig starts) gives the art's offset an output-off operation, and Artwork only never turns it back on, so the offset never burns
- **Severity:** P2. A wrong result with no warning: the new outline is drawn on the canvas but burns in neither jig run.
  - This is not P1. The new operation shows its output toggle off in the operation list, and Undo restores the project.
  - It is ordinary use: no Unlock All, the default locked outlines, and a single selected source is enough.
- **Where:**
  - `src/ui/state/vector-path-actions.ts:326-366`: `prepareIndependentArtwork` clones the source operation including `output`.
  - `src/ui/state/registration-output-actions.ts:67-85`: Artwork only restores each layer from the snapshot taken at Outline only, `artworkOutputSnapshot?.[layer.id] ?? layer.output`. The new operation is not in that snapshot, so it keeps the `false` that the Outline-only state gave it.
- **Repro:** R6. The jig is 2 outlines (locked), art S 20×20 on `art` (2222/90 %) plus its box-B copy. Steps: `setRegistrationOutput('artwork')`, then `'box'` (Outline only, as for a new jig). Select S (or S and its copy), Offset Outward 1 mm, then `setRegistrationOutput('artwork')`.
  - Layers after the offset: `registration=true, art=false, operation-offset-paths=false`.
  - After Artwork only: `registration=false, art=true, operation-offset-paths=false`. The burn is 160.000 mm, identical to the no-offset control (160.000).
  - The offset ring (about 86.3 mm) never burns in the outline run (480.000 mm, outlines only) or the artwork run. No toast.
- **Oracle:** The artwork's operation is off only because of the jig's run toggle, not because the user chose it. The source art itself burns in Artwork only, so a derived outline of that art should burn there too.
- **Likely shared (READ ONLY):** every `prepareIndependentArtwork` caller, which includes the panel offset (`vector-path-actions.ts:310`) and the Boolean results (`:257`). The Booleans and Weld leave jig art out (ADR-350 Amd 1 item 2), so Offset and the panel offset are the reachable ones.
- **Suggested fix:** When cloning an operation whose output is off only because of the registration run state, take the output value from `registrationArtworkOutputSnapshot`, or add the clone's id to that snapshot, so Artwork only turns it on.

## Not refuted / limits
- **LightBurn's layer choice for Offset results.** The official page does not state it. I used the brief's premise (the current layer) and did not verify it in a LightBurn install, since none is available here.
- **Not checked:**
  - Browser-driven dialog: memory was about 2 GB, and the dialog was read instead.
  - The panel offset (ADR-103) under mixed selections: READ ONLY, same `selected[0]` shape.

## Totals
Verdicts: T33-P2-1 UPHELD P2 (narrowed: one operation is documented and matches LightBurn; the defect is the silent scene-order choice with no output-off warning; the jig sub-case needs Unlock All); T33-P2-2 UPHELD P2; T33-P3-1..4 CONFIRMED P3 (P3-3 folds into the P2-1 fix); #1900 dialog guard CONFIRMED fixed. Extra raised: 1 (T33R-P2-1 P2: art offset in an Outline-only jig gets an output-off operation that Artwork only never re-enables).
