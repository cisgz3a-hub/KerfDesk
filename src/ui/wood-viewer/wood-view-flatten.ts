// wood-view-flatten — removes uncut peaks from inside a carved groove before
// the depth field is shaded (ADR-285).
//
// The simulator stamps a cone per sampled tool position. Where consecutive
// stamps do not quite overlap at the cell level, single cells keep their
// original height and stand up inside the groove as sharp spikes. A real
// cutter sweeps continuously and leaves nothing of the sort.
//
// The fix is a grey-scale morphological CLOSING: deepen every cell to the
// deepest value in its neighbourhood, then undo that dilation by taking the
// shallowest value back. Peaks thinner than the radius disappear; the groove's
// outer edge and its floor depth are preserved, because the two passes cancel
// everywhere the field is already smooth.
//
// PURE: numbers in, numbers out. Depth is z (<= 0), so "deepest" is the MINIMUM.

// One cell of overlap is enough to bridge stamps that just missed each other.
// Wider would start rounding off genuine detail such as a stroke's sharp tip.
const DEFAULT_RADIUS_CELLS = 1;

function sweep(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  radius: number,
  pick: (a: number, b: number) => number,
): void {
  // Horizontal, then vertical: a separable window is O(n·r) instead of O(n·r²)
  // and gives the same result for a rectangular structuring element.
  const middle = new Float32Array(source.length);
  for (let row = 0; row < height; row += 1) {
    const base = row * width;
    for (let col = 0; col < width; col += 1) {
      let best = source[base + col] ?? 0;
      const from = Math.max(0, col - radius);
      const to = Math.min(width - 1, col + radius);
      for (let k = from; k <= to; k += 1) best = pick(best, source[base + k] ?? 0);
      middle[base + col] = best;
    }
  }
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      let best = middle[row * width + col] ?? 0;
      const from = Math.max(0, row - radius);
      const to = Math.min(height - 1, row + radius);
      for (let k = from; k <= to; k += 1) best = pick(best, middle[k * width + col] ?? 0);
      target[row * width + col] = best;
    }
  }
}

/**
 * Closes a depth field so isolated uncut peaks inside a groove disappear.
 *
 * @param depth Depth per cell in mm, <= 0, row-major.
 * @param width Cells across.
 * @param height Cells down.
 * @param radius Structuring radius in cells; defaults to one cell.
 * @returns A new field of the same shape. The input is not modified.
 */
export function closeDepthField(
  depth: Float32Array,
  width: number,
  height: number,
  radius: number = DEFAULT_RADIUS_CELLS,
): Float32Array {
  if (radius < 1 || width < 1 || height < 1) return depth.slice();
  const dilated = new Float32Array(depth.length);
  sweep(depth, dilated, width, height, radius, Math.min);
  const closed = new Float32Array(depth.length);
  sweep(dilated, closed, width, height, radius, Math.max);
  // Adopt the closing ONLY where the cell is enclosed by cut stock. A closing
  // grows at a groove's rim — a corner cell went from 0 to full depth — which
  // would report material removed that the cutter never touched. Enclosure is
  // exactly the condition that separates a spike inside the groove from the
  // groove's own edge.
  const result = new Float32Array(depth.length);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const here = depth[index] ?? 0;
      result[index] = isEnclosed(depth, width, height, row, col)
        ? Math.min(here, closed[index] ?? 0)
        : here;
    }
  }
  return result;
}

// Enclosed = every orthogonal neighbour is cut. A cell on the grid's border is
// never enclosed, so the field's outer edge is left exactly as stamped.
function isEnclosed(
  depth: Float32Array,
  width: number,
  height: number,
  row: number,
  col: number,
): boolean {
  if (row === 0 || col === 0 || row === height - 1 || col === width - 1) return false;
  return (
    (depth[(row - 1) * width + col] ?? 0) < 0 &&
    (depth[(row + 1) * width + col] ?? 0) < 0 &&
    (depth[row * width + col - 1] ?? 0) < 0 &&
    (depth[row * width + col + 1] ?? 0) < 0
  );
}
