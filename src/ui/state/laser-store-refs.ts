import { grblDriver } from '../../core/controllers';
import { idleCollector } from '../../core/controllers/grbl';
import type { LiveRefs } from './laser-store';

/** Every store gets its own mutable lifecycle, reply and teardown ownership. */
export function createLaserStoreRefs(): LiveRefs {
  return {
    connection: null,
    safetyNoticeAcknowledgementRevision: 0,
    driver: grblDriver,
    unsubscribeLine: null,
    unsubscribeClose: null,
    pollHandle: null,
    settingsCollector: idleCollector(),
    settingsCollectorSessionEpoch: null,
    onLineArrived: null,
    nextTranscriptId: 1,
    stallProbe: null,
    qualificationTimer: null,
    qualificationDeadline: null,
    runControllerQualification: null,
    heartbeatProbe: null,
    connectAttemptRevision: 0,
    forgetIntentRevision: 0,
    closeRequests: new WeakMap(),
    intentionalDisconnects: new WeakMap(),
    forgetFinalizations: new WeakMap(),
    controllerCommand: null,
    controllerIdleWait: null,
    controllerResetWait: null,
    controllerStatusWait: null,
    pauseResumeTransition: null,
    writeEpoch: 0,
    pendingResetCleanup: null,
    untrackedAckReservations: [],
  };
}
