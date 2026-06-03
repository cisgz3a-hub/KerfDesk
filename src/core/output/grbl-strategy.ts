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
  for (let p = 0; p < group.passes; p += 1) {
    chunks.push(`; pass ${p + 1} of ${group.passes}`);
    for (const seg of group.segments) {
      // The overscan lead-in/lead-out are laser-off runway — emit them as G0
      // rapids, not G1 at the cutting feed (audit 2026-06-03). GRBL still
      // decelerates to the burn feed by burnStart (collinear junction), so the
      // burn span stays at constant speed — overscan's edge-quality purpose is
      // intact. The burn G1 carries F explicitly: the lead-in is a G0, so it no
      // longer establishes the modal feed. Every G0 keeps S0 (PROJECT.md #3).
      //
      // Short runs skip the runway entirely (effectiveOverscanMm → 0): on those
      // the 2×overscan runway would exceed the burn, and a traced fill is mostly
      // such runs. With overscan 0 the lead points collapse onto the burn ends,
      // so only the seek-to-burnStart G0 and the burn G1 are emitted.
      const overscan = effectiveOverscanMm(seg.polyline, group.overscanMm);
      const run = expandFillHatchWithOverscan(seg.polyline, overscan);
      if (run === null) continue;
      chunks.push(`G0 X${fmt(run.leadStart.x)} Y${fmt(run.leadStart.y)} S0`);
      if (overscan > 0) {
        chunks.push(`G0 X${fmt(run.burnStart.x)} Y${fmt(run.burnStart.y)} S0`);
      }
      chunks.push(`G1 X${fmt(run.burnEnd.x)} Y${fmt(run.burnEnd.y)} F${feed} S${s}`);
      if (overscan > 0) {
        chunks.push(`G0 X${fmt(run.leadEnd.x)} Y${fmt(run.leadEnd.y)} S0`);
      }
    }
  }
  return chunks.join(LINE_END) + LINE_END;
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
