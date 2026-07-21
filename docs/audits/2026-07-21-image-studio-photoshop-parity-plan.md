# Image Studio → Photoshop parity plan (2026-07-21)

Maintainer verdict on the IE-1 v1 editor: "not very good." Goal restated: copy the best
Photoshop into KerfDesk, researched properly. Evidence: [`photoshop-ux-anatomy-research`](./2026-07-21-photoshop-ux-anatomy-research.md)
(live-verified against Photopea) and [`minipaint-source-study`](./2026-07-21-minipaint-source-study.md)
(MIT implementations to adapt). Governance: extends ADR-242; the parity build is Phase L
IE-1.5/IE-2 work. The main-toolbar entry shipped separately (tools.edit-image).

## Design rulings (adopted from the research)

1. **Photopea's reductions are our template**: RGBA-only internals (grayscale = adjustment/vew),
   fixed docking (our overlay already is), merged flyouts, browser-safe shortcut remaps only
   where needed (we're an overlay — we can claim Ctrl+T etc. while open).
2. **Esc/Enter grammar everywhere; zero confirmations** (already rule #7 compliant).
3. **Undo = modern model** (Ctrl+Z steps back, Ctrl+Shift+Z forward) — already ours.
4. **miniPaint adoptions**: DOM-div brush cursor; temp-buffer live-edit + one-commit;
   radial-gradient soft eraser tip; schema-driven options bar; transform-box reference;
   `pica` (MIT) for Lanczos resize at the Image Size dialog (dependency evaluation at adoption).
5. **Docs are the acceptance list**: the UX report's Top-20 behaviors are the checklist; each
   phase below names the numbers it closes.

## Phases (each = one reviewable PR stack; Top-20 numbers in brackets)

- **PP-A "Feel pack"** [1, 2, 3, 7, 8, 10, parts of 12]: live circle brush cursor (DOM div,
  size × zoom; Caps Lock crosshair), `[`/`]` + Shift variants, foreground/background chips with
  X/D, Alt-click eyedropper inside paint tools, Spacebar temporary pan, Ctrl+0/1/± + Alt-wheel
  zoom-at-pointer, Esc/Enter audit.
- **PP-B "Selection booleans + clamped painting"** [5, 9, 13, 14, 18]: core mask combine
  (replace/add/subtract/intersect), four sticky bar buttons + Shift/Alt transient modifiers with
  +/−/× cursor badges, Shift-constrain/Alt-from-center on unmodified marquee, spacebar
  reposition mid-drag, paint/fill clamped to the active selection (coverage ∧ mask), Ctrl+A/D/
  Shift+I already present + Select ▸ Modify (Border/Smooth/Expand/Contract/Feather = mask
  morphology), outline-move vs pixel-move split (Ctrl = move pixels), arrow nudges.
- **PP-C "Toolbar anatomy + options bar"** [4, 16]: proper icon rail with flyouts (M: rect/
  ellipse; L: free/polygonal; single letters + Shift-cycle), schema-driven options bar with the
  researched per-tool contents (brush preset dropdown = size+hardness sliders; wand tolerance/
  AA/contiguous; eraser modes), real color picker dialog (S×B field + hue slider + hex + K%),
  swatches row, sticky per-tool options.
- **PP-D "Crop + Free Transform"** [11, 12]: crop tool with ratio presets, thirds overlay,
  ✓/✕ in bar, Enter/Esc; Ctrl+T free transform of selection/whole image (8-handle box from the
  miniPaint reference: rotate-outside, Shift aspect toggle, Alt about-center), Image ▸ Rotate/
  Flip menu equivalents.
- **PP-E "Adjustments + filters with live preview"** [15]: dialog engine (miniPaint
  single-generator pattern) with live canvas preview + Preview ✓ + Alt=Reset; Brightness/
  Contrast, **Levels with histogram**, Curves, Threshold, Invert, Posterize; Filters: Gaussian
  Blur, Unsharp Mask (Enhance parity), Median/Despeckle, High Pass; Image Size (pica Lanczos /
  Hermite / nearest) + Canvas Size (9-anchor); all selection-clamped.
- **PP-F "Panels"** [6, 17, 19, 20]: History panel (states list, time-travel, trimmed note),
  Layers panel + multi-layer core (compositing via canvas blend modes, eye/opacity/blend/
  reorder/merge/flatten — the IE-4 ADR gets written here), Info readout, Quick Mask.

## KerfDesk-specific integrations (unchanged contracts)

Apply→`applyEditedImage` one-undo-entry bake; re-trace loop; engrave-preview view toggle
(planned); DPI/mm invariants; sessions resumable, no confirms; Abort reachability; zero new
runtime deps except an evaluated `pica` at PP-E (RESEARCH_LOG entry required, ADR-017 gate).

## Standing acceptance

Every PR: tests + the a11y hover contract + perceptual/visual evidence; the Top-20 list is
re-scored in each PR body (which numbers now pass live).
