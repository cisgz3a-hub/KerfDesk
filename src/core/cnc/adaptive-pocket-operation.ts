import type { CncHelicalContourPass, CncPass } from '../job';
import type { CncLayerSettings, CncTool, Polyline } from '../scene';
import {
  planAdaptivePocket,
  type AdaptivePocketPlan,
  type AdaptivePocketSequence,
} from './adaptive-pocket';
import { verifyAdaptivePocket, type AdaptivePocketVerification } from './adaptive-pocket-verifier';

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
): ReadonlyArray<CncPass> {
  const passes: CncPass[] = [];
  for (let depthIndex = 0; depthIndex < depths.length; depthIndex += 1) {
    const zMm = depths[depthIndex];
    if (zMm === undefined) continue;
    const startZMm = depthIndex === 0 ? 0 : (depths[depthIndex - 1] ?? 0);
    for (const sequence of operation.plan.sequences) {
      const roughing = roughingPass(sequence, startZMm, zMm);
      if (roughing !== null) passes.push(roughing);
      for (const ring of sequence.finishRings) {
        passes.push({ kind: 'contour', zMm, polyline: ring.points, closed: true });
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
): ReadonlyArray<CncPass> | null {
  const operation = resolveAdaptivePocketOperation(contours, settings, tool);
  if (operation.kind === 'not-requested') return null;
  return operation.kind === 'ok' ? adaptivePocketPasses(operation, depths) : [];
}

function roughingPass(
  sequence: AdaptivePocketSequence,
  startZMm: number,
  zMm: number,
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
    clockwise: false,
    startZMm,
    zMm,
    revolutions: Math.max(1, Math.ceil((startZMm - zMm) / dropPerRevolution)),
    polyline,
    closed: false,
  };
}
