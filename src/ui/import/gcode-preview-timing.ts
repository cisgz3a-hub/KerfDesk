import { buildProgramTime } from '../../core/gcode-time';
import { timingUnavailableReason } from '../../core/gcode-time/program-timeline';
import { createGcodeRenderModelBuilder } from '../../core/gcode-view/gcode-render-model-builder';
import type { GcodeRenderModel } from '../../core/gcode-view';
import { formatDuration } from '../../core/job';
import { iterateLines } from '../../core/util';
import { createGcodeProgramLineParser, type ParseGcodeProgramResult } from '../../io/gcode';
import type { GcodeInspectionContext } from '../gcode-inspector/gcode-inspection-source';
import type { LiveJobEstimate } from '../laser/live-job-estimate';
import type { PreviewTimeline } from '../workspace/preview-timeline';
import {
  CANVAS_PROGRAM_ANALYSIS_LINE_BUDGET,
  CANVAS_PROGRAM_ANALYSIS_SEGMENT_BUDGET,
} from '../state/canvas-program-analysis-budget';

/** Session-only timing, captured atomically with the imported route. */
export type ImportedGcodeTiming = {
  readonly estimate: LiveJobEstimate;
  readonly timeline: PreviewTimeline | null;
  readonly description: string;
};

export type GcodePreviewParseResult = ParseGcodeProgramResult & {
  readonly timing?: ImportedGcodeTiming;
};

type SourceMotion = { readonly line: number; readonly length: number };

/** Read each source line once. The geometric parser deliberately omits feeds
 * and waits, so derive timing beside it with the Inspector's source model and
 * planner, never by timing the background document or reconstructing G-code. */
export function createTimedGcodePreviewParser(context: GcodeInspectionContext) {
  const motions: SourceMotion[] = [];
  let lineCount = 0;
  let timingBudgetExceeded = false;
  const parser = createGcodeProgramLineParser((line, step) => {
    if (!timingBudgetExceeded) motions.push({ line, length: step.length });
  });
  let builder: ReturnType<typeof createGcodeRenderModelBuilder> | null =
    createGcodeRenderModelBuilder({
      machineKind: context.machineKind,
      laserPowerControl: context.laserPowerControl,
      retainPreciseSegmentLengths: true,
      maxSegments: CANVAS_PROGRAM_ANALYSIS_SEGMENT_BUDGET,
    });
  return {
    pushLine(line: string): void {
      lineCount += 1;
      if (lineCount > CANVAS_PROGRAM_ANALYSIS_LINE_BUDGET && !timingBudgetExceeded) {
        timingBudgetExceeded = true;
        motions.length = 0;
        builder = null;
      }
      parser.pushLine(line);
      builder?.pushLine(line);
    },
    finish(): GcodePreviewParseResult {
      const parsed = parser.finish();
      if (parsed.kind === 'error') return parsed;
      if (builder === null)
        return {
          ...parsed,
          timing: unavailable(
            'Program exceeds the optional preview timing line budget; the complete route remains available.',
          ),
        };
      const model = builder.finish();
      const timing =
        model.kind === 'error'
          ? unavailable(
              model.segmentLimit === undefined
                ? model.reason
                : 'Program exceeds the optional preview timing segment budget; the complete route remains available.',
            )
          : timePreview(model.model, motions, parsed.notes, context);
      return { ...parsed, timing };
    },
  };
}

export function parseTimedGcodePreview(
  text: string,
  context: GcodeInspectionContext,
): GcodePreviewParseResult {
  const parser = createTimedGcodePreviewParser(context);
  for (const line of iterateLines(text)) parser.pushLine(line);
  return parser.finish();
}

function timePreview(
  model: GcodeRenderModel,
  motions: ReadonlyArray<SourceMotion>,
  notes: ReadonlyArray<string>,
  context: GcodeInspectionContext,
): ImportedGcodeTiming {
  const reason = timingUnavailableReason(model);
  if (reason !== null) return unavailable(reason);
  // The 2D parser ignores these non-geometric words; the timing model handles
  // them. Other ignored words could change the route, so do not claim that
  // their source timing maps onto the 2D geometry.
  const ignored = notes.find((note) => !/unsupported (G4|G94|G91\.1|M0|M1|M400)$/.test(note));
  if (ignored !== undefined) return unavailable(`2D preview omitted ${ignored}.`);
  const timing = context.timing;
  if (timing === undefined) return unavailable('No machine timing assumptions were supplied.');
  const time = buildProgramTime(model, timing.limits, {
    ...(context.machineKind === undefined ? {} : { machineKind: context.machineKind }),
    ...(timing.cutTimeScale === undefined ? {} : { cutTimeScale: timing.cutTimeScale }),
    ...(timing.travelTimeScale === undefined ? {} : { travelTimeScale: timing.travelTimeScale }),
    ...(timing.plannerBlocks === undefined ? {} : { plannerBlocks: timing.plannerBlocks }),
  });
  const timeline = sourceLineTimeline(model, motions, time.segSeconds);
  if (timeline === null) return unavailable('Source motion does not match the 2D preview route.');
  const { cutSeconds, rapidTravelSeconds, feedTravelSeconds } = time.breakdown;
  return {
    estimate: {
      kind: 'estimated',
      label: formatDuration(time.totalSeconds),
      totalSeconds: time.totalSeconds,
      breakdown: {
        cutSeconds,
        travelSeconds: rapidTravelSeconds + feedTravelSeconds,
        rapidTravelSeconds,
        feedTravelSeconds,
        dwellSeconds: time.dwellSeconds,
      },
      manualPauseCount: model.events.filter((event) => event.kind === 'pause').length,
    },
    timeline,
    description: `Imported program timed for ${timing.deviceName} at import. Assumes X0 Y0 Z0 and G4 P seconds. Uses its feeds and dwells; excludes manual pauses and transport time. Motion within each source line is approximate.`,
  };
}

/** Map source-line time onto the corresponding preview step. This preserves
 * feed changes, pure Z moves and helical timing despite the 2D route measuring
 * XY arcs/ramps differently from the timing model's physical XYZ distance. */
function sourceLineTimeline(
  model: GcodeRenderModel,
  motions: ReadonlyArray<SourceMotion>,
  segmentSeconds: Float64Array,
): PreviewTimeline | null {
  const motionSeconds = motionSecondsByLine(model, segmentSeconds);
  const dwells = dwellSecondsByLine(model);
  const segments: PreviewTimeline['segments'][number][] = [];
  let distance = 0;
  let elapsed = 0;
  let motionIndex = 0;
  for (let line = 0; line < model.lineCount; line += 1) {
    const seconds = motionSeconds[line] ?? 0;
    const motion = motions[motionIndex];
    if (motion?.line === line) {
      if (!(seconds > 0)) return null;
      segments.push({
        startDistanceMm: distance,
        endDistanceMm: distance + motion.length,
        startSeconds: elapsed,
        endSeconds: elapsed + seconds,
      });
      distance += motion.length;
      elapsed += seconds;
      motionIndex += 1;
    } else if (seconds > 0) return null;
    const dwell = dwells.get(line) ?? 0;
    if (dwell > 0) {
      segments.push({
        startDistanceMm: distance,
        endDistanceMm: distance,
        startSeconds: elapsed,
        endSeconds: elapsed + dwell,
      });
      elapsed += dwell;
    }
  }
  if (motionIndex !== motions.length) return null;
  return { totalDistanceMm: distance, totalSeconds: elapsed, segments };
}

function motionSecondsByLine(model: GcodeRenderModel, segmentSeconds: Float64Array): Float64Array {
  const seconds = new Float64Array(model.lineCount);
  for (let index = 0; index < model.segmentCount; index += 1) {
    const line = model.segLine[index];
    if (line !== undefined) seconds[line] = (seconds[line] ?? 0) + (segmentSeconds[index] ?? 0);
  }
  return seconds;
}

function dwellSecondsByLine(model: GcodeRenderModel): ReadonlyMap<number, number> {
  const seconds = new Map<number, number>();
  for (const event of model.events) {
    if (event.kind === 'dwell')
      seconds.set(event.line, (seconds.get(event.line) ?? 0) + event.seconds);
  }
  return seconds;
}

function unavailable(message: string): ImportedGcodeTiming {
  return {
    estimate: { kind: 'preparation-failed', message },
    timeline: null,
    description: `Timing unavailable: ${message} Playback shows geometry only.`,
  };
}
