// CncGrblStrategy — emits deterministic GRBL v1.1 G-code for a CNC (router)
// Job of CncGroups.
//
// Motion contract (the CNC analog of the laser-off-on-travel invariant):
//   * Every XY rapid (G0 with X/Y) happens with Z parked at the group's safe
//     height. The emitter retracts before any XY travel, by construction.
//   * Plunges are always G1 at the plunge feed — never rapids.
//   * A rapid never targets Z below the safe height.
// checked again post-emit by findPlungedTravelIssues (core/invariants).
//
// Coordinates: Z0 = stock top (operator zeros the bit on the stock before
// running); XY follow the same machine coordinates as the laser pipeline.
// S maps to spindle RPM — GRBL $30 should equal the machine's max RPM.
//
// Preamble:  G21, G90, G94, M3 S<rpm>, G4 P<spinup>, G0 Z<safe>.
// Postamble: G0 Z<safe>, M5, G0 X0 Y0 (park, still at safe Z).
//
// Optimization kept deliberately simple and safe: when the next pass plunges
// at the SAME XY the head is already at (successive depth passes of a closed
// contour), the retract + rapid pair is skipped and the bit feeds straight
// down to the next level.

import type { DeviceProfile } from '../devices';
import type { CncGroup, CncPass, Job } from '../job';
import { assertNever } from '../scene';
import type { OutputStrategy } from './output-strategy';

const DECIMAL_PLACES = 3;
const LINE_END = '\n';
const MIN_FEED_MM_PER_MIN = 1;

type Head = {
  x: string | null; // formatted coords — compared at emit precision
  y: string | null;
  z: string | null;
};

function fmt(n: number): string {
  return n.toFixed(DECIMAL_PLACES);
}

function fmtFeed(feedMmPerMin: number): number {
  return Math.max(MIN_FEED_MM_PER_MIN, Math.round(feedMmPerMin));
}

function emitJob(job: Job, _device: DeviceProfile): string {
  const cncGroups: CncGroup[] = [];
  for (const group of job.groups) {
    switch (group.kind) {
      case 'cnc':
        cncGroups.push(group);
        break;
      case 'cut':
      case 'fill':
      case 'raster':
        // Laser groups never belong in a CNC job; emit-gcode routes them to
        // grblStrategy. Reaching here means a pipeline bug — drop loudly.
        break;
      default:
        assertNever(group, 'Group');
    }
  }
  const firstGroup = cncGroups[0];
  if (firstGroup === undefined) return '';

  const lines: string[] = [];
  lines.push('G21');
  lines.push('G90');
  lines.push('G94');
  appendSpindleStart(lines, firstGroup.spindleRpm, firstGroup.spindleSpinupSec);

  const head: Head = { x: null, y: null, z: null };
  let currentRpm = firstGroup.spindleRpm;
  let maxSafeZ = 0;
  for (const group of cncGroups) {
    maxSafeZ = Math.max(maxSafeZ, group.safeZMm);
    if (group.spindleRpm !== currentRpm) {
      appendRetract(lines, head, group.safeZMm);
      appendSpindleStart(lines, group.spindleRpm, group.spindleSpinupSec);
      currentRpm = group.spindleRpm;
    }
    appendGroup(lines, head, group);
  }

  appendRetract(lines, head, maxSafeZ);
  lines.push('M5');
  lines.push('G0 X0.000 Y0.000');
  return lines.join(LINE_END) + LINE_END;
}

function appendSpindleStart(lines: string[], rpm: number, spinupSec: number): void {
  lines.push(`M3 S${Math.max(0, Math.round(rpm))}`);
  if (spinupSec > 0) lines.push(`G4 P${fmt(spinupSec)}`);
}

function appendGroup(lines: string[], head: Head, group: CncGroup): void {
  const feed = fmtFeed(group.feedMmPerMin);
  const plunge = fmtFeed(group.plungeMmPerMin);
  lines.push(
    `; cnc layer ${group.layerId} ${group.cutType} tool ${fmt(group.toolDiameterMm)} mm ` +
      `feed ${feed} plunge ${plunge} spindle ${Math.round(group.spindleRpm)} rpm ` +
      `passes ${group.passes.length}`,
  );
  for (const pass of group.passes) {
    appendPass(lines, head, pass, group.safeZMm, feed, plunge);
  }
}

function appendPass(
  lines: string[],
  head: Head,
  pass: CncPass,
  safeZMm: number,
  feed: number,
  plunge: number,
): void {
  const first = pass.polyline[0];
  if (first === undefined || pass.polyline.length < 2) return;
  const startX = fmt(first.x);
  const startY = fmt(first.y);
  const passZ = fmt(pass.zMm);

  const alreadyAtStartXy = head.x === startX && head.y === startY;
  if (!alreadyAtStartXy) {
    appendRetract(lines, head, safeZMm);
    lines.push(`G0 X${startX} Y${startY}`);
    head.x = startX;
    head.y = startY;
  }
  if (head.z !== passZ) {
    lines.push(`G1 Z${passZ} F${plunge}`);
    head.z = passZ;
  }
  appendCutMoves(lines, head, pass, feed);
}

function appendCutMoves(lines: string[], head: Head, pass: CncPass, feed: number): void {
  let feedEmitted = false;
  for (let i = 1; i < pass.polyline.length; i += 1) {
    const point = pass.polyline[i];
    if (point === undefined) continue;
    const x = fmt(point.x);
    const y = fmt(point.y);
    if (x === head.x && y === head.y) continue; // zero-length at emit precision
    const feedWord = feedEmitted ? '' : ` F${feed}`;
    feedEmitted = true;
    lines.push(`G1 X${x} Y${y}${feedWord}`);
    head.x = x;
    head.y = y;
  }
}

function appendRetract(lines: string[], head: Head, safeZMm: number): void {
  const safeZ = fmt(Math.max(0, safeZMm));
  if (head.z === safeZ) return;
  lines.push(`G0 Z${safeZ}`);
  head.z = safeZ;
}

export const cncGrblStrategy: OutputStrategy = {
  id: 'grbl-cnc',
  emit: emitJob,
};
