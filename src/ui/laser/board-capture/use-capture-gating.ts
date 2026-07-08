// use-capture-gating — the board-capture panel's Capture/jog gate, mirroring the
// JogPad: connected + Idle + no autofocus / motion / active job in flight. Kept
// out of the panel component so it stays under the function-size cap.

import { useLaserStore } from '../../state/laser-store';
import { isActiveJob } from '../../state/laser-store-helpers';

export function useCaptureGating(): { readonly connected: boolean; readonly disabled: boolean } {
  const connection = useLaserStore((s) => s.connection);
  const statusReport = useLaserStore((s) => s.statusReport);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const streamer = useLaserStore((s) => s.streamer);
  const connected = connection.kind === 'connected';
  const disabled =
    !connected ||
    statusReport?.state !== 'Idle' ||
    autofocusBusy ||
    motionOperation !== null ||
    controllerOperation !== null ||
    isActiveJob(streamer);
  return { connected, disabled };
}
