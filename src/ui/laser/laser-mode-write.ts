// Turns GRBL laser mode on ($32=1) for a laser whose controller has it off
// (UX audit U8-P2-1, ADR-637 Amendment 7). It is the twin of Job Review's
// Send $32=0 (ADR-180 Amendment 6) and uses Machine Settings' own guarded
// write: a `$`-setting driver, an Idle controller read this session, no
// operation running, the machine-kind rule (only exact $32=1 on a laser), and
// a `$$` read-back that must show the written value.

import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';

export const LASER_MODE_CONFIRMED_MESSAGE = 'Laser mode is on: the controller confirmed $32=1.';

/** What laser mode on changes, said before the write is confirmed. */
export const LASER_MODE_ON_EFFECT =
  'This turns GRBL laser mode on, so the laser changes power without stopping and stays off during rapids. The controller keeps the setting until it is changed, and KerfDesk reads the settings back to confirm it.';

/** Writes $32=1 and says how it went. True when the controller confirmed it. */
export async function writeLaserModeOn(): Promise<boolean> {
  try {
    await useLaserStore.getState().writeGrblSetting(32, '1');
    useToastStore.getState().pushToast(LASER_MODE_CONFIRMED_MESSAGE, 'success');
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    useToastStore.getState().pushToast(`$32=1 was not written: ${reason}`, 'warning');
    return false;
  }
}
