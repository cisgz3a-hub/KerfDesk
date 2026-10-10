import type { LaserState } from '../state/laser-store';
import { isActiveJobStatus } from '../state/laser-store-helpers';
import { unownedControllerMotion } from '../state/unowned-controller-motion';

/** Machine work an automatic prompt must not appear over. */
export function machineWorkActive(state: LaserState): boolean {
  return (
    isActiveJobStatus(state.streamer?.status ?? null) ||
    state.motionOperation !== null ||
    state.controllerOperation !== null ||
    state.fireActive ||
    state.mpgActive === true ||
    unownedControllerMotion(state) !== null
  );
}
