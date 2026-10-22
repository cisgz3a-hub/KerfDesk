import {
  applyFittedSimilarity,
  fitSimilarity,
  type FittedSimilarity,
} from '../geometry/similarity-fit';
import type { BoardOutlineDraft, ViewAxisSigns } from './board-outline';
import { outlineBounds } from './board-outline';
import type { Vec2 } from './scene-object';

export type OutlineBoardGeometry = {
  readonly kind: 'outline';
  readonly localPointsMm: ReadonlyArray<Vec2>;
  readonly anchorIndices: ReadonlyArray<number>;
  readonly viewSigns: ViewAxisSigns;
  readonly measured: ReadonlyArray<{ readonly index: number; readonly machine: Vec2 }>;
};

export const OUTLINE_SCALE_REFUSE_FRACTION = 0.05;
export const OUTLINE_SCALE_NOTICE_FRACTION = 0.01;

export type OutlineRegistration = {
  readonly transform: FittedSimilarity;
  readonly scale: number;
  readonly maxResidualMm: number;
  readonly residuals: ReadonlyArray<{ readonly index: number; readonly mm: number }>;
};

export function outlineRegistration(g: OutlineBoardGeometry): OutlineRegistration | null {
  if (g.measured.length < 2) return null;
  const pairs = g.measured.map(({ index, machine }) => ({
    from: g.localPointsMm[index] as Vec2,
    to: machineToView(machine, g.viewSigns),
  }));
  if (pairs.some(({ from, to }) => from === undefined || !finitePoint(to))) return null;
  const result = fitSimilarity(pairs);
  if (!result.ok) return null;
  return {
    transform: result.fit.transform,
    scale: result.fit.transform.scale,
    maxResidualMm: result.fit.maxResidualMm,
    residuals: g.measured.map(({ index }, position) => ({
      index,
      mm: result.fit.residualsMm[position] as number,
    })),
  };
}

export function outlineMachinePoints(g: OutlineBoardGeometry): ReadonlyArray<Vec2> | null {
  const registration = outlineRegistration(g);
  if (registration === null) return null;
  return g.localPointsMm.map((point) =>
    viewToMachine(applyFittedSimilarity(point, registration.transform), g.viewSigns),
  );
}

export function outlineMachineCorner(
  g: OutlineBoardGeometry,
  corner: 'front-left' | 'back-left',
): Vec2 | null {
  const registration = outlineRegistration(g);
  if (registration === null) return null;
  const viewPoints = g.localPointsMm.map((point) =>
    applyFittedSimilarity(point, registration.transform),
  );
  const bounds = outlineBounds(viewPoints);
  return viewToMachine(
    { x: bounds.minX, y: corner === 'front-left' ? bounds.maxY : bounds.minY },
    g.viewSigns,
  );
}

export function outlineBoardShape(g: OutlineBoardGeometry): {
  readonly kind: 'outline';
  readonly pointsMm: ReadonlyArray<Vec2>;
  readonly anchorIndices: ReadonlyArray<number>;
} | null {
  const registration = outlineRegistration(g);
  if (registration === null) return null;
  const viewPoints = g.localPointsMm.map((point) =>
    applyFittedSimilarity(point, registration.transform),
  );
  const bounds = outlineBounds(viewPoints);
  return {
    kind: 'outline',
    pointsMm: viewPoints.map((point) => ({
      x: point.x - bounds.minX,
      y: point.y - bounds.minY,
    })),
    anchorIndices: g.anchorIndices,
  };
}

export function outlineGeometryFromCaptures(
  draft: BoardOutlineDraft,
  captures: readonly [Vec2, Vec2],
  viewSigns: ViewAxisSigns,
):
  | { readonly ok: true; readonly geometry: OutlineBoardGeometry; readonly scale: number }
  | { readonly ok: false; readonly reason: string } {
  const [firstIndex, secondIndex] = draft.captureOrder;
  const firstLocal = draft.localPointsMm[firstIndex];
  const secondLocal = draft.localPointsMm[secondIndex];
  if (
    firstLocal === undefined ||
    secondLocal === undefined ||
    firstIndex === secondIndex ||
    !draft.anchorIndices.includes(firstIndex) ||
    !draft.anchorIndices.includes(secondIndex) ||
    captures.some((point) => !finitePoint(point))
  ) {
    return { ok: false, reason: 'The outline anchors and head positions must be valid.' };
  }
  const head = distance(captures[0], captures[1]);
  const outline = distance(firstLocal, secondLocal);
  if (!(head > 0) || !(outline > 0) || !Number.isFinite(head + outline)) {
    return { ok: false, reason: 'The two captured head positions must be distinct.' };
  }
  const geometry: OutlineBoardGeometry = {
    kind: 'outline',
    localPointsMm: draft.localPointsMm,
    anchorIndices: draft.anchorIndices,
    viewSigns,
    measured: [
      { index: firstIndex, machine: captures[0] },
      { index: secondIndex, machine: captures[1] },
    ],
  };
  const registration = outlineRegistration(geometry);
  if (registration === null) {
    return { ok: false, reason: 'The outline registration could not be calculated.' };
  }
  if (Math.abs(registration.scale - 1) > OUTLINE_SCALE_REFUSE_FRACTION) {
    return {
      ok: false,
      reason:
        `The head positions are ${head.toFixed(1)} mm apart, but the outline puts those anchors ` +
        `${outline.toFixed(1)} mm apart. Check that the head was on the highlighted anchors, ` +
        'or correct the board size.',
    };
  }
  return { ok: true, geometry, scale: registration.scale };
}

export function correctOutlineGeometry(
  g: OutlineBoardGeometry,
  index: number,
  confirmedMachine: Vec2,
): {
  readonly geometry: OutlineBoardGeometry;
  readonly predictionErrorMm: number;
  readonly maxResidualMm: number;
} | null {
  if (!g.anchorIndices.includes(index) || !finitePoint(confirmedMachine)) return null;
  const points = outlineMachinePoints(g);
  const predicted = points?.[index];
  if (predicted === undefined) return null;
  const measured = [
    ...g.measured.filter((entry) => entry.index !== index),
    { index, machine: confirmedMachine },
  ];
  const geometry = { ...g, measured };
  const registration = outlineRegistration(geometry);
  if (registration === null) return null;
  return {
    geometry,
    predictionErrorMm: distance(predicted, confirmedMachine),
    maxResidualMm: registration.maxResidualMm,
  };
}

function machineToView(point: Vec2, signs: ViewAxisSigns): Vec2 {
  return { x: signs.x * point.x, y: signs.y * point.y };
}

function viewToMachine(point: Vec2, signs: ViewAxisSigns): Vec2 {
  return { x: signs.x * point.x, y: signs.y * point.y };
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
