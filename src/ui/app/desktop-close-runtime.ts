import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { createAutosaveProjectSnapshot } from '../state/autosave-project-snapshot';
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
    epoch: laser.streamerEpoch,
    dirty: useStore.getState().dirty,
    document: documentSnapshot(useStore.getState()),
    warning: closeWarning(laser),
  };
}, stopBeforeClose);

// A latched Fire is turned off before a running job is aborted. Web pages
// cannot await a write while they unload, so the desktop handoff is the one
// place that M5 is sure to be written (controller audit electron-native-3).
async function stopBeforeClose(): Promise<void> {
  if (useLaserStore.getState().fireActive) await useLaserStore.getState().setFireActive(false);
  // Recovery records this stop as the app closing, not as an operator Abort.
  if (isActiveJob(useLaserStore.getState().streamer)) {
    await useLaserStore.getState().stopJob('app-closing');
  }
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
  readonly operation: 'prepare' | 'approve' | 'cancel';
  readonly requestId: number;
  readonly respond: (reply: DesktopCloseReply) => void;
}

function isCloseRequest(value: unknown): value is CloseRequest {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'operation' in value &&
    ['prepare', 'approve', 'cancel'].includes(String(value.operation)) &&
    'requestId' in value &&
    typeof value.requestId === 'number' &&
    Number.isSafeInteger(value.requestId) &&
    'respond' in value &&
    typeof value.respond === 'function'
  );
}

/**
 * Main invokes these three fixed renderer operations. This DOM event grants no
 * main-process capability: no preload, ipcRenderer, filesystem or shell API is
 * exposed. Ordinary web unload keeps the existing best-effort fallback until
 * the desktop main process requests ownership of a close attempt.
 */
export function installDesktopCloseReceiver(target: Window): () => void {
  const receive = (event: Event): void => {
    if (!(event instanceof CustomEvent) || !isCloseRequest(event.detail)) return;
    event.preventDefault();
    const request = event.detail;
    if (request.operation === 'prepare') {
      void desktopCloseController.prepare(request.requestId).then(request.respond);
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
