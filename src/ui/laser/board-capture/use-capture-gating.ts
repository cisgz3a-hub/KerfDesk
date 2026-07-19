import { useLaserStore } from '../../state/laser-store';
import { jogFrameCommandBlockMessage } from '../../state/laser-store-helpers';

export function useCaptureGating(): {
  readonly connected: boolean;
  readonly disabled: boolean;
  readonly blockedReason: string | null;
} {
  const connection = useLaserStore((state) => state.connection);
  const autofocusBusy = useLaserStore((state) => state.autofocusBusy);
  const pendingUntrackedAcks = useLaserStore((state) => state.pendingUntrackedAcks);
  const pendingTransportWrites = useLaserStore((state) => state.pendingTransportWrites ?? 0);
  const commandBlockMessage = useLaserStore(jogFrameCommandBlockMessage);
  const connected = connection.kind === 'connected';
  const blockedReason = !connected
    ? 'Connect the machine to capture or check a board.'
    : autofocusBusy
      ? 'Wait for autofocus to finish.'
      : pendingUntrackedAcks > 0 || pendingTransportWrites > 0
        ? 'Wait for the previous controller command to settle.'
        : commandBlockMessage;
  return { connected, disabled: blockedReason !== null, blockedReason };
}
