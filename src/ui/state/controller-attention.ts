// The controller state the toolbar's connection pill must not hide. The Alarm
// card lives in the machine rail, so an alarm raised while the Artwork tab was
// open showed nowhere until Frame was pressed, and a Marlin halt kept a green
// "Connected" (UX audit U5-P3-1, U5-P3-6).

import { isControllerHaltedNotice } from './laser-safety-notice';
import type { LaserState } from './laser-store';

export type ControllerAttention = 'alarm' | 'halted';

export function controllerAttention(
  state: Pick<LaserState, 'connection' | 'safetyNotice' | 'statusReport' | 'alarmCode'>,
): ControllerAttention | null {
  if (state.connection.kind !== 'connected') return null;
  if (isControllerHaltedNotice(state.safetyNotice)) return 'halted';
  return state.alarmCode !== null || state.statusReport?.state === 'Alarm' ? 'alarm' : null;
}
