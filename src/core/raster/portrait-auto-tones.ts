// Portrait auto tones (ADR-685): brightness, contrast and gamma chosen from the
// photo's own histogram, in the existing tone controls' conventions
// (luma-adjust.ts), so they need no new field and Undo, presets and projects
// keep working unchanged.
//
// Levels: the darkest and lightest 0.5% of the photo become solid and blank.
// Without it a portrait's off-white skin highlights and background burn a
// sparse scatter of single dots, which a laser spot wider than its scan line
// turns into visible speckle. Midtone hold: gamma then returns the photo's
// median tone to where it was, so the face keeps its overall lightness.
//
// Pure white (255) is left out of the count: a removed or transparent
// background imports as white and would otherwise hide the skin highlights.

export type PortraitTones = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
};

const BYTE_MAX = 255;
const BYTE_LEVELS = 256;
const CLIP_SHARE = 0.005;
/** contrast 100 is the control's maximum, a 2x stretch. */
const MAX_STRETCH = 2;
const GAMMA_MIN = 0.1;
const GAMMA_MAX = 5;

export function lumaHistogram(luma: Iterable<number>): Uint32Array<ArrayBuffer> {
  const histogram = new Uint32Array(BYTE_LEVELS);
  for (const level of luma) histogram[level] = (histogram[level] ?? 0) + 1;
  return histogram;
}

/** Tones for a portrait's histogram, or null when it holds no tone to work with. */
export function portraitAutoTones(histogram: ArrayLike<number>): PortraitTones | null {
  let total = 0;
  for (let level = 0; level < BYTE_MAX; level += 1) total += histogram[level] ?? 0;
  if (total === 0) return null;
  const lo = levelAtShare(histogram, total, CLIP_SHARE);
  const hi = levelAtShare(histogram, total, 1 - CLIP_SHARE);
  if (hi <= lo) return null;
  const stretch = Math.min(MAX_STRETCH, BYTE_MAX / (hi - lo));
  // (v + offset - 128) * stretch + 128 = (v - lo) * stretch: lo becomes 0 and,
  // unless the stretch is capped, hi becomes 255. Neither stage clamps a tone
  // between them (luma-adjust.ts).
  const offset = 128 - 128 / stretch - lo;
  // The controls hold a tenth: round brightness down and contrast up, so the
  // 0.5% level still lands at or below 0 and clamps solid. Rounding to nearest
  // left it up to a quarter level above 0, which the midtone gamma then lifted
  // by as much as 50 levels: a dark backdrop burned grey (O6-P3-2).
  const brightness = Math.floor(Math.round((offset / 2.55) * 1e6) / 1e5) / 10;
  const contrast = Math.min(100, Math.ceil(Math.round((stretch - 1) * 1e8) / 1e5) / 10);
  const median = levelAtShare(histogram, total, 0.5);
  const stretched = (median + brightness * 2.55 - 128) * (1 + contrast / 100) + 128;
  return { brightness, contrast, gamma: midtoneHoldGamma(median, stretched) };
}

/** Gamma (applied as v^(1/gamma)) that maps `stretched` back to `median`. */
function midtoneHoldGamma(median: number, stretched: number): number {
  if (median <= 0 || median >= BYTE_MAX || stretched <= 0 || stretched >= BYTE_MAX) return 1;
  const gamma = Math.log(stretched / BYTE_MAX) / Math.log(median / BYTE_MAX);
  return round(Math.max(GAMMA_MIN, Math.min(GAMMA_MAX, gamma)), 100);
}

// The lowest level at or below which `share` of the counted pixels lie.
function levelAtShare(histogram: ArrayLike<number>, total: number, share: number): number {
  const target = share * total;
  let seen = 0;
  for (let level = 0; level < BYTE_MAX; level += 1) {
    seen += histogram[level] ?? 0;
    if (seen >= target && seen > 0) return level;
  }
  return BYTE_MAX - 1;
}

function round(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}
