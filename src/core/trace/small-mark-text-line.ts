// A full stop's own geometry, for the automatic small-mark policy (ADR-434
// Amendment 3).
//
// A full stop after a letter with no ink near its foot ('y', 'T', '7') has
// nothing within the support radius, so the neighbourhood rules read it as a
// lone speck: the signature of a dirty scan. What a speck in clean paper does
// not have is the stop's place in a line of text. A stop is a compact, solid
// dot whose bottom sits on the baseline: some letter nearby, several times
// taller than the dot, ends on the same row. Dust lands anywhere; on the
// measured text every stop has such a letter within about one em, and the
// dirty-scan probes' specks almost never do (their neighbours are other
// specks and 3 px strokes, too low to be letters beside a compact dot at
// least 2 px tall).
//
// Cost: one scan of the rows around the dot's bottom edge, a bounded window
// (a dozen dot heights either side), per lone dark candidate.
//
// Our own design from connected-component geometry (ADR-017).

/** Per-label bounding boxes of the eight-connected ink components. */
export type LabelBoxes = {
  readonly x0: ReadonlyArray<number>;
  readonly y0: ReadonlyArray<number>;
  readonly x1: ReadonlyArray<number>;
  readonly y1: ReadonlyArray<number>;
};

/** A baseline letter lies within this many dot heights, edge to edge
 *  (about an em: a full stop is about a tenth of one). */
export const AUTO_TEXT_REACH_HEIGHTS = 12;
/** A letter is at least this many times taller than the dot (x-height or
 *  cap height against a stop's height; another dot is not a letter) ... */
export const AUTO_TEXT_MIN_HEIGHT_RATIO = 3;
/** ... and at most this many (a tall shape is not a letter beside a stop). */
export const AUTO_TEXT_MAX_HEIGHT_RATIO = 12;
/** A dot's box is at most this elongated, and its pixels fill at least this
 *  share of it: round and solid, as a stop is. */
const MAX_ASPECT = 2;
const MIN_FILL = 0.5;

export type TextLineInput = {
  readonly width: number;
  readonly height: number;
  readonly ink: Uint8Array;
  readonly boxes: LabelBoxes;
  readonly labelOf: (p: number) => number;
  /** One source pixel in mask px: how far apart two baselines may sit. */
  readonly baselinePx: number;
};

/** true = the region is a compact, solid dot whose bottom edge sits on the
 *  baseline of a letter-sized component nearby. */
export function sitsOnTextLine(region: ReadonlyArray<number>, input: TextLineInput): boolean {
  const own = input.labelOf(region[0] ?? 0);
  const { x0, y0, x1, y1 } = regionBox(region, input.width);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w > MAX_ASPECT * h || h > MAX_ASPECT * w || region.length < MIN_FILL * w * h) return false;
  const tolerance = Math.max(1, Math.round(input.baselinePx));
  const reach = Math.ceil(AUTO_TEXT_REACH_HEIGHTS * h);
  const seen = new Set<number>([own]);
  const yEnd = Math.min(input.height - 1, y1 + tolerance);
  const xEnd = Math.min(input.width - 1, x1 + reach);
  for (let y = Math.max(0, y1 - tolerance); y <= yEnd; y += 1) {
    for (let x = Math.max(0, x0 - reach); x <= xEnd; x += 1) {
      const p = y * input.width + x;
      if (input.ink[p] !== 1) continue;
      const label = input.labelOf(p);
      if (seen.has(label)) continue;
      seen.add(label);
      if (isBaselineLetter(labelBox(input.boxes, label), y1, h, tolerance)) return true;
    }
  }
  return false;
}

function isBaselineLetter(
  box: { readonly y0: number; readonly y1: number },
  dotBottom: number,
  dotHeight: number,
  tolerance: number,
): boolean {
  const letterHeight = box.y1 - box.y0 + 1;
  return (
    Math.abs(box.y1 - dotBottom) <= tolerance &&
    letterHeight >= AUTO_TEXT_MIN_HEIGHT_RATIO * dotHeight &&
    letterHeight <= AUTO_TEXT_MAX_HEIGHT_RATIO * dotHeight
  );
}

// The region's own box: a despeckle region may be part of a larger
// eight-connected label.
function regionBox(region: ReadonlyArray<number>, width: number): Box {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of region) {
    const x = p % width;
    const y = (p - x) / width;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

function labelBox(boxes: LabelBoxes, label: number): Box {
  return {
    x0: boxes.x0[label] ?? 0,
    y0: boxes.y0[label] ?? 0,
    x1: boxes.x1[label] ?? 0,
    y1: boxes.y1[label] ?? 0,
  };
}
