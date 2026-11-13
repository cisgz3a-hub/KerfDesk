# T22 Convert to Bitmap — auditor report
Tree: origin/main @ 1988481a5. Command id: `tools.convert-to-bitmap`.

## Map
- Menu `tools.convert-to-bitmap` (`src/ui/commands/command-families.ts:85-99`) is enabled when every selected object is a convertible vector (`selectedConvertibleVectors`, `selection-command-state.ts:85-95`). It sets `openConvertBitmapDialog` (`CommandShell.tsx:95,163-168`). The same gate covers `Ctrl/Cmd+Shift+B` (`shortcut-contexts.ts:138`).
- `ConvertBitmapDialogHost.tsx` → `ConvertToBitmapDialog.tsx` (Render Type Fill All / Outlines / Use Cut Settings; DPI 127–635, default 254; Default Brightness, default 50 %) → `convertSelectedVectorsToBitmap` (`src/ui/commands/bitmap-conversion.ts`). It records who owns the request (document epoch, the source objects by identity, and the layer signature for Use Cut Settings) and aborts on change.
- `buildBitmapFromVectors` (`src/ui/raster/vector-to-bitmap.ts`) → plan and budget (`bitmap-conversion-plan.ts`, `bitmap-conversion-resources.ts`, `bitmap-conversion-bounds.ts`) → worker (`convert-bitmap-worker.ts`) → `assembleBitmapAsync` (`bitmap-assembly.ts`). That step bakes transforms, sets each path's fill rule (text → nonzero, otherwise evenodd unless the path says otherwise) and builds groups (`bitmap-fill-groups.ts`) → `rasterizeVectorToLuma` (`src/core/raster/rasterize-vector.ts`, `rasterize-vector-fill.ts`; scanline sampled at pixel centres; paths are unioned inside an object, objects combine even-odd inside a group).
- Store `convertToBitmap` (`import-actions.ts:113-115`) → `applyConvertToBitmap` (`src/ui/state/convert-to-bitmap.ts`). It deletes the sources, runs `pruneOrphanLayers`, creates a new per-artwork Image operation (`createArtworkOperation`, defaults 30 % / 1500 mm/min / Floyd–Steinberg, `linesPerMm` = DPI/25.4) and pushes one undo entry. Laser recipe seeding then runs (`withFreshCncLayers`).
- Governing decisions: ADR-029 (DECISIONS.md:1380), with Amendments 2026-07-07 (i), (ii) and 2026-09-13 (fill fidelity, cancellable conversion, 64 MiB accounting); ADR-690 (submit clamps); ADR-286 / ADR-270 Amd 1 (fill rule). Workflow: WORKFLOW.md F-F4 (line 5827).
- Changes since 2026-10-16 on these files: ab3226fd1 (shared helpers, C2-P3-1), dbfa20e77 (#1582, a step mismatch no longer blocks a form, ADR-690), 353b82b09 (#1502), 2b1dd06c9. None changes the fill or placement semantics.

## October register re-check
Row #59 (category I: captured ownership and obsolete-work abort; 2896² pixel, 200000-point / 100000-curve budgets, nonfinite bounds):
- **Captured ownership and abort: still fixed.** `conversionOwnerIsCurrent` and the store subscription abort on a changed document, source or layer signature (`bitmap-conversion.ts:24-97`). `bitmap-conversion.test.ts`, `ConvertBitmapDialogHost.test.tsx` and the worker-client tests pass (20 files, 168 tests).
- **Pixel budget: still enforced, now tighter.** The 2896² cap was replaced by ADR-029 Amd 2026-09-13 §5 accounting (64 MiB at 32 B per pixel plus geometry), which works out to about 2.1 Mpx: 1440² ok, 1450² refused (t22c c6). See T22-P3-4.
- **Point and curve budgets:** the stress sizes are covered by the request-wide flattened-segment allowance (`bitmap-assembly.ts:201-227`) and by `bitmap-conversion-resources.test.ts` (passes). Reviewed and covered by the existing tests only.
- **Nonfinite bounds: still fixed.** NaN or Infinity bounds give verdict `too-large` with "invalid raster pixel dimensions", so Convert is disabled. A NaN DPI gives 254 (t22c c6).

## Checks run
| check | method | result |
|---|---|---|
| Burn region vs independent point-in-polygon (per-path rule, union per object, even-odd across objects), 18 cases | `zz-t22/t22a.test.ts`: real `convertSelectedVectorsToBitmap` → store → `prepareOutput` → G-code; worker transport replaced by the same `assembleBitmap` call; my own decoder and oracle | Every case matches. Max leak/miss ≤ 0.05 mm at 254 DPI (≤ ½ pixel); 0 mm² beyond 2 pitches except one decoder artefact (below) |
| Holes, nested objects on one Fill op, overlapping paths in one object (T16R-P2-1 shape), pentagram nonzero / evenodd, text one-path and unwelded multi-path with counter | t22a 02-08 | Bitmap = oracle = Fill: 321.4/321.5, 600/600 (union, not the T16R knock-out), 112.36/112.40 nonzero, 77.62/77.67 evenodd, 200/200, 188/188, 300/300 mm² |
| Rotated 30°, mirror X, scale 1.6×0.7 + 15°, mirror Y + 90°, rotated 45° footprint | t22a 10-13, t22c c8 | Area within 0.1 mm²; image bounds = exact AABB of the turned art (15.858..44.142) |
| Tiny art (0.4 mm circle, 0.15 mm bar), off-grid 7.33×3.17 mm, 127 and 635 DPI | t22a 14, 16-18 | No leak beyond ½ pixel; off-grid rect exact; 127 DPI leak ≤ 0.124 mm (pitch 0.198) |
| 635 DPI "0.865 mm interior miss" | t22b (luma row + G-code dump) | **Decoder artefact**: the sample point lies exactly on the ±pitch/2 boundary between rows 14.005 and 14.045 and float error excludes it. Luma and G-code are solid |
| Objects on two different Fill operations, Fill All vs Use Cut Settings | t22a 09/09b | Fill All XORs across objects (300 mm²) while Fill burns both (400); Use Cut Settings unions (400). Documented, see Not a defect |
| Use Cut Settings: Line object, Fill object, Output-off object | t22c c1 | Line becomes a 1 px ring (49.6 mm of rows), Fill = oracle 100/100 mm², Output-off object not rendered (0 mm) |
| Burn order after converting the engraving of an engrave + cut job | t22c c2 | New Image op is listed after the Line cut, but compile still burns the image first (segments 0-99 image, 100+ cut) |
| Source vector was an image mask | t22c c3 | Mask reference removed; warning toast "…image remains editable and unmasked" |
| Groups and artwork order | t22c2 c4 | Bitmap leaves its group (group now b,c) and goes to the top of the stacking order → T22-P3-5 |
| Undo / Redo | t22a every case | One Undo restores the same object references and operations; Redo restores the bitmap and Image op |
| Save / reopen | t22c2 c5 (`serializeProject` → `deserializeProject`) | Bounds, luma, 73×32 px, layer 10 l/mm identical; G-code byte-identical (28,433 chars) |
| Default 50 % brightness on the default layer | t22c2 c5 | Floyd–Steinberg dots at S300 (30 %), as ADR-029 / LightBurn intend |
| Budgets | t22c c6 | 144 mm² @254 ok, 145 refused; 289 mm @127 ok, 290 refused → T22-P3-4 |
| Dialog guard values | t22c c7 (jsdom, real dialog) | blank DPI → submits 127 with the field blank; blank brightness → 0 (solid black); 1e3 → 100 (burns nothing); −5 → 0 → T22-P3-2 |
| Existing suites | 20 files, `--maxWorkers=1` | 168/168 pass |
| LightBurn reference | docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/ (fetched) | Three render types; Fill All fills "areas between outlines"; 50 % gray; page warns the vector is deleted; bitmap goes to the last selected layer; no DPI range or default given |

## Findings
### T22-P3-1: The dialog never says the selected vectors will be deleted
- P3 (wording). Undo restores the vectors exactly (t22a), which is ADR-029 §5's reason. LightBurn's page carries an explicit warning, and Trace keeps its source, so users may expect the same here. The only text is "You can cancel without changing your artwork", and it shows only while busy.
- Where: `src/ui/raster/ConvertToBitmapDialog.tsx:56-101`.
- Repro: read; t22a shows the source deleted in every case.
- Suggested fix: one line under Source: "The selected artwork is replaced by the bitmap (Undo restores it)."

### T22-P3-2: Blank or out-of-range Default Brightness silently becomes solid black or invisible; blank DPI silently becomes 127
- P3. The burn changes without a message: blank → 0 % (luma 0, solid burn instead of 50 % dots); 1e3 → 100 % (luma 255, the bitmap burns nothing). The field keeps showing the typed text. A blank DPI submits 127 while the field is blank; the estimate (50 × 50 px) is the only clue. ADR-690 allows clamping at submit, but a blank field read as 0 is not a clamp.
- Where: `ConvertToBitmapDialog.tsx:224-232` (`Number('')` = 0).
- Repro: `zz-t22/t22c.test.tsx` c7, log `t22c.log`.
- Suggested fix: treat blank or NaN as the default (50 %, 254 DPI) and show the clamped value, or disable Convert with a reason.

### T22-P3-3: A conversion that burns nothing reports success and deletes the vector
- P3. An open-path-only selection under Fill All (t22a case 15: 200 × 100 px all white, 0 burned segments) or Brightness 100 % gives "Converted to bitmap: …". WORKFLOW F-F4 state 3 documents the blank result, and LightBurn's closed-shape rule is the same. Still, a notice would save a wasted job.
- Where: `bitmap-conversion.ts:64-69`.
- Repro: `zz-t22/t22a.test.ts` case 15 (`t22a.log`).
- Suggested fix: when no luma is below 255, use a warning toast ("Nothing in the selection fills; the bitmap is blank. Undo, or use Outlines").

### T22-P3-4: Artwork larger than about 289 mm square cannot be converted at any DPI; 145 mm is refused at the default DPI
- P3, a maintainer decision. ADR-029 Amd 2026-09-13 §5 accepts that "large conversions … can now be refused". The refusal advice "Lower DPI, scale the artwork down…" cannot help once DPI is at its 127 minimum. LightBurn has no such ceiling. On the default 400 × 400 mm bed, a 300 mm design cannot become a bitmap at all.
- Where: `bitmap-conversion-resources.ts` (32 B/px of 64 MiB ≈ 2.1 Mpx); `bitmap-conversion-plan.ts:76-84` (advice text).
- Repro: `zz-t22/t22c.test.tsx` c6: 144 mm @254 ok, 145 too-large; 289 mm @127 ok, 290 / 300 / 400 mm too-large.
- Suggested fix: when the minimum DPI is already over budget, say so ("too large to convert; split the artwork"). Revisit the 32 B/px allowance or tiled encoding.

### T22-P3-5: The bitmap leaves its group and jumps to the top of the stacking order
- P3. In a group of a, b, c, converting a gives the group [b, c] and artworkOrder [b, c, bitmap]. The bitmap was at the bottom; it now covers the other art on the canvas, and it is no longer moved with its group. Burn order is not affected (own operation; c2).
- Where: `src/ui/state/convert-to-bitmap.ts:48-60` (`removeObject` then `addObject`).
- Repro: `zz-t22/t22c2.test.tsx` c4 (`t22c2.log`).
- Suggested fix: insert the bitmap at the first source's artworkOrder index and into the group the sources shared.

### T22-P3-6: Documentation drift on where the bitmap lands and on the Fill All rule
- P3 (docs).
  - WORKFLOW F-F4 state 1 and ADR-029 §6 say the result goes to the `DEFAULT_RASTER_LAYER_COLOR` image layer "or the next free color". The code creates a new operation per artwork, named after the source ("polyline shape (bitmap)", "a", "2 objects (bitmap)"), in `nextOperationColor` (#2563eb).
  - WORKFLOW state 3 still says "(Outlines mode in A3 will render open paths)" although A3 shipped.
  - ADR-029 Amd (ii) §2 says the cross-object even-odd "matches … our own Fill mode". That holds only within one operation: in t22a case 09, objects on two Fill operations burn 400 mm² as Fill and 300 mm² after Fill All.
- Where: WORKFLOW.md:5893-5906, DECISIONS.md:1416, 1463.
- Repro: t22a log lines "layer … (bitmap)"; case 09.
- Suggested fix: update the three passages. For Fill All, say that objects on different operations also knock each other out (as LightBurn's "areas between outlines").

## Not a defect / limits
- **The burn region is right.** Across holes, nested objects, overlapping paths, nonzero and evenodd, text with and without welding, rotation, mirroring, non-uniform scale and tiny shapes, the decoded burn matches an independent winding-number oracle to within half a pixel. It matches the same objects' Fill burn. The T16/T16R defect (even-odd across one object's paths; ignoring nonzero) is **not** present here: `rasterize-vector-fill.ts:166-169` unions an object's paths per rule.
- **Fill All XORs objects on different operations** (case 09). This is decided by ADR-029 Amd 2026-09-13 §1 ("Fill All keeps deliberate even-odd interaction across selected objects") and agrees with LightBurn's "fill the areas between outlines". Use Cut Settings unions independent operations, as documented. Only the ADR's justification text is wrong (T22-P3-6).
- **50 % gray, 30 % / 1500 mm/min image defaults, deleted source:** ADR-029 §2, §5 and Amd (i) 1-2, and LightBurn's page. The bitmap does not inherit the Fill power. Laser recipe seeding applies to the new operation.
- **The image operation is listed after an existing cut** but compile burns it first (c2), so no part-falls-out hazard was found with default settings.
- **The DPI range of 127–635 is narrower than LightBurn's** (ADR-029 Amd (i) 3).
- **Known: `pruneOrphanLayers(scene)` prunes every empty operation in the project**, not just the sources' operations (`convert-to-bitmap.ts:54`, `scene-mutations.ts:186-196`). Same root as T06-P3-1. I only read this code and did not run a repro.
- **Not checked:**
  - a browser run (memory gate ~2.6–3 GB; the worker's OffscreenCanvas PNG encode was not exercised, only the shared `assembleBitmap` it calls);
  - real font text (synthetic text paths were used; `bitmap-assembly-font.test.ts` passes);
  - traced-image sources;
  - inch display (the dialog has no length fields);
  - real hardware.

## Totals
Raised 6; P1 0; P2 0; P3 6; known 1 (whole-scene orphan-operation prune, same root as T06-P3-1).
