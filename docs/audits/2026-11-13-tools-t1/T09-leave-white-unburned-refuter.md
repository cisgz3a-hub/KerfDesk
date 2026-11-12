# T09 Leave White Unburned — refuter report
Tree: origin/main @ 856cb3ae1 (`C:\Users\stolk\kd-t1\t06-main`, read only). Command id: `tools.leave-white-unburned`.
Script: `C:\Users\stolk\kd-t1\zz-t09r\t09r.test.ts`. Log: `C:\Users\stolk\kd-t1\zz-t09r\t09r-all.log` (6/6 tests ran, one worker, `NODE_OPTIONS=--no-experimental-webstorage`, free memory 2.6–2.9 GB).

**My method (not the auditor's):**
- I measured the burn with `compileJob` lit segments per operation id, plus the lit length inside each white outline (machine coordinates, `burnInside`). The auditor decoded emitted G-code against a paint-order oracle.
- I used different artwork:
  - an Illustrator-style CSS-class badge with an outline ring between the fills;
  - the repo's own Inkscape library clip art `laser-in-use.svg`;
  - both real 1.0.29 goldens (`1.0.29-white-logos.lf2.gz`, `1.0.29-white-logo-copies.lf2.gz`).
- Every surface was read from its own function: `countBurningImportedWhites`, `burningWhiteOpenNotice`, `burningWhiteReviewWarnings`, and the command's `count > 0`.
- The golden G0 shows that 1.0.29's saved objects have the same shape as my emulated older import: the keys are `kind,id,source,bounds,transform,paths,svgImport`, there is one Fill operation per colour, and there are no `whiteInk` marks.

## Verdicts

| Claim | Verdict | Why |
|---|---|---|
| T09-P1-1 multi-part logo copies keep burning white, count says 0 | **CONFIRMED P1** | Reproduced on a different logo and on a real library SVG. The original knocks out correctly; only copies fail, and only when a non-Fill entry sits between the fills in paint order. |
| T09-P2-1 knock-out rewrites or deletes Line bindings | **CONFIRMED P2** | Both halves reproduced. It is not documented as intended: Amd 4 D2 says the opposite for copies. Half (a) gives the same geometry a fresh import would give. A far more common route through the same lines is raised separately as T09R-P1-2, at P1. |

## Evidence

### T09-P1-1
- **Repro (own badge `AI_BADGE`):** a `#231f20` disc, then an outline ring (`fill:none; stroke`), then a white star, all in CSS classes as Illustrator writes them. Saved as 1.0.29 would save it, then Array ×3.
  - Before the tool: count **1** for 3 logos. Lit inside each star is 3,864 / 3,864 / 3,864 mm (dark fill plus white fill).
  - The tool returns 1. Toast: "1 white shape is left unburned".
  - After: count 0, open notice none, Job Review rows 0, command disabled.
  - Inside each star after: original **0**, copies **3,864 / 3,864** (unchanged).
- **Control, ring painted last (P1-C1):** same art and Array ×3, but the ring comes after the fills, so the fills form one part. Count 3 and returned 3; inside each star 3,864 → 0 / 0 / 0. The trigger is exactly the paint-order split.
- **The original alone knocks out correctly (P1-0):** star 3,864 → 0 mm and count 1 → 0. `svgImport` groups span the parts, and all parts share one transform.
- **Real-world file (L):**
  - `src/ui/library/assets/openclipart/laser-in-use.svg` is Inkscape output. It has been in the library since 2026-07-06 (`416e890b0`), so it was in 1.0.29.
  - It parses into 8 entries, `F Lw Fw L Fw L F L`. Six white-over-dark pairs cross a part boundary.
  - As a 1.0.29 import with an Array copy: count 8, but 7 of the 8 belong to the original.
  - After the tool, lit inside the white outlines: original 89,778 → 8,788 mm. The residual is black painted after the white, which correctly stays. The copy goes only 89,778 → **86,526 mm**.
- **Realism:**
  - Of the 25 SVGs in the tree, 2 have paper white over a darker fill. One of those two (laser-in-use) has the cross-part pattern.
  - The split does not need a visible "stroke between the fills". Any element with a stroke paint imports as a Line entry, including a filled-and-stroked shape (`parse-svg.ts:285`, `appendVectorEntry(..., strokeColor === '')`). So does any image. The element only has to come between the fills in document order.
  - Illustrator writes `stroke:...;stroke-miterlimit:10` on any object with a stroke, and Canva exports often embed raster images. Both make the split common in practice. This is from general knowledge; I did not re-read the exporters' documentation (no web fetch).
  - The golden `1.0.29-white-logo-copies.lf2.gz` shows that 1.0.29 projects already contain copies without `svgImport`. A user does not need to copy anything on main: opening a 1.0.29 batch of a multi-part logo is enough.
- **"Count says 0" is exact:**
  - After the tool, all four surfaces agree at 0 / none: the count, the open notice, the Job Review row and the command's enabled state.
  - Before the tool the count is already low: 1 for 3 logos, 8 for 8 + 6 missed copy whites.
  - No other surface warns. `stacked-copy-warnings.ts` covers only coincident copies. The plain-ink canvas paints white black (ADR-620). Only Preview's burn rendering would show the overlap, with no warning (READ ONLY).
- **Relation to X2-P1-1 / #1651:**
  - This is an **incomplete fix, not a regression**. Before #1651 these copies were missed too.
  - Amd 4 D1 chose "every `imported-svg` part without `svgImport` is a group of its own". Its Consequences promise "the counts match the white shapes that exist". Its tests (`svg-white-fill-knockout-v12`, the copies golden) use only single-part logos, and "Not covered" does not name multi-part logos.

### T09-P2-1
- **(a) P2-a:** older badge, then an added Line operation (90 %) on the dark disc part only. Line lit goes 94.21 → **188.60 mm**: the star outline is now cut.
  - Control: a **fresh import on main** with the same Line operation on the dark part also gives **188.60 mm**. So the new geometry is what main gives a new import, where the operator sees the hole before adding the cut.
  - On the older project an existing cut changes silently.
- **(b) P2-b:** a Line operation (20 %) on the white star part only goes 94.39 → **absent**, and the operation is deleted. The toast mentions neither.
- **Documented as intended?** No. ADR-686 D5 says "A cut fill keeps its colour and operation" (singular, written for a fresh import) and says nothing about other bindings. Amd 4 D2 says "A copy on a Line operation stays a cut and is left alone", so the stated intent is that Line artwork is not knocked out.
- **How a user binds a Line operation to one part (READ ONLY):**
  - An import with more than one part is grouped at import (`svg-fragment-mutation.ts:161-168`).
  - A single part is reached through the Design tree's member rows or group focus (`design-tree-rows.ts`). That route is narrow, so P2 stands for these two repros.
  - The common route to the same lines is the operation-mode switch: see T09R-P1-2.

## Extra findings

### T09R-P1-1: Copies of an older logo that also carry a Line operation ("engrave and cut out") are skipped: the count drops and they keep burning white
- **Severity:** P1. It is X2-P1-1's harm: white burned a second time over the black in every copy, while every surface reports none. The trigger is the most common batch setup, and it works on single-part logos, so it is a separate cause from T09-P1-1.
- **Where:** `src/core/geometry/burning-imported-white.ts:51-59` (`isSavedFillPart`). A copy counts as Fill only when **every** operation its paths use is Fill, so a Fill + Line copy is "not Fill" and is skipped entirely (`svgImportGroups` line 36).
- **Repro on the real 1.0.29 golden (G2):**
  1. Open `1.0.29-white-logo-copies.lf2.gz`. Count **4**, which is correct.
  2. Select all and Add operation, set to Line 100 % (cut each coaster out). The count is now **1**, before anything is pressed.
  3. Leave white unburned returns 1. Toast "1 white shape is left unburned". Count 0, no notice, no row.
  4. Lit inside each diamond: original 1,881 → 0; the 3 copies stay at **1,881 / 1,881 / 1,881 mm**.
- **Own logo (X4):** single-part logo with an added Line operation, then Array ×2. Inside the copy's diamond 3,936 → **3,936 mm**; count 1 → 0.
- **Oracle:** the same logo without the Line operation (golden as opened) counts 4 and knocks out every copy (#1651's own test). A cut operation should not change what the Fill burns.
- **Suggested fix:** judge each path by whether it has a burning **Fill** binding (the same rule for originals and copies), and knock out only those bindings. Add a Fill + Line copy to the v12 test.

### T09R-P1-2: An older logo whose colour operations were switched to Line is named as "white burning over the darker fill"; the button turns the white's score into part of the black's cut and deletes the score operation
- **Severity:** P1. It is a wrong burn: a 15 % score becomes a 100 % through-cut, so the shape drops out of the piece. On open, the notice and the Job Review row falsely say the white "burns over the darker fill under it" and steer the user to the button.
  - The canvas shows a diamond outline before and after, so the change is hard to see.
  - Undo restores it.
  - Switching an operation's mode is the most common edit there is. This is the common UI route to T09-P2-1's lines. If the coordinator merges the two, the merged finding is P1.
- **Where:**
  - `burning-imported-white.ts:52`: an original is Fill artwork by `svgImport.mode`, whatever its operations are. A copy is judged by its operations (line 54), so the two rules disagree.
  - `burns()` at lines 107-110 accepts any operation with Output on, Line included.
  - `white-fill-knockout.ts:109-124` nulls the white path and rewrites the dark path for every binding they have.
- **Repro on the real golden (G1):**
  1. Open `1.0.29-white-logos.lf2.gz`.
  2. On U3's logo, set black to Line 100 % and white to Line 15 %. Count stays **5**, and still includes this logo, which has no fill at all.
  3. After the tool, the cut goes 94.21 → **134.21 mm**: the 40 mm diamond is now cut at 100 %. The score operation is **deleted**.
- **Own logo:**
  - X2 (black cut, white score): cut 120 → **176.57 mm**; score 56.57 → deleted.
  - X1 (black Line, white Fill engraving): the 2,000 mm engraving is deleted, and the cut gains the 56.57 mm diamond outline.
  - X3 (control): an Array copy of the same Line/Line logo is left alone, as Amd 4 D2 promises. Only the original is rewritten: cut 240 → 296.57, score 113.14 → 56.57.
- **Oracle:** Amd 4 D2 ("a copy on a Line operation stays a cut and is left alone"), and ADR-686's premise that only a burning white **fill** over a burning darker **fill** is a double burn.
- **Suggested fix:** count and knock out only paths with a burning Fill binding (originals as copies). Keep the Line bindings on the unchanged geometry. Name any removed operation in the toast.

## Not a defect / limits
- **Duplicate stacked on the original (observed, not raised, outside T09):**
  - `duplicateSelection` placed the copy at the same transform.
  - `compileJob` then emitted **no Fill segments at all** for the two coincident multi-part logos (only the Line ring, 219.84 mm).
  - I did not check whether prepare refuses or warns (`stacked-copy-warnings.ts` exists). It is worth a look in the Duplicate or Array area.
  - I used Array placements for the P1 numbers.
- **Copy and Paste case (P1-2):** the paste lands 10 mm off and overlaps the original, so the inside-white numbers mix the two logos. It still shows count 1 → 0 with the pasted white kept: copy 2,924 → 3,172 mm.
- **Not checked:** the canvas, Preview and Design-tree clicks in a browser (memory gate: no browser runs). I also did not check production-nesting copies.

## Totals
- T09-P1-1 CONFIRMED P1. T09-P2-1 CONFIRMED P2.
- Extra raised 2: P1 2, P2 0, P3 0; known 0. Both are residuals of the X2-P1-1 / #1651 rule set, not ledgered before. T09R-P1-2 shares code with T09-P2-1.
