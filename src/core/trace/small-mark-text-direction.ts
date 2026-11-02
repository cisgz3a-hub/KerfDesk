// Which way the text around a small mark runs, for the automatic small-mark
// policy (ADR-434 Amendment 4).
//
// A turned or upside-down line of text has no horizontal baseline to read, but
// it still has a baseline: seen along the right direction, many letters end on
// one line. Each letter-sized component keeps its convex hull's support (how
// far it reaches) in every direction of a fixed sweep; the direction whose
// feet pile up most is how the local text runs. The direction comes from the
// letters alone, never from the mark being judged: two letters always share
// some tangent line, so a line fitted through a speck would pass almost any
// speck beside text. The mark then has to land on a line of THAT direction,
// which is as selective as a horizontal baseline is on upright text.
//
// Cost: a hull and one support table per letter, built on first use and only
// near a lone dark candidate; one sweep per coarse tile, cached, over at most
// MAX_LETTERS letters. The rest is a constant per query.
//
// Our own design from convex hulls and a one-parameter vote (ADR-017).

/** Sweep step 2°: a one-pixel tolerance over about an em either side. */
export const DIRECTION_STEPS = 180;
const QUARTER_TURN = DIRECTION_STEPS / 4;
/** The sweep's step that points down the image: where upright text's feet are. */
export const UPRIGHT_STEP = QUARTER_TURN;

const COS = Float64Array.from({ length: DIRECTION_STEPS }, (_, k) =>
  Math.cos((2 * Math.PI * k) / DIRECTION_STEPS),
);
const SIN = Float64Array.from({ length: DIRECTION_STEPS }, (_, k) =>
  Math.sin((2 * Math.PI * k) / DIRECTION_STEPS),
);

/** Tiles of this many source px hold the letters; a query reads its own tile
 *  and two more each way, so about 3 ems or more of text at 20-28 px either
 *  side, wherever a stop lies in its tile. */
const LETTER_TILE_PX = 32;
const TILE_REACH = 2;
/** A letter-sized component's longer side, in source px: three heights of the
 *  smallest dot the policy keeps, and twelve heights of the largest. */
const MIN_LETTER_PX = 6;
const MAX_LETTER_PX = 54;
/** A sweep reads at most this many letters: enough to find a direction. */
const MAX_LETTERS = 64;
/** A direction this far behind the best still counts: a line of glyphs at a
 *  step between two of the sweep's can miss a few feet. */
const NEAR_BEST_SHARE = 0.8;
/** This many letters on one line name the direction outright. Two do not:
 *  any two letters share a tangent. */
const STRONG_LETTERS = 3;

export type Box = {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
};

/** Per-label bounding boxes of the eight-connected ink components. */
export type LabelBoxes = {
  readonly x0: ReadonlyArray<number>;
  readonly y0: ReadonlyArray<number>;
  readonly x1: ReadonlyArray<number>;
  readonly y1: ReadonlyArray<number>;
};

export type TextDirectionInput = {
  readonly width: number;
  readonly boxes: LabelBoxes;
  readonly labelOf: (p: number) => number;
  /** One source pixel in mask px. */
  readonly sourcePx: number;
  /** The largest dot-to-letter search a caller makes, past the letter's box. */
  readonly letterMax: number;
};

export type Letter = {
  readonly label: number;
  /** Support of the letter's hull at each sweep step. */
  readonly reach: Float32Array;
};

/** The directions a query may take, as sweep steps of the feet's normal. */
export type LocalDirections = {
  readonly letters: ReadonlyArray<Letter>;
  /** Steps whose line of feet is the best, or near it, around here. */
  readonly steps: ReadonlyArray<number>;
  /** Letters on the fullest line of any step. */
  readonly best: number;
  /** Each step's fullest line of feet, in letters. */
  readonly votes: Uint16Array;
};

export type TextDirections = {
  /** A letter-sized component within this many mask px of the box. Dust far
   *  from any letter stops here and never pays for a sweep. */
  readonly letterWithin: (box: Box, reach: number) => boolean;
  /** How the text around this point runs. */
  readonly at: (x: number, y: number) => LocalDirections;
};

export function opposite(step: number): number {
  return (step + DIRECTION_STEPS / 2) % DIRECTION_STEPS;
}

/** The sweep's step along a line of feet, in reading order: +x on upright text. */
export function alongLine(step: number): number {
  return (step - QUARTER_TURN + DIRECTION_STEPS) % DIRECTION_STEPS;
}

/** How far points reach at a sweep step. */
export function reachOf(points: ReadonlyArray<number>, width: number, step: number): number {
  let reach = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const x = p % width;
    reach = Math.max(reach, x * (COS[step] ?? 0) + ((p - x) / width) * (SIN[step] ?? 0));
  }
  return reach;
}

/** A pixel's position along a sweep step. */
export function positionAt(x: number, y: number, step: number): number {
  return x * (COS[step] ?? 0) + y * (SIN[step] ?? 0);
}

export function createTextDirections(input: TextDirectionInput): TextDirections {
  const tile = Math.max(1, Math.round(LETTER_TILE_PX * input.sourcePx));
  const tilesX = Math.ceil(input.width / tile);
  let index: ReadonlyMap<number, ReadonlyArray<number>> | null = null;
  const letters = new Map<number, Letter>();
  const swept = new Map<number, LocalDirections>();

  const letterOf = (label: number): Letter => {
    let letter = letters.get(label);
    if (letter === undefined) {
      letter = { label, reach: supportTable(hullOf(label, input)) };
      letters.set(label, letter);
    }
    return letter;
  };
  const near = (tx: number, ty: number): Letter[] => {
    index ??= letterIndex(input, tile, tilesX);
    const out: Letter[] = [];
    for (let y = ty - TILE_REACH; y <= ty + TILE_REACH; y += 1)
      for (let x = Math.max(0, tx - TILE_REACH); x <= Math.min(tilesX - 1, tx + TILE_REACH); x += 1)
        for (const label of index.get(y * tilesX + x) ?? [])
          if (out.length < MAX_LETTERS) out.push(letterOf(label));
    return out;
  };

  return {
    letterWithin: (box, reach) => {
      index ??= letterIndex(input, tile, tilesX);
      const y1 = Math.floor((box.y1 + reach + input.letterMax / 2) / tile);
      const x1 = Math.min(tilesX - 1, Math.floor((box.x1 + reach + input.letterMax / 2) / tile));
      const x0 = Math.max(0, Math.floor((box.x0 - reach - input.letterMax / 2) / tile));
      for (let y = Math.floor((box.y0 - reach - input.letterMax / 2) / tile); y <= y1; y += 1)
        for (let x = x0; x <= x1; x += 1)
          for (const label of index.get(y * tilesX + x) ?? [])
            if (boxGap(box, label, input.boxes) <= reach) return true;
      return false;
    },
    at: (x, y) => {
      const tx = Math.floor(x / tile);
      const ty = Math.floor(y / tile);
      const key = ty * tilesX + tx;
      let local = swept.get(key);
      if (local === undefined) {
        local = sweep(near(tx, ty), Math.max(1, Math.round(input.sourcePx)));
        swept.set(key, local);
      }
      return local;
    },
  };
}

function boxGap(box: Box, label: number, boxes: LabelBoxes): number {
  return Math.max(
    (boxes.x0[label] ?? 0) - box.x1,
    box.x0 - (boxes.x1[label] ?? 0),
    (boxes.y0[label] ?? 0) - box.y1,
    box.y0 - (boxes.y1[label] ?? 0),
  );
}

/** A component's box is letter-sized (one source pixel = sourcePx mask px). */
export function isLetterSized(box: Box, sourcePx: number): boolean {
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0) + 1;
  return side >= MIN_LETTER_PX * sourcePx && side <= MAX_LETTER_PX * sourcePx;
}

function letterIndex(
  input: TextDirectionInput,
  tile: number,
  tilesX: number,
): ReadonlyMap<number, ReadonlyArray<number>> {
  const { x0, y0, x1, y1 } = input.boxes;
  const index = new Map<number, number[]>();
  for (let label = 1; label < x0.length; label += 1) {
    const left = x0[label] ?? 0;
    const top = y0[label] ?? 0;
    const w = (x1[label] ?? 0) - left + 1;
    const h = (y1[label] ?? 0) - top + 1;
    if (!isLetterSized({ x0: left, y0: top, x1: left + w - 1, y1: top + h - 1 }, input.sourcePx))
      continue;
    const key = Math.floor((top + h / 2) / tile) * tilesX + Math.floor((left + w / 2) / tile);
    const list = index.get(key);
    if (list === undefined) index.set(key, [label]);
    else list.push(label);
  }
  return index;
}

// The vote. At each step, the most feet within a tolerance band.
function sweep(letters: ReadonlyArray<Letter>, tolerance: number): LocalDirections {
  const votes = new Uint16Array(DIRECTION_STEPS);
  let best = 0;
  const feet = new Float32Array(letters.length);
  const order = Uint16Array.from(letters.keys());
  for (let step = 0; step < DIRECTION_STEPS; step += 1) {
    for (let i = 0; i < letters.length; i += 1) feet[i] = letters[i]?.reach[step] ?? 0;
    const count = fullestBand(feet, order, tolerance);
    votes[step] = count;
    best = Math.max(best, count);
  }
  const floor = best < STRONG_LETTERS ? best : Math.ceil(NEAR_BEST_SHARE * best);
  const steps: number[] = [];
  if (best >= 2) {
    for (let step = 0; step < DIRECTION_STEPS; step += 1) {
      if ((votes[step] ?? 0) >= floor || (votes[opposite(step)] ?? 0) >= floor) steps.push(step);
    }
  }
  return { letters, steps, best, votes };
}

// The most feet within a tolerance band. `order` carries the letters sorted by
// the last step's feet: a 2° turn barely reorders them, so an insertion sort is
// about linear here, and this is the sweep's whole cost.
function fullestBand(feet: Float32Array, order: Uint16Array, tolerance: number): number {
  for (let i = 1; i < order.length; i += 1) {
    const moving = order[i] as number;
    const foot = feet[moving] as number;
    let j = i - 1;
    for (; j >= 0 && (feet[order[j] as number] as number) > foot; j -= 1) {
      order[j + 1] = order[j] as number;
    }
    order[j + 1] = moving;
  }
  let fullest = 0;
  let from = 0;
  for (let to = 0; to < order.length; to += 1) {
    const foot = feet[order[to] as number] as number;
    while (foot - (feet[order[from] as number] as number) > tolerance) from += 1;
    fullest = Math.max(fullest, to - from + 1);
  }
  return fullest;
}

/** This many letters on one line name the direction on their own. */
export function isStrong(local: LocalDirections): boolean {
  return local.best >= STRONG_LETTERS;
}

function supportTable(hull: ReadonlyArray<readonly [number, number]>): Float32Array {
  const table = new Float32Array(DIRECTION_STEPS);
  for (let step = 0; step < DIRECTION_STEPS; step += 1) {
    let reach = Number.NEGATIVE_INFINITY;
    const c = COS[step] ?? 0;
    const s = SIN[step] ?? 0;
    for (const [x, y] of hull) reach = Math.max(reach, x * c + y * s);
    table[step] = reach;
  }
  return table;
}

// Convex hull of a label's pixels from each row's two ends (monotone chain).
function hullOf(label: number, input: TextDirectionInput): Array<readonly [number, number]> {
  const left: Array<readonly [number, number]> = [];
  const right: Array<readonly [number, number]> = [];
  const x0 = input.boxes.x0[label] ?? 0;
  const x1 = input.boxes.x1[label] ?? 0;
  const y1 = input.boxes.y1[label] ?? 0;
  for (let y = input.boxes.y0[label] ?? 0; y <= y1; y += 1) {
    let first = -1;
    let last = -1;
    for (let x = x0; x <= x1; x += 1) {
      if (input.labelOf(y * input.width + x) !== label) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) continue;
    pushHull(left, [first, y], 1);
    pushHull(right, [last, y], -1);
  }
  return [...left, ...right];
}

function pushHull(
  chain: Array<readonly [number, number]>,
  point: readonly [number, number],
  turn: 1 | -1,
): void {
  while (chain.length >= 2) {
    const [ax = 0, ay = 0] = chain[chain.length - 2] ?? [];
    const [bx = 0, by = 0] = chain[chain.length - 1] ?? [];
    if (turn * ((bx - ax) * (point[1] - ay) - (by - ay) * (point[0] - ax)) > 0) break;
    chain.pop();
  }
  chain.push(point);
}
