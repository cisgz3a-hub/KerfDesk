// GrblStrategy — emits deterministic GRBL v1.1+ G-code for a Job.
//
// Invariants enforced at emit time (PROJECT.md non-negotiables):
//   #3 Laser-off on travel: every G0 line carries `S0`.
//   #5 Deterministic output: fixed decimal precision, LF line endings,
//      indexed iteration (no Set/Map iteration order).
//   #7 Power scale honest: S = round((power/100) * device.maxPowerS).
//
// Preamble:  G21 (mm), G90 (absolute), M3 S0 (arm laser at zero power —
//            see preamble() for the $32=0 priming rationale; M3 S0 is
//            laser-off in laser mode, and deliberately NOT M5).
// Postamble: M5, then `G0 X0 Y0 S0` to park at origin.
// LightBurn divergence (LIGHTBURN-STUDY §8): stock GRBL headers there are
// units/positioning only, with M3/M4 issued per cut layer — ours pre-arms.

import {
  resolveGrblDialect,
  type DeviceProfile,
  type GrblGcodeDialect,
  type GrblPowerMode,
} from '../devices';
import { effectiveFillOverscanMm, expandFillHatchWithOverscan } from '../job/fill-overscan';
import { groupFillSweeps, type FillSpan, type FillSweep } from '../job/fill-sweeps';
import { isSensitiveIslandFillPolicy } from '../job/island-fill-motion';
import { offsetForSpeed, shiftAlongTravel } from '../job/scan-offset';
import type { CutGroup, CutSegment, FillGroup, Group, Job, RasterGroup } from '../job';
import { emitRasterGroup as emitRasterGroupGcode } from '../raster';
import { assertNever } from '../scene';
import type { OutputStrategy } from './output-strategy';

const DECIMAL_PLACES = 3;
const LINE_END = '\n';
type CoolantMode = 'off' | 'M7' | 'M8';

function fmt(n: number): string {
  return n.toFixed(DECIMAL_PLACES);
}

function scaleS(powerPercent: number, maxPowerS: number): number {
  return Math.round((powerPercent / 100) * maxPowerS);
}

function laserModeWord(mode: GrblPowerMode): 'M3' | 'M4' {
  return mode === 'dynamic' ? 'M4' : 'M3';
}

function travelLine(x: number, y: number, dialect: GrblGcodeDialect): string {
  const controlledFeed = dialect.controlledLaserOffTravelFeedMmPerMin;
  if (typeof controlledFeed === 'number' && Number.isFinite(controlledFeed) && controlledFeed > 0) {
    return `G1 X${fmt(x)} Y${fmt(y)} F${Math.round(controlledFeed)} S0`;
  }
  const base = `G0 X${fmt(x)} Y${fmt(y)}`;
  return dialect.requiresS0OnRapid ? `${base} S0` : base;
}

function laserOffFeedLine(x: number, y: number, feed: number): string {
  return `G1 X${fmt(x)} Y${fmt(y)} F${feed} S0`;
}

function roundedPositiveFeed(speed: number, context: string): number {
  const feed = Math.round(speed);
  if (!Number.isFinite(feed) || feed <= 0) {
    throw new Error(`${context}: speed must be finite and > 0`);
  }
  return feed;
}

function hasControlledLaserOffTravel(dialect: GrblGcodeDialect): boolean {
  const controlledFeed = dialect.controlledLaserOffTravelFeedMmPerMin;
  return (
    typeof controlledFeed === 'number' && Number.isFinite(controlledFeed) && controlledFeed > 0
  );
}

function preamble(dialect: GrblGcodeDialect): string {
  // M3 S0: enable spindle/laser at power 0. Subsequent G1 with S>0 fires the
  // laser without needing another M3. Without M3 in the preamble, GRBL
  // controllers that aren't in laser mode ($32=0) won't fire the diode even
  // when G1 carries S>0 — the move happens but the beam stays off. M3 S0 is
  // safe (no power) and primes the controller for any subsequent S-driven
  // cutting move.
  return ['G21', 'G90', `${laserModeWord(dialect.cutPowerMode)} S0`].join(LINE_END) + LINE_END;
}

function postamble(laserAlreadyOff: boolean, dialect: GrblGcodeDialect): string {
  // M5: definitively turn the spindle/laser off at end of job, then park. When
  // the last group was raster it already emitted its trailing M5, so skip the
  // redundant one; the park move still carries S0, so the laser-off invariant
  // holds either way.
  const lines = laserAlreadyOff ? [] : ['M5'];
  if (dialect.parkAtOriginAfterJob) lines.push(travelLine(0, 0, dialect));
  return lines.join(LINE_END) + LINE_END;
}

function emitSegment(seg: CutSegment, s: number, feed: number, dialect: GrblGcodeDialect): string {
  const lines: string[] = [];
  const first = seg.polyline[0];
  if (first === undefined) {
    return '';
  }
  // Rapid to start with laser off.
  lines.push(travelLine(first.x, first.y, dialect));
  // First G1 carries F and S; subsequent G1s inherit.
  for (let i = 1; i < seg.polyline.length; i += 1) {
    const pt = seg.polyline[i];
    if (pt === undefined) continue;
    const feedWord = i === 1 || !dialect.modalFeedrate ? ` F${feed}` : '';
    const sWord = i === 1 || dialect.emitSOnEveryBurnMove ? ` S${s}` : '';
    lines.push(`G1 X${fmt(pt.x)} Y${fmt(pt.y)}${feedWord}${sWord}`);
  }
  return lines.join(LINE_END) + LINE_END;
}

function emitGroup(group: CutGroup, device: DeviceProfile, dialect: GrblGcodeDialect): string {
  const s = scaleS(group.power, device.maxPowerS);
  const feed = roundedPositiveFeed(group.speed, `Layer ${group.layerId}`);
  const chunks: string[] = [];
  chunks.push(
    `; layer ${group.layerId} color ${group.color} power ${group.power}% speed ${feed} mm/min passes ${group.passes}`,
  );
  for (let p = 0; p < group.passes; p += 1) {
    chunks.push(`; pass ${p + 1} of ${group.passes}`);
    if (p > 0) chunks.push(`${laserModeWord(dialect.cutPowerMode)} S0`);
    for (const seg of group.segments) {
      const segText = emitSegment(seg, s, feed, dialect);
      if (segText.length > 0) chunks.push(segText.replace(/\n$/, ''));
    }
  }
  return chunks.join(LINE_END) + LINE_END;
}

function emitFillGroup(group: FillGroup, device: DeviceProfile, dialect: GrblGcodeDialect): string {
  if ((group.fillStyle ?? 'scanline') === 'offset')
    return emitOffsetFillGroup(group, device, dialect);
  const s = scaleS(group.power, device.maxPowerS);
  const feed = roundedPositiveFeed(group.speed, `Layer ${group.layerId}`);
  const chunks: string[] = [];
  chunks.push(
    `; fill layer ${group.layerId} color ${group.color} power ${group.power}% speed ${feed} mm/min passes ${group.passes} overscan ${fmt(group.overscanMm)} mm`,
  );
  // Each scanline's runs become ONE continuous laser-on sweep: a single G1
  // pass across the row that blanks the interior gaps (holes) with S0 instead
  // of lifting to a rapid and stopping at every run. This is the structural
  // fill-speed fix (ADR-034) — it matches how emit-raster.ts sweeps a row and
  // how LightBurn fills, collapsing thousands of short stop-start runs into a
  // few hundred continuous sweeps. Normal scanline short-run skip is preserved;
  // Island Fill gets a capped partial runway so tiny islands do not start
  // burning from rest.
  const sweeps = groupFillSweeps(group.segments);
  const scanOffsetMm = offsetForSpeed(device.scanningOffsets, group.speed);
  for (let p = 0; p < group.passes; p += 1) {
    chunks.push(`; pass ${p + 1} of ${group.passes}`);
    for (const sweep of sweeps) {
      const text = emitFillSweep(
        sweep,
        s,
        feed,
        group.overscanMm,
        group.fillStyle,
        group.islandMotionPolicy,
        scanOffsetMm,
        dialect,
      );
      if (text.length > 0) chunks.push(text);
    }
  }
  return chunks.join(LINE_END) + LINE_END;
}

function emitOffsetFillGroup(
  group: FillGroup,
  device: DeviceProfile,
  dialect: GrblGcodeDialect,
): string {
  const s = scaleS(group.power, device.maxPowerS);
  const feed = roundedPositiveFeed(group.speed, `Layer ${group.layerId}`);
  const chunks: string[] = [];
  chunks.push(
    `; offset fill layer ${group.layerId} color ${group.color} power ${group.power}% speed ${feed} mm/min passes ${group.passes}`,
  );
  for (let p = 0; p < group.passes; p += 1) {
    chunks.push(`; pass ${p + 1} of ${group.passes}`);
    for (const seg of group.segments) {
      const segText = emitSegment(seg, s, feed, dialect);
      if (segText.length > 0) chunks.push(segText.replace(/\n$/, ''));
    }
  }
  return chunks.join(LINE_END) + LINE_END;
}

// One scanline as a continuous sweep. Seek to the optional overscan lead with
// the laser off (reusing the 1a/1b lead geometry + short-run skip), then keep a
// single G1 chain: each ink span burns at S{s}, each interior gap crosses
// at S0 so the head never stops over a hole. Sensitive Island Fill runways on
// controlled-travel dialects also enter/exit at burn feed with S0. G-code
// S is modal, so every span re-asserts its value — a missed S0 would fire the
// beam across a hole, so the per-segment S sequence is asserted exhaustively in
// the tests.
function emitFillSweep(
  sweep: FillSweep,
  s: number,
  feed: number,
  overscanMm: number,
  fillStyle: FillGroup['fillStyle'],
  islandMotionPolicy: FillGroup['islandMotionPolicy'],
  scanOffsetMm: number,
  dialect: GrblGcodeDialect,
): string {
  const spans = scanOffsetSpans(sweep, scanOffsetMm);
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (first === undefined || last === undefined) return '';
  const overscan = effectiveFillOverscanMm(
    [first.start, last.end],
    overscanMm,
    fillStyle,
    islandMotionPolicy,
  );
  const run = expandFillHatchWithOverscan([first.start, last.end], overscan);
  if (run === null) return '';
  const feedMatchedRunway =
    overscan > 0 &&
    fillStyle === 'island' &&
    isSensitiveIslandFillPolicy(islandMotionPolicy) &&
    hasControlledLaserOffTravel(dialect);
  const lines: string[] = [travelLine(run.leadStart.x, run.leadStart.y, dialect)];
  if (overscan > 0) {
    lines.push(
      feedMatchedRunway
        ? laserOffFeedLine(run.burnStart.x, run.burnStart.y, feed)
        : travelLine(run.burnStart.x, run.burnStart.y, dialect),
    );
  }
  for (const line of sweepSpanLines(spans, s, feed, dialect)) lines.push(line);
  if (overscan > 0) {
    lines.push(
      feedMatchedRunway
        ? laserOffFeedLine(run.leadEnd.x, run.leadEnd.y, feed)
        : travelLine(run.leadEnd.x, run.leadEnd.y, dialect),
    );
  }
  return lines.join(LINE_END);
}

function scanOffsetSpans(sweep: FillSweep, scanOffsetMm: number): ReadonlyArray<FillSpan> {
  if (!sweep.reverse || scanOffsetMm === 0) return sweep.spans;
  return sweep.spans.map((span) => {
    const shifted = shiftAlongTravel(span.start, span.end, scanOffsetMm);
    return { start: shifted.from, end: shifted.to };
  });
}

// The G1 chain for one sweep: burn each ink span (S{s}), blank each interior
// gap (S0). F rides only the first emitted G1 (modal). A head tracker skips any
// move whose target equals the current position at emit precision (3 dp), so a
// degenerate span never emits a stationary beam-on G1 and two touching spans
// never emit a zero-length gap — defense in depth for PROJECT.md #3 ("positive
// S only on a moving G1"). The live producer already filters sub-epsilon runs
// (fill-hatching SCANLINE_EPS); this guards the contract at the emitter too
// (audit 2026-06-03).
function sweepSpanLines(
  spans: ReadonlyArray<FillSpan>,
  s: number,
  feed: number,
  dialect: GrblGcodeDialect,
): string[] {
  const first = spans[0];
  if (first === undefined) return [];
  const lines: string[] = [];
  // Head starts where the runway G0 left it: the first span's start.
  let headX = fmt(first.start.x);
  let headY = fmt(first.start.y);
  let feedEmitted = false;
  const moveTo = (x: number, y: number, sWord: string): void => {
    const fx = fmt(x);
    const fy = fmt(y);
    if (fx === headX && fy === headY) return; // zero-length at emit precision — skip
    const feedWord = feedEmitted && dialect.modalFeedrate ? '' : ` F${feed}`;
    feedEmitted = true;
    lines.push(`G1 X${fx} Y${fy}${feedWord} ${sWord}`);
    headX = fx;
    headY = fy;
  };
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (span === undefined) continue;
    moveTo(span.end.x, span.end.y, `S${s}`);
    const next = spans[i + 1];
    if (next !== undefined) moveTo(next.start.x, next.start.y, 'S0');
  }
  return lines;
}

// F.2.d: raster groups emit through the dedicated raster path
// (emit-raster.ts), which handles the M4 flip + per-pixel S
// modulation. The strategy stays one-arm-per-kind so adding new
// group types lights up the exhaustiveness check.
function emitRasterGroupHere(
  group: RasterGroup,
  device: DeviceProfile,
  dialect: GrblGcodeDialect,
): string {
  const feed = roundedPositiveFeed(group.speed, `Layer ${group.layerId}`);
  return emitRasterGroupGcode({
    sValues: group.sValues,
    width: group.pixelWidth,
    height: group.pixelHeight,
    bounds: group.bounds,
    feedMmPerMin: feed,
    passes: group.passes,
    overscanMm: group.overscanMm,
    dotWidthCorrectionMm: group.dotWidthCorrectionMm,
    scanOffsetMm: offsetForSpeed(device.scanningOffsets, feed),
    ...(group.bidirectional !== undefined ? { bidirectional: group.bidirectional } : {}),
    laserModeCommand: laserModeWord(dialect.rasterPowerMode),
    ...(dialect.controlledLaserOffTravelFeedMmPerMin !== undefined
      ? { controlledLaserOffTravelFeedMmPerMin: dialect.controlledLaserOffTravelFeedMmPerMin }
      : {}),
    modalFeedrate: dialect.modalFeedrate,
    emitSOnEveryBurnMove: dialect.emitSOnEveryBurnMove,
    layerId: group.layerId,
    color: group.color,
    powerPercent: group.power,
  });
}

function emitAnyGroup(group: Group, device: DeviceProfile, dialect: GrblGcodeDialect): string {
  switch (group.kind) {
    case 'cut':
      return emitGroup(group, device, dialect);
    case 'fill':
      return emitFillGroup(group, device, dialect);
    case 'raster':
      return emitRasterGroupHere(group, device, dialect);
    case 'cnc':
      // CNC jobs are emitted by cncGrblStrategy; emit-gcode routes by the
      // project's machine kind. A cnc group reaching the laser strategy is a
      // pipeline bug — emit a visible marker instead of laser motion.
      return `; cnc group ${group.layerId} skipped by laser strategy${LINE_END}`;
    default:
      return assertNever(group, 'Group');
  }
}

function groupCoolantMode(group: Group, device: DeviceProfile): CoolantMode {
  if (group.kind === 'cnc' || !group.airAssist) return 'off';
  return device.airAssistCommand === 'none' ? 'off' : device.airAssistCommand;
}

function coolantTransition(from: CoolantMode, to: CoolantMode): string {
  if (from === to) return '';
  if (to === 'off') return `M9${LINE_END}`;
  if (from !== 'off') return `M9${LINE_END}${to}${LINE_END}`;
  return `${to}${LINE_END}`;
}

// Laser power mode is modal and spans groups. The preamble arms M3 (constant
// power). Cut groups keep M3 — a slow corner must still cut fully through. FILL
// groups want M4 DYNAMIC power: GRBL then scales S by actual/programmed feed, so
// a short engrave stroke that never reaches feed (the head accelerating from
// rest inside a few-mm glyph) deposits constant energy/mm instead of over-burning
// the slow zones — the small-text "uneven density" defect
// (docs/research/burn-perfection-small-text.md Cause A; supersedes ADR-020 #4,
// see ADR-036). Raster manages its own M4 internally and ends in M5. A flip is
// emitted ONLY when the required mode actually changes, so cut-only jobs stay
// byte-identical. Under M4 the diode is also dark whenever the head is stopped
// (dynamic power → 0 at 0 feed), so fill is now strictly safer on travel/pause.
function emitJob(job: Job, device: DeviceProfile): string {
  const dialect = resolveGrblDialect(device);
  const parts: string[] = [];
  parts.push(preamble(dialect));
  let mode: 'M3' | 'M4' | 'off' = laserModeWord(dialect.cutPowerMode);
  let coolant: CoolantMode = 'off';
  for (const group of job.groups) {
    const wantedMode = powerModeForGroup(group, dialect);
    if (wantedMode === 'M3' && mode !== 'M3') {
      // Restore constant power for vector cutting.
      parts.push('M3 S0' + LINE_END);
      mode = 'M3';
    } else if (wantedMode === 'M4' && mode !== 'M4') {
      // Arm dynamic power. Coming from constant mode, clear M3 first (mirrors
      // emit-raster's "M5 so we don't stay stuck in M3"), then M4 S0. Coming
      // from a raster group the controller already issued its trailing M5, so
      // M4 S0 alone suffices (no redundant second M5).
      parts.push((mode === 'M3' ? 'M5' + LINE_END : '') + 'M4 S0' + LINE_END);
      mode = 'M4';
    }
    const nextCoolant = groupCoolantMode(group, device);
    parts.push(coolantTransition(coolant, nextCoolant));
    coolant = nextCoolant;
    parts.push(emitAnyGroup(group, device, dialect));
    if (group.kind === 'raster') mode = 'off'; // raster emits its own trailing M5
  }
  parts.push(coolantTransition(coolant, 'off'));
  // A raster group last in the job already issued its trailing M5, so the
  // postamble must not emit a redundant second one (mode === 'off').
  parts.push(postamble(mode === 'off', dialect));
  return parts.join('');
}

function powerModeForGroup(group: Group, dialect: GrblGcodeDialect): 'M3' | 'M4' | 'group-managed' {
  if ((group.kind === 'cut' || group.kind === 'fill') && group.powerMode !== undefined) {
    return laserModeWord(group.powerMode);
  }
  if (group.kind === 'fill') return dialect.fillPowerMode === 'dynamic' ? 'M4' : 'M3';
  if (group.kind === 'raster' || group.kind === 'cnc') return 'group-managed';
  return laserModeWord(dialect.cutPowerMode);
}

export const grblStrategy: OutputStrategy = {
  id: 'grbl',
  emit: emitJob,
};
