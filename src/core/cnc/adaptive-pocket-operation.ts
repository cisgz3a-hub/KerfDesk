import type { CncHelicalContourPass, CncPass } from '../job';
import type { CncCutDirection, CncLayerSettings, CncTool, Polyline, Vec2 } from '../scene';
import {
  planAdaptivePocket,
  type AdaptivePocketPlan,
  type AdaptivePocketSequence,
} from './adaptive-pocket';
import { verifyAdaptivePocket, type AdaptivePocketVerification } from './adaptive-pocket-verifier';
import { contourPassFromPolyline } from './compile-cnc-helpers';
import {
  buildVCarveSourceRegionLayout,
  vcarveSourceRegionRankFromLayout,
} from './vcarve-region-order';
import type { FrameHandedness } from './machine-frame-handedness';
import { cutDirectionClockwise, enforceCutDirection } from './motion-polish';

export type AdaptivePocketOperation =
  | { readonly kind: 'not-requested' }
  | { readonly kind: 'error'; readonly reason: string }
  | {
      readonly kind: 'ok';
      readonly plan: Extract<AdaptivePocketPlan, { readonly ok: true }>;
      readonly verification: Extract<AdaptivePocketVerification, { readonly ok: true }>;
    };

const DEFAULT_LOAD_RATIO = 0.1;
const HELIX_ANGLE_DEG = 3;

/** Legacy API/schema name for a compile-time geometric engagement limit. */
export function adaptiveOptimalLoadMm(settings: CncLayerSettings, toolDiameterMm: number): number {
  return settings.adaptiveOptimalLoadMm ?? toolDiameterMm * DEFAULT_LOAD_RATIO;
}

export function resolveAdaptivePocketOperation(
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
): AdaptivePocketOperation {
  if (settings.cutType !== 'pocket' || settings.pocketStrategy !== 'adaptive') {
    return { kind: 'not-requested' };
  }
  if (settings.pocketRestStock !== undefined)
    return {
      kind: 'error',
      reason:
        'Explicit previous-stock rest uses the disclosed offset-pocket fallback for adaptive strategy.',
    };
  if (tool.kind !== 'end-mill') {
    return { kind: 'error', reason: 'Adaptive clearing requires an end mill.' };
  }
  const plan = planAdaptivePocket(
    contours,
    tool.diameterMm,
    adaptiveOptimalLoadMm(settings, tool.diameterMm),
  );
  if (!plan.ok) return { kind: 'error', reason: plan.reason };
  const verification = verifyAdaptivePocket(contours, tool.diameterMm, plan);
  return verification.ok
    ? { kind: 'ok', plan, verification }
    : { kind: 'error', reason: verification.reason };
}

export function adaptivePocketPasses(
  operation: Extract<AdaptivePocketOperation, { readonly kind: 'ok' }>,
  depths: ReadonlyArray<number>,
  sourceContours: ReadonlyArray<Polyline> = [],
  direction?: {
    readonly cutDirection: CncCutDirection;
    readonly handedness: FrameHandedness;
  },
): ReadonlyArray<CncPass> {
  const passes: CncPass[] = [];
  const sourceLayout = buildVCarveSourceRegionLayout(sourceContours);
  const sequences = operation.plan.sequences
    .map((sequence, sourceIndex) => ({
      sequence,
      sourceIndex,
      rank: vcarveSourceRegionRankFromLayout(sequence.entryCenter, sourceLayout),
    }))
    .sort((a, b) => a.rank - b.rank || a.sourceIndex - b.sourceIndex)
    .map(({ sequence }) => sequence);
  for (const sequence of sequences) {
    for (let depthIndex = 0; depthIndex < depths.length; depthIndex += 1) {
      const zMm = depths[depthIndex];
      if (zMm === undefined) continue;
      const startZMm = depthIndex === 0 ? 0 : (depths[depthIndex - 1] ?? 0);
      passes.push(...sequenceRoughingPasses(sequence, startZMm, zMm, direction));
      const finishRings =
        direction === undefined
          ? sequence.finishRings
          : enforceCutDirection(
              sequence.finishRings,
              direction.cutDirection,
              'pocket',
              direction.handedness,
            );
      for (const ring of finishRings) {
        // The planner closes each finishing ring on its first point, and
        // direction enforcement then moves the start to the middle of the
        // longest segment. That leaves the old closing point as a repeated
        // vertex mid-ring and ends the ring at the corner before its new
        // start, half that segment short (ADR-154 Amendment 2). Drop the
        // repeat and close the ring at its new start, as pocket rings are
        // closed.
        const points = withoutRepeatedPoints(ring.points);
        passes.push(contourPassFromPolyline({ ...ring, points }, zMm));
      }
    }
  }
  return passes;
}

export function adaptivePocketPassesForSettings(
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  depths: ReadonlyArray<number>,
  handedness: FrameHandedness = 1,
): ReadonlyArray<CncPass> | null {
  const operation = resolveAdaptivePocketOperation(contours, settings, tool);
  if (operation.kind === 'not-requested') return null;
  return operation.kind === 'ok'
    ? adaptivePocketPasses(
        operation,
        depths,
        contours,
        settings.cutDirection === undefined
          ? undefined
          : { cutDirection: settings.cutDirection, handedness },
      )
    : null;
}

function withoutRepeatedPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return previous === undefined || previous.x !== point.x || previous.y !== point.y;
  });
}

function roughingPass(
  sequence: AdaptivePocketSequence,
  startZMm: number,
  zMm: number,
  direction?: {
    readonly cutDirection: CncCutDirection;
    readonly handedness: FrameHandedness;
  },
): CncHelicalContourPass | null {
  const polyline = sequence.rings.flatMap((ring) => ring.points);
  if (polyline.length < 2) return null;
  const circumference = 2 * Math.PI * sequence.entryRadiusMm;
  const dropPerRevolution = circumference * Math.tan((HELIX_ANGLE_DEG * Math.PI) / 180);
  return {
    kind: 'helical-contour',
    start: {
      x: sequence.entryCenter.x + sequence.entryRadiusMm,
      y: sequence.entryCenter.y,
    },
    center: sequence.entryCenter,
    clockwise:
      direction === undefined
        ? false
        : (cutDirectionClockwise(direction.cutDirection, 'pocket', direction.handedness) ?? false),
    startZMm,
    zMm,
    revolutions: Math.max(1, Math.ceil((startZMm - zMm) / dropPerRevolution)),
    polyline,
    closed: false,
  };
}

function sequenceRoughingPasses(
  sequence: AdaptivePocketSequence,
  startZMm: number,
  zMm: number,
  direction?: { readonly cutDirection: CncCutDirection; readonly handedness: FrameHandedness },
): ReadonlyArray<CncPass> {
  const seed = sequence.seedRings;
  if (seed === undefined) {
    const legacy = roughingPass(sequence, startZMm, zMm, direction);
    return legacy === null ? [] : [legacy];
  }
  const foundation = roughingPass(
    { ...sequence, rings: [...seed, ...sequence.rings] },
    startZMm,
    zMm,
    direction,
  );
  if (foundation === null) return [];
  const entryEnd = foundation.start;
  const seedPoints = [entryEnd, ...seed.flatMap((ring) => ring.points)];
  const seedEnd = seedPoints[seedPoints.length - 1] ?? entryEnd;
  const radialPoints = [seedEnd, ...sequence.rings.flatMap((ring) => ring.points)];
  // The helix emitter requires a two-point contour tail. Keep it stationary so
  // full-width seed slotting starts in the following explicit plunge-feed pass.
  const passes: CncPass[] = [{ ...foundation, polyline: [entryEnd, entryEnd] }];
  if (seedPoints.length > 1)
    passes.push({
      kind: 'path3d',
      closed: false,
      lateralFeed: 'plunge',
      points: seedPoints.map((point) => ({ ...point, z: zMm })),
    });
  if (radialPoints.length > 1)
    passes.push({ kind: 'contour', closed: false, zMm, polyline: radialPoints });
  return passes;
}
