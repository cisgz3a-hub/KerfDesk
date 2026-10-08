import type { StoreApi } from 'zustand';
import type { LaserState } from './laser-store';
import { controllerReconnectRecommended } from './controller-recovery-status';
import { machineSettingsReadBlockReason } from './machine-settings-read-readiness';
import {
  scheduleControllerQualification,
  type ControllerQualificationScheduleRefs,
} from './laser-controller-qualification';

export type {
  ControllerQualification,
  ControllerQualificationScheduleRefs,
} from './laser-controller-qualification';

export function controllerInformationStatusActions(
  get: () => LaserState,
  refs: ControllerQualificationScheduleRefs,
): Pick<LaserState, 'getMachineSettingsReadBlockReason' | 'getControllerReconnectRecommended'> {
  return {
    getMachineSettingsReadBlockReason: () =>
      machineSettingsReadBlockReason(get(), {
        settingsCollectionActive: refs.settingsCollector?.kind === 'collecting',
        resetCleanupPending: refs.pendingResetCleanup != null,
      }),
    getControllerReconnectRecommended: () => controllerReconnectRecommended(get()),
  };
}

/** Arm the same owned refresh for Abort, recovery and startup invalidations.
 * Initial handshake and command/cleanup owners remain ahead of the scheduler;
 * failed settings responses are not automatically retried. */
export function bindControllerQualificationScheduler(
  store: Pick<StoreApi<LaserState>, 'getState' | 'setState' | 'subscribe'>,
  refs: ControllerQualificationScheduleRefs,
): void {
  store.subscribe((state, previous) => {
    const qualification = state.controllerQualification;
    if (
      state.connection.kind !== 'connected' ||
      qualification.kind !== 'qualifying' ||
      qualification.phase === 'settings-read'
    ) {
      return;
    }
    if (
      state.controllerSessionEpoch !== previous.controllerSessionEpoch ||
      previous.connection.kind !== 'connected' ||
      previous.controllerQualification.kind !== 'qualifying'
    ) {
      scheduleControllerQualification(store.setState, store.getState, refs, qualification.epoch, {
        afterAlarm:
          qualification.phase === 'reset-cleanup' && state.capabilities.softResetReboots === false,
      });
    }
  });
}
