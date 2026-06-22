import { transformedBBox, type Project, type SceneObject, type Transform } from '../../core/scene';

export type SnapAxis = 'x' | 'y';

export type SnapGuide = {
  readonly axis: SnapAxis;
  readonly positionMm: number;
  readonly fromMm: number;
  readonly toMm: number;
};

export type SnapSettings = {
  readonly enabled: boolean;
  readonly snapToGrid: boolean;
  readonly snapToObjects: boolean;
  readonly distanceMm: number;
  readonly gridMm: number;
};

export const DEFAULT_SNAP_DISTANCE_MM = 2;
export const DEFAULT_SNAP_GRID_MM = 10;
export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  enabled: true,
  snapToGrid: true,
  snapToObjects: true,
  distanceMm: DEFAULT_SNAP_DISTANCE_MM,
  gridMm: DEFAULT_SNAP_GRID_MM,
};

export type SnapMoveResult = {
  readonly transform: Transform;
  readonly guides: ReadonlyArray<SnapGuide>;
};

type Aabb = ReturnType<typeof transformedBBox>;

type SnapCandidate = {
  readonly deltaMm: number;
  readonly guide: SnapGuide;
};

export function snapMoveTransform(args: {
  readonly project: Project;
  readonly movingObjectId: string;
  readonly proposedTransform: Transform;
  readonly settings: SnapSettings;
}): SnapMoveResult {
  if (!canSnap(args.settings)) return noSnap(args.proposedTransform);
  const moving = args.project.scene.objects.find((object) => object.id === args.movingObjectId);
  if (moving === undefined) return noSnap(args.proposedTransform);
  const moved = { ...moving, transform: args.proposedTransform };
  const movedBox = transformedBBox(moved);
  const snapArgs = {
    project: args.project,
    movingObjectId: moving.id,
    movedBox,
    settings: args.settings,
  };
  const x = bestSnapForAxis({ ...snapArgs, axis: 'x' });
  const y = bestSnapForAxis({ ...snapArgs, axis: 'y' });
  return {
    transform: {
      ...args.proposedTransform,
      x: args.proposedTransform.x + (x?.deltaMm ?? 0),
      y: args.proposedTransform.y + (y?.deltaMm ?? 0),
    },
    guides: [x?.guide, y?.guide].filter((guide): guide is SnapGuide => guide !== undefined),
  };
}

function canSnap(settings: SnapSettings): boolean {
  return settings.enabled && isPositiveFinite(settings.distanceMm);
}

function noSnap(transform: Transform): SnapMoveResult {
  return { transform, guides: [] };
}

function bestSnapForAxis(args: {
  readonly axis: SnapAxis;
  readonly project: Project;
  readonly movingObjectId: string;
  readonly movedBox: Aabb;
  readonly settings: SnapSettings;
}): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  for (const candidate of snapCandidates(args)) {
    if (Math.abs(candidate.deltaMm) > args.settings.distanceMm) continue;
    if (best === null || Math.abs(candidate.deltaMm) < Math.abs(best.deltaMm)) best = candidate;
  }
  return best;
}

function snapCandidates(args: {
  readonly axis: SnapAxis;
  readonly project: Project;
  readonly movingObjectId: string;
  readonly movedBox: Aabb;
  readonly settings: SnapSettings;
}): ReadonlyArray<SnapCandidate> {
  return [
    ...(args.settings.snapToObjects ? objectSnapCandidates(args) : []),
    ...(args.settings.snapToGrid ? gridSnapCandidates(args) : []),
  ];
}

function objectSnapCandidates(args: {
  readonly axis: SnapAxis;
  readonly project: Project;
  readonly movingObjectId: string;
  readonly movedBox: Aabb;
}): ReadonlyArray<SnapCandidate> {
  const candidates: SnapCandidate[] = [];
  for (const object of args.project.scene.objects) {
    if (!canUseObjectTarget(object, args.movingObjectId)) continue;
    const targetBox = transformedBBox(object);
    addObjectCandidates(candidates, args.axis, args.movedBox, targetBox);
  }
  return candidates;
}

function addObjectCandidates(
  candidates: SnapCandidate[],
  axis: SnapAxis,
  movedBox: Aabb,
  targetBox: Aabb,
): void {
  for (const movingPosition of snapPositions(movedBox, axis)) {
    for (const targetPosition of snapPositions(targetBox, axis)) {
      candidates.push({
        deltaMm: targetPosition - movingPosition,
        guide: objectGuide(axis, targetPosition, movedBox, targetBox),
      });
    }
  }
}

function gridSnapCandidates(args: {
  readonly axis: SnapAxis;
  readonly movedBox: Aabb;
  readonly settings: SnapSettings;
}): ReadonlyArray<SnapCandidate> {
  if (!isPositiveFinite(args.settings.gridMm)) return [];
  return snapPositions(args.movedBox, args.axis).map((movingPosition) => {
    const targetPosition = Math.round(movingPosition / args.settings.gridMm) * args.settings.gridMm;
    return {
      deltaMm: targetPosition - movingPosition,
      guide: gridGuide(args.axis, targetPosition, args.movedBox),
    };
  });
}

function canUseObjectTarget(object: SceneObject, movingObjectId: string): boolean {
  return object.id !== movingObjectId && object.locked !== true;
}

function snapPositions(box: Aabb, axis: SnapAxis): ReadonlyArray<number> {
  if (axis === 'x') return [box.minX, (box.minX + box.maxX) / 2, box.maxX];
  return [box.minY, (box.minY + box.maxY) / 2, box.maxY];
}

function objectGuide(
  axis: SnapAxis,
  positionMm: number,
  movedBox: Aabb,
  targetBox: Aabb,
): SnapGuide {
  if (axis === 'x') {
    return {
      axis,
      positionMm,
      fromMm: Math.min(movedBox.minY, targetBox.minY),
      toMm: Math.max(movedBox.maxY, targetBox.maxY),
    };
  }
  return {
    axis,
    positionMm,
    fromMm: Math.min(movedBox.minX, targetBox.minX),
    toMm: Math.max(movedBox.maxX, targetBox.maxX),
  };
}

function gridGuide(axis: SnapAxis, positionMm: number, movedBox: Aabb): SnapGuide {
  return axis === 'x'
    ? { axis, positionMm, fromMm: movedBox.minY, toMm: movedBox.maxY }
    : { axis, positionMm, fromMm: movedBox.minX, toMm: movedBox.maxX };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
