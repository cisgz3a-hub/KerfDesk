// When a camera picture is worth shrinking for the overlay (ADR-440
// Amendment 11, rolling audit v14 Z1-P1-1). A shrink costs a full pass over
// the picture, so one that would save only a few per cent of its width is
// skipped: a 1,920 px camera on a canvas asking for 1,917 px is drawn as is.

/** Shrink only when the wanted width is under this share of the picture's own. */
export const SHRINK_BELOW_SHARE = 0.9;

/** Widest the overlay ever needs a camera picture, device pixels. */
export const OVERLAY_MAX_WIDTH = 1920;

/** The width to shrink a `sourceWidth` picture to for `wantedWidth`, or undefined to keep it. */
export function shrinkWidth(sourceWidth: number, wantedWidth: number): number | undefined {
  const width = Math.max(1, Math.round(wantedWidth));
  return width < sourceWidth * SHRINK_BELOW_SHARE ? width : undefined;
}
