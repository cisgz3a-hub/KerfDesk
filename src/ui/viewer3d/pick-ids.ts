// Move identities for the pointer pick pass (ADR-470). Each drawn move is
// painted in a colour that spells its render-model segment index plus one,
// so a pixel read back from under the pointer names the move exactly, with
// no search over the program. Zero is left for "nothing here".

/** Side of the square read around the pointer, in CSS pixels. Odd, so the
 * pointer sits on the centre pixel. Lines are 1 px wide in this pass, so the
 * window is the reach within which a move still counts as pointed at. */
export const PICK_WINDOW_PX = 13;

const BYTES_PER_ID = 4;
const BYTE = 256;

/**
 * Per-vertex RGBA bytes for a line batch: both ends of entry `i` carry
 * `sourceIndex[i] + 1`, least significant byte first.
 */
export function encodePickIds(sourceIndex: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(sourceIndex.length * 2 * BYTES_PER_ID);
  for (let entry = 0; entry < sourceIndex.length; entry += 1) {
    let id = (sourceIndex[entry] ?? 0) + 1;
    const at = entry * 2 * BYTES_PER_ID;
    for (let byte = 0; byte < BYTES_PER_ID; byte += 1) {
      const value = id % BYTE;
      bytes[at + byte] = value;
      bytes[at + BYTES_PER_ID + byte] = value;
      id = (id - value) / BYTE;
    }
  }
  return bytes;
}

/**
 * The segment index painted nearest the centre of a square RGBA read-back,
 * or null when no move crosses the window. Rows may run either way up: the
 * search only measures distance from the centre.
 */
export function nearestPickedSegment(pixels: Uint8Array, size: number): number | null {
  const centre = (size - 1) / 2;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const id = pixelId(pixels, (row * size + column) * BYTES_PER_ID);
      if (id === 0) continue;
      const distance = (row - centre) ** 2 + (column - centre) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id - 1;
      }
    }
  }
  return best;
}

function pixelId(pixels: Uint8Array, at: number): number {
  return (
    (pixels[at] ?? 0) +
    (pixels[at + 1] ?? 0) * BYTE +
    (pixels[at + 2] ?? 0) * BYTE ** 2 +
    (pixels[at + 3] ?? 0) * BYTE ** 3
  );
}
