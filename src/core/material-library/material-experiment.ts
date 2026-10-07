import type { Bounds, MachineKind, Vec2 } from '../scene';
import { applyHomography, solveHomography } from '../camera/homography';
import type { ProcessRecipe } from './process-recipe';

/** Empirical notes are user observations, never controller-completion evidence. */
export type ExperimentCell = {
  readonly id: string;
  readonly row: number;
  readonly column: number;
  readonly objectId: string;
  readonly bounds: Bounds;
  readonly requestedFeed: number;
  readonly effectiveFeed: number;
  readonly process: ProcessRecipe;
  readonly observation: string;
  readonly recipeRef?: {
    readonly kind: 'material' | 'process';
    readonly id: string;
    readonly revision: string;
  };
};

/** Photo coordinates are fractions of the original image, independent of UI size. */
export type ExperimentPhoto = {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly registration?: readonly [Vec2, Vec2, Vec2, Vec2];
};

export type MaterialExperiment = {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly source: 'grid' | 'artwork';
  readonly machineKind: MachineKind;
  readonly deviceName: string;
  readonly profileId?: string;
  readonly headDescription?: string;
  readonly axes?: string;
  readonly material: string;
  readonly batch: string;
  readonly thicknessMm?: number;
  readonly notes: string;
  readonly cells: ReadonlyArray<ExperimentCell>;
  readonly selectedCellId?: string;
  readonly photo?: ExperimentPhoto;
};

export function experimentBounds(experiment: MaterialExperiment): Bounds {
  return {
    minX: Math.min(...experiment.cells.map((cell) => cell.bounds.minX)),
    minY: Math.min(...experiment.cells.map((cell) => cell.bounds.minY)),
    maxX: Math.max(...experiment.cells.map((cell) => cell.bounds.maxX)),
    maxY: Math.max(...experiment.cells.map((cell) => cell.bounds.maxY)),
  };
}

export function experimentCorners(experiment: MaterialExperiment): readonly Vec2[] {
  const bounds = experimentBounds(experiment);
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

export function registeredCellPolygon(
  experiment: MaterialExperiment,
  cell: ExperimentCell,
): ReadonlyArray<Vec2> | null {
  const registration = experiment.photo?.registration;
  if (registration === undefined || !validRegistration(registration)) return null;
  const transform = solveHomography(
    experimentCorners(experiment).map((src, i) => ({ src, dst: registration[i] as Vec2 })),
  );
  if (!transform.ok) return null;
  const b = cell.bounds;
  const points = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((point) => applyHomography(transform.matrix, point));
  return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    ? points
    : null;
}

export function photoCellAt(experiment: MaterialExperiment, point: Vec2): ExperimentCell | null {
  const registration = experiment.photo?.registration;
  if (registration === undefined || !validRegistration(registration)) return null;
  const transform = solveHomography(
    registration.map((src, i) => ({ src, dst: experimentCorners(experiment)[i] as Vec2 })),
  );
  if (!transform.ok) return null;
  const position = applyHomography(transform.matrix, point);
  // Gaps deliberately select no cell; never round them to a neighbouring recipe.
  return (
    experiment.cells.find(
      ({ bounds: b }) =>
        position.x >= b.minX &&
        position.x <= b.maxX &&
        position.y >= b.minY &&
        position.y <= b.maxY,
    ) ?? null
  );
}

export function validRegistration(points: ReadonlyArray<Vec2>): boolean {
  if (points.length !== 4) return false;
  const turns = points.map((point, i) => {
    const next = points[(i + 1) % 4] as Vec2;
    const after = points[(i + 2) % 4] as Vec2;
    return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
  });
  return turns.every((value) => value > 1e-8) || turns.every((value) => value < -1e-8);
}
