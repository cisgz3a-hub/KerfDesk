// QR Code data masking (ISO/IEC 18004 §7.8): the eight mask conditions and
// the four penalty rules used to pick the least ambiguous mask. The finder-
// like rule counts a 1:1:3:1:1 run only when four light modules inside the
// symbol flank it, the widely deployed reading of the rule.

import type { QrGrid } from './qr-matrix';

const PENALTY_RUN = 3;
const PENALTY_BLOCK = 3;
const PENALTY_FINDER_LIKE = 40;
const PENALTY_BALANCE = 10;
const FINDER_LIKE = [1, 0, 1, 1, 1, 0, 1] as const;

/** True where mask `mask` flips the module at row y, column x. */
export function qrMaskFlips(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** XORs the mask into every module that is not a function pattern. */
export function applyQrMask(grid: QrGrid, mask: number): void {
  const size = grid.size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (grid.reserved[index] === 1 || !qrMaskFlips(mask, x, y)) continue;
      grid.dark[index] = (grid.dark[index] ?? 0) ^ 1;
    }
  }
}

export function qrPenalty(dark: Uint8Array, size: number): number {
  const at = (x: number, y: number): number => dark[y * size + x] ?? 0;
  const across = (line: number, offset: number): number => at(offset, line);
  const down = (line: number, offset: number): number => at(line, offset);
  return (
    runPenalty(size, across) +
    runPenalty(size, down) +
    blockPenalty(size, at) +
    finderLikePenalty(size, across) +
    finderLikePenalty(size, down) +
    balancePenalty(dark)
  );
}

type LineReader = (line: number, offset: number) => number;

function runPenalty(size: number, read: LineReader): number {
  let penalty = 0;
  for (let line = 0; line < size; line += 1) {
    let run = 1;
    for (let offset = 1; offset <= size; offset += 1) {
      if (offset < size && read(line, offset) === read(line, offset - 1)) {
        run += 1;
        continue;
      }
      if (run >= 5) penalty += PENALTY_RUN + (run - 5);
      run = 1;
    }
  }
  return penalty;
}

function blockPenalty(size: number, at: (x: number, y: number) => number): number {
  let penalty = 0;
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const colour = at(x, y);
      if (colour === at(x + 1, y) && colour === at(x, y + 1) && colour === at(x + 1, y + 1)) {
        penalty += PENALTY_BLOCK;
      }
    }
  }
  return penalty;
}

function finderLikePenalty(size: number, read: LineReader): number {
  let penalty = 0;
  for (let line = 0; line < size; line += 1) {
    for (let offset = 0; offset + 6 < size; offset += 1) {
      if (!FINDER_LIKE.every((value, index) => read(line, offset + index) === value)) continue;
      if (
        lightRun(read, line, offset - 4, offset, size) ||
        lightRun(read, line, offset + 7, offset + 11, size)
      ) {
        penalty += PENALTY_FINDER_LIKE;
      }
    }
  }
  return penalty;
}

function lightRun(read: LineReader, line: number, from: number, to: number, size: number): boolean {
  if (from < 0 || to > size) return false;
  for (let offset = from; offset < to; offset += 1) {
    if (read(line, offset) === 1) return false;
  }
  return true;
}

function balancePenalty(dark: Uint8Array): number {
  let count = 0;
  for (const module of dark) count += module;
  const total = dark.length;
  return Math.floor((Math.abs(count * 2 - total) * 10) / total) * PENALTY_BALANCE;
}
