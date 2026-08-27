import { assertNever, type Bounds } from './scene-object';

export type GridArraySpec = {
  readonly kind: 'grid';
  readonly rows: number;
  readonly columns: number;
  readonly spacingX: number;
  readonly spacingY: number;
};

export type CircularArraySpec = {
  readonly kind: 'circular';
  readonly count: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
  readonly startAngleDeg: number;
  readonly rotateCopies: boolean;
};

export type PointRotationArraySpec = {
  readonly kind: 'point-rotation';
  readonly count: number;
  readonly totalAngleDeg: number;
};

export type ArraySpec = GridArraySpec | CircularArraySpec | PointRotationArraySpec;

export type ArrayPlacement = {
  readonly dx: number;
  readonly dy: number;
  readonly rotationDeg: number;
  // Scene-space point the copy rotates about. Circular arrays use the
  // destination ring point; Point Rotation uses the combined selection centre.
  // Present only when rotationDeg is non-zero.
  readonly pivot?: { readonly x: number; readonly y: number };
};

export function arrayPlacements(bounds: Bounds, spec: ArraySpec): ReadonlyArray<ArrayPlacement> {
  switch (spec.kind) {
    case 'grid':
      return gridPlacements(bounds, spec);
    case 'circular':
      return circularPlacements(bounds, spec);
    case 'point-rotation':
      return pointRotationPlacements(bounds, spec);
    default:
      return assertNever(spec, 'ArraySpec');
  }
}

function gridPlacements(bounds: Bounds, spec: GridArraySpec): ReadonlyArray<ArrayPlacement> {
  const rows = positiveCount(spec.rows);
  const columns = positiveCount(spec.columns);
  const copyCount = rows * columns;
  const stepX = span(bounds.minX, bounds.maxX) + finiteNonNegative(spec.spacingX);
  const stepY = span(bounds.minY, bounds.maxY) + finiteNonNegative(spec.spacingY);
  const placements: ArrayPlacement[] = [];
  for (let index = 0; index < copyCount; index += 1) {
    placements.push({
      dx: (index % columns) * stepX,
      dy: Math.floor(index / columns) * stepY,
      rotationDeg: 0,
    });
  }
  return placements;
}

function circularPlacements(
  bounds: Bounds,
  spec: CircularArraySpec,
): ReadonlyArray<ArrayPlacement> {
  const count = positiveCount(spec.count);
  const radius = finiteNonNegative(spec.radius);
  const sourceCenter = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const start = finite(spec.startAngleDeg) * (Math.PI / 180);
  return Array.from({ length: count }, (_, index) => {
    const angle = start + (index * Math.PI * 2) / count;
    const angleDeg = (angle * 180) / Math.PI;
    const target = {
      x: finite(spec.centerX) + Math.cos(angle) * radius,
      y: finite(spec.centerY) + Math.sin(angle) * radius,
    };
    return {
      dx: target.x - sourceCenter.x,
      dy: target.y - sourceCenter.y,
      rotationDeg: spec.rotateCopies ? angleDeg + 90 : 0,
      ...(spec.rotateCopies ? { pivot: target } : {}),
    };
  });
}

function pointRotationPlacements(
  bounds: Bounds,
  spec: PointRotationArraySpec,
): ReadonlyArray<ArrayPlacement> {
  const count = positiveCount(spec.count);
  const pivot = {
    x: (finite(bounds.minX) + finite(bounds.maxX)) / 2,
    y: (finite(bounds.minY) + finite(bounds.maxY)) / 2,
  };
  const stepDeg = finite(spec.totalAngleDeg) / count;
  return Array.from({ length: count }, (_, index) => {
    const rotationDeg = index === 0 ? 0 : index * stepDeg;
    return {
      dx: 0,
      dy: 0,
      rotationDeg,
      ...(rotationDeg === 0 ? {} : { pivot }),
    };
  });
}

function positiveCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function finiteNonNegative(value: number): number {
  return Math.max(0, finite(value));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function span(min: number, max: number): number {
  return Math.max(0, finite(max) - finite(min));
}
