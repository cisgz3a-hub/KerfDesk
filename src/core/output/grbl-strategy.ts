// GrblStrategy — emits deterministic GRBL v1.1+ G-code for a Job.
//
// Invariants enforced at emit time (PROJECT.md non-negotiables):
//   #3 Laser-off on travel: every G0 line carries `S0`.
//   #5 Deterministic output: fixed decimal precision, LF line endings,
//      indexed iteration (no Set/Map iteration order).
//   #7 Power scale honest: S = round((power/100) * device.maxPowerS).
//
// Preamble:  G21 (mm), G90 (absolute), M5 (laser off).
// Postamble: M5, then `G0 X0 Y0 S0` to park at origin.

import type { DeviceProfile } from '../devices';
import { effectiveOverscanMm, expandFillHatchWithOverscan } from '../job/fill-overscan';
import { groupFillSweeps, type FillSpan, type FillSweep } from '../job/fill-sweeps';
import type { CutGroup, CutSegment, FillGroup, Group, Job, RasterGroup } from '../job';
import { emitRasterGroup as emitRasterGroupGcode } from '../raster';
import { assertNever } from '../scene';
import type { OutputStrategy } from './output-strategy';

const DECIMAL_PLACES = 3;
const LINE_END = '\n';

function fmt(n: number): string {
  return n.toFixed(DECIMAL_PLACES);
}

function scaleS(powerPercent: number, maxPowerS: number): number {
  return Math.round((powerPercent / 100) * maxPowerS);
}

function preamble(): string {
  // M3 S0: enable spindle/laser at power 0. Subsequent G1 with S>0 fires the
  // laser without needing another M3. Without M3 in the preamble, GRBL
  // controllers that aren't in laser mode ($32=0) won't fire the diode even
  // when G1 carries S>0 — the move happens but the beam stays off. M3 S0 is
  // safe (no power) and primes the controller for any subsequent S-driven
  // cutting move.
  return ['G21', 'G90', 'M3 S0'].join(LINE_END) + LINE_END;
}

function postamble(): string {
  // M5: definitively turn the spindle/laser off at end of job, then park.
  return ['M5', 'G0 X0.000 Y0.000 S0'].join(LINE_END) + LINE_END;
}

function emitSegment(seg: CutSegment, s: number, feed: number): string {
  const lines: string[] = [];
  const first = seg.polyline[0];
  if (first === undefined) {
    return '';
  }
  // Rapid to start with laser off.
  lines.push(`G0 X${fmt(first.x)} Y${fmt(first.y)} S0`);
  // First G1 carries F and S; subsequent G1s inherit.
  for (let i = 1; i < seg.polyline.length; i += 1) {
    const pt = seg.polyline[i];
    if (pt === undefined) continue;
    if (i === 1) {
      lines.push(`G1 X${fmt(pt.x)} Y${fmt(pt.y)} F${feed} S${s}`);
    } else {
      lines.push(`G1 X${fmt(pt.x)} Y${fmt(pt.y)}`);
    }
  }
  return lines.join(LINE_END) + LINE_END;
}

function emitGroup(group: CutGroup, device: DeviceProfile): string {
  const s = scaleS(group.power, device.maxPowerS);
  const feed = Math.round(group.speed);
  const chunks: string[] = [];
  chunks.push(
    `; layer ${group.layerId} color ${group.color} power ${group.power}% speed ${feed} mm/min passes ${group.passes}`,
  );
  for (let p = 0; p < group.passes; p += 1) {
    chunks.push(`; pass ${p + 1} of ${group.passes}`);
    for (const seg of group.segments) {
      const segText = emitSegment(seg, s, feed);
      if (segText.length > 0) chunks.push(segText.replace(/\n$/, ''));
    }
  }
  return chunks.join(LINE_END) + LINE_END;
}

function emitFillGroup(group: FillGroup, device: DeviceProfile): string {
  const s = scaleS(group.power, device.maxPowerS);
  const feed = Math.round(group.speed);
  const chunks: string[] = [];
  chunks.push(
    `; fill layer ${group.layerId} color ${group.color} power ${group.power}% speed ${feed} mm/min passes ${group.passes} overscan ${fmt(group.overscanMm)} mm`,
  );
  // Each scanline's runs become ONE continuous laser-on sweep: a single G1
  // pass across the row that blanks the interior gaps (holes) with S0 instead
  // of lifting to a rapid and stopping at every run. This is the structural
  // fill-speed fix (ADR-034) — it matches how emit-raster.ts sweeps a row and
  // how LightBurn fills, collapsing thousands of short stop-start runs into a
  // few hundred continuous sweeps. Single-run scanlines emit exactly as before
  // (1a rapid runway + 1b short-run skip preserved).
  const sweeps = groupFillSweeps(group.segments);
  for (let p = 0; p < group.passes; p += 1) {
    chunks.push(`; pass ${p + 1} of ${group.passes}`);
    for (const sweep of sweeps) {
      const text = emitFillSweep(sweep, s, feed, group.overscanMm);
      if (text.length > 0) chunks.push(text);
    }
  }
  return chunks.join(LINE_END) + LINE_END;
}

// One scanline as a continuous sweep. Rapid into the optional overscan runway
// with the laser off (reusing the 1a/1b lead geometry + short-run skip), then a
// single chain of G1s: each ink span burns at S{s}, each interior gap crosses
// at S0 (diode dark, head still at feed so it never stops over a hole). G-code
// S is modal, so every span re-asserts its value — a missed S0 would fire the
// beam across a hole, so the per-segment S sequence is asserted exhaustively in
// the tests.
function emitFillSweep(sweep: FillSweep, s: number, feed: number, overscanMm: number): string {
  const spans = sweep.spans;
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (first === undefined || last === undefined) return '';
  const overscan = effectiveOverscanMm([first.start, last.end], overscanMm);
  const run = expandFillHatchWithOverscan([first.start, last.end], overscan);
  if (run === null) return '';
  const lines: string[] = [`G0 X${fmt(run.leadStart.x)} Y${fmt(run.leadStart.y)} S0`];
  if (overscan > 0) {
    lines.push(`G0 X${fmt(run.burnStart.x)} Y${fmt(run.burnStart.y)} S0`);
  }
  for (const line of sweepSpanLines(spans, s, feed)) lines.push(line);
  if (overscan > 0) {
    lines.push(`G0 X${fmt(run.leadEnd.x)} Y${fmt(run.leadEnd.y)} S0`);
  }
  return lines.join(LINE_END);
}

// The G1 chain for one sweep: burn each ink span (S{s}), blank each interior
// gap (S0). F rides only the first G1 (modal). The runway is always a G0, so
// the first G1 is always the first ink span.
function sweepSpanLines(spans: ReadonlyArray<FillSpan>, s: number, feed: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (span === undefined) continue;
    const burn = `G1 X${fmt(span.end.x)} Y${fmt(span.end.y)}`;
    lines.push(i === 0 ? `${burn} F${feed} S${s}` : `${burn} S${s}`);
    const next = spans[i + 1];
    if (next !== undefined) {
      lines.push(`G1 X${fmt(next.start.x)} Y${fmt(next.start.y)} S0`);
    }
  }
  return lines;
}

// F.2.d: raster groups emit through the dedicated raster path
// (emit-raster.ts), which handles the M4 flip + per-pixel S
// modulation. The strategy stays one-arm-per-kind so adding new
// group types lights up the exhaustiveness check.
function emitRasterGroupHere(group: RasterGroup): string {
  return emitRasterGroupGcode({
    sValues: group.sValues,
    width: group.pixelWidth,
    height: group.pixelHeight,
    bounds: group.bounds,
    feedMmPerMin: group.speed,
    passes: group.passes,
    overscanMm: group.overscanMm,
    layerId: group.layerId,
    color: group.color,
    powerPercent: group.power,
  });
}

function emitAnyGroup(group: Group, device: DeviceProfile): string {
  switch (group.kind) {
    case 'cut':
      return emitGroup(group, device);
    case 'fill':
      return emitFillGroup(group, device);
    case 'raster':
      return emitRasterGroupHere(group);
    default:
      return assertNever(group, 'Group');
  }
}

function emitJob(job: Job, device: DeviceProfile): string {
  const parts: string[] = [];
  parts.push(preamble());
  let previousKind: Group['kind'] | null = null;
  for (const group of job.groups) {
    if ((group.kind === 'cut' || group.kind === 'fill') && previousKind === 'raster') {
      parts.push('M3 S0' + LINE_END);
    }
    parts.push(emitAnyGroup(group, device));
    previousKind = group.kind;
  }
  parts.push(postamble());
  return parts.join('');
}

export const grblStrategy: OutputStrategy = {
  id: 'grbl',
  emit: emitJob,
};
