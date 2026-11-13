## ADR-245 Amendment 3 - Point adjustments on the Background act on its colour over white (2026-11-13)

**Status:** Accepted on 2026-11-13 |
**Amends:** ADR-245 (Image Studio layers: active-layer document with a composite bake), §4 "The
Background layer keeps the white-is-empty convention (ADR-242)"

### Context

Tools audit T1, tool T13 (Image Studio), findings T13-P2-1 and T13R-P2-1.

The Background layer can hold alpha: an imported PNG logo keeps its transparency there (fully
transparent pixels as RGB 255 / alpha 0), and "Clean up white paper" writes alpha into it. The
Studio shows the Background composited over white, so the user sees, and the burn follows, the
colour over white. The point adjustments mapped RGB only and never read alpha:

- **Invert** of a transparent-background logo turned its straight black into straight white, so the
  composite went all white and Apply baked a blank image that burned 0 mm, while the layer's own
  Negative image burned the inverse. Inverting a logo for slate or anodised aluminium is the
  common case.
- **Black & white** (Threshold) after "Clean up white paper", the two Prepare-your-photo quick
  actions in order, changed nothing (the cleaned RGB is all black), so a scan stayed grey instead
  of becoming two-level line art; Invert after the clean-up blanked the image.

Photoshop and GIMP keep a layer's alpha on Invert, but they show transparency as a checkerboard.
The Studio never shows transparency on the Background, and §4 already defines it as white paper.

### Decision

1. **A point adjustment on the Background acts on what it shows.** Before Brightness/Contrast,
   Levels, Curves, Threshold, Posterize, Invert or Desaturate runs on the Background, each pixel
   it touches is composited over white and made opaque. The composite is unchanged by that step,
   so the adjustment maps the colour the user sees, in the preview and on OK alike.
2. **Other layers keep their transparency.** An upper layer's alpha is its content; point
   adjustments there still map RGB alone.
3. **Neighbourhood filters and "Clean up white paper" are unchanged.** The clean-up still writes
   alpha on whichever layer is active; a later point adjustment on the Background flattens it
   again, which keeps the composite.

### Consequences

- Invert of a transparent logo gives its negative (transparent paper → black); Threshold after
  the clean-up gives only black and white, the same as Threshold without it.
- The October stress test's incidental check that Invert keeps the Background's alpha is updated;
  its undo/redo byte comparisons are unchanged.
- Verification: `editor-background-over-white.test.ts` (Invert of a transparent logo in preview
  and Apply, Black & white and Invert after the clean-up, an upper layer keeping its alpha). Three
  of its four cases fail before this amendment.
