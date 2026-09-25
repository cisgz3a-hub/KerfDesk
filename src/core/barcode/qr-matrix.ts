// QR Code module placement (ISO/IEC 18004 §7.7-7.9): function patterns,
// format and version information, and the zig-zag walk that lays codewords
// into the remaining modules. Row-major grids index y * size + x.

import { qrAlignmentCentres, qrSize } from './qr-tables';

export type QrGrid = {
  readonly size: number;
  readonly dark: Uint8Array;
  /** 1 where a function pattern or format/version bit owns the module. */
  readonly reserved: Uint8Array;
};

const FORMAT_GENERATOR = 0x537;
const FORMAT_MASK = 0x5412;
const VERSION_GENERATOR = 0x1f25;

export function qrFunctionGrid(version: number): QrGrid {
  const size = qrSize(version);
  const grid: QrGrid = {
    size,
    dark: new Uint8Array(size * size),
    reserved: new Uint8Array(size * size),
  };
  for (let index = 0; index < size; index += 1) {
    setFunction(grid, 6, index, index % 2 === 0);
    setFunction(grid, index, 6, index % 2 === 0);
  }
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);
  drawAlignments(grid, version);
  // Reserve the format areas now; their bits depend on the mask chosen later.
  drawFormatBits(grid, 0);
  drawVersionBits(grid, version);
  return grid;
}

/** The 15-bit BCH(15,5) format word for a level indicator and mask, XOR-masked. */
export function qrFormatBits(levelBits: number, mask: number): number {
  const data = (levelBits << 3) | mask;
  let remainder = data;
  for (let step = 0; step < 10; step += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * FORMAT_GENERATOR);
  }
  return ((data << 10) | remainder) ^ FORMAT_MASK;
}

/** The 18-bit BCH(18,6) version word carried by versions 7 and above. */
export function qrVersionBits(version: number): number {
  let remainder = version;
  for (let step = 0; step < 12; step += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * VERSION_GENERATOR);
  }
  return (version << 12) | remainder;
}

export function drawFormatBits(grid: QrGrid, bits: number): void {
  const size = grid.size;
  const bit = (index: number): boolean => ((bits >>> index) & 1) === 1;
  // Copy beside the top-left finder: bits 0-7 down column 8, 8-14 along row 8.
  for (let index = 0; index <= 5; index += 1) setFunction(grid, 8, index, bit(index));
  setFunction(grid, 8, 7, bit(6));
  setFunction(grid, 8, 8, bit(7));
  setFunction(grid, 7, 8, bit(8));
  for (let index = 9; index < 15; index += 1) setFunction(grid, 14 - index, 8, bit(index));
  // Split copy beside the other two finders.
  for (let index = 0; index < 8; index += 1) setFunction(grid, size - 1 - index, 8, bit(index));
  for (let index = 8; index < 15; index += 1) setFunction(grid, 8, size - 15 + index, bit(index));
  // The fixed dark module above the bottom-left finder's format bits.
  setFunction(grid, 8, size - 8, true);
}

function drawVersionBits(grid: QrGrid, version: number): void {
  if (version < 7) return;
  const bits = qrVersionBits(version);
  for (let index = 0; index < 18; index += 1) {
    const dark = ((bits >>> index) & 1) === 1;
    const across = grid.size - 11 + (index % 3);
    const down = Math.floor(index / 3);
    setFunction(grid, across, down, dark);
    setFunction(grid, down, across, dark);
  }
}

function drawFinder(grid: QrGrid, centreX: number, centreY: number): void {
  // 7x7 finder plus its one-module light separator.
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = centreX + dx;
      const y = centreY + dy;
      if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(grid, x, y, ring !== 2 && ring !== 4);
    }
  }
}

function drawAlignments(grid: QrGrid, version: number): void {
  const centres = qrAlignmentCentres(version);
  const last = centres.length - 1;
  centres.forEach((row, rowIndex) => {
    centres.forEach((column, columnIndex) => {
      const overlapsFinder =
        (rowIndex === 0 && columnIndex === 0) ||
        (rowIndex === 0 && columnIndex === last) ||
        (rowIndex === last && columnIndex === 0);
      if (overlapsFinder) return;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          setFunction(grid, column + dx, row + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });
}

/** Lays codewords MSB-first along the two-column zig-zag, skipping column 6. */
export function placeQrCodewords(grid: QrGrid, codewords: ArrayLike<number>): void {
  const size = grid.size;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        const index = y * size + x;
        if (grid.reserved[index] === 1) continue;
        if (bitIndex < totalBits) {
          const codeword = codewords[bitIndex >>> 3] ?? 0;
          grid.dark[index] = (codeword >>> (7 - (bitIndex & 7))) & 1;
          bitIndex += 1;
        }
        // Remainder bits past the last codeword stay light (0).
      }
    }
  }
}

function setFunction(grid: QrGrid, x: number, y: number, dark: boolean): void {
  const index = y * grid.size + x;
  grid.dark[index] = dark ? 1 : 0;
  grid.reserved[index] = 1;
}
