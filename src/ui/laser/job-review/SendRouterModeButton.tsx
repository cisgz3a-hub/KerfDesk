// One click from Job Review's router laser-mode warning to the setting it asks
// for (CNC audit JR-1, ADR-180 Amendment 6). It uses Machine Settings' own
// guarded write, which refuses anything but an Idle, read controller and reads
// $$ back to verify the value. Job Review then rebuilds from the verified
// settings, and the warning clears. The warning never gates Start
// (PROJECT.md rule 21); this is its in-place fix.

import { useState } from 'react';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';
import { useLaserStore } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';

export const SEND_ROUTER_MODE_PROMPT =
  'Write $32=0 to the controller?\n\n' +
  'This turns GRBL laser mode off, so the spindle runs its spin-up delay and keeps turning ' +
  'through rapids. The controller keeps the setting until it is changed, and KerfDesk reads ' +
  'the settings back to confirm it.';

export const ROUTER_MODE_CONFIRMED_MESSAGE = 'Laser mode is off: the controller confirmed $32=0.';

export function SendRouterModeButton(): JSX.Element {
  const operationBusy = useLaserStore((state) => state.controllerOperation !== null);
  const [sending, setSending] = useState(false);
  const send = async (): Promise<void> => {
    if (sending || !jobAwareConfirm(SEND_ROUTER_MODE_PROMPT)) return;
    setSending(true);
    try {
      await useLaserStore.getState().writeGrblSetting(32, '0');
      useToastStore.getState().pushToast(ROUTER_MODE_CONFIRMED_MESSAGE, 'success');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      useToastStore.getState().pushToast(`$32=0 was not written: ${reason}`, 'warning');
    } finally {
      setSending(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void send()}
      disabled={operationBusy || sending}
      title="Write $32=0 to the controller, then read the settings back to confirm it."
      style={buttonStyle}
    >
      {sending ? 'Sending $32=0…' : 'Send $32=0'}
    </button>
  );
}

const buttonStyle: React.CSSProperties = { marginLeft: 8 };
