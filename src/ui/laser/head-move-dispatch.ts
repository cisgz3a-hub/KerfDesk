// head-move-dispatch — send the head to a typed, saved or selection position
// (LightBurn gaps LBG-T15 and LBG-M02, ADR-483). One path for all three: the
// position resolves to native MPos through head-position-frames, then goes out
// as the laser store's beam-off machine-position jog, which already handles the
// work-offset delta, CNC safe Z, the Frame permit and the configured-bounds and
// no-go-zone warnings (ADR-232: those warn, the controller's limits decide).
// A missing connection, a busy machine or a missing work offset is a transport
// fact shown as a toast and nothing is sent; nothing new is refused (ADR-228).
// An unverified bed mapping only warns, as it does for Start.

import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import { rotaryAppliesTo } from '../../core/job/rotary-job';
import type { Project, Vec2 } from '../../core/scene';
import type { SavedPositionFrame } from '../../core/devices/device-profile';
import {
  headPositionToNative,
  nativeToHeadPosition,
  type HeadFrameContext,
  type HeadPosition,
} from '../../core/devices/head-position-frames';
import { useStore } from '../state';
import { inferCurrentMachinePosition, reportedWorkOffsetMm } from '../state/infer-machine-position';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { jogFrameCommandBlockMessage } from '../state/laser-store-helpers';
import { resolveNativeBedFrame, selectNativeBedEvidence } from '../state/native-bed-frame';
import { useToastStore } from '../state/toast-store';
import { clampJogFeed } from './jog-control-policy';
import { useJogControlPreferences } from './jog-control-preferences';

export const HEAD_MOVE_NEEDS_CONNECTION = 'Connect the machine to move the laser head.';
export const HEAD_MOVE_UNVERIFIED_BED =
  'The controller-to-bed mapping is unverified, so the head goes where an Absolute job would put that canvas point. Check the physical spot at the machine.';
export const HEAD_MOVE_ROTARY_X_ONLY =
  'The rotary is on, so only X moves: Y on the rotary is rotation from where the job starts, not a place on the bed.';
export const HEAD_MOVE_NEEDS_WORK_OFFSET =
  'The controller has not reported its work offset yet. Wait for a status report and try again.';

/** The frame facts for converting head positions right now. */
export function headFrameContext(laser: LaserState): HeadFrameContext {
  const device = useStore.getState().project.device;
  const reportInches = laser.controllerSettings?.reportInches === true;
  const offset = reportedWorkOffsetMm(laser.wcoCache, reportInches);
  return {
    device,
    nativeFrame: resolveNativeBedFrame(device, selectNativeBedEvidence(laser)),
    workOffsetMm: offset === null ? null : { x: offset.x, y: offset.y },
  };
}

/** Why a head move cannot be sent now, or null when the machine can take it. */
export function headMoveBlockMessage(laser: LaserState): string | null {
  if (laser.connection.kind !== 'connected') return HEAD_MOVE_NEEDS_CONNECTION;
  return jogFrameCommandBlockMessage(laser);
}

/** The head's current position in a frame, or null when it cannot be read. */
export function currentHeadPosition(frame: SavedPositionFrame): HeadPosition | null {
  const laser = useLaserStore.getState();
  const reportInches = laser.controllerSettings?.reportInches === true;
  const native = inferCurrentMachinePosition(laser.statusReport, laser.wcoCache, reportInches);
  if (native === null) return null;
  return nativeToHeadPosition(native, frame, headFrameContext(laser));
}

/**
 * Jog the head, beam off, to a position. Returns true when the jog was sent;
 * otherwise the reason is a toast and nothing moved. `what` names the target in
 * the failure toast ("Cannot move to <what>: ...").
 */
export function dispatchHeadMove(position: HeadPosition, what: string): boolean {
  const toast = useToastStore.getState().pushToast;
  const laser = useLaserStore.getState();
  const blocked = headMoveBlockMessage(laser);
  if (blocked !== null) {
    toast(blocked, 'error');
    return false;
  }
  const resolved = headPositionToNative(position, headFrameContext(laser));
  if (resolved.kind !== 'native') {
    toast(HEAD_MOVE_NEEDS_WORK_OFFSET, 'error');
    return false;
  }
  if (!resolved.verified) toast(HEAD_MOVE_UNVERIFIED_BED, 'warning');
  const project = useStore.getState().project;
  const target = rotaryKeepsY(laser, project, resolved.point);
  if (target !== resolved.point) toast(HEAD_MOVE_ROTARY_X_ONLY, 'warning');
  const maxFeed = deviceForActiveHead(project.device, project.machine).maxFeed;
  const feed = clampJogFeed(useJogControlPreferences.getState().requestedFeedMmPerMin, maxFeed);
  void laser.jogToMachinePosition(target.x, target.y, feed).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    toast(`Cannot move to ${what}: ${reason}`, 'warning');
  });
  return true;
}

// Rotary output rebases Y to the job's own start and scales it to the roller
// (machineSpaceJob), so no canvas or work Y names a rotation. The move keeps the
// current Y and goes to X only; without a live position the jog path reports
// that itself.
function rotaryKeepsY(laser: LaserState, project: Project, point: Vec2): Vec2 {
  if (!rotaryAppliesTo(project.device, project.machine)) return point;
  const reportInches = laser.controllerSettings?.reportInches === true;
  const current = inferCurrentMachinePosition(laser.statusReport, laser.wcoCache, reportInches);
  return current === null ? point : { x: point.x, y: current.y };
}
