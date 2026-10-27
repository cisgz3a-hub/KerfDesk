import { useLaserStore } from '../../state/laser-store';
import { boardCaptureBlockMessage } from './board-capture-gate';

export function useCaptureGating(): {
  readonly connected: boolean;
  readonly disabled: boolean;
  readonly blockedReason: string | null;
} {
  const connected = useLaserStore((state) => state.connection.kind === 'connected');
  const blockedReason = useLaserStore(boardCaptureBlockMessage);
  return { connected, disabled: blockedReason !== null, blockedReason };
}
