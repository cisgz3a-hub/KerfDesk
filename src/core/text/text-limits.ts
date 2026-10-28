// ADR-564 Amendment 1. One range for every way text is made or edited: the text dialog, the canvas
// and jig editors, and remote and MCP text. A value one of them accepts is never clamped by
// another, so editing one word on the PC keeps a size or spacing the remote set.

/** Size, in mm. */
export const TEXT_SIZE_MIN_MM = 0.1;
export const TEXT_SIZE_MAX_MM = 1000;
/** Line height, as a multiple of the size. */
export const TEXT_LINE_HEIGHT_MIN = 0.1;
export const TEXT_LINE_HEIGHT_MAX = 20;
/** Letter spacing, as a share of the size added between glyphs. */
export const TEXT_LETTER_SPACING_MIN = -1;
export const TEXT_LETTER_SPACING_MAX = 20;

export function textSizeInRange(value: number): boolean {
  return Number.isFinite(value) && value >= TEXT_SIZE_MIN_MM && value <= TEXT_SIZE_MAX_MM;
}
