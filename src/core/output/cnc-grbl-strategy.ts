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
// Postamble: G0 Z<safe>, M5, [M9], G0 X<park> Y<park> (park, still at safe Z;
// the configured park position, a current-position job's own start, or X0 Y0).
// The M7/M8/M9 coolant lines appear only when the machine's coolant is on.
//
// Optimization kept deliberately simple and safe: when the next pass plunges
// at the SAME XY the head is already at (successive depth passes of a closed
// contour), the retract + rapid pair is skipped and the bit feeds straight
// down to the next level.
//
// The non-cutting transitions (spindle start, tool-change holds, park-target
// resolution) live in cnc-grbl-transitions.ts and the shared emit-head
// primitives in cnc-grbl-emit-head.ts (ADR-015 size cap); coolant is in
// cnc-grbl-coolant.ts.

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
import { assertNever } from '../scene';
import { appendCoolantStart } from './cnc-grbl-coolant';
import { appendRetract, fmt, fmtFeed, type Head } from './cnc-grbl-emit-head';
import { prepareHelicalMotion, type PreparedHelicalMotion } from './cnc-grbl-helical';
import { collectIndexedCncGroups } from './cnc-grbl-job-groups';
import {
  appendGroupTransition,
  appendSpindleStart,
  parkTarget,
  type EmitState,
} from './cnc-grbl-transitions';
import type { CncPassSpan, CncPassSpanEmission, CncPassSpanRecorder } from './cnc-pass-spans';
import type { OutputEmitOptions, OutputStrategy } from './output-strategy';

const LINE_END = '\n';

function emitJob(job: Job, device: DeviceProfile, options: OutputEmitOptions = {}): string {
  return emitCncProgram(job, device, undefined, options);
}

/** Emit the ordinary deterministic CNC program while also reporting, for every
 * pass that produced at least one line, its raw-line span in that program.
 * Recording is observation only: the G-code is byte-identical to
 * `cncGrblStrategy.emit` for the same job AND the same emit options — a
 * current-position job's finishPosition changes its park lines, so resume
 * mapping must re-emit with the run's own options (ADR-215). */
export function emitCncJobWithPassSpans(
  job: Job,
  device: DeviceProfile,
  options: OutputEmitOptions = {},
): CncPassSpanEmission {
  const spans: CncPassSpan[] = [];
  const gcode = emitCncProgram(
    job,
    device,
    (span) => {
      spans.push(span);
    },
    options,
  );
  return { gcode, spans };
}

function emitCncProgram(
  job: Job,
  _device: DeviceProfile,
  onPassSpan: CncPassSpanRecorder | undefined,
  options: OutputEmitOptions,
): string {
  // Groups keep their Job.groups indices: pass spans must speak the job's own
  // indices so recovery can slice the same Job it reviewed.
  const cncGroups = collectIndexedCncGroups(job);
  const firstGroup = cncGroups[0]?.group;
  if (firstGroup === undefined) return '';

  // Multi-tool jobs (H.7) get M0 change blocks between bit sections; a
  // single-tool job emits byte-identically to pre-H.7 output.
  const isMultiTool = new Set(cncGroups.map(({ group }) => group.toolId ?? '')).size > 1;

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
    finish: options.finishPosition,
  };
  for (const { group, jobGroupIndex } of cncGroups) {
    appendGroupTransition(lines, head, group, state);
    appendGroup(lines, head, group, jobGroupIndex, onPassSpan);
  }

  appendPostamble(lines, head, state, cncGroups[cncGroups.length - 1]?.group, coolantIsOn);
  return lines.join(LINE_END) + LINE_END;
}

// Job end: retract to the highest safe Z any group used, stop the spindle,
// turn coolant off (mirror of the spindle-up ordering — M9 only when a coolant
// was actually turned on), and park.
function appendPostamble(
  lines: string[],
  head: Head,
  state: EmitState,
  lastGroup: CncGroup | undefined,
  coolantIsOn: boolean,
): void {
  appendRetract(lines, head, state.maxSafeZ);
  lines.push('M5');
  if (coolantIsOn) lines.push('M9');
  const park = parkTarget(lastGroup, state.finish);
  lines.push(`G0 X${fmt(park.x)} Y${fmt(park.y)}`);
}

function appendGroup(
  lines: string[],
  head: Head,
  group: CncGroup,
  jobGroupIndex: number,
  onPassSpan: CncPassSpanRecorder | undefined,
): void {
  const feed = fmtFeed(group.feedMmPerMin);
  const plunge = fmtFeed(group.plungeMmPerMin);
  lines.push(
    `; cnc layer ${group.layerId} ${group.cutType} tool ${fmt(group.toolDiameterMm)} mm ` +
      `feed ${feed} plunge ${plunge} spindle ${Math.round(group.spindleRpm)} rpm ` +
      `passes ${group.passes.length}`,
  );
  for (const [passIndex, pass] of group.passes.entries()) {
    const firstRawLine = lines.length + 1;
    appendPass(lines, head, pass, group.safeZMm, feed, plunge, group.retractBetweenPasses ?? false);
    // A degenerate pass (under two distinct points at emit precision) emits
    // nothing and gets no span; resume mapping treats it as zero-length.
    if (onPassSpan !== undefined && lines.length >= firstRawLine) {
      onPassSpan({ groupIndex: jobGroupIndex, passIndex, firstRawLine, lastRawLine: lines.length });
    }
  }
}

function appendPass(
  lines: string[],
  head: Head,
  pass: CncPass,
  safeZMm: number,
  feed: number,
  plunge: number,
  retractBetweenPasses: boolean,
): void {
  switch (pass.kind) {
    case 'contour':
      appendContourPass(lines, head, pass, safeZMm, feed, plunge, retractBetweenPasses);
      break;
    case 'path3d':
      appendPath3dPass(lines, head, pass, safeZMm, feed, plunge, retractBetweenPasses);
      break;
    case 'arc':
      // Arc passes are self-contained single moves; helical passes do their own
      // retract/entry (positionForHelix). Neither participates in the per-pass
      // retract mode, so they ignore the flag.
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
  retractBetweenPasses: boolean,
): void {
  const first = pass.polyline[0];
  if (first === undefined || pass.polyline.length < 2) return;
  const startX = fmt(first.x);
  const startY = fmt(first.y);
  const passZ = fmt(pass.zMm);

  // ADR-253: lift clear of the cut before this pass replunges, instead of
  // stepping Z down in place. A no-op on the first pass (already at safe Z) and
  // wherever the next pass starts at a new XY (the retract below already fires).
  if (retractBetweenPasses) appendRetract(lines, head, safeZMm);
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
  retractBetweenPasses: boolean,
): void {
  const first = pass.points[0];
  if (first === undefined || pass.points.length < 2) return;
  const startX = fmt(first.x);
  const startY = fmt(first.y);
  const startZ = fmt(first.z);

  // ADR-253: lift clear before a lead-in profile pass replunges (see
  // appendContourPass). Relief/surfacing path3d groups compile the flag false.
  if (retractBetweenPasses) appendRetract(lines, head, safeZMm);
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

export const cncGrblStrategy: OutputStrategy = { id: 'grbl-cnc', emit: emitJob };
