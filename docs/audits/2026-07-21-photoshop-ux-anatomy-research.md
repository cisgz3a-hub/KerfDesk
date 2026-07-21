# Photoshop UI implementation spec — external research (2026-07-21)

Evidence file for the Image Studio Photoshop-parity plan (ADR-242 follow-up). Produced by a
research pass that drove the live Photopea app in-browser (the strongest available source — a
deliberate Photoshop UI clone), read Photopea's official docs, recovered Adobe helpx content via
search extracts (Adobe's Feb-2026 docs restructure gutted most tool pages), and cross-checked
shortcut references. Items marked **[K]** are training-knowledge (decades-stable, not re-verified
this session); **[PP-live]** = read from the running Photopea DOM. Priorities are judged for the
laser-prep context (grayscale-centric, add/erase line work, area cleanup).

---

## A. Tools palette — P1

Single-column toolbar, flyouts share a key; **pressing the letter selects the flyout's current
tool; Shift+key cycles within the flyout**; click-and-hold (or right-click) opens the flyout
listing tools with shortcut letters [PP-live]; tooltips show "Brush Tool (B)" [PP-live].

| Key | Flyout contents |
|---|---|
| V | Move, Artboard |
| M | Rectangular Marquee, Elliptical Marquee (+ single row/column, keyless) [K] |
| L | Lasso, Polygonal Lasso, Magnetic Lasso |
| W | Object Selection, Quick Selection, Magic Wand |
| C | Crop, Perspective Crop, Slice, Slice Select |
| I | Eyedropper, Color Sampler, Ruler, Note [K] |
| J | Spot Healing, Healing Brush, Patch, Content-Aware Move, Red Eye |
| B | Brush, Pencil, Color Replacement, Mixer Brush |
| S | Clone Stamp, Pattern Stamp |
| E | Eraser, Background Eraser, Magic Eraser |
| G | Gradient, Paint Bucket |
| O | Dodge, Burn, Sponge |
| T | Type tools [K] |
| H | Hand |
| Z | Zoom |
| — | Blur / Sharpen / Smudge (keyless flyout) [PP-live keyless] |

Below the tools: **foreground/background color chips** (mini swap/reset icons), **Quick Mask
toggle (Q)**, screen mode [PP-live + K]. Spring-loaded tools (hold a key = temporary switch) [K].

KerfDesk P1 set: V M L W C I B E Z H with flyouts + Shift-cycling. P2: G, S, O, Q. P3: type/vector.

## B. Options bar (per-tool context bar) — P1

Bar always starts with a tool-preset dropdown [PP-live].

- **Brush**: preset dropdown (**Size px slider + Hardness % slider + preset grid** [PP-live]),
  Blend Mode, Opacity % (with slider), Flow %, Smoothing %, pressure toggles.
- **Pencil**: same minus Flow [PP-live]; + Auto Erase [K].
- **Eraser**: brush layout with **Mode: Brush/Pencil/Block** [K]; Opacity/Flow/Smooth [PP-live].
- **Marquee**: the **four boolean buttons — New/Add/Subtract/Intersect** [PP-live:
  Replace/Unite/Subtract/Intersect], Feather px, Anti-alias (ellipse), Style: Normal/Fixed
  Ratio/Fixed Size with W:/H: + swap [K/PP-live], Refine Edge.
- **Lasso/Polygonal**: booleans, Feather, Anti-alias [PP-live]. Magnetic adds Width/Edge
  Contrast/Frequency [K].
- **Magic Wand**: booleans, **Tolerance** (PP default 16, PS 32), **Anti-alias ✓, Contiguous ✓,
  Sample All Layers ☐** [PP-live].
- **Crop**: ratio presets, W:/H: + swap, Straighten, overlay choice [K], **Delete Cropped
  Pixels ✓**, content-aware fill, **✕/✓ commit buttons in the bar** [PP-live].
- **Move**: **Auto-Select + Layer/Group**, **Show Transform Controls**, align/distribute buttons
  [PP-live full set].
- **Eyedropper**: Sample Size (Point/3×3/5×5/…) [K/PP-live], sample source, sampling ring.
- **Gradient**: preview picker, Linear/Radial/Angle/Reflected/Diamond, Reverse/Dither/
  Transparency [K/PP-live]. **Paint Bucket**: fill source, Tolerance, AA, Contiguous [PP-live].

## C. Color model — P1

- Foreground paints (brush/pencil/gradient-start/fill); Background is what the Eraser erases *to*
  on locked/background layers, canvas-extend fill, gradient end [K + photopea.com/learn/bt-basic].
- **X swaps; D resets black/white** (photopea.com/learn/workspace). In Quick Mask, black/white
  paint mask-out/mask-in [K].
- **Click chip → Color Picker**: big saturation×brightness field + vertical hue slider + H S B /
  R G B / hex fields (+ Lab/CMYK in PS/PP), new-vs-current swatch, Add to Swatches [PP-live].
- Swatches panel: click = foreground, Alt-click = background [K].
- **Alt-click = temporary eyedropper while any paint tool is active** [K] — top-tier muscle memory.
- KerfDesk: keep the model verbatim; default picker to a grayscale ramp + K% field.

## D. Canvas interaction — P1

- **Brush cursor = live circle outline at exact brush diameter**; **Caps Lock = crosshair**
  (usethekeyboard.com); degrades to crosshair when tiny [K]. **[ / ] size, Shift+[ / ] hardness**.
- **Zoom**: Ctrl +/−, **Ctrl+0 fit, Ctrl+1 100%** [PP-live menu], **Alt+wheel zooms at pointer**
  (photopea.com/learn/navigation), Z drag-right in / drag-left out, Ctrl+Space temporary zoom.
- **Pan**: Hand tool; **Spacebar = temporary Hand from any tool**.
- **Selection modifiers while starting a drag** (Adobe-verified): **Shift=add (+ badge),
  Alt=subtract (−), Shift+Alt=intersect (×)** — transient forms of the four sticky bar buttons.
  Unmodified: Shift constrains square/circle, Alt draws from center [K]. **Spacebar mid-drag
  repositions the in-progress marquee** [K].
- **Outline vs pixels**: selection-tool drag inside ants moves the outline only; **Move tool (or
  Ctrl) drags the pixels** (floating cut; Alt+drag duplicates); arrows nudge 1 px, Shift 10 px
  (photopea.com/learn/moving-selected-data).
- **Free Transform (Ctrl+T; Photopea uses Alt+Ctrl+T for browser reasons)**: 8 handles; drag
  outside = rotate; Shift toggles aspect lock (post-2019 proportional default), Alt = about
  center, Ctrl+handle = skew/distort; numeric fields in bar; **Enter commits / Esc cancels**
  (photopea.com/learn/free-transform).
- **Crop**: box over whole canvas, thirds overlay, drag outside rotates, Enter/✓ commits.

## E. Panels

- **Layers (P1)**: blend-mode dropdown — the standard **27 modes in 6 groups** [PP-live: Normal,
  Dissolve | Darken, Multiply, Color Burn, Linear Burn, Darker Color | Lighten, Screen, Color
  Dodge, Linear Dodge, Lighter Color | Overlay, Soft Light, Hard Light, Vivid Light, Linear
  Light, Pin Light, Hard Mix | Difference, Exclusion, Subtract, Divide | Hue, Saturation, Color,
  Luminosity]; Opacity + Fill; lock row (Transparency/Pixels/Position/All); rows = eye +
  thumbnail + name (dbl-click rename); bottom strip = link, fx, mask, adjustment, group, new,
  trash [PP-live]. Ctrl+J duplicate, Ctrl+E merge down, drag-reorder.
- **History (P2)**: chronological states, click to time-travel, grayed forward states (linear
  default), snapshots pinned at top, history-brush source column (Adobe helpx history pages).
- **Adjustments (P1 subset for laser)**: Brightness/Contrast, **Levels (Ctrl+L, histogram +
  input sliders + eyedroppers)**, Curves (Ctrl+M), **Threshold**, **Invert (Ctrl+I)**, Posterize,
  Black & White/Desaturate. Full roster verified [PP-live].
- **Info (P2)**: cursor X/Y + RGB/K + selection W×H. **Navigator (P3)**.
- Docking: fixed two-column right side is proven sufficient (Photopea).

## F. Menus — P1 skeleton

- **Edit**: Undo/Redo, Step Fwd/Back, Cut/Copy/Copy Merged/Paste/Clear, **Fill… (Shift+F5:
  fg/bg/black/white/50% gray)**, **Stroke…**, Free Transform, Transform ▸ (rotate/flip/skew…).
- **Undo model (P1)**: modern — **Ctrl+Z steps backward repeatedly, Ctrl+Shift+Z forward**
  (CC2019+; Fstoppers/Adobe community verified). Menu items self-rename ("Undo Brush Tool").
- **Image**: Adjustments ▸ (above); **Image Size… (resample dropdown, constrain link)**,
  **Canvas Size… (9-way anchor grid)**, Rotation ▸ 180/90CW/90CCW/Arbitrary/Flip H/V, Trim.
- **Select**: All / **Deselect Ctrl+D** / Inverse Shift+Ctrl+I / Color Range… / **Modify ▸
  Border/Smooth/Expand/Contract/Feather** / Grow / Similar / **Transform Selection** / Quick
  Mask / Save+Load Selection [PP-live exact].
- **Filter**: Last Filter (Ctrl+Alt+F); laser workhorses: **Gaussian Blur, Unsharp Mask, Smart
  Sharpen, Median, Dust & Scratches, Add Noise, High Pass, Find Edges** [PP-live menu trees].
- **File**: Export As (PNG/JPG + preview) [PP-live].

## G. What makes it FEEL fast — P1

1. Zero confirmations in the paint loop; safety = undo depth.
2. Modifier-key everything (Space, Ctrl+Space, Alt-sample, Shift/Alt booleans, Ctrl=Move).
3. **Every dialog previews live on the real canvas with a Preview ✓ checkbox.**
4. **Alt turns Cancel into Reset in every dialog** [K].
5. Sticky per-tool options across sessions.
6. Single-letter tool switching; **Esc cancels / Enter commits everywhere**.
7. Number keys set opacity (5=50%, 0=100%) with a paint tool active [K].

## H. Photopea deltas (the proven web reduction)

Keeps the whole mental model (menus, 27 modes, letters); remaps browser-stolen keys
(Alt+Ctrl+T/N/I/C); merges flyouts to 16 slots; **drops color-mode complexity — RGBA internal,
grayscale as adjustment** (KerfDesk precedent); drops Reselect; fixed docking; crop ✓/✕ in bar.

## Top 20 "feels like Photoshop" behaviors (ranked, testable)

1. Live circle brush cursor at exact diameter; Caps Lock crosshair. (P1)
2. `[`/`]` size, Shift+`[`/`]` hardness — mid-hover, no dialog. (P1)
3. Spacebar temporary Hand pan from any tool. (P1)
4. Single-letter tools + Shift-cycle flyouts. (P1)
5. Shift-add / Alt-subtract / Shift+Alt-intersect with +/−/× cursor badges + 4 sticky buttons. (P1)
6. Ctrl+Z steps back repeatedly (≥50), Ctrl+Shift+Z forward. (P1)
7. X swap, D reset black/white. (P1)
8. Alt-click eyedropper inside paint tools. (P1)
9. Marching ants + every op clamps to the selection. (P1)
10. Ctrl+0 fit / Ctrl+1 100% / Ctrl± / Alt+wheel zoom-at-pointer. (P1)
11. Ctrl+T free transform (rotate outside, Shift aspect toggle, Alt center, Enter/Esc). (P1)
12. Esc cancels + Enter commits every modal canvas state. (P1)
13. Spacebar repositions an in-progress marquee. (P1)
14. Outline-move vs pixel-move (Ctrl/Move), Alt-duplicate, arrow nudges. (P1)
15. Live dialog preview + Preview ✓ + Alt=Reset. (P1)
16. Brush preset dropdown = Size + Hardness sliders. (P2)
17. Layers panel exact anatomy + Ctrl+J/Ctrl+E. (P1)
18. Ctrl+A/D/Shift+I + Modify ▸ Border/Smooth/Expand/Contract/Feather. (P1)
19. History panel time-travel + snapshots. (P2)
20. Q Quick Mask: selection as paintable red overlay. (P2)

Key sources: photopea.com live app + /learn/{workspace, creating-selections, selections,
advanced-selecting, navigation, layers, free-transform, moving-selected-data, brush-tools,
bt-basic}; helpx.adobe.com add/subtract-selections + history-panel + snapshots pages;
usethekeyboard.com/adobe-photoshop; Adobe shortcuts PDF (cited, fetch timed out); Fstoppers +
Adobe Community on the CC2019 undo model.
