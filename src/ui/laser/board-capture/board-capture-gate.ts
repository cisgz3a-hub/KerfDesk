import type { Vec2 } from '../../../core/scene';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import type { LaserState } from '../../state/laser-store';
import { jogFrameCommandBlockMessage } from '../../state/laser-store-helpers';

/** Why Place Board's Capture and Finish cannot run now, or null. The PC buttons and the
 * remote board tools both read it, so a remote capture is refused exactly when the PC's
 * Capture button is disabled (ADR-654 Amendment 1). */
export function boardCaptureBlockMessage(state: LaserState): string | null {
  if (state.connection.kind !== 'connected')
    return 'Connect the machine to capture or check a board.';
  if (state.autofocusBusy) return 'Wait for autofocus to finish.';
  if (state.pendingUntrackedAcks > 0 || (state.pendingTransportWrites ?? 0) > 0)
    return 'Wait for the previous controller command to settle.';
  return jogFrameCommandBlockMessage(state);
}

/** The machine position in the latest status report, read with the gate above. */
export function boardCapturePosition(state: LaserState): Vec2 | null {
  return inferCurrentMachinePosition(
    state.statusReport,
    state.wcoCache,
    state.controllerSettings?.reportInches === true,
  );
}
