// emit-raster — Phase F.2.b pure G-code emitter for an image-mode
// group. Takes the dither output (per-pixel S-values), the image's
// mm-bounds, and run parameters; returns deterministic GRBL G-code.
//
// Algorithm per ADR-020 Q1 (M4 hardcoded for image groups) + Q3
// (streaming threshold deferred — v1 emits a complete string):
//
//   - Preamble emits `M5` + `M4 S0` at the start of the group so the
//     controller flips into dynamic-power mode before the first burn.
//     Cut groups in the same job re-issue their own M3 at start; the
//     dispatcher (compile-job in F.2.d) is responsible for ordering.
//   - Each pixel row sweeps left-to-right (serpentine deferred — see
//     "Future improvements" below). Run-length compression: a G1
//     emits only when the dithered S changes from the previous pixel,
//     so a row of identical S values becomes one G1, and a checker
//     pattern becomes N G1s. The X coordinate on each G1 is the
//     RIGHT edge of the run — that's where the new S kicks in.
//   - Overscan: each row's rapid arrives `overscanMm` to the left of
//     bounds.minX, then sweeps past bounds.maxX by `overscanMm` with
//     S0 on the exit. Gives the head room to accelerate / decelerate
//     with the laser off so corners don't over-burn.
//   - S=0 pixels (white in the source) emit normally — they're part
//     of the sweep but the dynamic-power M4 controller automatically
//     keeps the diode dark when S=0.
//
// Pure-core compliant: no clock, no random, no I/O. Same input +
// same options → byte-identical G-code (determinism invariant #5).
//
// Future improvements (out of F.2.b v1):
//   - Serpentine alternation (every other row reversed). Cuts
//     bidirectional-travel time in half on tall images.
//   - Async-iterable emit for >100 KB jobs (ADR-020 Q3 threshold).
//   - Per-pixel feed modulation for grayscale-on-non-M4 controllers.

const DECIMAL_PLACES = 3;
const LINE_END = '\n';

function fmt(n: number): string {
  return n.toFixed(DECIMAL_PLACES);
}

export type EmitRasterInput = {
  // Dithered S-values, one per pixel, row-major. Length must equal
  // width * height. Each value is in [0, sMax] — the caller (the
  // dither module) has already applied the power scale.
  readonly sValues: Uint16Array;
  readonly width: number;
  readonly height: number;
  // World bounds of the image in mm. The image is rendered with its
  // top-left at (minX, minY) and bottom-right at (maxX, maxY); the
  // emitter does not apply any transform (the caller bakes that in).
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
  // Feed rate for raster G1s, in mm/min. Constant across the image —
  // M4 controllers modulate power, not speed.
  readonly feedMmPerMin: number;
  // Distance to overshoot at each row end, in mm. 5 mm is a typical
  // default for diode lasers; higher feeds want more. 0 disables.
  readonly overscanMm: number;
  // Optional comment fields written above the data for the operator
  // (and the job-time estimator). Same shape as grbl-strategy emits.
  readonly layerId?: string;
  readonly color?: string;
  readonly powerPercent?: number;
};

export function emitRasterGroup(input: EmitRasterInput): string {
  validate(input);
  const chunks: string[] = [];
  chunks.push(headerComment(input));
  // M5 first so we don't get stuck in M3 from a preceding cut group.
  // Then M4 S0 to arm dynamic-power mode at zero output.
  chunks.push('M5');
  chunks.push('M4 S0');
  const feed = Math.round(input.feedMmPerMin);
  const pixelWidthMm = (input.bounds.maxX - input.bounds.minX) / input.width;
  const pixelHeightMm = (input.bounds.maxY - input.bounds.minY) / input.height;
  let isFirstSweep = true;
  // Body — one row at a time. Two optimizations on top of the naive
  // "sweep every row across the full width" version:
  //   1. Skip rows whose pixels are all S=0. They contribute zero
  //      burn and would otherwise force the head to sweep at feed
  //      across width mm of nothing. For a 200×100 mm banner with
  //      80% of its rows blank, this drops engrave time ~5×.
  //   2. For non-empty rows, clip the sweep to the active span
  //      (first non-zero pixel to last non-zero pixel) plus overscan
  //      on each side. Skipping leading/trailing all-zero pixels
  //      means the head only burns travel where pixels actually exist.
  // The G0 rapid between rows handles arbitrarily-large Y jumps when
  // we skip a band of empty rows — the controller plans an oblique
  // travel from the end of one active row to the start of the next.
  for (let y = 0; y < input.height; y += 1) {
    const span = activeSpan(input, y);
    if (span === null) continue; // all-zero row → skip entirely
    const worldY = input.bounds.minY + (y + 0.5) * pixelHeightMm;
    chunks.push(emitRow(input, y, worldY, pixelWidthMm, feed, isFirstSweep, span));
    isFirstSweep = false;
  }
  // Trailing M5 so any subsequent cut group starts from a known
  // mode-off state. The cut group will re-issue its own M3.
  chunks.push('M5');
  return chunks.join(LINE_END) + LINE_END;
}

// Returns the [firstX, lastX] inclusive column range with any S>0
// pixel, or null if the entire row is S=0. Scanning twice (forward
// then backward) is O(width) — same as one linear scan plus negligible
// constant, and reads cleaner than threading both extents through one
// pass.
type ActiveSpan = { readonly firstX: number; readonly lastX: number };
function activeSpan(input: EmitRasterInput, y: number): ActiveSpan | null {
  const rowStart = y * input.width;
  let firstX = -1;
  for (let i = 0; i < input.width; i += 1) {
    if ((input.sValues[rowStart + i] ?? 0) !== 0) {
      firstX = i;
      break;
    }
  }
  if (firstX === -1) return null;
  let lastX = input.width - 1;
  for (let i = input.width - 1; i >= firstX; i -= 1) {
    if ((input.sValues[rowStart + i] ?? 0) !== 0) {
      lastX = i;
      break;
    }
  }
  return { firstX, lastX };
}

function emitRow(
  input: EmitRasterInput,
  y: number,
  worldY: number,
  pixelWidthMm: number,
  feed: number,
  isFirstSweep: boolean,
  span: ActiveSpan,
): string {
  const lines: string[] = [];
  // Sweep extents are the ACTIVE span's pixel edges plus overscan,
  // not the full image bounds. For a row with content only in cols
  // 40..60 of a 200-col image, the head only visits world X from
  // (minX + 40*pw - overscan) to (minX + 61*pw + overscan).
  const activeStartX = input.bounds.minX + span.firstX * pixelWidthMm;
  const activeEndX = input.bounds.minX + (span.lastX + 1) * pixelWidthMm;
  const startX = activeStartX - input.overscanMm;
  const endX = activeEndX + input.overscanMm;
  // Rapid into the overscan zone, laser off (M4 + S0 → diode dark).
  lines.push(`G0 X${fmt(startX)} Y${fmt(worldY)} S0`);
  let prevS = -1;
  // Sweep runs within the active span. Start the run accounting at
  // firstX so we don't waste G1s on the leading zeros we just
  // overscan-rapid'd past.
  let runStartIdx = span.firstX;
  let runS = input.sValues[y * input.width + span.firstX] ?? 0;
  for (let i = span.firstX + 1; i <= span.lastX; i += 1) {
    const cellS = input.sValues[y * input.width + i] ?? 0;
    if (cellS !== runS) {
      const runEndX = input.bounds.minX + i * pixelWidthMm;
      lines.push(
        formatRunG1(runEndX, runS, prevS, feed, isFirstSweep && runStartIdx === span.firstX),
      );
      prevS = runS;
      runStartIdx = i;
      runS = cellS;
    }
  }
  // Final run ends at the active-span end edge.
  lines.push(
    formatRunG1(activeEndX, runS, prevS, feed, isFirstSweep && runStartIdx === span.firstX),
  );
  // Exit overscan with S0 so the diode is dark during deceleration.
  lines.push(`G1 X${fmt(endX)} S0`);
  return lines.join(LINE_END);
}

// One G1 closing a run. Emits S only when it changed from the
// previous run (G-code is modal). Emits F only on the very first
// G1 of the whole raster — subsequent G1s inherit the feed.
function formatRunG1(
  x: number,
  s: number,
  prevS: number,
  feed: number,
  isVeryFirstG1: boolean,
): string {
  const parts: string[] = [`G1 X${fmt(x)}`];
  if (isVeryFirstG1) parts.push(`F${feed}`);
  if (s !== prevS) parts.push(`S${s}`);
  return parts.join(' ');
}

function headerComment(input: EmitRasterInput): string {
  const layer = input.layerId ?? '?';
  const color = input.color ?? '?';
  const power = input.powerPercent ?? '?';
  return [
    `; image layer ${layer} color ${color} power ${power}%`,
    `; ${input.width} × ${input.height} px, ${fmt(input.bounds.maxX - input.bounds.minX)} × ${fmt(input.bounds.maxY - input.bounds.minY)} mm`,
    `; feed ${Math.round(input.feedMmPerMin)} mm/min, overscan ${fmt(input.overscanMm)} mm`,
  ].join(LINE_END);
}

function validate(input: EmitRasterInput): void {
  if (input.width <= 0 || input.height <= 0) {
    throw new Error(`emitRasterGroup: invalid dimensions ${input.width}×${input.height}`);
  }
  if (input.sValues.length !== input.width * input.height) {
    throw new Error(
      `emitRasterGroup: sValues length ${input.sValues.length} does not match ${input.width}×${input.height}`,
    );
  }
  if (input.bounds.maxX <= input.bounds.minX || input.bounds.maxY <= input.bounds.minY) {
    throw new Error('emitRasterGroup: bounds must be positive');
  }
  if (input.feedMmPerMin <= 0) {
    throw new Error('emitRasterGroup: feedMmPerMin must be > 0');
  }
  if (input.overscanMm < 0) {
    throw new Error('emitRasterGroup: overscanMm must be >= 0');
  }
}
