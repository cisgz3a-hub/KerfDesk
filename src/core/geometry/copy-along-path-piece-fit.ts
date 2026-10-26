// A scaled gap trial traverses runs of copies on each straight guide piece.
// Summing their arithmetic-series steps avoids work or storage per copy when
// a long guide admits millions of copies that the project cannot hold.

export type GapPiece = {
  readonly start: number;
  readonly end: number;
  readonly extent: number;
  readonly includeEnd?: boolean;
};

type FitInput = {
  readonly pieces: readonly GapPiece[];
  readonly gap: number;
  readonly lastScale: number;
  readonly start: number;
  readonly end: number;
  readonly count: number;
  readonly closed: boolean;
};

type Cursor = { readonly index: number; readonly distance: number; readonly piece: number };
type Run = {
  readonly first: number;
  readonly distance: number;
  readonly step: number;
  readonly slope: number;
};

const FIT_EPS_MM = 1e-6;
const MIN_STEP_MM = 1e-3;

export function fitScaledGapPieces(
  input: FitInput,
): { readonly count: number; readonly at: (index: number) => number } | null {
  const { pieces, start, count } = input;
  const runs: Run[] = [];
  let cursor: Cursor = { index: 0, distance: start, piece: pieceAt(pieces, start) };
  for (;;) {
    const piece = pieces[cursor.piece];
    if (piece === undefined) return null;
    const run = makeRun(input, cursor, piece.extent);
    runs.push(run);
    const index = lastIndexInPiece(input, cursor, run, piece);
    cursor = { ...cursor, index, distance: runDistance(run, index) };
    if (index === count - 1) break;
    const next = nextPiecePosition(input, cursor, piece.extent);
    if (next === null) return null;
    cursor = next;
  }
  if (!seamFits(input, cursor)) return null;
  return { count, at: (index) => distanceAt(runs, index, start) };
}

function makeRun(input: FitInput, cursor: Cursor, extent: number): Run {
  return {
    first: cursor.index,
    distance: cursor.distance,
    step: input.gap + extent * scaleAt(input, cursor.index),
    slope: (extent * (input.lastScale - 1)) / (2 * (input.count - 1)),
  };
}

function lastIndexInPiece(input: FitInput, cursor: Cursor, run: Run, piece: GapPiece): number {
  let low = cursor.index;
  let high = input.count - 1;
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    const steps = middle - run.first;
    const minimumStep = run.step + run.slope * (run.slope < 0 ? 2 * steps - 1 : 1);
    const distance = runDistance(run, middle);
    if (
      minimumStep >= MIN_STEP_MM &&
      distance <= input.end + FIT_EPS_MM &&
      withinPiece(input.pieces, cursor.piece, piece, distance)
    )
      low = middle;
    else high = middle - 1;
  }
  return low;
}

function nextPiecePosition(input: FitInput, current: Cursor, extent: number): Cursor | null {
  const reach = input.gap + (extent * scaleAt(input, current.index)) / 2;
  const index = current.index + 1;
  const scale = scaleAt(input, index);
  for (let pieceIndex = current.piece + 1; pieceIndex < input.pieces.length; pieceIndex += 1) {
    const piece = input.pieces[pieceIndex];
    if (piece === undefined || piece.start > input.end) return null;
    const distance = Math.max(piece.start, current.distance + reach + (piece.extent * scale) / 2);
    if (
      distance <= input.end + FIT_EPS_MM &&
      distance - current.distance >= MIN_STEP_MM &&
      withinPiece(input.pieces, pieceIndex, piece, distance)
    )
      return { index, distance, piece: pieceIndex };
  }
  return null;
}

function withinPiece(
  pieces: readonly GapPiece[],
  index: number,
  piece: GapPiece,
  at: number,
): boolean {
  return (
    at < piece.end ||
    (piece.includeEnd === true && at === piece.end) ||
    (index === pieces.length - 1 && at <= piece.end + FIT_EPS_MM)
  );
}

function seamFits(input: FitInput, last: Cursor): boolean {
  if (!input.closed) return true;
  const firstExtent = input.pieces[pieceAt(input.pieces, input.start)]?.extent ?? 0;
  const lastExtent = input.pieces[last.piece]?.extent ?? 0;
  const seam = input.gap + (lastExtent * input.lastScale + firstExtent) / 2;
  return input.end - last.distance >= seam - FIT_EPS_MM;
}

function scaleAt(input: FitInput, index: number): number {
  const t = index / (input.count - 1);
  return 1 - t + input.lastScale * t;
}

function runDistance(run: Run, index: number): number {
  const steps = index - run.first;
  return run.distance + steps * (run.step + run.slope * steps);
}

function distanceAt(runs: readonly Run[], index: number, start: number): number {
  let low = 0;
  let high = runs.length - 1;
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    if ((runs[middle]?.first ?? Infinity) <= index) low = middle;
    else high = middle - 1;
  }
  const run = runs[low];
  return run === undefined ? start : runDistance(run, index);
}

function pieceAt(pieces: readonly GapPiece[], distance: number): number {
  let index = 0;
  while (index + 1 < pieces.length) {
    const piece = pieces[index];
    if (
      piece === undefined ||
      distance < piece.end ||
      (piece.includeEnd === true && distance === piece.end)
    )
      break;
    index += 1;
  }
  return index;
}
