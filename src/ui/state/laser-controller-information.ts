import type { StoreApi } from 'zustand';
import type { LaserState } from './laser-store';
import { controllerReconnectRecommended, controllerWentSilent } from './controller-recovery-status';
import { machineSettingsReadBlockReason } from './machine-settings-read-readiness';
import {
  scheduleControllerQualification,
  type ControllerQualificationScheduleRefs,
} from './laser-controller-qualification';
import type { StatusPollScheduleRefs } from './laser-status-poll-schedule';

export type {
  ControllerQualification,
  ControllerQualificationScheduleRefs,
} from './laser-controller-qualification';

export function controllerInformationStatusActions(
  get: () => LaserState,
  refs: ControllerQualificationScheduleRefs & StatusPollScheduleRefs,
): Pick<
  LaserState,
  | 'getMachineSettingsReadBlockReason'
  | 'getControllerReconnectRecommended'
  | 'getControllerWentSilent'
> {
  return {
    getMachineSettingsReadBlockReason: () =>
      machineSettingsReadBlockReason(get(), {
        settingsCollectionActive: refs.settingsCollector?.kind === 'collecting',
        resetCleanupPending: refs.pendingResetCleanup != null,
      }),
    getControllerReconnectRecommended: () => controllerReconnectRecommended(get()),
    // Silence counts only time the status poll ran on schedule (ADR-356).
    getControllerWentSilent: () => controllerWentSilent(get(), Date.now(), refs.statusPollSchedule),
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
