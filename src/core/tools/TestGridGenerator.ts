/**
 * @file TestGridGenerator.ts
 * @copyright (c) 2025 LaserForge. All rights reserved.
 *
 * Generates a power/speed test grid as G-code. Users burn the grid,
 * visually identify the best cell, and read off the power/speed values.
 *
 * Output pattern:
 *   - Grid of filled squares arranged in rows (power) and columns (speed)
 *   - Text labels along top (speeds) and left (powers)
 *   - Optional title text at top
 */

export interface TestGridOptions {
  /** Grid cell size in mm. */
  cellSizeMm: number;
  /** Gap between cells in mm. */
  cellGapMm: number;
  /** List of power values (S values) to test. Each becomes a row. */
  powers: number[];
  /** List of feed rates (mm/min) to test. Each becomes a column. */
  speeds: number[];
  /** Maximum S value the machine accepts. Typically $30. Default 1000. */
  maxSpindle: number;
  /** Starting origin X (bottom-left of grid), mm. */
  originX: number;
  /** Starting origin Y (bottom-left of grid), mm. */
  originY: number;
  /** Raster scan line interval inside each cell, mm. Smaller = more fill. */
  lineIntervalMm: number;
  /** Travel speed for rapid moves, mm/min. */
  travelSpeedMmPerMin: number;
  /** Include text labels for power/speed values. */
  includeLabels: boolean;
  /** Add passes (1 = single pass). */
  passes: number;
}

export const DEFAULT_TEST_GRID: TestGridOptions = {
  cellSizeMm: 10,
  cellGapMm: 2,
  powers: [100, 200, 400, 600, 800, 1000],
  speeds: [500, 1000, 1500, 2000, 3000, 6000],
  maxSpindle: 1000,
  originX: 10,
  originY: 10,
  lineIntervalMm: 0.2,
  travelSpeedMmPerMin: 6000,
  includeLabels: true,
  passes: 1,
};

/**
 * Generate the full G-code for a power/speed test grid.
 */
export function generateTestGrid(opts: TestGridOptions): string {
  const lines: string[] = [];

  lines.push('; LaserForge power/speed test grid');
  lines.push(`; Generated at ${new Date().toISOString()}`);
  lines.push(`; Grid: ${opts.powers.length} powers x ${opts.speeds.length} speeds`);
  lines.push(`; Cell size: ${opts.cellSizeMm}mm, interval: ${opts.lineIntervalMm}mm`);
  lines.push('G90 ; absolute positioning');
  lines.push('G21 ; mm units');
  lines.push('M4 S0 ; laser dynamic mode, off');

  const {
    cellSizeMm,
    cellGapMm,
    powers,
    speeds,
    originX,
    originY,
    lineIntervalMm,
    travelSpeedMmPerMin,
    includeLabels,
    passes,
    maxSpindle,
  } = opts;

  const labelMargin = includeLabels ? 6 : 0;
  const gridOriginX = originX + labelMargin;
  const gridOriginY = originY + labelMargin;

  for (let pIdx = 0; pIdx < powers.length; pIdx++) {
    const power = powers[pIdx];
    const clampedPower = Math.min(Math.max(power, 0), maxSpindle);
    const rowY = gridOriginY + pIdx * (cellSizeMm + cellGapMm);

    for (let sIdx = 0; sIdx < speeds.length; sIdx++) {
      const speed = speeds[sIdx];
      const colX = gridOriginX + sIdx * (cellSizeMm + cellGapMm);

      lines.push(`; Cell power=${power} speed=${speed}`);

      for (let pass = 0; pass < passes; pass++) {
        lines.push(
          ...fillCell(colX, rowY, cellSizeMm, lineIntervalMm, clampedPower, speed, travelSpeedMmPerMin),
        );
      }
    }
  }

  if (includeLabels) {
    lines.push('; --- Labels ---');
    lines.push(...drawAxisLabels(opts, gridOriginX, gridOriginY));
  }

  lines.push('M5 ; laser off');
  lines.push(`G0 X0 Y0 F${travelSpeedMmPerMin}`);
  lines.push('; End of test grid');

  return lines.join('\n');
}

/**
 * Fill one cell with horizontal scan lines (bidirectional for speed).
 */
function fillCell(
  x0: number,
  y0: number,
  size: number,
  interval: number,
  power: number,
  speed: number,
  travelSpeed: number,
): string[] {
  const out: string[] = [];
  const step = Math.max(interval, 0.05);
  let y = y0;
  let direction = 1;

  while (y <= y0 + size + 1e-6) {
    const startX = direction > 0 ? x0 : x0 + size;
    const endX = direction > 0 ? x0 + size : x0;
    out.push(`G0 X${startX.toFixed(3)} Y${y.toFixed(3)} F${travelSpeed}`);
    out.push(`G1 X${endX.toFixed(3)} F${speed} S${power}`);
    y += step;
    direction = -direction;
  }

  out.push('G1 S0');
  return out;
}

function drawAxisLabels(opts: TestGridOptions, gridOriginX: number, gridOriginY: number): string[] {
  const out: string[] = [];
  const { powers, speeds, cellSizeMm, cellGapMm, maxSpindle, travelSpeedMmPerMin } = opts;
  const labelPower = Math.round(maxSpindle * 0.2);
  const labelSpeed = 1500;
  const charSize = 2.5;

  const labelY = gridOriginY + powers.length * (cellSizeMm + cellGapMm) + 1;
  for (let sIdx = 0; sIdx < speeds.length; sIdx++) {
    const labelX = gridOriginX + sIdx * (cellSizeMm + cellGapMm) + cellSizeMm / 2 - 3;
    out.push(
      ...drawNumber(speeds[sIdx], labelX, labelY, charSize, labelPower, labelSpeed, travelSpeedMmPerMin),
    );
  }

  for (let pIdx = 0; pIdx < powers.length; pIdx++) {
    const labelX = gridOriginX - 5;
    const labelY = gridOriginY + pIdx * (cellSizeMm + cellGapMm) + cellSizeMm / 2 - 1;
    out.push(
      ...drawNumber(powers[pIdx], labelX, labelY, charSize, labelPower, labelSpeed, travelSpeedMmPerMin),
    );
  }

  return out;
}

function drawNumber(
  value: number,
  x: number,
  y: number,
  charSize: number,
  power: number,
  speed: number,
  travelSpeed: number,
): string[] {
  const out: string[] = [];
  const digits = Math.round(value).toString();
  const charWidth = charSize * 0.6;
  const charGap = charSize * 0.2;

  for (let i = 0; i < digits.length; i++) {
    const cx = x + i * (charWidth + charGap);
    out.push(...drawDigit(digits[i]!, cx, y, charSize, charWidth, power, speed, travelSpeed));
  }

  return out;
}

type Seg = { x1: number; y1: number; x2: number; y2: number };

function drawDigit(
  digit: string,
  x: number,
  y: number,
  h: number,
  w: number,
  power: number,
  speed: number,
  travelSpeed: number,
): string[] {
  const a: Seg = { x1: x, y1: y + h, x2: x + w, y2: y + h };
  const b: Seg = { x1: x + w, y1: y + h, x2: x + w, y2: y + h / 2 };
  const c: Seg = { x1: x + w, y1: y + h / 2, x2: x + w, y2: y };
  const d: Seg = { x1: x, y1: y, x2: x + w, y2: y };
  const e: Seg = { x1: x, y1: y + h / 2, x2: x, y2: y };
  const f: Seg = { x1: x, y1: y + h, x2: x, y2: y + h / 2 };
  const g: Seg = { x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2 };

  const SEGMENTS: Record<string, Seg[]> = {
    '0': [a, b, c, d, e, f],
    '1': [b, c],
    '2': [a, b, g, e, d],
    '3': [a, b, g, c, d],
    '4': [f, g, b, c],
    '5': [a, f, g, c, d],
    '6': [a, f, g, e, c, d],
    '7': [a, b, c],
    '8': [a, b, c, d, e, f, g],
    '9': [a, b, c, d, f, g],
  };

  const segs = SEGMENTS[digit] ?? [];
  const out: string[] = [];
  for (const s of segs) {
    out.push(`G0 X${s.x1.toFixed(3)} Y${s.y1.toFixed(3)} F${travelSpeed}`);
    out.push(`G1 X${s.x2.toFixed(3)} Y${s.y2.toFixed(3)} F${speed} S${power}`);
    out.push('G1 S0');
  }

  return out;
}

/**
 * Compute the full width of a test grid based on options.
 */
export function computeGridWidth(opts: TestGridOptions): number {
  const labelMargin = opts.includeLabels ? 6 : 0;
  return (
    labelMargin +
    opts.speeds.length * opts.cellSizeMm +
    (opts.speeds.length - 1) * opts.cellGapMm
  );
}

/**
 * Compute the full height of a test grid based on options.
 */
export function computeGridHeight(opts: TestGridOptions): number {
  const labelMargin = opts.includeLabels ? 6 : 0;
  const gridSize =
    opts.powers.length * opts.cellSizeMm + (opts.powers.length - 1) * opts.cellGapMm;
  return labelMargin + gridSize + 4;
}
