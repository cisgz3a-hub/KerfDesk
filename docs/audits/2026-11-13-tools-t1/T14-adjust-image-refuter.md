# T14 Adjust Image — refuter report
Tree: origin/main @ 49ced452b (`C:\Users\stolk\kd-t1\t13-main`, read-only). Command id: `tools.adjust-image`.
Scratch: `C:\Users\stolk\kd-t1\zz-t14r` (`t14r.test.tsx`, `vitest.config.mts`, log `t14r.log`).
Run (from the tree root, free memory 2.7 GB): `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t14r/vitest.config.mts --maxWorkers=1 t14r.test.tsx` → 5/5 pass, 32 s.

Method (different from the auditor's): no hand-built two-photo scene and no G-code decoder. Photo A is imported through the store's own `importRasterImage`. Photo B is made with the real Edit → Duplicate (`duplicateSelection`). The dialog is opened through the real `CommandShell` Tools menu (`[data-menu-family-summary="tools"]` → `command:tools.adjust-image`), so the real `AdjustDialog` wiring runs (`CommandShell.tsx:326-348`). The burn is compared with `core/job/compileJob` on a scene containing A alone, comparing the raster group's S values cell by cell.

## Verdicts

### T14-P2-1 — CONFIRMED at P2
I could not disprove it. Every check I tried supports it.

- **It reproduces through a real route.**
  - Import A, Duplicate: A and B both have `operationIds ["operation-A"]` and neither has an override. There is one layer: image, Floyd–Steinberg, Negative off.
  - Open Adjust Image on B from the Tools menu, tick Negative Image, OK.
  - A, which nobody touched, then compiles differently in **16,025 of 25,600 cells**: total S goes from 4,145,400 to 3,535,500, `op.negativeImage=true`, and A's effective Negative is true.
  - It costs one Undo entry, and one Undo restores A exactly (0 cells differ).
- **The dialog discloses nothing.**
  - I searched the rendered dialog's text and every `title` tooltip for "operation", "shared", "layer", "other image", "also", "every image" and "all images": all false.
  - Its only headings are "Adjust Image / Source / Processed". There is no group, legend or fieldset.
  - The Negative tooltip is "Invert image brightness before engraving." (`AdjustImageDialog.fields.tsx:311`).
  - OK pushes no toast (`CommandShell.tsx:333-339`).
  - The design canvas does not show A's change either (`raster-adjusted-display.ts:10-11`: image tones only, "not an operation's Invert brightness").
  - Only the job Preview and Job Review show it.
- **Disclosure elsewhere (READ ONLY).** The Artwork run-order card shows "Shared by N artworks" (`ArtworkRunOrderRow.tsx:150`, `artwork-run-order-view-model.ts:63`). That is in a side panel, not in this dialog, and it does not say that Adjust Image fields write to the shared operation. It is not enough to refute the claim.
- **How often photos share one operation.**
  - A fresh import gives each photo its own operation: `createArtworkOperation`, `artwork-operation.ts:45-73`, makes a new id and colour per import, and R1 shows 1 layer per import. So two separately imported photos do not share.
  - **Duplicate keeps the exact bindings** (`duplicate-scene-selection.ts:39-48`, "Keep the exact operation bindings"). R1 shows this produces the shared case with no override.
  - Duplicate-then-tweak is the ordinary "same photo on two blanks" workflow. Assign-to-operation (`assignSelectionToLayer`, "Assign one shared operation…") and multi-image LightBurn projects are other routes (READ ONLY).
- **Photo engraving writes an override first: yes. This makes the disclosure gap worse, not better.**
  - R2: the same Negative change made through `buildPhotoEngravingUpdate` on B leaves A at 0 cells differing. It writes B's override keys `mode, ditherAlgorithm, linesPerMm, negativeImage, passThrough` (`photo-engraving-apply.ts:80-115`), and its toast says "applied to the selected photo".
  - R3: once Photo engraving has given B an override, Adjust Image on B (Negative and Min Power 20) leaves A at 0 cells differing.
  - So two image tools on the same selected photo, showing overlapping fields (dither, density, Negative, Pass-through), have opposite scope. Which one you get depends on invisible history (whether Photo engraving was ever applied), and Adjust Image says nothing either way.
- **Which fields are per image and which per operation.**
  - Per image: Brightness, Contrast, Gamma (`RasterImageAdjustmentPatch`, `raster-adjustment-actions.ts:7-11`, written to the object).
  - Per operation unless the image owns an override: Dither, Min Power, Line Interval/DPI (one field, `linesPerMm`), Dot Width, Negative Image, Pass-through (`:13-24`, `:56-58`).
  - Display only: Invert Preview.
  - So yes, Brightness/Contrast/Gamma are per image while Negative is per operation.
  - No KerfDesk document states this split for Adjust Image:
    - ADR-671 talks only about the tone pipeline.
    - ADR-581 Context (l. 37-39) says only "Its Apply path edits a shared operation. Neither behaviour is suitable for the new selected-photo workflow". It records the sharing as a known shortcoming, not as a sanctioned design.
    - WORKFLOW (~l. 5106) mentions Adjust Image only for dither swatches and Pass-through.
    - The October register (2026-10-15 tools image-trace §6) says only "Shared-layer behaviour is retained".
  - The split matches LightBurn, but LightBurn discloses it: its dialog has a "Layer Settings" group, and its docs say changes affect any image on the same layer.
- **Severity.**
  - AREAS.md P2 names "a missing warning" and "a wrong result the user is likely to notice". This is exactly a missing warning whose consequence is another object's burn changing.
  - The P3 counter-arguments do not reach it:
    - LightBurn parity concerns the semantics, and LightBurn does warn.
    - The job Preview shows it, but that is the usual "noticeable" condition of P2, not of P3.
    - Undo works, but the harm is only found if the user looks at A.
  - It is not P1: the semantics are intended, Preview and Job Review show the result, and Undo is exact.
  - No earlier ledger has it. I searched `docs/audits/**` for Adjust Image together with shared/sibling/same layer and found nothing.

## Evidence
`t14r.log` (verbatim key lines):
```
R1 layers=1 A.ops=["operation-A"] B.ops=["operation-A"]
R1 A override=null B override=null
R1 dialog text words: operation=false shared=false layer=false other image=false also=false every image=false all images=false
R1 dialog title words: operation=false shared=false layer=false other image=false also=false every image=false all images=false
R1 dialog headings: Adjust Image / Source / Processed
R1 after OK on B: A pixels=25600 differ=16025 sumS 4145400 -> 3535500; op.negativeImage=true; A effective neg=true; undo +1
R1 one Undo: A differ from before=0
R2 Photo engraving on B: A differ=0; B override keys=["mode","ditherAlgorithm","linesPerMm","negativeImage","passThrough"]
R3 B owns override then Adjust Image OK (Negative, Min 20): A differ=0
R4 before phone import: header=alpha.png typed brightness=60; after: selected=C (B=ed92…) dialog open=true header=charlie.png brightness shown=60 negative shown=true
R4 after OK: C brightness unset -> 60; C op operation-C negative=true; C differ=13056/25600; B brightness=unset; B op operation-A negative=false
R5 cleared selection: dialog gone=true; selecting A again (no command): dialog open=true
```

## Extra findings

### T14R-P2-1: Adjust Image follows the live selection while it is open, so a phone or MCP selection change makes OK write photo B's draft onto another photo C and its operation
- **Severity P2.** It is a wrong result: another photo's burn changes, and the edit the user made for B is silently dropped. The user can notice it, because the header changes to C's file name and the preview redraws C. It is not P1, because it needs a write from outside the window while the dialog is open, and job Preview shows C.
  - Precedent: V6-P3-2 (rolling v10) stayed P3 for the same reachability, but there "nothing burns differently". Here something does.
- **Where:**
  - `CommandShell.tsx:89,130-131`: `selectedRaster` is read live, and `<AdjustDialog image={selectedRaster}>` has no key and no captured owner.
  - `CommandShell.tsx:330`: `layer` is re-derived from the new image.
  - `AdjustImageDialog.tsx:61`: `useState(() => initialDraft(...))` keeps the old draft across the prop change.
  - Remote writes run while a desktop modal is open: `remote-control/adapter.ts:288-295` checks only `canEdit`/`pendingUndo`, and `renderer-session.ts:126` defines `canEdit` as `pendingUndo === null`. Remote design import selects the new photo (`design-imports.ts:317` → `importRasterImage` → `selectedObjectId`), and remote selection writes exist (`remote-control/selection.ts`).
  - Contrast: Photo engraving binds to its owner and refuses when the selection or document changes (`photoEngravingOwnerIsCurrent`, `photo-engraving-apply.ts:53-65`; ADR-581 decision 7 "Bind the dialog to the exact document epoch, source, operation…"). Adjust Image has no such guard.
- **Repro (ran):** `zz-t14r\t14r.test.tsx` R4.
  1. Import A, Duplicate to B, open Adjust Image on B through the menu. The header shows `alpha.png`.
  2. Type Brightness 60 and tick Negative.
  3. Run what the phone design import calls: `importRasterImage(photo C)`.
  4. The dialog stays open, its header now reads `charlie.png`, and it still shows Brightness 60 and Negative ticked.
  5. Press OK.
  - **Actual:** C's brightness goes from unset to 60, C's own `operation-C` gets `negativeImage=true`, and C compiles differently in 13,056 of 25,600 cells. B is untouched: brightness unset, and `operation-A` keeps Negative off. The user's edit for B is lost.
  - **Expected:** OK applies to B, the photo the dialog was opened on, or the dialog refuses with "The photo changed…" as Photo engraving does.
- **Oracle:** ADR-581 decision 7, and Photo engraving's own owner check on the same kind of edit.
- **Suggested fix:** capture the image id and project epoch when the dialog opens: open `AdjustDialog` with an id, and key it. On OK, re-check them, as `photoEngravingOwnerIsCurrent` does, and show an error instead of retargeting.

### T14R-P3-1: The dialog vanishes when the selection is cleared and pops back unasked on the next image selection
- **Severity P3:** an annoyance with no burn change. The draft is lost.
- **Where:** `CommandShell.tsx:130`. `adjustDialogOpen && selectedRaster !== null` unmounts the dialog when the selection becomes null or non-raster, but `adjustDialogOpen` is never reset.
- **Repro (ran):** R5. Open Adjust Image, then `selectObject(null)`: the dialog is gone. Then `selectObject(A)`, with no command: the dialog is open again on A. Reachable through phone or MCP selection writes (the same reachability as T14R-P2-1). Locally the modal backdrop and `keyboardOwnedElsewhere` block the canvas and Esc.
- **Suggested fix:** call `setAdjustDialogOpen(false)` when the owned image disappears, or fix it together with T14R-P2-1 by keying the dialog to the captured owner.

## Totals
T14-P2-1: CONFIRMED at P2. T14-P3-1: not re-examined.
Extra raised 2: P1 0; P2 1 (T14R-P2-1); P3 1 (T14R-P3-1); known 0. The remote-while-modal reachability is the same class as V6-P3-2, but this is a different tool and it changes a burn.
