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
//
// Constant-power (M3) output never makes the controller drain its planner
// while the beam may still be lit mid-job (2026-09-25 controller audit, OR-1):
// see grbl-output-cursor.ts for the rules and upstream evidence.

import { resolveGrblDialect, type DeviceProfile, type GrblGcodeDialect } from '../devices';
import { contourEntryPoint, type ContourEntryBounds } from '../job/contour-entry';
import { cutSegmentsForPass, finalPassCutSegments } from '../job/cut-pass-segments';
import { offsetForSpeed } from '../job/scan-offset';
import type { CutGroup, CutSegment, FillGroup, Group, Job, RasterGroup } from '../job';
import { emitRasterGroupWithEnd } from '../raster/emit-raster';
import { assertNever } from '../scene';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import type { OutputEmitOptions, OutputStrategy } from './output-strategy';
import { bridgedAirGapIndices } from './air-assist-hold';
import { emitScanlineFillGroup } from './grbl-fill-emission';
import {
  LINE_END,
  contourEntryComment,
  overcutComment,
  feedComment,
  joinedLines,
  laserOffRunwayLine,
  laserOffSeekLine,
  pushOperationProvenanceComment,
  roundedPositiveFeed,
  scaleS,
} from './grbl-laser-lines';
import {
  createLaserOutputCursor,
  emittedHead,
  heldLinesBeforeBurn,
  laserOffMoveLines,
  noteBurn,
  noteLaserOffMove,
  noteRasterGroupEnd,
  releaseHeldLines,
  takeHeldLines,
  transitionLinesNow,
  type EmittedHead,
  type LaserOutputCursor,
} from './grbl-output-cursor';
import { laserModeWord, vectorPowerWord } from './grbl-power-modes';
import { laserParkTarget } from './job-park-target';
import { laserArcMovesEnabled } from '../devices/laser-arc-moves';
import { jobWritesArcMoves } from '../job/cut-arc-moves';
import { arcSegmentBurns } from './grbl-laser-arc-moves';
import { operationProvenanceComment } from './operation-provenance-comment';

type CoolantMode = 'off' | 'M7' | 'M8';

function preamble(dialect: GrblGcodeDialect, writesArcs: boolean): string {
  // G54 + G94 pin the modal WCS and feed mode the same way the CNC preamble
  // does (cnc-grbl-strategy.ts): GRBL's active G54-G59 selection and G93/G94
  // feed mode are modal and can be left changed by a console command or a $N
  // startup block (re-run after every soft reset, including the app's own Stop).
  // Without pinning them a laser job runs in whatever WCS was left active — the
  // burn lands displaced by a stale G55-G59 offset (F41/F50) — or interprets
  // every feed under a stale G93 inverse-time mode (F10).
  //
  // M3 S0: enable spindle/laser at power 0. Subsequent G1 with S>0 fires the
  // laser without needing another M3. Without M3 in the preamble, GRBL
  // controllers that aren't in laser mode ($32=0) won't fire the diode even
  // when G1 carries S>0 — the move happens but the beam stays off. M3 S0 is
  // safe (no power) and primes the controller for any subsequent S-driven
  // cutting move.
  //
  // G17 pins the arc plane like the WCS, and only when the job writes G2/G3
  // (ADR-432): a stale G18/G19 reads an XY I/J arc as error:33 or swings Z.
  const plane = writesArcs ? ['G17'] : [];
  const words = ['G21', 'G90', 'G54', 'G94', ...plane, `${laserModeWord(dialect.cutPowerMode)} S0`];
  return words.join(LINE_END) + LINE_END;
}

function postamble(
  laserAlreadyOff: boolean,
  device: DeviceProfile,
  dialect: GrblGcodeDialect,
  finishPosition: OutputEmitOptions['finishPosition'],
): string {
  // M5: definitively turn the spindle/laser off at end of job, then park. When
  // the last group was raster it already emitted its trailing M5, so skip the
  // redundant one; the park move still carries S0, so the laser-off invariant
  // holds either way.
  const lines = laserAlreadyOff ? [] : ['M5'];
  // Park precedence lives in laserParkTarget (shared with the Job Review
  // park-outside-frame disclosure) so review and emission cannot diverge.
  const park = laserParkTarget(dialect, finishPosition);
  if (park !== null) lines.push(laserOffSeekLine(park.x, park.y, device, dialect));
  return lines.join(LINE_END) + LINE_END;
}

// Shared emission context for contour segments (Line mode and offset fill).
// entryRunwayMm carries the group's ADR-239 tangential entry; undefined keeps
// legacy byte-identical approach motion.
type SegmentEmissionContext = {
  readonly s: number;
  readonly feed: number;
  readonly device: DeviceProfile;
  readonly dialect: GrblGcodeDialect;
  readonly entryRunwayMm?: number | undefined;
  readonly entryBounds: ContourEntryBounds;
  readonly cursor: LaserOutputCursor;
  /** ADR-432: the machine takes G2/G3, so fitted arc moves may be written. */
  readonly arcMovesEnabled: boolean;
};
type GroupEmissionContext = Pick<
  SegmentEmissionContext,
  'device' | 'dialect' | 'entryBounds' | 'cursor' | 'arcMovesEnabled'
>;

function emitSegment(seg: CutSegment, context: SegmentEmissionContext): string[] {
  const first = seg.polyline[0];
  // A one-point polyline has nothing to cut — emitting its rapid alone would
  // be a pointless stray G0 (defense in depth; producers filter these).
  if (first === undefined || seg.polyline.length < 2) return [];
  const burns = segmentBurnLines(seg, first, context);
  // If the entire segment collapses at emit precision, omit its laser-off seek
  // as well; it has no executable burn motion to position for.
  if (burns === null) return [];
  const { cursor, device, dialect } = context;
  const lines = [
    ...segmentApproachLines(seg, first, context),
    ...heldLinesBeforeBurn(cursor, { start: first, firstTarget: burns.firstTarget }, (x, y) =>
      laserOffSeekLine(x, y, device, dialect),
    ),
    ...burns.lines,
  ];
  if (context.s > 0) noteBurn(cursor, burns.end);
  else noteLaserOffMove(cursor, burns.end);
  return lines;
}

function segmentBurnLines(
  seg: CutSegment,
  first: { readonly x: number; readonly y: number },
  context: SegmentEmissionContext,
): SegmentBurns | null {
  // Fitted arc moves (ADR-432) replace the polyline when this output writes them.
  const arcs = arcSegmentBurns(seg, first, context);
  if (arcs !== null)
    return arcs.firstTarget === null ? null : { ...arcs, firstTarget: arcs.firstTarget };
  return polylineSegmentBurns(seg, first, context);
}

function polylineSegmentBurns(
  seg: CutSegment,
  first: { readonly x: number; readonly y: number },
  context: SegmentEmissionContext,
): SegmentBurns | null {
  const { s, feed, dialect } = context;
  const lines: string[] = [];
  let head = emittedHead(first.x, first.y);
  let firstTarget: SegmentBurns['firstTarget'] | null = null;
  for (let i = 1; i < seg.polyline.length; i += 1) {
    const pt = seg.polyline[i];
    if (pt === undefined) continue;
    const target = emittedHead(pt.x, pt.y);
    // Formatting is part of the executable artifact: points that differ in
    // memory can collapse to one machine coordinate at 3 dp. Never emit a
    // stationary positive-power G1, and keep F/S for the first real move.
    if (target.x === head.x && target.y === head.y) continue;
    const burnEmitted = firstTarget !== null;
    const feedWord =
      !burnEmitted || !dialect.modalFeedrate ? ` F${formatGcodeFeedMmPerMin(feed)}` : '';
    const sWord = !burnEmitted || dialect.emitSOnEveryBurnMove ? ` S${s}` : '';
    lines.push(`G1 X${target.x} Y${target.y}${feedWord}${sWord}`);
    firstTarget ??= pt;
    head = target;
  }
  return firstTarget === null ? null : { lines, end: head, firstTarget };
}

type SegmentBurns = {
  readonly lines: ReadonlyArray<string>;
  readonly end: EmittedHead;
  /** Where the first emitted burn goes (it starts at the segment's first point). */
  readonly firstTarget: { readonly x: number; readonly y: number };
};

// ADR-239: with an entry runway, seek to the tangential entry point instead of
// the ink edge, then ramp to the first vertex laser-off at burn feed. The ramp
// is collinear with the first burn edge, so the junction carries the entry
// feed into the ink. Without one (or when no tangent exists), keep the legacy
// direct seek byte-identically.
function segmentApproachLines(
  seg: CutSegment,
  first: { readonly x: number; readonly y: number },
  context: SegmentEmissionContext,
): string[] {
  const { cursor, device, dialect } = context;
  const entry =
    context.entryRunwayMm === undefined
      ? null
      : contourEntryPoint(seg.polyline, context.entryRunwayMm, context.entryBounds);
  const firstHead = emittedHead(first.x, first.y);
  if (entry === null) {
    return laserOffMoveLines(
      cursor,
      firstHead,
      laserOffSeekLine(first.x, first.y, device, dialect),
    );
  }
  return [
    ...laserOffMoveLines(
      cursor,
      emittedHead(entry.x, entry.y),
      laserOffSeekLine(entry.x, entry.y, device, dialect),
    ),
    ...laserOffMoveLines(cursor, firstHead, laserOffRunwayLine(first.x, first.y, context.feed)),
  ];
}

function emitGroup(group: CutGroup, context: GroupEmissionContext): string {
  const s = scaleS(group.power, context.device.maxPowerS);
  const feed = roundedPositiveFeed(group.speed, `Layer ${group.layerId}`);
  const chunks: string[] = [];
  chunks.push(
    `; layer ${group.layerId} color ${group.color} power ${group.power}% ${feedComment(group, feed)} passes ${group.passes}${contourEntryComment(group.entryRunwayMm)}${overcutComment(group.finalPassOvercutMm)}`,
  );
  pushOperationProvenanceComment(chunks, group);
  const segmentContext = { ...context, s, feed, entryRunwayMm: group.entryRunwayMm };
  const finalPass = finalPassCutSegments(group);
  for (let p = 0; p < group.passes; p += 1) {
    chunks.push(`; pass ${p + 1} of ${group.passes}`);
    // No re-arm between passes (OR-1). The power word cannot change inside a
    // group: emitJob arms the group's effective word (layer override or dialect
    // default, audit P2-1) before its first pass, and every positioning move
    // already carries S0. The old `M3 S0`/`M4 S0` here drained the planner:
    // under M3 with the previous pass's last burn still lit, under M4 at the
    // cost of a full stop, and Marlin's `M5 I`/`M3 I S0` derived from it
    // stopped the head with continuous inline power on.
    for (const seg of cutSegmentsForPass(group, finalPass, p, group.passes)) {
      const lines = emitSegment(seg, segmentContext);
      if (lines.length > 0) chunks.push(lines.join(LINE_END));
    }
  }
  return chunks.join(LINE_END) + LINE_END;
}

function emitOffsetFillGroup(group: FillGroup, context: GroupEmissionContext): string {
  const s = scaleS(group.power, context.device.maxPowerS);
  const feed = roundedPositiveFeed(group.speed, `Layer ${group.layerId}`);
  const chunks: string[] = [];
  chunks.push(
    `; offset fill layer ${group.layerId} color ${group.color} power ${group.power}% ${feedComment(group, feed)} passes ${group.passes}${contourEntryComment(group.entryRunwayMm)}`,
  );
  pushOperationProvenanceComment(chunks, group);
  const segmentContext = { ...context, s, feed, entryRunwayMm: group.entryRunwayMm };
  for (let p = 0; p < group.passes; p += 1) {
    chunks.push(`; pass ${p + 1} of ${group.passes}`);
    for (const seg of group.segments) {
      const lines = emitSegment(seg, segmentContext);
      if (lines.length > 0) chunks.push(lines.join(LINE_END));
    }
  }
  return chunks.join(LINE_END) + LINE_END;
}

// F.2.d: raster groups emit through the dedicated raster path
// (emit-raster.ts), which handles the M4 flip + per-pixel S
// modulation. The strategy stays one-arm-per-kind so adding new
// group types lights up the exhaustiveness check.
//
// A raster group writes its own opening (`M5`, arm) and closing `M5`. While a
// preceding M3 burn may still be lit, the opening and the held air change
// follow the group's first laser-off travel, and an M3 group that ends on a
// burn leaves its closing `M5` for the next laser-off move (OR-1).
function emitRasterGroupHere(group: RasterGroup, context: GroupEmissionContext): string {
  const { device, dialect, cursor } = context;
  const feed = roundedPositiveFeed(group.speed, `Layer ${group.layerId}`);
  const operationComment = operationProvenanceComment(group);
  const deferEntry = cursor.litAtStop;
  const emission = emitRasterGroupWithEnd({
    sValues: group.sValues,
    ...(group.rowProvider !== undefined ? { rowProvider: group.rowProvider } : {}),
    ...(group.rowProviderOrder !== undefined ? { rowProviderOrder: group.rowProviderOrder } : {}),
    width: group.pixelWidth,
    height: group.pixelHeight,
    bounds: group.bounds,
    feedMmPerMin: feed,
    passes: group.passes,
    overscanMm: group.overscanMm,
    dotWidthCorrectionMm: group.dotWidthCorrectionMm,
    scanOffsetMm: group.bidirectionalScanOffsetMm ?? offsetForSpeed(device.scanningOffsets, feed),
    ...(device.controlledLaserOffTravelFeedMmPerMin === undefined
      ? {}
      : {
          controlledLaserOffTravelFeedMmPerMin: device.controlledLaserOffTravelFeedMmPerMin,
        }),
    ...(group.bidirectional !== undefined ? { bidirectional: group.bidirectional } : {}),
    laserModeCommand: laserModeWord(dialect.rasterPowerMode),
    modalFeedrate: dialect.modalFeedrate,
    emitSOnEveryBurnMove: dialect.emitSOnEveryBurnMove,
    compactMotionWords: dialect.compactMotionWords,
    layerId: group.layerId,
    color: group.color,
    powerPercent: group.power,
    ...(operationComment === undefined ? {} : { effectiveOperationComment: operationComment }),
    ...(deferEntry ? { deferredEntry: { entryLines: takeHeldLines(cursor) } } : {}),
    deferClosingM5WhenLit: true,
  });
  noteRasterGroupEnd(cursor, emission.closingM5Deferred);
  return emission.gcode;
}

function emitAnyGroup(group: Group, context: GroupEmissionContext): string {
  switch (group.kind) {
    case 'cut':
      return emitGroup(group, context);
    case 'fill':
      return (group.fillStyle ?? 'scanline') === 'offset'
        ? emitOffsetFillGroup(group, context)
        : emitScanlineFillGroup(group, context);
    case 'raster':
      return emitRasterGroupHere(group, context);
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

/**
 * The coolant mode each group actually runs under, by group index.
 *
 * Normally that is exactly what the operation asked for. `bridgedAirGapIndices`
 * owns the one exception and the reasoning behind it (ADR-335); every Air-on
 * group resolves to the same device command, so a single held mode suffices.
 */
function coolantPlan(job: Job, device: DeviceProfile): ReadonlyArray<CoolantMode> {
  const wanted = job.groups.map((group) => groupCoolantMode(group, device));
  const bridged = bridgedAirGapIndices(
    wanted.map((mode) => mode !== 'off'),
    device.airAssistRestartUnreliable === true,
  );
  if (bridged.size === 0) return wanted;
  const held = wanted.find((mode) => mode !== 'off') ?? 'off';
  return wanted.map((mode, index) => (bridged.has(index) ? held : mode));
}

function coolantTransitionLines(from: CoolantMode, to: CoolantMode): string[] {
  if (from === to) return [];
  if (to === 'off') return ['M9'];
  if (from !== 'off') return ['M9', to];
  return [to];
}

// Restore constant power for vector cutting with `M3 S0`. Arming dynamic power
// from constant mode clears M3 first (mirrors emit-raster's "M5 so we don't stay
// stuck in M3"), then `M4 S0`. Coming from a raster group the controller already
// issued its trailing M5, so `M4 S0` alone suffices (no redundant second M5).
function modeChangeLines(
  mode: 'M3' | 'M4' | 'off',
  wantedMode: 'M3' | 'M4' | 'group-managed',
): string[] {
  if (wantedMode === 'M3' && mode !== 'M3') return ['M3 S0'];
  if (wantedMode === 'M4' && mode !== 'M4') return mode === 'M3' ? ['M5', 'M4 S0'] : ['M4 S0'];
  return [];
}

// Laser power mode is modal and spans groups. The preamble arms the dialect's
// cut mode; each vector group then selects an explicit layer override or its
// dialect/kind default. Dialects that use M4 for fill get GRBL's dynamic scaling
// by actual/programmed feed, while the M4-incompatible profile remains on M3.
// Raster manages its own mode internally and ends in M5. A flip is emitted only
// when the effective mode changes. Mode and air changes go before the group
// unless an M3 burn may still be lit; the cursor then holds them until the
// group's first laser-off move (OR-1).
function emitJob(job: Job, device: DeviceProfile, options: OutputEmitOptions = {}): string {
  const dialect = emittedDialect(device, options);
  const arcMovesEnabled = laserArcMovesEnabled(device);
  const parts: string[] = [];
  parts.push(preamble(dialect, arcMovesEnabled && jobWritesArcMoves(job)));
  let mode: 'M3' | 'M4' | 'off' = laserModeWord(dialect.cutPowerMode);
  let coolant: CoolantMode = 'off';
  const cursor = createLaserOutputCursor(mode);
  const plan = coolantPlan(job, device);
  const entryBounds =
    job.contourEntryBounds === undefined
      ? { widthMm: device.bedWidth, heightMm: device.bedHeight }
      : job.contourEntryBounds;
  for (const [index, group] of job.groups.entries()) {
    const wantedMode = powerModeForGroup(group, dialect);
    const nextCoolant = plan[index] ?? 'off';
    const transition = [
      ...modeChangeLines(mode, wantedMode),
      ...coolantTransitionLines(coolant, nextCoolant),
    ];
    parts.push(joinedLines(transitionLinesNow(cursor, transition)));
    if (wantedMode !== 'group-managed') mode = wantedMode;
    coolant = nextCoolant;
    parts.push(emitAnyGroup(group, { device, dialect, entryBounds, cursor, arcMovesEnabled }));
    if (group.kind === 'raster') mode = 'off'; // raster ends in M5, written or held
  }
  // Job end: held lines, air off and M5 follow the last burn, and the park
  // runs after them. Under M3 that stops the head with the beam still lit:
  // no laser-off move is left to take the drain before the laser is switched
  // off. The stop is inherent to constant power and is deliberately left as is
  // (OR-1).
  parts.push(joinedLines(releaseHeldLines(cursor)));
  parts.push(joinedLines(coolantTransitionLines(coolant, 'off')));
  // A raster group last in the job already issued its trailing M5, so the
  // postamble must not emit a redundant second one (mode === 'off').
  parts.push(postamble(mode === 'off', device, dialect, options.finishPosition));
  return parts.join('');
}

function powerModeForGroup(group: Group, dialect: GrblGcodeDialect): 'M3' | 'M4' | 'group-managed' {
  if (group.kind === 'raster' || group.kind === 'cnc') return 'group-managed';
  return vectorPowerWord(group, dialect);
}

// The dialect this emission actually uses. Everything comes from the device
// profile except the motion spelling, which a post-processing caller may pin
// to verbose (ADR-332).
function emittedDialect(device: DeviceProfile, options: OutputEmitOptions): GrblGcodeDialect {
  const dialect = resolveGrblDialect(device);
  return options.compactMotionWords === false && dialect.compactMotionWords
    ? { ...dialect, compactMotionWords: false }
    : dialect;
}

export const grblStrategy: OutputStrategy = {
  id: 'grbl',
  emit: emitJob,
};
