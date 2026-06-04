import type { GrblState } from '../../core/controllers/grbl';

export type LaserMotionOperationKind = 'frame' | 'jog';

export type LaserMotionOperation = {
  readonly kind: LaserMotionOperationKind;
  readonly sawControllerBusy: boolean;
  readonly idleStatusReports: number;
  readonly dispatchComplete: boolean;
};

export function startMotionOperation(kind: LaserMotionOperationKind): LaserMotionOperation {
  return { kind, sawControllerBusy: false, idleStatusReports: 0, dispatchComplete: false };
}

export function markMotionOperationDispatched(
  operation: LaserMotionOperation | null,
  kind: LaserMotionOperationKind,
): LaserMotionOperation | null {
  if (operation === null || operation.kind !== kind) return operation;
  return { ...operation, dispatchComplete: true };
}

export function observeMotionStatus(
  operation: LaserMotionOperation | null,
  state: GrblState,
): LaserMotionOperation | null {
  if (operation === null) return null;
  if (state === 'Idle' && operation.sawControllerBusy) return null;
  if (state === 'Idle' && !operation.dispatchComplete) return operation;
  if (state === 'Idle') {
    const idleStatusReports = operation.idleStatusReports + 1;
    return idleStatusReports >= 2 ? null : { ...operation, idleStatusReports };
  }
  if (!operation.sawControllerBusy || operation.idleStatusReports !== 0) {
    return { ...operation, sawControllerBusy: true, idleStatusReports: 0 };
  }
  return operation;
}

export function buildFrameJogLines(
  bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  },
  feed: number,
): ReadonlyArray<string> {
  const f = Math.max(1, Math.round(feed));
  const fmt = (n: number): string => n.toFixed(3);
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.minY },
  ].map((c) => `$J=G90 G21 X${fmt(c.x)} Y${fmt(c.y)} F${f}\n`);
}
