// The galvo USB panel body (ADR-704): Connect (with an optional EZCad .cor
// lens correction), then the red-light Frame, Start, Pause, Resume and Abort —
// the controls JCZ_GALVO_USB_CAPABILITIES lists. GalvoUsbPanel loads it
// lazily, so it, the store and the LMC encoder stay out of the boot bundle;
// it lives outside src/ui/laser, which vite.config.ts places in the boot chunk.

import { useState } from 'react';
import { readCorFile, type LmcCorrectionTable } from '../../core/controllers/jcz/lmc-cor-file';
import { useStore } from '../state';
import { prepareGalvoUsbJob } from '../state/jcz-usb/galvo-usb-job';
import { GALVO_NOT_QUALIFIED, galvoListStateText } from '../state/jcz-usb/galvo-usb-messages';
import { useGalvoUsbStore, type GalvoUsbState } from '../state/jcz-usb/galvo-usb-store';
import type { GalvoUsbAdapter } from '../state/jcz-usb/galvo-usb-types';

export default function GalvoUsbDetails({
  adapter,
}: {
  readonly adapter: GalvoUsbAdapter;
}): JSX.Element {
  const galvo = useGalvoUsbStore();
  return (
    <details>
      <summary title="Connect a JCZ LMC (EZCad2-class) galvo board over USB.">
        JCZ galvo USB connection (experimental)
      </summary>
      <p role="note">{GALVO_NOT_QUALIFIED}</p>
      <GalvoConnectRow adapter={adapter} galvo={galvo} />
      {galvo.phase !== 'disconnected' && galvo.phase !== 'connecting' && (
        <GalvoJobControls galvo={galvo} />
      )}
      {galvo.message !== '' && (
        <p role="status" data-tone={galvo.tone}>
          {galvo.message}
        </p>
      )}
      {galvo.advisories.length > 0 && (
        <ul aria-label="Job warnings">
          {galvo.advisories.map((advisory) => (
            <li key={advisory}>{advisory}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function GalvoConnectRow({
  adapter,
  galvo,
}: {
  readonly adapter: GalvoUsbAdapter;
  readonly galvo: GalvoUsbState;
}): JSX.Element {
  const [correction, setCorrection] = useState<LmcCorrectionTable | null>(null);
  const [corNote, setCorNote] = useState('');
  const disconnected = galvo.phase === 'disconnected';
  const chooseCor = async (file: File | undefined): Promise<void> => {
    if (file === undefined) {
      setCorrection(null);
      setCorNote('');
      return;
    }
    const read = readCorFile(new Uint8Array(await file.arrayBuffer()));
    setCorrection(read.ok ? read.table : null);
    setCorNote(read.ok ? `${file.name}: ${read.format} table read.` : read.reason);
  };
  return (
    <>
      <label title="Optional: the lens correction file EZCad uses for this lens. Sent to the board at Connect; without one the board's table is cleared.">
        Lens correction (.cor){' '}
        <input
          type="file"
          accept=".cor"
          aria-label="Galvo lens correction file"
          title="Choose the .cor lens correction file EZCad uses for this lens"
          disabled={!disconnected}
          onChange={(event) => void chooseCor(event.target.files?.[0])}
        />
      </label>
      {corNote !== '' && <p>{corNote}</p>}
      {disconnected || galvo.phase === 'connecting' ? (
        <button
          type="button"
          title="Choose the galvo board (USB 9588:9899) and initialise it. Nothing moves or fires."
          disabled={!disconnected}
          onClick={() => void galvo.connect(adapter, correction)}
        >
          Connect galvo
        </button>
      ) : (
        <button
          type="button"
          title="Close the USB link. A running program gets Stop Execute first."
          onClick={() => void galvo.disconnect()}
        >
          Disconnect galvo
        </button>
      )}
    </>
  );
}

function GalvoJobControls({ galvo }: { readonly galvo: GalvoUsbState }): JSX.Element {
  const [compileError, setCompileError] = useState('');
  const idle = galvo.phase === 'idle';
  const active = galvo.phase === 'framing' || galvo.phase === 'running' || galvo.phase === 'paused';
  const withJob = async (action: 'frame' | 'start'): Promise<void> => {
    const { project, jobPlacement } = useStore.getState();
    const prepared = await prepareGalvoUsbJob(project, jobPlacement);
    if (!prepared.ok) {
      setCompileError(prepared.messages.join(' '));
      return;
    }
    setCompileError('');
    await (action === 'frame' ? galvo.frame(prepared.job) : galvo.start(prepared.job));
  };
  return (
    <>
      <p>
        Board: {galvoListStateText(galvo.listState)}
        {galvo.sending !== null && ` · sent ${galvo.sending.sent}/${galvo.sending.total} lists`}
      </p>
      <button
        type="button"
        title="Trace the job's outline with the red pointer. The laser source is not fired."
        disabled={!idle}
        onClick={() => void withJob('frame')}
      >
        Frame (red light)
      </button>
      <button
        type="button"
        disabled={!idle || galvo.framed === null}
        title={galvo.framed === null ? 'Frame this job first.' : 'Send the framed job and mark it.'}
        onClick={() => void withJob('start')}
      >
        Start
      </button>
      <button
        type="button"
        title="Send Stop List: the board holds the program."
        disabled={galvo.phase !== 'running'}
        onClick={() => void galvo.pause()}
      >
        Pause
      </button>
      <button
        type="button"
        title="Send Restart List to continue the held program."
        disabled={galvo.phase !== 'paused'}
        onClick={() => void galvo.resume()}
      >
        Resume
      </button>
      <button
        type="button"
        title="Stop sending and send Stop Execute. Keep a hand on the machine's emergency stop."
        disabled={!active}
        onClick={() => void galvo.abort()}
      >
        Abort
      </button>
      {compileError !== '' && <p role="alert">{compileError}</p>}
    </>
  );
}
