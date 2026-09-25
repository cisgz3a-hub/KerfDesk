// Light-solid recovery for the automatic detail mask (ADR-393).
//
// A local-contrast test (ink = luma < localMean − bias) sees a large flat
// region only where its neighbourhood window reaches brighter paper, so a
// light solid (gold, tan, light blue: luma above the brightness band) comes
// out as a band about one window radius wide around a background interior.
// Adaptive thresholds share this failure mode; the published remedies
// (Sauvola 2000, Wolf–Jolion 2004) damp the local test in low-variance
// areas. Here the local test is kept exactly as it is — it is what recovers
// faint strokes — and the hollow is repaired afterwards, by evidence the
// local mask itself provides:
//
//   * a hollow interior is a background component whose bordering ink has
//     the SAME tone as the component (the band is the solid's own rim),
//     whereas a real counter or gap borders DIFFERENT, darker ink (the stroke
//     that local contrast found);
//   * the component is flat (low luma spread), which rejects illumination
//     ramps and texture, and lighter than the brightness band, which already
//     fills everything darker;
//   * the component is clearly darker than the paper tone, estimated as the
//     dominant border luma, so paper and paper tints are never filled.
//
// Outlined colour fills (a gold area inside a black line) and colour on a
// dark ground are left as a global brightness threshold leaves them: nothing
// there is a same-tone rim, because the local test only rims a tone that
// sits next to something brighter.
//
// Accepted solids are grown over their same-tone rim, and the iso value used
// for both the mask and the sub-pixel crack field is raised to the midpoint
// between the solid's tone and paper on the solid and a two-pixel shell
// around it, so the outline lands where a half-coverage edge pixel says it
// is instead of being biased inward by the local-contrast offset.

/** Solids must be at least this far (luma) below paper to be filled; lighter
 *  regions are paper tints. For scale: the ±8 local test marks nothing within
 *  8 of paper and closes a rim around a large straight-edged region only from
 *  about 17 below paper (its corners from about 12). */
const MIN_PAPER_DISTANCE = 12;
/** Rim pixels and noisy interiors may deviate this much from the region mean. */
const TONE_TOLERANCE = 10;
/** Maximum luma standard deviation of a region that counts as flat. */
const MAX_FLAT_DEVIATION = 16;
/** Share of a region's bordering ink that must be its own tone. */
const MIN_RIM_MATCH = 0.5;
/** Shell (px, Chebyshev) around a solid that uses the solid's midpoint iso. */
const EDGE_SHELL_PX = 2;

type Plane = {
  readonly width: number;
  readonly height: number;
  readonly luma: Float32Array;
  /** 1 where the brightness band or the local-contrast test marks ink. */
  readonly ink: Uint8Array;
};

type Region = {
  readonly seed: number;
  count: number;
  sum: number;
  sumSq: number;
  rim: number;
  rimMatch: number;
};

/**
 * Per-pixel iso raised over light solids that the local-contrast mask
 * hollowed, or null when there are none. A pixel is ink when its luma is at
 * or below the returned value (entries are −Infinity away from solids).
 */
export function lightSolidIso(plane: Plane, bandUpper: number): Float32Array | null {
  const paper = paperLuma(plane);
  const labels = new Int32Array(plane.luma.length).fill(-1);
  const queue = new Int32Array(plane.luma.length);
  const regions = labelBackground(plane, labels, queue);
  measureRims(plane, labels, regions);
  let iso: Float32Array | null = null;
  const claimed = new Uint8Array(plane.luma.length);
  regions.forEach((region, id) => {
    const tone = region.sum / region.count;
    if (!isHollowSolid(region, tone, paper, bandUpper)) return;
    iso ??= new Float32Array(plane.luma.length).fill(-Infinity);
    const size = growSolid(plane, labels, { id, seed: region.seed, tone }, queue, claimed);
    raiseIso(plane, iso, queue.subarray(0, size), claimed, Math.fround((tone + paper) / 2));
  });
  return iso;
}

function isHollowSolid(region: Region, tone: number, paper: number, bandUpper: number): boolean {
  if (tone <= bandUpper || tone > paper - MIN_PAPER_DISTANCE) return false;
  const variance = Math.max(0, region.sumSq / region.count - tone * tone);
  if (Math.sqrt(variance) > MAX_FLAT_DEVIATION) return false;
  return region.rim > 0 && region.rimMatch >= MIN_RIM_MATCH * region.rim;
}

/** Dominant luma along the image border (5-level window, brighter on ties):
 *  the tone of the sheet the artwork sits on. */
function paperLuma(plane: Plane): number {
  const { width, height, luma } = plane;
  const histogram = new Float64Array(256);
  const add = (i: number): void => {
    const level = Math.max(0, Math.min(255, Math.round(luma[i] as number)));
    histogram[level] = (histogram[level] as number) + 1;
  };
  for (let x = 0; x < width; x += 1) {
    add(x);
    if (height > 1) add((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    add(y * width);
    if (width > 1) add(y * width + width - 1);
  }
  let best = 255;
  let bestCount = -1;
  for (let level = 0; level < 256; level += 1) {
    let count = 0;
    for (let d = -2; d <= 2; d += 1) count += histogram[level + d] ?? 0;
    if (count >= bestCount) {
      best = level;
      bestCount = count;
    }
  }
  return best;
}

function labelBackground(plane: Plane, labels: Int32Array, queue: Int32Array): Region[] {
  const { width, height, luma, ink } = plane;
  const regions: Region[] = [];
  const around = new Int32Array(4);
  for (let start = 0; start < luma.length; start += 1) {
    if (ink[start] === 1 || labels[start] !== -1) continue;
    const id = regions.length;
    const region: Region = { seed: start, count: 0, sum: 0, sumSq: 0, rim: 0, rimMatch: 0 };
    regions.push(region);
    labels[start] = id;
    queue[0] = start;
    let tail = 1;
    for (let head = 0; head < tail; head += 1) {
      const i = queue[head] as number;
      const l = luma[i] as number;
      region.count += 1;
      region.sum += l;
      region.sumSq += l * l;
      neighbours4(around, i, width, height);
      for (let k = 0; k < 4; k += 1) {
        const n = around[k] as number;
        if (n < 0 || ink[n] === 1 || labels[n] !== -1) continue;
        labels[n] = id;
        queue[tail] = n;
        tail += 1;
      }
    }
  }
  return regions;
}

/** Count, per background region, its ink-bordering pixel sides and how many
 *  of those ink pixels share the region's tone. */
function measureRims(plane: Plane, labels: Int32Array, regions: Region[]): void {
  const { width, height, luma, ink } = plane;
  const around = new Int32Array(4);
  for (let i = 0; i < luma.length; i += 1) {
    const id = labels[i] as number;
    if (id < 0) continue;
    const region = regions[id] as Region;
    const tone = region.sum / region.count;
    neighbours4(around, i, width, height);
    for (let k = 0; k < 4; k += 1) {
      const n = around[k] as number;
      if (n < 0 || ink[n] !== 1) continue;
      region.rim += 1;
      if (Math.abs((luma[n] as number) - tone) <= TONE_TOLERANCE) region.rimMatch += 1;
    }
  }
}

/** Flood the region plus the connected same-tone ink that forms its rim into
 *  `queue`; returns how many pixels it holds. The region is 4-connected
 *  through its own pixels, so one seed reaches all of it. */
function growSolid(
  plane: Plane,
  labels: Int32Array,
  solid: { readonly id: number; readonly seed: number; readonly tone: number },
  queue: Int32Array,
  claimed: Uint8Array,
): number {
  const { width, height, luma, ink } = plane;
  const around = new Int32Array(4);
  const joins = (n: number): boolean =>
    n >= 0 &&
    claimed[n] === 0 &&
    (labels[n] === solid.id ||
      (ink[n] === 1 && Math.abs((luma[n] as number) - solid.tone) <= TONE_TOLERANCE));
  claimed[solid.seed] = 1;
  queue[0] = solid.seed;
  let tail = 1;
  for (let head = 0; head < tail; head += 1) {
    neighbours4(around, queue[head] as number, width, height);
    for (let k = 0; k < 4; k += 1) {
      const n = around[k] as number;
      if (!joins(n)) continue;
      claimed[n] = 1;
      queue[tail] = n;
      tail += 1;
    }
  }
  return tail;
}

/** Raise the iso to `value` on the solid, and on a shell around its edge
 *  pixels (those with a 4-neighbour outside every solid). */
function raiseIso(
  plane: Plane,
  iso: Float32Array,
  solid: Int32Array,
  claimed: Uint8Array,
  value: number,
): void {
  const { width, height } = plane;
  const around = new Int32Array(4);
  for (const p of solid) {
    if ((iso[p] as number) < value) iso[p] = value;
    const edge = neighbours4(around, p, width, height).some((n) => n < 0 || claimed[n] === 0);
    if (!edge) continue;
    const x = p % width;
    const y = (p - x) / width;
    const x1 = Math.min(width - 1, x + EDGE_SHELL_PX);
    const y1 = Math.min(height - 1, y + EDGE_SHELL_PX);
    for (let yy = Math.max(0, y - EDGE_SHELL_PX); yy <= y1; yy += 1) {
      for (let xx = Math.max(0, x - EDGE_SHELL_PX); xx <= x1; xx += 1) {
        const n = yy * width + xx;
        if ((iso[n] as number) < value) iso[n] = value;
      }
    }
  }
}

/** Fill `out` with the 4-neighbours of pixel `i` (−1 beyond the image). */
function neighbours4(out: Int32Array, i: number, width: number, height: number): Int32Array {
  const x = i % width;
  out[0] = x > 0 ? i - 1 : -1;
  out[1] = x < width - 1 ? i + 1 : -1;
  out[2] = i >= width ? i - width : -1;
  out[3] = i < (height - 1) * width ? i + width : -1;
  return out;
}
