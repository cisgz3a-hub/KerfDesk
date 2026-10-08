/** Exact Euclidean distance from each background pixel centre to the union
 * of raised pixel cells, measured in mm. Unlike a centre-distance correction,
 * this preserves the rectangular face edges and corners at anisotropic pitch.
 * Horizontal interval distances followed by two one-sided parabola envelopes
 * evaluate min(dxToCell² + dyToCell²) in linear work per image dimension. */
export function squaredFaceEdgeDistance(
  face: Uint8Array,
  width: number,
  height: number,
  pitchX: number,
  pitchY: number,
): Float64Array {
  const horizontal = horizontalDistances(face, width, height, pitchX);
  const output = new Float64Array(face.length);
  const column = new Float64Array(height);
  const reverse = new Float64Array(height);
  const scratch = { roots: new Int32Array(height), edges: new Float64Array(height) };
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) column[y] = horizontal[y * width + x] ?? Infinity;
    const forward = oneSidedDistances(column, pitchY, scratch);
    for (let y = 0; y < height; y += 1) output[y * width + x] = forward[y] ?? Infinity;
    for (let y = 0; y < height; y += 1) reverse[y] = column[height - 1 - y] ?? Infinity;
    const backward = oneSidedDistances(reverse, pitchY, scratch);
    for (let y = 0; y < height; y += 1) {
      const index = y * width + x;
      output[index] = Math.min(output[index] ?? Infinity, backward[height - 1 - y] ?? Infinity);
    }
  }
  return output;
}

function horizontalDistances(
  face: Uint8Array,
  width: number,
  height: number,
  pitch: number,
): Float64Array {
  const out = new Float64Array(face.length);
  out.fill(Infinity);
  for (let y = 0; y < height; y += 1) {
    let nearest = -Infinity;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (face[index] === 1) nearest = x;
      out[index] = intervalDistanceSquared(x - nearest, pitch);
    }
    nearest = Infinity;
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (face[index] === 1) nearest = x;
      out[index] = Math.min(out[index] ?? Infinity, intervalDistanceSquared(nearest - x, pitch));
    }
  }
  return out;
}
function intervalDistanceSquared(delta: number, pitch: number): number {
  return (Math.max(0, delta - 0.5) * pitch) ** 2;
}
type Scratch = { readonly roots: Int32Array; readonly edges: Float64Array };
function oneSidedDistances(values: Float64Array, pitch: number, scratch: Scratch): Float64Array {
  const out = new Float64Array(values.length);
  const weight = pitch * pitch;
  let last = -1;
  let active = 0;
  for (let x = 0; x < values.length; x += 1) {
    while (active < last && (scratch.edges[active + 1] ?? Infinity) <= x) active += 1;
    const root = scratch.roots[active] ?? 0;
    const left = last < 0 ? Infinity : (values[root] ?? Infinity) + weight * (x - root - 0.5) ** 2;
    out[x] = Math.min(values[x] ?? Infinity, left);
    if (!Number.isFinite(values[x])) continue;
    last = insertRoot(values, x, weight, scratch, last);
    active = Math.min(active, last);
  }
  return out;
}
function insertRoot(
  values: Float64Array,
  q: number,
  weight: number,
  scratch: Scratch,
  last: number,
): number {
  let edge = -Infinity;
  while (last >= 0) {
    const p = scratch.roots[last] ?? 0;
    edge =
      ((values[q] ?? Infinity) - (values[p] ?? Infinity)) / (2 * weight * (q - p)) +
      (q + p + 1) / 2;
    if (edge > (scratch.edges[last] ?? -Infinity)) break;
    last -= 1;
  }
  const next = last + 1;
  scratch.roots[next] = q;
  scratch.edges[next] = last < 0 ? -Infinity : edge;
  return next;
}
