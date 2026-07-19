import { gcodeUsesM7 } from '../../core/preflight/m7-air-assist-readiness';
import type { StartJobOptions } from './laser-job-options';
import {
  captureLaserModeStartSnapshot,
  createLaserModeStartEvidence,
} from './laser-mode-start-evidence';
import { useLaserStore } from './laser-store';

/** Low-level store harnesses have no Job Review. Make their acknowledgement
 * explicit so production's wire-boundary evidence requirement stays intact. */
export function startTestLaserJob(gcode: string, options: StartJobOptions = {}): Promise<void> {
  const state = useLaserStore.getState();
  const snapshot = captureLaserModeStartSnapshot(state);
  return state.startJob(gcode, {
    ...options,
    machineKind: 'laser',
    laserModeStartEvidence: createLaserModeStartEvidence(
      snapshot,
      snapshot.maxPowerS ?? 1000,
      gcodeUsesM7(gcode),
      true,
    ),
  });
}

/** Complete the read-only stock-GRBL handshake owned by connection tests. */
export function respondToTestGrblHandshake(
  data: string,
  emitLine: (line: string) => void,
  modalState = 'G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0',
): void {
  respondToTestGrblBuildInfo(data, emitLine);
  if (
    data === '$G\n' &&
    useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
  ) {
    emitLine(`[GC:${modalState}]`);
    emitLine('ok');
  }
}

export function respondToTestGrblBuildInfo(data: string, emitLine: (line: string) => void): void {
  if (
    data === '$I\n' &&
    useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
  ) {
    emitLine('[VER:1.1h.20190830:test]');
    emitLine('[OPT:VM,15,128]');
    emitLine('ok');
  }
}

/** Drain the promise continuations between the settings, build-info, and
 * modal-state stages, then prove that the fake connection completed the same
 * qualification sequence as a real stock-GRBL controller. */
export async function settleTestGrblHandshake(): Promise<void> {
  for (let index = 0; index < 128; index += 1) {
    await Promise.resolve();
    const state = useLaserStore.getState();
    if (
      state.controllerOperation === null &&
      state.pendingUntrackedAcks === 0 &&
      state.controllerQualification.epoch === state.controllerSessionEpoch &&
      state.controllerBuildInfoObservation?.sessionEpoch === state.controllerSessionEpoch &&
      (state.controllerQualification.kind !== 'qualified' || state.activeWcs !== null)
    ) {
      return;
    }
  }
  const state = useLaserStore.getState();
  throw new Error(
    `The test GRBL handshake did not settle (${JSON.stringify({
      controllerOperation: state.controllerOperation,
      pendingUntrackedAcks: state.pendingUntrackedAcks,
      controllerQualification: state.controllerQualification,
      controllerBuildInfoObservation: state.controllerBuildInfoObservation,
      controllerSessionEpoch: state.controllerSessionEpoch,
      activeWcs: state.activeWcs,
    })}).`,
  );
}
