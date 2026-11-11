// The Moshiboard USB panel body (ADR-705): Connect, then Frame, Start, Home
// and Abort — the controls MOSHI_USB_CAPABILITIES lists. MoshiUsbPanel loads
// it lazily, so it and the Moshi store and encoder stay out of the boot
// bundle; it lives outside src/ui/laser, which vite.config.ts places in the
// boot ui-workbench chunk.

import { useState } from 'react';
import { moshiStatusText } from '../../core/controllers/moshi/moshi-live-commands';
import { useStore } from '../state';
import { MOSHI_NOT_QUALIFIED, MOSHI_POWER_NOTE } from '../state/moshi-usb/moshi-usb-messages';
import { prepareMoshiUsbJob } from '../state/moshi-usb/moshi-usb-job';
import { useMoshiUsbStore, type MoshiUsbState } from '../state/moshi-usb/moshi-usb-store';
import type { MoshiUsbOpener } from '../state/moshi-usb/moshi-usb-types';

export default function MoshiUsbDetails({ open }: { readonly open: MoshiUsbOpener }): JSX.Element {
  const moshi = useMoshiUsbStore();
  const disconnected = moshi.phase === 'disconnected';
  return (
    <details>
      <summary title="Connect a Moshiboard (MS10105) over its CH341 USB link.">
        Moshiboard USB connection (experimental)
      </summary>
      <p role="note">{MOSHI_NOT_QUALIFIED}</p>
      <p>{MOSHI_POWER_NOTE}</p>
      {disconnected || moshi.phase === 'connecting' ? (
        <button
          type="button"
          title="Choose the Moshiboard's USB device and read its status."
          disabled={!disconnected}
          onClick={() => void moshi.connect(open)}
        >
          Connect Moshiboard
        </button>
      ) : (
        <>
          <button
            type="button"
            title="Close the USB link. A running program gets the estop first."
            onClick={() => void moshi.disconnect()}
          >
            Disconnect Moshiboard
          </button>
          <MoshiJobControls moshi={moshi} />
        </>
      )}
      {moshi.message !== '' && (
        <p role="status" data-tone={moshi.tone}>
          {moshi.message}
        </p>
      )}
      {moshi.advisories.length > 0 && (
        <ul aria-label="Job warnings">
          {moshi.advisories.map((advisory) => (
            <li key={advisory}>{advisory}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function MoshiJobControls({ moshi }: { readonly moshi: MoshiUsbState }): JSX.Element {
  const [compileError, setCompileError] = useState('');
  const idle = moshi.phase === 'idle';
  const active = moshi.phase === 'framing' || moshi.phase === 'running' || moshi.phase === 'homing';
  const withJob = async (action: 'frame' | 'start'): Promise<void> => {
    const { project, jobPlacement } = useStore.getState();
    const prepared = await prepareMoshiUsbJob(project, jobPlacement);
    if (!prepared.ok) {
      setCompileError(prepared.messages.join(' '));
      return;
    }
    setCompileError('');
    await (action === 'frame' ? moshi.frame(prepared.job) : moshi.start(prepared.job));
  };
  return (
    <>
      <p>
        Board status: {moshiStatusText(moshi.status)}
        {moshi.sending !== null &&
          moshi.sending.total > 0 &&
          ` · sent ${moshi.sending.sent}/${moshi.sending.total} bytes`}
      </p>
      <button
        type="button"
        title="Trace the job's outline with the laser off, where the job will run."
        disabled={!idle}
        onClick={() => void withJob('frame')}
      >
        Frame (laser off)
      </button>
      <button
        type="button"
        disabled={!idle || moshi.framed === null}
        title={moshi.framed === null ? 'Frame this job first.' : 'Send the framed job and run it.'}
        onClick={() => void withJob('start')}
      >
        Start
      </button>
      <button
        type="button"
        title="Move the head to the board's 0,0 with the laser off."
        disabled={!idle}
        onClick={() => void moshi.home()}
      >
        Home
      </button>
      <button
        type="button"
        title="Send the estop and drop the job. Keep a hand on the machine's stop switch."
        disabled={!active}
        onClick={() => void moshi.abort()}
      >
        Abort
      </button>
      {compileError !== '' && <p role="alert">{compileError}</p>}
    </>
  );
}
