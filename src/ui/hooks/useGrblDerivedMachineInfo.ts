/**
 * T2-6 Phase 3t: GRBL machine-info derivations extracted from App.tsx.
 *
 * Pre-T2-6-3t these five memos lived inline in App.tsx — three
 * useMemos plus two intermediate scalars — each reading
 * `controller instanceof GrblController` and `getMachineInfo()`.
 * Bundled here as one hook so:
 *   1. App.tsx loses ~50 lines of derivation noise.
 *   2. The bed / accel / position helpers become pure functions
 *      callable from tests without mounting React.
 *   3. New consumers can pull this from one named hook instead of
 *      reaching into App-internal patterns.
 *
 * Memoization keys mirror the App.tsx originals exactly; render
 * behavior is byte-identical to the pre-extraction code.
 */
import { useMemo } from 'react';
import { type LaserController, type MachineState } from '../../controllers/ControllerInterface';
import { GrblController, type GrblMachineInfo } from '../../controllers/grbl/GrblController';
import { type MachineTransformResult } from '../../core/plan/MachineTransform';

export interface GrblDerivedMachineInfo {
  /** Position to seed the start-job wizard at. Null when disconnected/connecting. */
  machinePositionForStartWizard: { x: number; y: number } | null;
  /** Live canvas-space pen position during a running job. Null when no job. */
  liveJobCanvasPosition: { x: number; y: number } | null;
  /** $130/$131 bed dimensions when both are positive; null otherwise. */
  machineBedFromGrbl: { width: number; height: number } | null;
  /** Min of $120/$121 (single-axis fallback when only one is set); null when neither is set. */
  machineAccelFromGrbl: number | null;
  /** Full machine info snapshot when the controller is GRBL; null otherwise. */
  grblMachineInfo: GrblMachineInfo | null;
}

/** Pure helper: machine position for the start-job wizard. */
export function resolveMachinePositionForWizard(
  state: MachineState | null | undefined,
): { x: number; y: number } | null {
  if (!state || state.status === 'disconnected' || state.status === 'connecting') return null;
  return { x: state.position.x, y: state.position.y };
}

/** Pure helper: live canvas-space pen position from a running job. */
export function resolveLiveJobCanvasPosition(args: {
  isJobRunning: boolean;
  state: MachineState | null | undefined;
  transform: MachineTransformResult | null | undefined;
}): { x: number; y: number } | null {
  if (!args.isJobRunning) return null;
  const s = args.state;
  if (!s || s.status === 'disconnected' || s.status === 'connecting') return null;
  const wp = s.position;
  const t = args.transform;
  if (t) {
    const canvasX = wp.x - t.offsetX;
    const canvasY = t.flipY
      ? t.flipReferenceY - wp.y + t.offsetY
      : wp.y - t.offsetY;
    return { x: canvasX, y: canvasY };
  }
  return { x: wp.x, y: wp.y };
}

/** Pure helper: bed dimensions from a machine-info snapshot. */
export function resolveBedFromGrblInfo(
  info: GrblMachineInfo | null,
): { width: number; height: number } | null {
  if (!info) return null;
  if (info.bedWidth > 0 && info.bedHeight > 0) {
    return { width: info.bedWidth, height: info.bedHeight };
  }
  return null;
}

/** Pure helper: travel accel (mm/s²) from a machine-info snapshot. */
export function resolveAccelFromGrblInfo(info: GrblMachineInfo | null): number | null {
  if (!info) return null;
  if (info.maxAccelX > 0 && info.maxAccelY > 0) {
    return Math.min(info.maxAccelX, info.maxAccelY);
  }
  if (info.maxAccelX > 0) return info.maxAccelX;
  if (info.maxAccelY > 0) return info.maxAccelY;
  return null;
}

export interface UseGrblDerivedMachineInfoArgs {
  controller: LaserController | null;
  machineState: MachineState | null;
  isJobRunning: boolean;
  activeJobTransform: MachineTransformResult | null;
}

export function useGrblDerivedMachineInfo(
  args: UseGrblDerivedMachineInfoArgs,
): GrblDerivedMachineInfo {
  const { controller, machineState, isJobRunning, activeJobTransform } = args;

  const machinePositionForStartWizard = useMemo(
    () => resolveMachinePositionForWizard(machineState),
    [machineState],
  );

  const liveJobCanvasPosition = useMemo(
    () => resolveLiveJobCanvasPosition({ isJobRunning, state: machineState, transform: activeJobTransform }),
    [isJobRunning, machineState, activeJobTransform],
  );

  // Read bed scalars each render; memoize the {width,height} object by value
  // so GRBL status polls (new machineState references) don't churn identity.
  const _bedWidth =
    controller instanceof GrblController ? controller.getMachineInfo().bedWidth : 0;
  const _bedHeight =
    controller instanceof GrblController ? controller.getMachineInfo().bedHeight : 0;
  const machineBedFromGrbl = useMemo(() => {
    if (_bedWidth > 0 && _bedHeight > 0) return { width: _bedWidth, height: _bedHeight };
    return null;
  }, [_bedWidth, _bedHeight]);

  const machineAccelFromGrbl = useMemo(() => {
    void machineState;
    if (!(controller instanceof GrblController)) return null;
    return resolveAccelFromGrblInfo(controller.getMachineInfo());
  }, [controller, machineState]);

  const grblMachineInfo = useMemo<GrblMachineInfo | null>(() => {
    void machineState;
    if (!(controller instanceof GrblController)) return null;
    return controller.getMachineInfo();
  }, [controller, machineState]);

  return {
    machinePositionForStartWizard,
    liveJobCanvasPosition,
    machineBedFromGrbl,
    machineAccelFromGrbl,
    grblMachineInfo,
  };
}
