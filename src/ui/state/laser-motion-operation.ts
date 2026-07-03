import type { GrblState } from '../../core/controllers/grbl';

export type LaserMotionOperationKind = 'frame' | 'jog';

export type LaserMotionOperation = {
  readonly kind: LaserMotionOperationKind;
  readonly sawControllerBusy: boolean;
  readonly idleStatusReports: number;
  readonly dispatchComplete: boolean;
  readonly pendingLines: ReadonlyArray<string>;
};

export function startMotionOperation(
  kind: LaserMotionOperationKind,
  pendingLines: ReadonlyArray<string> = [],
): LaserMotionOperation {
  return {
    kind,
    sawControllerBusy: false,
    idleStatusReports: 0,
    dispatchComplete: false,
    pendingLines,
  };
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

export function takeNextFrameJogLine(
  operation: LaserMotionOperation | null,
): { readonly operation: LaserMotionOperation; readonly line: string } | null {
  if (operation === null || operation.kind !== 'frame') return null;
  const [line, ...pendingLines] = operation.pendingLines ?? [];
  if (line === undefined) return null;
  return { operation: startMotionOperation('frame', pendingLines), line };
}

// Frame move construction moved to the ControllerDriver (ADR-094):
// core/controllers/grbl/frame-lines.ts owns the GRBL $J= perimeter builder.
