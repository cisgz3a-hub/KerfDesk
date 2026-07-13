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
// Preamble:  G21, G90, G54, G94, G0 Z<safe>, M3 S<rpm>, G4 P<spinup>, [M7/M8].
// Postamble: G0 Z<safe>, M5, [M9], G0 X0 Y0 (park, still at safe Z).
// The M7/M8/M9 coolant lines appear only when the machine's coolant is on.
//
// Optimization kept deliberately simple and safe: when the next pass plunges
// at the SAME XY the head is already at (successive depth passes of a closed
// contour), the retract + rapid pair is skipped and the bit feeds straight
// down to the next level.

import type { DeviceProfile } from '../devices';
import {
  circularArcGeometry,
  isCircularArcFullCircle,
  sampleCircularArcPoints,
} from '../geometry/circular-arc';
import type {
  CncArcPass,
  CncContourPass,
  CncGroup,
  CncHelicalContourPass,
  CncPass,
  CncPath3dPass,
  Job,
} from '../job';
import { assertNever, type CncCoolantMode } from '../scene';
import { prepareHelicalMotion, type PreparedHelicalMotion } from './cnc-grbl-helical';
import type { OutputStrategy } from './output-strategy';
import { TOOL_CHANGE_LOAD_PREFIX } from './tool-change-labels';

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

  // Multi-tool jobs (H.7) get M0 change blocks between bit sections; a
  // single-tool job emits byte-identically to pre-H.7 output.
  const isMultiTool = new Set(cncGroups.map((group) => group.toolId ?? '')).size > 1;

  const lines: string[] = [];
  const head: Head = { x: null, y: null, z: null };
  lines.push('G21');
  lines.push('G90');
  // G54 is KerfDesk's canonical WCS. GRBL's active G54-G59 selection is
  // modal and may be changed by a console command or startup block, so never
  // let a stale G55-G59 redirect an otherwise valid program.
  lines.push('G54');
  lines.push('G94');
  if (isMultiTool && firstGroup.toolName !== undefined) {
    lines.push(`; tool: ${firstGroup.toolName} (load before starting)`);
  }
  // Lift to safe height BEFORE the spindle spins up: after Z touch-off the
  // bit is resting on the stock top, and starting the spindle there burns
  // the stock and can grab (Easel's post lifts first, then M3).
  appendSpindleStart(
    lines,
    head,
    firstGroup.safeZMm,
    firstGroup.spindleRpm,
    firstGroup.spindleSpinupSec,
  );
  // Coolant is machine-wide for the job: turn it on right after the spindle
  // spins up (never while the bit is still resting on the stock during
  // touch-off), and off at job end after M5. 'off'/absent emits nothing, so
  // output stays byte-identical to a job with no coolant.
  const coolantIsOn = appendCoolantStart(lines, firstGroup.coolant);

  const state: EmitState = {
    isMultiTool,
    currentRpm: firstGroup.spindleRpm,
    currentToolKey: firstGroup.toolId ?? '',
    maxSafeZ: 0,
  };
  for (const group of cncGroups) {
    appendGroupTransition(lines, head, group, state);
    appendGroup(lines, head, group);
  }

  appendPostamble(lines, head, state.maxSafeZ, cncGroups[cncGroups.length - 1], coolantIsOn);
  return lines.join(LINE_END) + LINE_END;
}

// Job end: retract to the highest safe Z any group used, stop the spindle,
// turn coolant off (mirror of the spindle-up ordering — M9 only when a coolant
// was actually turned on), and park.
function appendPostamble(
  lines: string[],
  head: Head,
  maxSafeZ: number,
  lastGroup: CncGroup | undefined,
  coolantIsOn: boolean,
): void {
  appendRetract(lines, head, maxSafeZ);
  lines.push('M5');
  if (coolantIsOn) lines.push('M9');
  lines.push(parkLine(lastGroup));
}

// Emit the coolant-on command for the machine's mode and report whether one was
// emitted (so the postamble knows to close it with M9). 'off'/absent emits
// nothing and returns false — byte-identical to a job with no coolant.
function appendCoolantStart(lines: string[], mode: CncCoolantMode | undefined): boolean {
  const command = cncCoolantOnCommand(mode);
  if (command === null) return false;
  lines.push(command);
  return true;
}

// Coolant-on command for the machine's mode: mist runs the mist-coolant
// relay (M7), flood the flood-coolant relay (M8). 'off'/absent ⇒ null.
function cncCoolantOnCommand(mode: CncCoolantMode | undefined): 'M7' | 'M8' | null {
  switch (mode) {
    case 'mist':
      return 'M7';
    case 'flood':
      return 'M8';
    case 'off':
    case undefined:
      return null;
    default:
      return assertNever(mode, 'CncCoolantMode');
  }
}

// H.9 parking parity: the configured park position, or the machine origin
// (the pre-H.9 default — keeps existing output byte-identical).
function parkLine(group: CncGroup | undefined): string {
  return `G0 X${fmt(group?.parkXMm ?? 0)} Y${fmt(group?.parkYMm ?? 0)}`;
}

type EmitState = {
  isMultiTool: boolean;
  currentRpm: number;
  currentToolKey: string;
  maxSafeZ: number;
};

// Between-group transitions: an M0 tool-change block when the bit changes
// (multi-tool jobs only), else a spindle re-start when only the RPM does.
function appendGroupTransition(
  lines: string[],
  head: Head,
  group: CncGroup,
  state: EmitState,
): void {
  state.maxSafeZ = Math.max(state.maxSafeZ, group.safeZMm);
  if (state.isMultiTool && (group.toolId ?? '') !== state.currentToolKey) {
    appendToolChange(lines, head, group, state.maxSafeZ);
    state.currentToolKey = group.toolId ?? '';
    state.currentRpm = group.spindleRpm;
    return;
  }
  if (group.spindleRpm !== state.currentRpm) {
    appendSpindleStart(lines, head, group.safeZMm, group.spindleRpm, group.spindleSpinupSec);
    state.currentRpm = group.spindleRpm;
  }
}

// The manual GRBL tool-change flow (F-CNC14/15): retract, spindle off,
// park at the front for bit access, M0 pause. The operator swaps the bit,
// re-zeros Z on the stock top (the new bit's length differs), and
// continues. Touch-off leaves the new bit at Z0 on the stock, so the first
// resumed command lifts to safe Z with the spindle off; only then may M3 run.
function appendToolChange(lines: string[], head: Head, group: CncGroup, safeZMm: number): void {
  appendRetract(lines, head, safeZMm);
  lines.push('M5');
  lines.push(parkLine(group));
  head.x = fmt(group.parkXMm ?? 0);
  head.y = fmt(group.parkYMm ?? 0);
  lines.push(`${TOOL_CHANGE_LOAD_PREFIX}${group.toolName ?? 'next tool'}`);
  lines.push('; re-zero Z on the stock top, then cycle-start to resume');
  lines.push('M0');
  // The operator physically moved Z during the pause (touch-off leaves the
  // new bit at the stock top), so the tracked height is no longer real.
  head.z = null;
  appendSpindleStart(lines, head, safeZMm, group.spindleRpm, group.spindleSpinupSec);
}

// Central spindle-start invariant: every native CNC M3 is preceded by a known
// safe-Z retract. This is especially important after a manual tool touch-off,
// where the new cutter is resting on the stock when Continue is pressed.
function appendSpindleStart(
  lines: string[],
  head: Head,
  safeZMm: number,
  rpm: number,
  spinupSec: number,
): void {
  appendRetract(lines, head, safeZMm);
  lines.push(`M3 S${Math.max(0, Math.round(rpm))}`);
  // This is deliberately time-based. Stock GRBL's FS value reflects its
  // commanded/limited spindle output, not tachometer-backed physical RPM.
  // CNC preflight rejects non-positive durations before output can be written.
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
  switch (pass.kind) {
    case 'contour':
      appendContourPass(lines, head, pass, safeZMm, feed, plunge);
      break;
    case 'path3d':
      appendPath3dPass(lines, head, pass, safeZMm, feed, plunge);
      break;
    case 'arc':
      appendArcPass(lines, head, pass, safeZMm, feed, plunge);
      break;
    case 'helical-contour':
      appendHelicalContourPass(lines, head, pass, safeZMm, feed, plunge);
      break;
    default:
      assertNever(pass, 'CncPass');
  }
}

function appendHelicalContourPass(
  lines: string[],
  head: Head,
  pass: CncHelicalContourPass,
  safeZMm: number,
  feed: number,
  plunge: number,
): void {
  const prepared = prepareHelicalMotion(pass, plunge);
  if (prepared === null) return;
  positionForHelix(lines, head, prepared, safeZMm, plunge);
  lines.push(...prepared.arcLines);
  head.z = prepared.finalZ;
  linkHelixToContour(lines, head, prepared, feed);
  appendCutMoves(
    lines,
    head,
    { kind: 'contour', zMm: pass.zMm, polyline: pass.polyline, closed: pass.closed },
    feed,
  );
}

function positionForHelix(
  lines: string[],
  head: Head,
  prepared: PreparedHelicalMotion,
  safeZMm: number,
  plunge: number,
): void {
  appendRetract(lines, head, safeZMm);
  if (head.x !== prepared.startX || head.y !== prepared.startY) {
    lines.push(`G0 X${prepared.startX} Y${prepared.startY}`);
    head.x = prepared.startX;
    head.y = prepared.startY;
  }
  if (head.z !== prepared.startZ) {
    lines.push(`G1 Z${prepared.startZ} F${plunge}`);
    head.z = prepared.startZ;
  }
}

function linkHelixToContour(
  lines: string[],
  head: Head,
  prepared: PreparedHelicalMotion,
  feed: number,
): void {
  const contourStartX = fmt(prepared.first.x);
  const contourStartY = fmt(prepared.first.y);
  if (head.x !== contourStartX || head.y !== contourStartY) {
    lines.push(`G1 X${contourStartX} Y${contourStartY} F${feed}`);
    head.x = contourStartX;
    head.y = contourStartY;
  }
}

function appendContourPass(
  lines: string[],
  head: Head,
  pass: CncContourPass,
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

// arc: same retract/rapid/plunge discipline as a contour pass, then a native
// G2/G3 move when the radius is valid. Invalid arcs fall back to sampled G1
// motion so output stays controller-safe.
function appendArcPass(
  lines: string[],
  head: Head,
  pass: CncArcPass,
  safeZMm: number,
  feed: number,
  plunge: number,
): void {
  if (!Number.isFinite(pass.zMm)) return;
  const polyline = sampleCircularArcPoints(pass);
  const first = polyline[0];
  if (first === undefined || polyline.length < 2) return;
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

  const geometry = circularArcGeometry(pass);
  const endX = fmt(pass.end.x);
  const endY = fmt(pass.end.y);
  const formattedEndEqualsStart = endX === startX && endY === startY;
  if (geometry.kind === 'ok' && (!formattedEndEqualsStart || isCircularArcFullCircle(pass))) {
    const direction = pass.clockwise ? 'G2' : 'G3';
    const i = fmt(pass.center.x - pass.start.x);
    const j = fmt(pass.center.y - pass.start.y);
    lines.push(`${direction} X${endX} Y${endY} I${i} J${j} F${feed}`);
    head.x = endX;
    head.y = endY;
    return;
  }

  appendCutMoves(
    lines,
    head,
    { kind: 'contour', zMm: pass.zMm, polyline, closed: pass.closed },
    feed,
  );
}

// path3d: same retract/rapid/plunge discipline as a contour pass, then
// per-vertex XYZ feed moves. Plunge targets the FIRST vertex's Z; every
// in-cut Z change after that rides a G1 at the cutting feed (never a rapid),
// so findPlungedTravelIssues holds by construction.
function appendPath3dPass(
  lines: string[],
  head: Head,
  pass: CncPath3dPass,
  safeZMm: number,
  feed: number,
  plunge: number,
): void {
  const first = pass.points[0];
  if (first === undefined || pass.points.length < 2) return;
  const startX = fmt(first.x);
  const startY = fmt(first.y);
  const startZ = fmt(first.z);

  const alreadyAtStartXy = head.x === startX && head.y === startY;
  if (!alreadyAtStartXy) {
    appendRetract(lines, head, safeZMm);
    lines.push(`G0 X${startX} Y${startY}`);
    head.x = startX;
    head.y = startY;
  }
  if (head.z !== startZ) {
    lines.push(`G1 Z${startZ} F${plunge}`);
    head.z = startZ;
  }
  appendPath3dCutMoves(lines, head, pass, feed, plunge);
}

function appendPath3dCutMoves(
  lines: string[],
  head: Head,
  pass: CncPath3dPass,
  feed: number,
  plunge: number,
): void {
  let modalFeed: number | null = null;
  for (let i = 1; i < pass.points.length; i += 1) {
    const point = pass.points[i];
    if (point === undefined) continue;
    const x = fmt(point.x);
    const y = fmt(point.y);
    const z = fmt(point.z);
    if (x === head.x && y === head.y && z === head.z) continue; // zero-length at emit precision
    // Pure-vertical segments (a ramp longer than its path ends with a
    // same-XY descent) ride the plunge feed, never the XY cutting feed; the
    // cutting feed is re-issued on the next lateral move.
    const wantFeed = x === head.x && y === head.y ? plunge : feed;
    const feedWord = modalFeed === wantFeed ? '' : ` F${wantFeed}`;
    modalFeed = wantFeed;
    lines.push(`G1 X${x} Y${y} Z${z}${feedWord}`);
    head.x = x;
    head.y = y;
    head.z = z;
  }
}

function appendCutMoves(lines: string[], head: Head, pass: CncContourPass, feed: number): void {
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
