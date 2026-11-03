## ADR-685 Amendment 1 - A recipe's Auto tones wait for the preview, read only the pixels that burn, and light marks say how to keep a background (2026-11-02)

**Status:** Accepted; tested in the real dialog (preview hook mocked) and through the preview
worker's own function. Not burn-tested. | **Date:** 2026-11-02

Follows rolling audit v9 findings R8-P2-3 (P2), R8-P3-1 and R8-P3-2 (P3), confirmed by an
independent refuter (`docs/audits/2026-11-02-rolling-v9/R8-cross-fix-journeys.md`).

### Context

- **R8-P2-3.** A recipe applied Auto tones with the histogram on hand when it was picked. Picked
  before the first preview, it applied none. The window said "Auto tones apply once the preview
  has read the photo", and that sentence then disappeared, which read as done. ADR-685 measured the
  recipe's main benefit, highlight speckle at 3.6 % against 12.5 %, with Auto tones on.
- **R8-P3-2.** The histogram counted every source pixel, including those a mask or the image's own
  clip keeps from burning. A dark surround could take the contrast from 100 to 19.
- **R8-P3-1.** Light-mark recipes (slate, anodized, clear from the back) invert the photo, so a
  background removed to white burns solid: 74 % of cells on the auditor's portrait.

### Decision

1. **A recipe owes its tones until the histogram arrives.** Picked before the preview, it records
   that its Auto tones are pending and applies them when the histogram lands. A tone the operator
   sets in the meantime (brightness, contrast or midtones), the Auto tones button or choosing no
   recipe cancels the pending tones, so the operator's own value stands. The sentence shows only
   while the tones are pending.
2. **Auto tones reads the pixels that can burn.** The preview builds the histogram from the source
   pixels inside the image's mask and clip, with the compiler's own pixel test
   (`createImageMaskPixelTest`). Pure white was already left out (Decision 1), and compile whitens
   masked pixels, so the two now agree.
3. **Light marks say how to keep a background.** A light-mark recipe's note adds: "A background
   removed to white burns solid with light marks: draw a closed shape around the subject and use
   Tools → Apply Mask to Image instead."

### Consequences

- Picking a material first, as the window invites, gives the same tones as picking it after the
  preview.
- **Tests:** `PhotoEngravingDialog.recipes.test.tsx` (tones applied when the preview arrives late;
  a tone set while waiting is kept; the light-mark sentence) and `photo-engraving-preview.test.ts`
  (a mask over half the photo halves the histogram).
