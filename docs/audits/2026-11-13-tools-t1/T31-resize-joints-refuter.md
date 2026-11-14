# T31 Resize Joint Openings — refuter report
Tree: origin/main @ eeac725e8 (`C:\Users\stolk\kd-t1\t31-main`, read only). Command id: `tools.resize-joints`.
Scripts (my own, not the auditor's): `C:\Users\stolk\kd-t1\zz-t31r\r1-box.test.ts`, `r2-tabs.test.ts`, `r3-hole.test.ts`, with `.log` outputs next to each. Run from the tree root:
`NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t31r/vitest.config.mts --maxWorkers=1 <file>` (free memory 3.1 GB and 1.9 GB before runs).

## Verdicts

| ID | Auditor | Verdict | Final |
|---|---|---|---|
| T31-P1-1 box resized 3→4 no longer assembles | P1 | **Confirmed, re-graded.** The defect is real (my own geometry and measurement). But the tool's documented scope leaves out finger-joint depth, and every change matches the reviewed preview. The defect is a partial detection with no warning, inside a scope the dialog and tutorial disclaim. | **P2** |
| T31-P1-2 placed tabs slide after a resize | P1 | **Confirmed, re-graded.** Tabs keep their fraction. On my 25-finger panel they move up to 18.4 mm, and one lands across a finger corner. No notice. Precedent: rolling v9 R3-P2-2 (Shear/Warp/Deform keep the fraction, up to 46 mm, tab changes edge) was kept at P2 under ADR-494 Amd 1's reshape rule. This is the same class. | **P2** |
| T31-P2-1 cutout features inside-out | P2 | **Confirmed**, with either winding of the hole. | **P2** |
| T31-P3-1 width/depth swapped, internal id | P3 | Confirmed (box log: finger shown as "w3 d11.429") | P3 |
| T31-P3-2 tolerance edge | P3 | Confirmed with a qualification: depends on the coordinates. A slot at x 38.45..41.55 (3.1 wide) **is** detected; a 0..3.1 width is not. | P3 |
| T31-P3-3 skipped with no notice | P3 | Confirmed (READ: `joint-resize-detection.ts:33` returns `[]` silently) | P3 |
| T31-P3-4 summary line wrong for tabs | P3 | Confirmed (READ: `JointResizeDialog.tsx:115-116`) | P3 |
| T31-P3-5 fields always mm | P3 | Confirmed (READ: `use-joint-resize-review.ts:128` `{ kind: 'length' }` with no unit) | P3 |

## Evidence

### T31-P1-1: what the tool promises, and the measurements

**Promise and scope (read):**
- Dialog footnote, `JointResizeDialog.tsx:58-62`: "Detects orthogonal inward U-slots and enclosed rectangular contours with one matching dimension, and outward tabs whose depth matches; a tab's depth becomes the material thickness … **Rounded slots and general thickness conversion require explicit design edits.**"
- Intro, `:46-47`: "Candidate geometry cannot establish manufacturing intent."
- Help tooltip, `command-help-topics.ts:188`: "Review straight receiving slots and notches against measured material thickness."
- Tutorial, `layout-tutorials.ts:196`, tip: "This bounded tool **does not resize finger-joint depth, tabs** or every feature in a thickness-dependent design." It names `box` and `box-fit` as related tutorials. Step 2 says "Select only the enclosed rectangles or inward U-slots".
- KXS-09 (`docs/implementation/xtool-workflows-20261007.md:53`): "bounded rectangular openings and orthogonal U-notches … assists design adaptation".
- ADR-570 has no joint-specific text. No WORKFLOW section names the tool.
- Tab detection came later, in bc4cd9eba: "LightBurn parity D063 (Resize Slots & Tabs) … finds orthogonal outward tabs whose depth matches". LightBurn's page (2.2, fetched) says the tool adjusts "a jointed design that was intended for a material of a different thickness". It treats box fingers as tabs, with Adjust Slot Depth / Slot Width / Tab Height. So since bc4cd9eba the dialog reaches into box fingers, while the tutorial still says it does not.

**Scope verdict:** converting a whole box is not KerfDesk's documented promise. The tutorial excludes finger-joint depth. For a box made in KerfDesk, the documented path is the Box Generator, where Material thickness is the first input (`production-generator-tutorials.ts:20`). The generator keeps no source on the sheet, so this means re-running it with the same dimensions. The Resize dialog does not mention or offer that path. For an imported box (boxes.py, MakerCase) there is no regenerate path, and LightBurn's equivalent is exactly this tool.

**Measurement (my script `r1-box.test.ts`, log `r1-box.log`):** Box Generator 80×50×40 inner, T3, finger 10, clearance 0. All six panels go in as imported-svg objects. Settings: current 3, thickness 4, fit 0, tolerance 0.1. Every candidate is selected. Oracle: analytic, every joint step (finger flank) of a T-mm box equals T, so a correct conversion makes every short segment 4 mm. Generator T4 is the cross-check.

| Panel | Candidates | T3 steps | Tool T4 steps | Generator T4 steps | Tool size / generator |
|---|---|---|---|---|---|
| Bottom, Top | 6 each | 20 × 3 mm | **8 × 3 mm + 12 × 4 mm** | 20 × 4 | 88×58 / 88×58 |
| Front, Back | 6 each | 16 × 3 mm | **4 × 3 mm + 12 × 4 mm** | 16 × 4 | **86×48** / 88×48 |
| Left, Right | 6 each | 12 × 3 mm | 12 × 4 mm | 12 × 4 | 58×48 / 58×48 |

- 36 candidates, notices `[]`. The steps left at 3 mm are the corner fingers. `rectangularNotch` (`joint-resize-detection.ts:100-103`) needs a straight edge parallel to the base on both sides, which a corner finger lacks. The receiving notches are also never deepened, because inward slots are matched by mouth width (10–13 mm), not depth.
- Left and Right convert fully because their corners are notches. Front/Back come out 2 mm short of the generator.
- My referee harness fed sheet-frame outlines and failed its control (8 issues on the untouched generator T3). So I rely on the analytic histogram. The auditor's referee run, which used `buildPanelClaims` locals with a 0-issue control, agrees (20 issues).
- Applies with no toast on success (`use-joint-resize-review.ts:66-74`).

**Grade:** wrong result and no warning, but outside the documented scope. Each selected feature changes exactly as the dialog says and as the preview shows. The dialog says general thickness conversion needs explicit edits, and the tutorial says finger-joint depth is not resized. That is P2 ("a wrong result … or a missing warning"), not P1. The P2 is real: the tool offers box fingers as candidates, contrary to its own tutorial, and silently skips the corner fingers and notch depths. The 220-px preview of a whole sheet shows about 1 px per mm, so a user will not easily see it. Suggested fix: refuse or warn when a contour has joint steps of the old depth that were not detected, and point to Box Generator for generated boxes. Or implement LightBurn's slot-depth and tab-height modes, corners included.

### T31-P1-2: tabs placed by hand (`r2-tabs.test.ts`, log `r2-tabs.log`)
Real `jointResizeSelectionMutation` through the store, a layer with tabs on (1 mm, 20 % tab power), and my own GRBL decoder. A tab span is a contiguous lit G1 run below the maximum S, reported by its arc midpoint in machine mm. Oracle: the placed tab should stay put, which `withTabsFollowingEdit` (ADR-494 Amd 2) gives. I also computed the fraction-kept place analytically: s₁ = s₀ · L₁/L₀.

**R2a**, a 100×50 panel with three 10×3 fingers on the top edge (L 318→324):

| Tab placed | After (app) | Moved | Analytic fraction-kept | `withTabsFollowingEdit` |
|---|---|---|---|---|
| (50,0) bottom, untouched | (50.943,0) | 0.943 | exact | 0.000 |
| (100,25) right, untouched | (100,27.358) | 2.358 | exact | 0.000 |
| (0,25) left, untouched | (0,25.472) | 0.472 | exact | 0.000 |
| (56,50) beside a finger | **(55,50.774), on the finger's flank** | 1.264 | exact | 0.000 |
| (62.5,50) between fingers | (60.849,50) | 1.651 | exact | 0.000 |

- Decoded G-code tab runs move the same: 1.265, 1.651, 2.358, 0.943 and 0.472 mm.
- The run for tab 3 has its midpoint at machine (85, 319.226), so the 1 mm bridge straddles the finger corner. A joint face gets a nub.

**R2b**, a 300×100 panel with 25 fingers of 6×3 (L 950→1000): bottom tab moved **7.895** mm, right-edge tab **18.421** mm, left **2.632** mm. The decoded G-code agrees (2.632 / 7.895 / 18.421).

- **Notice?** None: 0 toasts, empty notices, and no success toast exists.
- **Canvas?** ADR-494 Amd 2/3 say placed tabs are drawn only while a tab tool is open, so nothing shows on screen.
- **Off the part?** Never: a fraction always stays on the same contour. It can land on another feature, as R2a tab 3 does on a finger flank.
- **Grade:** the auditor's numbers reproduce and scale with finger count. ADR-494 Amd 1 Consequences (lines 103-107) state that reshaping edits such as node drags "keep each tab's fraction … left to a deliberate remap". Rolling v9 R3-P2-2 graded the same class (Shear/Warp/Deform: 16.7 mm shear, 46 mm warp, tab changing edge) **P2**, "kept on ADR-494 Amd 1's reshape rule, not on reach", and Amd 4 fixed it as such. N3-P1-1 (v8) was P1 as a regression that put tabs on arcs. Joint resize is a multi-node reshape with no restart, so for consistency it is **P2**. Fix: pass the result through `withTabsFollowingEdit(source, resized)` in `jointResizeSelectionMutation` or `resizeGeometry`, and push Amd 2's moved sentence. My script shows that this gives 0.000 mm on every tab.

### T31-P2-1: cutout features (`r3-hole.test.ts`, log `r3-hole.log`)
The plate is 80×60 with a window 25..55 × 20..40. The window has a keyway cut into the material (x 38.5..41.5, up to y 43) and a material tooth into the window (x 30..33, up to y 23). Settings: T4, fit 0.2.
- Same winding as the outer contour: the keyway is listed as **outward-tab** and goes to y 44 (deepened, still 3 wide). The tooth is listed as **inward-slot** and widened to x 29.4..33.6 (4.2 wide). Oracle: keyway x 37.9..42.1 with its top at 43; tooth depth 4 with width 3, or refused as LightBurn does.
- Opposite winding: identical result, so the classification is by the contour's own convexity and not by material side.
- At T3 + 0.2: the keyway counts as "already match" and is left unchanged (oracle 3.2 wide), while the tooth is widened to 3.2.
- Control, the same slot on the outer edge: inward-slot, 37.9..42.1. Correct.
- Island: a 3×15 strip part inside a 40×30 cutout is listed as **enclosed-rectangle** and widened to 4.2. The genuine slot control is the same.
- Grade P2 stands. The user reviews every candidate, but the label states the opposite of what the feature is.

### P3 spot checks
- P3-1: `r1-box.log` lists a 10-wide finger as "outward-tab w3 d11.429". Confirmed.
- P3-2: in `r3-hole.log` the widths 3.1, 2.9, 3.09 and 3.05 at x centred on 40 are all detected. The miss needs coordinates whose float subtraction rounds up (3.1 − 0 − 3 = 0.10000000000000009). It is coordinate-dependent and stays P3.
- P3-3/4/5: read, as stated in the auditor report.

## Extra findings

### T31R-P3-1: Tutorial and help still say the tool does not resize tabs, while the dialog does (READ ONLY)
- Where: `src/ui/tutorials/layout-tutorials.ts:196` (tip: "does not resize finger-joint depth, tabs …"), `:179` ("Select only the enclosed rectangles or inward U-slots"), `:190` ("preserving their depth and centre"), and `command-help-topics.ts:188` ("slots and notches"). Since bc4cd9eba the dialog detects and resizes outward tabs, growing their depth.
- Why it matters: the contradiction is what makes T31-P1-1 misleading. Read alone, the tutorial correctly scopes the tool away from boxes, but the dialog offers box fingers as candidates.
- Fix: bring the tutorial and help up to date with tab behaviour, and state there and in the dialog that a generated box should be regenerated at the new thickness.

## Not a defect / limits
- Kerf is not applied by the tool, so there is no double count. The tab target is the bare thickness by design (bc4cd9eba).
- The edit keeps the contour start (`normalizeJointPoints` only drops a repeated closing point), so the tab shift is purely the length-share effect and not a restart.
- CNC placed tabs (`cncTabAnchors`) go through the same spread at `joint-resize.ts:265` and would move the same way. READ ONLY, not run.
- My assembly-referee harness was invalid (control failed, sheet frame). The analytic step histogram is the oracle for P1-1.

## Totals
Verdicts: confirmed 1 (P2-1), re-graded 2 (P1-1 → P2, P1-2 → P2), refuted 0; P3s 5 of 5 confirmed (P3-2 coordinate-dependent). Extra raised: 1 (P3 1: T31R-P3-1).
Net for T31 after refutation: P1 0, P2 3, P3 6.
