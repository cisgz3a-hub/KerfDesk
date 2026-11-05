// A text mark's own geometry, for the automatic small-mark policy (ADR-434
// Amendments 3 and 4).
//
// A full stop after a letter with no ink near its foot ('y', 'T', '7') has
// nothing within the support radius, so the neighbourhood rules read it as a
// lone speck: the signature of a dirty scan. What a speck in clean paper does
// not have is the stop's place in a line of text. A stop is a compact, solid
// dot whose foot sits on the baseline: some letter nearby, several times
// taller than the dot, ends on the same line. Dust lands anywhere; on the
// measured text every stop has such a letter within about one em, and the
// dirty-scan probes' specks almost never do (their neighbours are other
// specks and 3 px strokes, too low to be letters beside a compact dot at
// least 2 px tall).
//
// The line runs wherever the text around the dot runs (small-mark-text-
// direction.ts): a turned, skewed or upside-down line is read the same way as
// an upright one. An upright letter's foot is its box's bottom, which needs no
// direction; a turned line needs the letters around it to agree on one (three
// on a line, or two that both reach the dot's own line).
//
// Two more marks belong to a line without sitting on it:
//   - A stop after a descender: 'p' or 'y' does not end on the baseline, and a
//     small stop's reach may not get past them to a letter that does. The
//     descender's body narrows there instead: wide above the dot's foot, one
//     thin stroke carrying on below it.
//   - A colon's top dot: a like dot straight above a dot on the line. Each is
//     then a text mark, so neither vetoes the other as dust.
//
// Cost: one scan of the rows around the dot's bottom edge, a bounded window
// (a dozen dot heights either side), per lone dark candidate; then a constant
// over the letters around it.
//
// Our own design from connected-component geometry (ADR-017).

import {
  alongLine,
  createTextDirections,
  isLetterSized,
  isStrong,
  opposite,
  positionAt,
  reachOf,
  UPRIGHT_STEP,
  type Box,
  type LabelBoxes,
  type Letter,
  type LocalDirections,
  type TextDirections,
} from './small-mark-text-direction';

export type { LabelBoxes };

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
/** A colon's dots: at most this many dot heights apart, edge to edge, and at
 *  most twice the other's pixels. A slanted colon leans by this share of the
 *  distance between them (about 17°). */
const STACK_MAX_GAP_HEIGHTS = 6;
const STACK_MAX_AREA_RATIO = 2;
const STACK_MAX_LEAN = 0.3;
/** Where a descender's letter holds the baseline: this share of the way down
 *  its height. */
const DESCENDER_MIN_POSITION = 0.55;
const DESCENDER_MAX_POSITION = 0.92;
/** The stroke below the baseline is at most this share as wide as the body
 *  above it, and reaches at least this many dot heights on. */
const DESCENDER_MAX_NARROWING = 0.6;
const DESCENDER_MIN_DEPTH_HEIGHTS = 1.5;
/** The largest letter-sized side (small-mark-text-direction.ts), in source px. */
const LETTER_MAX_PX = 54;
/** A speck within this many source px of a letter is one of its pieces. */
const GLYPH_PIECE_GAP_PX = 2;
/** A stop sits at most this many dot heights past its descender's box. */
const DESCENDER_MAX_GAP_HEIGHTS = 2;

export type TextLineInput = {
  readonly width: number;
  readonly height: number;
  readonly ink: Uint8Array;
  readonly boxes: LabelBoxes;
  readonly labelOf: (p: number) => number;
  /** Per-label pixel counts. */
  readonly areas: ReadonlyArray<number>;
  /** One source pixel in mask px: how far apart two baselines may sit. */
  readonly baselinePx: number;
};

export type TextLine = {
  /** A compact, solid dot on the baseline of a letter-sized component nearby,
   *  just past a descender, or a colon's other dot. */
  readonly holds: (region: ReadonlyArray<number>) => boolean;
  /** A colon's other dot alone: this judges a dot under the size floor. */
  readonly colonDot: (region: ReadonlyArray<number>) => boolean;
  /** A piece of a letter: a speck this close to a letter-sized component is
   *  the glyph's own fragment, a tittle or a tip, not debris on the paper. */
  readonly besideLetter: (region: ReadonlyArray<number>) => boolean;
};

type Dot = {
  readonly points: ReadonlyArray<number>;
  readonly box: Box;
  readonly height: number;
};

/** A whole label read as a dot, with the sweep step of the line its foot sits
 *  on; null when it is not a dot or sits on no line. */
type LabelDot = { readonly dot: Dot; readonly step: number } | null;

export function createTextLine(input: TextLineInput): TextLine {
  const directions = createTextDirections({
    width: input.width,
    boxes: input.boxes,
    labelOf: input.labelOf,
    sourcePx: input.baselinePx,
    letterMax: LETTER_MAX_PX * input.baselinePx,
  });
  // Every dot within a colon's reach of a label asks for that label's
  // baseline, so a speckled page asked once per speck. The answer depends only
  // on the label and this mask, so each label is read once.
  const labelDots = new Map<number, LabelDot>();
  const baselineDot = (label: number): LabelDot => {
    const known = labelDots.get(label);
    if (known !== undefined) return known;
    const dot = labelDot(label, labelBox(input.boxes, label), input);
    const step = dot === null ? null : baselineStep(dot, directions, input);
    const read = dot === null || step === null ? null : { dot, step };
    labelDots.set(label, read);
    return read;
  };
  return {
    holds: (region) => {
      const dot = compactDot(region, input.width);
      if (dot === null) return false;
      return (
        baselineStep(dot, directions, input) !== null ||
        afterDescender(dot, directions, input) ||
        stackedOverBaselineDot(dot, region.length, directions, input, baselineDot)
      );
    },
    colonDot: (region) => {
      const dot = compactDot(region, input.width);
      return (
        dot !== null && stackedOverBaselineDot(dot, region.length, directions, input, baselineDot)
      );
    },
    besideLetter: (region) => hasLetterWithin(region, input),
  };
}

function hasLetterWithin(region: ReadonlyArray<number>, input: TextLineInput): boolean {
  const box = regionBox(region, input.width);
  const own = input.labelOf(region[0] ?? 0);
  const reach = Math.ceil(GLYPH_PIECE_GAP_PX * input.baselinePx) + 1;
  const yEnd = Math.min(input.height - 1, box.y1 + reach);
  const xEnd = Math.min(input.width - 1, box.x1 + reach);
  const seen = new Set<number>([own]);
  for (let y = Math.max(0, box.y0 - reach); y <= yEnd; y += 1) {
    for (let x = Math.max(0, box.x0 - reach); x <= xEnd; x += 1) {
      const p = y * input.width + x;
      if (input.ink[p] !== 1) continue;
      const label = input.labelOf(p);
      if (seen.has(label)) continue;
      seen.add(label);
      if (isLetterSized(labelBox(input.boxes, label), input.baselinePx)) return true;
    }
  }
  return false;
}

function localDirections(dot: Dot, directions: TextDirections): LocalDirections {
  return directions.at((dot.box.x0 + dot.box.x1) / 2, (dot.box.y0 + dot.box.y1) / 2);
}

function letterInReach(dot: Dot, directions: TextDirections): boolean {
  return directions.letterWithin(dot.box, AUTO_TEXT_REACH_HEIGHTS * dot.height);
}

function compactDot(points: ReadonlyArray<number>, width: number): Dot | null {
  const box = regionBox(points, width);
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  if (w > MAX_ASPECT * h || h > MAX_ASPECT * w || points.length < MIN_FILL * w * h) return null;
  return { points, box, height: h };
}

// The sweep step of the line the dot's foot sits on; null: none.
function baselineStep(dot: Dot, directions: TextDirections, input: TextLineInput): number | null {
  if (!letterInReach(dot, directions)) {
    return onUprightBaseline(dot, input) ? UPRIGHT_STEP : null;
  }
  const local = localDirections(dot, directions);
  if (readsUpright(local) && onUprightBaseline(dot, input)) return UPRIGHT_STEP;
  const tolerance = Math.max(1, Math.round(input.baselinePx));
  for (const step of local.steps) {
    if (onLineAtStep(dot, step, local, tolerance, input.width)) return step;
  }
  return null;
}

// Letters that plainly run another way have no box bottoms to read: on a page
// turned 90°, any letter's bottom is one more place a speck can line up.
function readsUpright(local: LocalDirections): boolean {
  return !isStrong(local) || local.steps.includes(UPRIGHT_STEP);
}

function onUprightBaseline(dot: Dot, input: TextLineInput): boolean {
  const { x0, x1, y1 } = dot.box;
  const own = input.labelOf(dot.points[0] ?? 0);
  const tolerance = Math.max(1, Math.round(input.baselinePx));
  const reach = Math.ceil(AUTO_TEXT_REACH_HEIGHTS * dot.height);
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
      if (isBaselineLetter(labelBox(input.boxes, label), y1, dot.height, tolerance)) return true;
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

// The dot on a line of this direction: enough letters nearby end on it. The
// side of the line the text's feet are on is the one with more letters ending
// on it; there, once the direction is plain, one letter is enough, as on
// upright text. On the other side (its letters' heads) two must. Where the
// direction rests on two letters alone, a pair's tangent is no evidence by
// itself: the same pair, or another, must line up across the text too, and two
// must end on the dot's line.
function onLineAtStep(
  dot: Dot,
  step: number,
  local: LocalDirections,
  tolerance: number,
  width: number,
): boolean {
  const feet = local.votes[step] ?? 0;
  const heads = local.votes[opposite(step)] ?? 0;
  if (!isStrong(local) && Math.min(feet, heads) < 2) return false;
  const needed = isStrong(local) && feet >= heads ? 1 : 2;
  const seen = dotAt(dot, step, width);
  let count = 0;
  for (const letter of local.letters) {
    if (!endsOnDotsLine(letter, step, seen, tolerance)) continue;
    count += 1;
    if (count >= needed) return true;
  }
  return false;
}

function endsOnDotsLine(letter: Letter, step: number, dot: SeenDot, tolerance: number): boolean {
  if (Math.abs((letter.reach[step] ?? 0) - dot.foot) > tolerance) return false;
  if (!letterSized(letter, step, dot.height)) return false;
  const along = alongLine(step);
  const gap = Math.max(
    -(letter.reach[opposite(along)] ?? 0) - dot.end,
    dot.start - (letter.reach[along] ?? 0),
  );
  return gap <= AUTO_TEXT_REACH_HEIGHTS * dot.height;
}

function letterSized(letter: Letter, step: number, dotHeight: number): boolean {
  const height = (letter.reach[step] ?? 0) + (letter.reach[opposite(step)] ?? 0) + 1;
  return (
    height >= AUTO_TEXT_MIN_HEIGHT_RATIO * dotHeight &&
    height <= AUTO_TEXT_MAX_HEIGHT_RATIO * dotHeight
  );
}

// A stop just past a descender, upright or along the local text.
function afterDescender(dot: Dot, directions: TextDirections, input: TextLineInput): boolean {
  if (!letterInReach(dot, directions)) return false;
  const local = localDirections(dot, directions);
  const onFeetSide = (step: number): boolean =>
    (local.votes[step] ?? 0) >= (local.votes[opposite(step)] ?? 0);
  const turned = isStrong(local) ? local.steps.filter(onFeetSide) : [];
  return [UPRIGHT_STEP, ...turned].some((step) => {
    const seen = dotAt(dot, step, input.width);
    return local.letters.some((letter) => descenderHoldsDot(seen, letter, step, input));
  });
}

// The dot as seen at a sweep step: its foot, height, and span along the line.
type SeenDot = {
  readonly foot: number;
  readonly height: number;
  readonly start: number;
  readonly end: number;
};

function dotAt(dot: Dot, step: number, width: number): SeenDot {
  const foot = reachOf(dot.points, width, step);
  return {
    foot,
    height: foot + reachOf(dot.points, width, opposite(step)) + 1,
    start: -reachOf(dot.points, width, opposite(alongLine(step))),
    end: reachOf(dot.points, width, alongLine(step)),
  };
}

function descenderHoldsDot(
  dot: SeenDot,
  letter: Letter,
  step: number,
  input: TextLineInput,
): boolean {
  const { foot, height: dotHeight } = dot;
  if (!letterSized(letter, step, dotHeight)) return false;
  const letterFoot = letter.reach[step] ?? 0;
  const letterHead = -(letter.reach[opposite(step)] ?? 0);
  const position = (foot - letterHead) / (letterFoot - letterHead);
  if (position < DESCENDER_MIN_POSITION || position > DESCENDER_MAX_POSITION) return false;
  if (letterFoot - foot < DESCENDER_MIN_DEPTH_HEIGHTS * dotHeight) return false;
  const gap = dot.start - (letter.reach[alongLine(step)] ?? 0);
  if (Math.abs(gap) > DESCENDER_MAX_GAP_HEIGHTS * dotHeight) return false;
  return bodyNarrowsAt(letter.label, step, foot, dotHeight, input);
}

// The letter's ink along the line: as wide as a body above the foot, a stroke
// at most DESCENDER_MAX_NARROWING as wide just below it.
function bodyNarrowsAt(
  label: number,
  step: number,
  foot: number,
  dotHeight: number,
  input: TextLineInput,
): boolean {
  const along = alongLine(step);
  const body = { min: Infinity, max: -Infinity };
  const below = { min: Infinity, max: -Infinity };
  const box = labelBox(input.boxes, label);
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      if (input.labelOf(y * input.width + x) !== label) continue;
      const depth = positionAt(x, y, step) - foot;
      if (depth > DESCENDER_MIN_DEPTH_HEIGHTS * dotHeight) continue;
      const band = depth > 0 ? below : body;
      const position = positionAt(x, y, along);
      band.min = Math.min(band.min, position);
      band.max = Math.max(band.max, position);
    }
  }
  return (
    below.max >= below.min &&
    below.max - below.min <= DESCENDER_MAX_NARROWING * (body.max - body.min)
  );
}

// A colon's other dot: a dot about this size further along the feet's normal
// that sits on a baseline, with this one straight above it on that line.
function stackedOverBaselineDot(
  dot: Dot,
  area: number,
  directions: TextDirections,
  input: TextLineInput,
  baselineDot: (label: number) => LabelDot,
): boolean {
  if (!letterInReach(dot, directions)) return false;
  const own = input.labelOf(dot.points[0] ?? 0);
  const reach = Math.ceil((STACK_MAX_GAP_HEIGHTS + 1) * dot.height);
  const seen = new Set<number>([own]);
  const yEnd = Math.min(input.height - 1, dot.box.y1 + reach);
  const xEnd = Math.min(input.width - 1, dot.box.x1 + reach);
  for (let y = Math.max(0, dot.box.y0 - reach); y <= yEnd; y += 1) {
    for (let x = Math.max(0, dot.box.x0 - reach); x <= xEnd; x += 1) {
      const p = y * input.width + x;
      if (input.ink[p] !== 1) continue;
      const label = input.labelOf(p);
      if (seen.has(label)) continue;
      seen.add(label);
      const areaOther = input.areas[label] ?? 0;
      if (Math.max(area, areaOther) > STACK_MAX_AREA_RATIO * Math.min(area, areaOther)) continue;
      if (stackedOn(dot, baselineDot(label), input)) return true;
    }
  }
  return false;
}

// The label's pixels as a dot; null when it is not one.
function labelDot(label: number, box: Box, input: TextLineInput): Dot | null {
  const points: number[] = [];
  for (let y = box.y0; y <= box.y1; y += 1)
    for (let x = box.x0; x <= box.x1; x += 1)
      if (input.labelOf(y * input.width + x) === label) points.push(y * input.width + x);
  return compactDot(points, input.width);
}

function stackedOn(dot: Dot, onLine: LabelDot, input: TextLineInput): boolean {
  if (onLine === null) return false;
  const { dot: other, step } = onLine;
  const along = alongLine(step);
  const [cx, cy] = centre(dot.box);
  const [ox, oy] = centre(other.box);
  const down = positionAt(ox - cx, oy - cy, step);
  const across = Math.abs(positionAt(ox - cx, oy - cy, along));
  const gap = down - (dot.height + other.height) / 2;
  const tolerance = Math.max(1, Math.round(input.baselinePx));
  return (
    gap > 0 &&
    gap <= STACK_MAX_GAP_HEIGHTS * dot.height &&
    across <= tolerance + STACK_MAX_LEAN * down
  );
}

function centre(box: Box): readonly [number, number] {
  return [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
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

function labelBox(boxes: LabelBoxes, label: number): Box {
  return {
    x0: boxes.x0[label] ?? 0,
    y0: boxes.y0[label] ?? 0,
    x1: boxes.x1[label] ?? 0,
    y1: boxes.y1[label] ?? 0,
  };
}
