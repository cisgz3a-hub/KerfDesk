// One click from Job Review's laser-mode-off warning to the setting it asks
// for (UX audit U8-P2-1, ADR-637 Amendment 7), the twin of the router's
// Send $32=0 (ADR-180 Amendment 6). A verified write rebuilds Job Review from
// the re-read settings, and the warning clears. The warning never gates Start
// (PROJECT.md rule 21); this is its in-place fix. A driver that sends no `$`
// setting writes (FluidNC's YAML, Falcon's read-only contract) gets no button.

import { useState } from 'react';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';
import { useLaserStore } from '../../state/laser-store';
import { LASER_MODE_ON_EFFECT, writeLaserModeOn } from '../laser-mode-write';

export const SEND_LASER_MODE_PROMPT = `Write $32=1 to the controller?\n\n${LASER_MODE_ON_EFFECT}`;

export function SendLaserModeButton(): JSX.Element | null {
  const writable = useLaserStore((state) => state.capabilities.settings === 'grbl-dollar');
  const operationBusy = useLaserStore((state) => state.controllerOperation !== null);
  const [sending, setSending] = useState(false);
  if (!writable) return null;
  const send = async (): Promise<void> => {
    if (sending || !jobAwareConfirm(SEND_LASER_MODE_PROMPT)) return;
    setSending(true);
    try {
      await writeLaserModeOn();
    } finally {
      setSending(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void send()}
      disabled={operationBusy || sending}
      title="Write $32=1 to the controller, then read the settings back to confirm it."
      style={buttonStyle}
    >
      {sending ? 'Sending $32=1…' : 'Send $32=1'}
    </button>
  );
}

const buttonStyle: React.CSSProperties = { marginLeft: 8 };
