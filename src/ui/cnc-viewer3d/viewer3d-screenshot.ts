// viewer3d-screenshot — naming and sizing for a PNG of the viewport.
//
// The render itself is a setSize + render + toDataURL round trip and is not
// testable outside a GPU. What IS testable — and what actually goes wrong — is
// the filename and the pixel size, so both live here as pure functions and the
// scene keeps only the round trip.
//
// The clock is passed in rather than read. This is ui/, not core/, so
// Date.now() is not forbidden here, but a function that reads it cannot be
// tested for the timestamp it produces, which is the part most likely to be
// wrong.
//
// PURE: values in, values out. No three import, no DOM.

// A 2x capture stays legible dropped into a build log or a message without
// producing a file too big to send. Past 4x most GPUs refuse the framebuffer.
export const DEFAULT_SCREENSHOT_SCALE = 2;
export const MAX_SCREENSHOT_SCALE = 4;

/**
 * Builds a filesystem-safe screenshot filename.
 *
 * @param prefix Job or project name; falls back when empty.
 * @param isoTimestamp An ISO-8601 timestamp, supplied by the caller.
 * @returns A .png filename with no characters that need escaping.
 */
export function screenshotFileName(prefix: string, isoTimestamp: string): string {
  const safePrefix = slug(prefix) || 'cnc-3d';
  // Colons are legal in an ISO string and illegal in a Windows filename, and
  // the sub-second part adds nothing a human reads.
  const stamp = isoTimestamp.replace(/\.\d+Z$/, 'Z').replace(/[:.]/g, '-');
  return `${safePrefix}-${stamp}.png`;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Pixel size for a capture at a scale multiplier.
 *
 * @param width Current viewport width in CSS pixels.
 * @param height Current viewport height in CSS pixels.
 * @param scale Requested multiplier.
 * @returns Integer pixel dimensions, clamped to a size a GPU will allocate.
 */
export function screenshotSize(
  width: number,
  height: number,
  scale: number,
): { readonly width: number; readonly height: number } {
  const clamped = Math.min(MAX_SCREENSHOT_SCALE, Math.max(1, scale));
  // A zero-sized framebuffer throws in WebGL and a fractional one is silently
  // floored by the driver, so round up — a 1px pane still produces a file.
  return {
    width: Math.max(1, Math.ceil(width * clamped)),
    height: Math.max(1, Math.ceil(height * clamped)),
  };
}
