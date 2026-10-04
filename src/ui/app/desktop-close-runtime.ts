import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import {
  controllerOperationOwner,
  isUnsafeControllerOperation,
} from '../state/laser-controller-operation';
import { createAutosaveProjectSnapshot } from '../state/autosave-project-snapshot';
import { useToastStore } from '../state/toast-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { pendingTransportWriteCount } from '../state/laser-start-queue-fence';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import { DesktopCloseController, type DesktopCloseReply } from './desktop-close-controller';

// Reuse the existing immutable document/setup identity; no serialization or
// hashing on close. Open/New epochs and true-to-true dirty edits change it.
const documentSnapshot = createAutosaveProjectSnapshot();

export const FIRE_NOT_CONFIRMED_OFF_WARNING =
  'KerfDesk could not confirm that Fire is off, so the laser beam may still be on. Release the ' +
  'Fire control, and use the physical E-stop or power cutoff if the beam may still be on.';

export const desktopCloseController = new DesktopCloseController(() => {
  const laser = useLaserStore.getState();
  return {
    active: isActiveJob(laser.streamer),
    fireLatched: laser.fireActive,
    motionOwner: laser.motionOperation?.operationId ?? null,
    controllerOwner: controllerOwner(laser),
    epoch: laser.streamerEpoch,
    dirty: useStore.getState().dirty,
    document: documentSnapshot(useStore.getState()),
    warning: closeWarning(laser),
    updateBlocked: updateCloseBlocked(laser),
  };
}, stopBeforeClose);

function updateCloseBlocked(laser: ReturnType<typeof useLaserStore.getState>): boolean {
  return (
    useFramePreparationStore.getState().pending ||
    useJobReviewStore.getState().state.kind === 'open' ||
    laser.pendingUntrackedAcks > 0 ||
    pendingTransportWriteCount(laser) > 0 ||
    observedControllerBusy(laser)
  );
}

function observedControllerBusy(laser: ReturnType<typeof useLaserStore.getState>): boolean {
  if (laser.connection.kind !== 'connected') return false;
  const report = laser.statusReport;
  if (report !== null && ['Run', 'Jog', 'Home', 'Hold', 'Door'].includes(report.state)) return true;
  // GRBL omits A:/Ov: between accessory observations. The canonical cache
  // also retains grblHAL tool-change/secondary-spindle evidence.
  const accessories = laser.accessoryCache ?? report?.accessories;
  return (
    accessories != null &&
    (accessories.spindleCw ||
      accessories.spindleCcw ||
      accessories.toolChangePending === true ||
      accessories.secondarySpindlePresent === true)
  );
}

// A latched Fire is turned off before a running job is aborted. Web pages
// cannot await a write while they unload, so the desktop handoff is the one
// place that M5 is sure to be written (controller audit electron-native-3).
async function stopBeforeClose(): Promise<void> {
  if (useLaserStore.getState().fireActive) await useLaserStore.getState().setFireActive(false);
  // Recovery records this stop as the app closing, not as an operator Abort.
  const laser = useLaserStore.getState();
  if (
    isActiveJob(laser.streamer) ||
    laser.motionOperation !== null ||
    isUnsafeControllerOperation(laser.controllerOperation)
  ) {
    await laser.stopJob('app-closing');
  }
}

function controllerOwner(laser: ReturnType<typeof useLaserStore.getState>): object | string | null {
  const operation = laser.controllerOperation;
  if (!isUnsafeControllerOperation(operation) || operation === null) return null;
  // Status/phase updates replace these records while preserving their owner.
  if (operation.kind === 'home') return `home:${operation.operationId}`;
  if (operation.kind === 'probe') return `probe:${operation.transactionId}`;
  return controllerOperationOwner(operation);
}

function closeWarning(laser: ReturnType<typeof useLaserStore.getState>): string | null {
  const notice = laser.safetyNotice;
  if (notice?.kind === 'disconnect-stop-unconfirmed') return notice.message;
  if (notice?.kind === 'write-failed' && (notice.action === 'stop' || notice.action === 'fire')) {
    return notice.message;
  }
  return laser.fireActive ? FIRE_NOT_CONFIRMED_OFF_WARNING : null;
}

interface CloseRequest {
  readonly operation: 'prepare' | 'prepare-update' | 'save' | 'approve' | 'cancel';
  readonly requestId: number;
  readonly respond: (reply: DesktopCloseReply) => void;
}

function isCloseRequest(value: unknown): value is CloseRequest {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'operation' in value &&
    ['prepare', 'prepare-update', 'save', 'approve', 'cancel'].includes(String(value.operation)) &&
    'requestId' in value &&
    typeof value.requestId === 'number' &&
    Number.isSafeInteger(value.requestId) &&
    'respond' in value &&
    typeof value.respond === 'function'
  );
}

/**
 * Main invokes these four fixed renderer operations. This DOM event grants no
 * main-process capability: no preload, ipcRenderer, filesystem or shell API is
 * exposed. Ordinary web unload keeps the existing best-effort fallback until
 * the desktop main process requests ownership of a close attempt. `save` runs
 * the project's own Save (ADR-549); without it, Save before closing cancels.
 */
export function installDesktopCloseReceiver(
  target: Window,
  saveProject: () => Promise<boolean> = async () => false,
): () => void {
  const receive = (event: Event): void => {
    if (!(event instanceof CustomEvent) || !isCloseRequest(event.detail)) return;
    event.preventDefault();
    const request = event.detail;
    if (request.operation === 'prepare-update') {
      void desktopCloseController.prepareForUpdate(request.requestId).then((reply) => {
        if (reply.status === 'cancelled')
          useToastStore
            .getState()
            .pushToast(
              'Finish machine work and resolve any stop warning before installing the update. KerfDesk stays open; choose Install and close KerfDesk again when ready.',
              'info',
            );
        request.respond(reply);
      });
    } else if (request.operation === 'prepare') {
      void desktopCloseController.prepare(request.requestId).then(request.respond);
    } else if (request.operation === 'save') {
      void desktopCloseController.save(request.requestId, saveProject).then(request.respond);
    } else if (request.operation === 'approve') {
      request.respond(desktopCloseController.approve(request.requestId));
    } else {
      request.respond(desktopCloseController.cancel(request.requestId));
    }
  };
  target.addEventListener('kerfdesk:desktop-close', receive);
  return () => {
    target.removeEventListener('kerfdesk:desktop-close', receive);
    desktopCloseController.keepOpen();
  };
}
