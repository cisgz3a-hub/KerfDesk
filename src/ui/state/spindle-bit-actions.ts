// The Machine rail's "Bit in the spindle" choice (ADR-416 Amendment 4). Kept
// out of the laser store's action table: it writes one session field and sends
// nothing to the controller.

import { useLaserStore } from './laser-store';
import { pushLog } from './laser-store-helpers';
import { declaredSpindleBit, SPINDLE_BIT_LABEL } from './spindle-bit';
import { useStore } from './store';

/**
 * Declares which bit is in the spindle. The next Zero Z, probe or controller
 * read-back records Work Z for it; a Work Z already recorded keeps the bit it
 * was taken with. False for a bit neither the open project nor the current
 * bit-change hold offers.
 */
export function declareSpindleBit(toolId: string): boolean {
  const bit = declaredSpindleBit(useLaserStore.getState(), useStore.getState().project, toolId);
  if (bit === null) return false;
  useLaserStore.setState((state) =>
    state.spindleBit?.toolId === bit.toolId
      ? {}
      : { spindleBit: bit, log: pushLog(state, `[lf2] ${SPINDLE_BIT_LABEL}: ${bit.name}.`) },
  );
  return true;
}
