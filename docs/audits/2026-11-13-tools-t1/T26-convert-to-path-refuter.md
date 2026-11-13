# T26 Convert to Path — refuter report
Tree: origin/main @ 3293fd15d (read-only). Command id: `tools.convert-to-path`.
Own scratch: `C:\Users\stolk\kd-t1\zz-t26r` (`r26.test.ts`, log `r26.log`, own config). None of the auditor's scripts or decoder were used: own G-code reader (lit runs, lit extent, G1/G2/G3 counts), a different font (Inconsolata, monospace, so width is proportional to character count), the real template parser, the real store resize action and the real registration output toggle.
Run: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config C:/Users/stolk/kd-t1/zz-t26r/vitest.config.mts --maxWorkers=1 C:/Users/stolk/kd-t1/zz-t26r/r26.test.ts`, 5/5 pass, free memory 2.7 GB.

## Verdicts

| Claim | Verdict |
|---|---|
| T26-P1-1 variable text burns the literal template | **CONFIRMED, P1 kept** |
| T26-P2-1 curves flattened to 0.025 mm chords, off-shape after scale-up, arcs lost | **CONFIRMED, P2 kept** (trigger is wider than reported) |
| T26-P2-2 Select All → Convert dissolves the registration jig | **CONFIRMED, P2 kept** (one more consequence found) |

## Evidence

### T26-P1-1 — CONFIRMED P1
Attempts to refute:
1. **"The burn matches the canvas, so the user sees it."** The canvas draws the stored template glyphs both before and after: `deriveVariableBarcodeDisplay` (the only canvas substitution for variable data, `src/ui/workspace/variable-barcode-display.ts:70-80`) returns the text object with its paths unchanged (`canvas draws stored paths unchanged: true`, stored width 58.856 mm = template). So the canvas does not change when the burn changes. The canvas showing braces is the normal look of variable text, so it does not count as a warning.
2. **"Preview shows it."** Preview before conversion goes through the snapshot because the project has variable data (`use-preview-toolpath.ts:166`). It shows the value: 11 lit contours, width 27.096 mm, which is "SN 0042". After conversion the project has no variable data, so Preview uses the plain prepare. It now shows 19 contours, width 58.856 mm: the braces. So Preview does show the change, but only if the operator opens it and reads the text. Nothing points them to it: `advisories []` in both Start paths, toasts `[]`. Job Review was not driven in a browser (memory). Start's advisories are empty, so READ: no Job Review notice.
3. **"Documented as intended."** No. ADR-443 Amd 2 Decision 1 says a job "never compiles ... variable text unevaluated". Bake Variable Text (`src/ui/state/variable-bake-actions.ts`, register row 29: `Audit{{serial:4}}` → `Audit0042`) is the documented way to freeze the value. The only accepted case where conversion uses the stored data is barcodes (ADR-386 Amd 2 Consequences: "Convert to Path still converts the stored code"). There the stored data is a valid insert-time code, not template syntax, so it does not cover text. No test covers variable text plus Convert to Path.
4. **Own numbers** (Inconsolata 8 mm, serial 42, real `parseVariableTemplateSource`): Start before: 11 runs, X 30.000..57.096. Start after, via snapshot and via plain prepare: 19 runs, X 30.000..88.856. Oracle: `"SN 0042"` is 27.096 mm wide with 11 contours; the template is 58.856 mm wide with 19 contours. The output is exactly the template.
- **Trigger:** moderate to low. The menu is enabled on variable text (`selectionHasUnlockedVectorObject` → true). Converting text to node-edit or reshape it is an ordinary step. Select All → Convert on a sheet of serial copies converts every copy.
- **Harm:** each piece burns the literal `SN {{serial:4}}`, 2.2× the intended width, which can run outside the intended area. The serial keeps advancing but no longer reaches the burn. Severity stays P1: a wrong burn with no canvas change and no warning.

### T26-P2-1 — CONFIRMED P2
- Store path (`setObjectTransform`, the action behind resize). The converted d10 circle has 33 nodes, `curves` gone (the original had 4 arcs). Measured on my own decoder, as the maximum radial distance of the lit path from the circle, against a chord-sag oracle `r(1−cos(π/n))`:

| Scale after convert | diameter | converted burn | oracle |
|---|---|---|---|
| ×2 | 20 | 0.049 mm | 0.048 |
| ×5 | 50 | 0.123 mm | 0.120 |
| ×10 | 100 | 0.247 mm | 0.241 |

  d40 behaves the same (64-gon: 0.049 / 0.123). GRBL 1.1 with arcs on: converted 32 or 64 G1 lines and 0 G2/G3. The unconverted circle at the same scale gives 2–13 G2/G3.
- **Not intended:** no ADR states that Convert to Path flattens curves. The command's twin `localPathArtwork` (used by Trim, Extend and Optimize) keeps "their exact arcs" (header comment, `local-path-artwork.ts:1-5`). L6's statement cites that twin, not the menu command.
- **Wider trigger than reported:**
  - Node mode on a primitive offers this exact command (ADR-351 item 7), so editing nodes on any drawn circle or rounded rectangle goes through it. The rounded rectangle r5 comes out with 37 nodes, against 8 nodes with handles in the source.
  - It is enabled on, and flattens, paths that are already curved paths. An imported-svg with 4 exact arcs (from `localPathArtwork`, as Trim leaves it) comes out with 57 nodes and no curves. So Select All → Convert also flattens every curved SVG import and every Trim result.
- **Why not P1:** at the moment of conversion the burn is unchanged within 0.025 mm, and at ×2 the error is still under 0.05 mm. The 0.12–0.25 mm faceting at ×5–×10 is drawn on the canvas, because the canvas draws the polylines, so the user is likely to notice it. That fits P2.

### T26-P2-2 — CONFIRMED P2
- Built 2 real `createRegistrationBox` boxes plus artwork. Ran the real `applyRegistrationOutputToScene` for each mode, then the real `selectAllObjects` and `convertSelectionToPath`.
- Select All picks `["boxA","boxB","art"]`: the boxes are unlocked, and `selectAllObjects` filters only locked objects and hidden layers (`store-actions.ts:282-287`).
- After conversion:
  - Boxes 2 → 0 and `isRegistrationBox` [false,false], so the jig bar is gone. `RegistrationJigPanel` renders only when `findRegistrationBoxes(scene).length > 0`.
  - Run state → `none`.
  - `separatelyCompiledJigInstances` needs at least 2 boxes (`registration-jig-artwork.ts:185`), so per-piece ordering is gone. This agrees with the auditor's reported order change; I confirmed the cause through the box count and that code, without re-running the order test.
- **Twin:** Optimize Shapes deliberately skips registration boxes (`optimize-shapes-plan.ts:70`), so the unguarded Convert is inconsistent with the codebase's own rule.
- **One more consequence:** done while **Outline only** is active, the conversion leaves the artwork layer's output off (`art layer output false`) and removes the jig bar, which holds the only Outline only / Artwork only buttons. The next job burns only the two converted outlines (2 lit runs, X 10..140). Getting the artwork back means re-enabling layers by hand. One Undo restores everything (boxes 2).
- **Why P2:** no burn outside the art. Geometry and the box layer are kept, the change shows in Preview and in the missing jig bar, and Undo works. The trigger needs Select All plus Convert while a jig is present, which is uncommon. "Missing warning" is P2.

## Extra findings

### T26R-P3-1: Convert to Path is enabled on a live Boolean compound but does nothing, with no message
- Severity: P3. The skip is by design (ADR-571: compounds change through Expand), but the enabled menu item does nothing and gives no message. This is the same family as T26-P3-3.
- Where: `src/ui/commands/selection-command-state.ts:69-77` (enabled by `isConvertibleVector`, which accepts any imported-svg) vs `src/ui/state/vector-path-actions.ts:197` (`isBooleanCompoundObject` → `continue`).
- Repro (ran): `r26.test.ts` R5. `loadCompound('subtract')`, select the compound, Convert to Path: `menu enabled true; project changed false; undo steps added 0; new toasts []; still compound true`.
- Oracle: ADR-571 names Expand as the only way out of a compound; the menu should be disabled, or say "Use Expand first".
- Fix: exclude boolean compounds from the enable check, or show a toast naming Expand.

### Checked, not a defect
- Barcodes (QR and Code 128, plain and inverted, 30° rotation, Fill and Line, 8 cases, R4): runs and lit length are identical before and after (for example QR inverted Fill: 1619 runs / 2753.694 mm both sides), and `evenodd` is kept. Non-variable barcodes convert exactly.

### Pointer for other tool audits (READ ONLY, not counted)
- `materializeVectorObject` is shared by Weld change, Offset Shapes, Duplicate, Dogbone, Cut Shape Sides and Copy Along Path guides (`rg materializeVectorObject`). None of them checks `objectVariableTemplate`, so they likely act on the template glyphs of variable text in the same way as T26-P1-1. Worth a check in those tools' T1 areas.

## Totals
Verdicts: P1 1 confirmed, P2 2 confirmed, 0 refuted, 0 severity changes. Extra raised: 1 (P3 1). Known: R4-P2-2 (as auditor).
