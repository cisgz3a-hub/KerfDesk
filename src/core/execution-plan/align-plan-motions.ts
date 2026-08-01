import { SEG_KIND, SEG_MOTION, type GcodeRenderModel } from '../gcode-view';
// Deep import: core/job's legacy barrel is CI-ratcheted at 85 exports and may only shrink.
import type { MotionBlock } from '../job/motion-manifest';
import {
  type ExecutablePlanBuildIssue,
  type ExecutablePlanMotion,
  type ExecutablePlanMotionIntent,
  type ExecutablePlanMotionMode,
  type ExecutablePlanPoint,
} from './executable-plan-types';

/** Endpoint agreement floor near the origin, where relative budgets collapse. */
const FLOAT32_ENDPOINT_FLOOR_MM = 1e-6;
/** Float32 keeps a 24-bit significand, so one ULP is 2^-23 of the magnitude. */
const FLOAT32_ULP_FRACTION = 2 ** -23;
/**
 * ULP budget for the Inspector's Float32 storage round trip. A fixed absolute
 * budget would reject a single-ULP difference on a large-format job, where one
 * Float32 ULP already exceeds a micrometre.
 */
const FLOAT32_ENDPOINT_ULP_BUDGET = 4;
/** Six floats per segment: start xyz then end xyz. */
const FLOATS_PER_RENDER_SEGMENT = 6;

type RenderLineMotion = {
  readonly line: number;
  readonly firstSegment: number;
  readonly lastSegment: number;
  readonly mode: number;
  readonly feed: number;
  readonly power: number;
  readonly segmentCount: number;
};

type AlignmentContext = {
  readonly renderLines: ReadonlyMap<number, RenderLineMotion>;
  readonly model: GcodeRenderModel;
  readonly issues: ExecutablePlanBuildIssue[];
};

/** Motions when both readers agree, or the disagreements that refused the plan. */
export type AlignPlanMotionsResult = {
  readonly motions: ReadonlyArray<ExecutablePlanMotion> | null;
  readonly issues: ReadonlyArray<ExecutablePlanBuildIssue>;
};

/**
 * Aligns the controller manifest against the Inspector render model line by line.
 * Both compose the shared modal engine in `core/gcode` (ADR-255 stage 1), so this
 * catches policy divergence between the readers, not a defect inside that engine.
 */
export function alignPlanMotions(
  model: GcodeRenderModel,
  blocks: ReadonlyArray<MotionBlock>,
): AlignPlanMotionsResult {
  const collected = collectRenderLines(model);
  if (collected.issues.length > 0) return { motions: null, issues: collected.issues };
  const issues: ExecutablePlanBuildIssue[] = [];
  const context: AlignmentContext = { renderLines: collected.lines, model, issues };
  const motions = blocks.map((block, index) => alignMotion(block, index, context));
  const manifestLines = new Set(blocks.map((block) => block.rawLineIndex));
  for (const line of collected.lines.keys()) {
    if (manifestLines.has(line)) continue;
    issues.push({
      code: 'motion-line-mismatch',
      message: `Render motion on raw line ${line} has no controller-manifest block.`,
      rawLineIndex: line,
    });
  }
  if (issues.length > 0 || motions.some((motion) => motion === null)) {
    return { motions: null, issues };
  }
  return {
    motions: motions.filter((motion): motion is ExecutablePlanMotion => motion !== null),
    issues,
  };
}

function collectRenderLines(model: GcodeRenderModel): {
  readonly lines: ReadonlyMap<number, RenderLineMotion>;
  readonly issues: ReadonlyArray<ExecutablePlanBuildIssue>;
} {
  const lines = new Map<number, RenderLineMotion>();
  const issues: ExecutablePlanBuildIssue[] = [];
  for (let index = 0; index < model.segmentCount; index += 1) {
    const line = model.segLine[index];
    const mode = model.segMotion[index];
    if (line === undefined || mode === undefined) continue;
    const existing = lines.get(line);
    if (existing !== undefined && existing.mode !== mode) {
      issues.push({
        code: 'compound-motion-line',
        message: `Raw line ${line} expands to more than one motion mode.`,
        rawLineIndex: line,
      });
      continue;
    }
    lines.set(line, {
      line,
      firstSegment: existing?.firstSegment ?? index,
      lastSegment: index,
      mode,
      feed: model.segFeed[index] ?? 0,
      power: model.segPower[index] ?? 0,
      segmentCount: (existing?.segmentCount ?? 0) + 1,
    });
  }
  return { lines, issues };
}

function alignMotion(
  block: MotionBlock,
  index: number,
  context: AlignmentContext,
): ExecutablePlanMotion | null {
  const rendered = context.renderLines.get(block.rawLineIndex);
  if (rendered === undefined) {
    context.issues.push({
      code: 'motion-line-mismatch',
      message: `Controller motion on raw line ${block.rawLineIndex} has no render motion.`,
      rawLineIndex: block.rawLineIndex,
    });
    return null;
  }
  const manifestStart = block.points[0];
  const manifestEnd = block.points.at(-1);
  const renderStart = renderPointAtOffset(
    context.model,
    rendered.firstSegment * FLOATS_PER_RENDER_SEGMENT,
  );
  const renderEnd = renderPointAtOffset(
    context.model,
    rendered.lastSegment * FLOATS_PER_RENDER_SEGMENT + 3,
  );
  if (
    manifestStart === undefined ||
    manifestEnd === undefined ||
    !sameEndpoint(manifestStart, renderStart) ||
    !sameEndpoint(manifestEnd, renderEnd)
  ) {
    context.issues.push({
      code: 'endpoint-mismatch',
      message: `The readers disagree on endpoints for raw line ${block.rawLineIndex}.`,
      rawLineIndex: block.rawLineIndex,
    });
    return null;
  }
  return {
    id: `motion-${String(index + 1).padStart(6, '0')}`,
    rawLineIndex: block.rawLineIndex,
    sendableLineIndex: block.sendableLineIndex,
    programLineNumber: block.programLineNumber,
    mode: motionMode(rendered.mode),
    intent: motionIntent(block, context.model.segKind[rendered.firstSegment]),
    pointsMm: block.points.map(copyPoint),
    lengthMm: block.lengthMm,
    routeStartMm: block.routeStartMm,
    routeEndMm: block.routeEndMm,
    feedMmPerMin: rendered.feed > 0 ? rendered.feed : null,
    power: rendered.power,
    sourceSegmentCount: rendered.segmentCount,
  };
}

function renderPointAtOffset(model: GcodeRenderModel, offset: number): ExecutablePlanPoint {
  return {
    x: model.positions[offset] ?? 0,
    y: model.positions[offset + 1] ?? 0,
    z: model.positions[offset + 2] ?? 0,
  };
}

function sameEndpoint(expected: ExecutablePlanPoint, actual: ExecutablePlanPoint): boolean {
  return (
    sameFloat32(expected.x, actual.x) &&
    sameFloat32(expected.y, actual.y) &&
    sameFloat32(expected.z, actual.z)
  );
}

function sameFloat32(expected: number, actual: number): boolean {
  const rounded = Math.fround(expected);
  const budget = Math.max(
    FLOAT32_ENDPOINT_FLOOR_MM,
    Math.abs(rounded) * FLOAT32_ULP_FRACTION * FLOAT32_ENDPOINT_ULP_BUDGET,
  );
  return Math.abs(rounded - actual) <= budget;
}

function motionMode(mode: number): ExecutablePlanMotionMode {
  if (mode === SEG_MOTION.rapid) return 'rapid';
  if (mode === SEG_MOTION.linear) return 'linear';
  if (mode === SEG_MOTION.cw) return 'clockwise-arc';
  return 'counterclockwise-arc';
}

/**
 * The manifest already separates travel, process and park by XY route and spindle
 * state. Only the vertical direction is missing from it, and the render model's
 * segment kind supplies that.
 */
function motionIntent(
  block: MotionBlock,
  firstRenderKind: number | undefined,
): ExecutablePlanMotionIntent {
  if (block.kind !== 'plunge') return block.kind;
  return firstRenderKind === SEG_KIND.retract ? 'retract' : 'plunge';
}

function copyPoint(point: ExecutablePlanPoint): ExecutablePlanPoint {
  return { x: point.x, y: point.y, z: point.z };
}
