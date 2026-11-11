// The Lihuiyu USB panel body (ADR-703): connect to the K40's board, then
// Home, Jog, Frame, Start, Pause, Resume and Abort, the controls the driver's
// usbLink capabilities list. LihuiyuUsbPanel loads it lazily, so it and the
// store stay out of the boot bundle; it lives outside src/ui/laser, which
// vite.config.ts places in the boot ui-workbench chunk.

import { useState } from 'react';
import { LHY_STEPS_PER_MM } from '../../core/controllers/lihuiyu/lhy-motion-plan';
import { useStore } from '../state';
import { prepareLihuiyuUsbJob } from '../state/lihuiyu-usb/lihuiyu-usb-job';
import {
  LIHUIYU_NOT_QUALIFIED,
  lihuiyuStatusText,
} from '../state/lihuiyu-usb/lihuiyu-usb-messages';
import { useLihuiyuUsbStore } from '../state/lihuiyu-usb/lihuiyu-usb-store';
import type { LihuiyuUsbOpener, LihuiyuUsbState } from '../state/lihuiyu-usb/lihuiyu-usb-types';

const JOG_STEPS_MM = [1, 10] as const;

export default function LihuiyuUsbDetails({
  open,
}: {
  readonly open: LihuiyuUsbOpener;
}): JSX.Element {
  const board = useLihuiyuUsbStore();
  const connected = board.phase !== 'disconnected' && board.phase !== 'connecting';
  return (
    <details>
      <summary title="Drive the K40's Lihuiyu M2/M3 Nano board over USB (CH341).">
        K40 USB connection (experimental)
      </summary>
      <p role="note">{LIHUIYU_NOT_QUALIFIED}</p>
      <p>
        Close MeerK40t, K40 Whisperer and LaserDRW first: only one program can hold the board. The
        board reports no position, so Home before an Absolute job.
      </p>
      {board.phase === 'disconnected' || board.phase === 'connecting' ? (
        <button
          type="button"
          title="Choose the board (USB2.0-Print, CH341) and read its status."
          disabled={board.phase === 'connecting'}
          onClick={() => void board.connect(open)}
        >
          Connect K40
        </button>
      ) : (
        <button
          type="button"
          title="Close the link. A running job is reset first."
          onClick={() => void board.disconnect()}
        >
          Disconnect K40
        </button>
      )}
      {connected && <LihuiyuControls board={board} />}
      {board.message !== '' && (
        <p role="status" data-tone={board.tone}>
          {board.message}
        </p>
      )}
      {board.advisories.length > 0 && (
        <ul aria-label="Job warnings">
          {board.advisories.map((advisory) => (
            <li key={advisory}>{advisory}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function LihuiyuControls({ board }: { readonly board: LihuiyuUsbState }): JSX.Element {
  const [compileError, setCompileError] = useState('');
  const idle = board.phase === 'idle';
  const active = board.phase === 'framing' || board.phase === 'running' || board.phase === 'paused';
  const withJob = async (action: 'frame' | 'start'): Promise<void> => {
    const { project, jobPlacement } = useStore.getState();
    const prepared = await prepareLihuiyuUsbJob(project, jobPlacement, board.head);
    if (!prepared.ok) {
      setCompileError(prepared.messages.join(' '));
      return;
    }
    setCompileError('');
    await (action === 'frame' ? board.frame(prepared.job) : board.start(prepared.job));
  };
  return (
    <>
      <p>
        Board status: {lihuiyuStatusText(board.statusCode)}
        {board.head === null
          ? ' · position unknown (Home)'
          : ` · X ${(board.head.x / LHY_STEPS_PER_MM).toFixed(1)} Y ${(board.head.y / LHY_STEPS_PER_MM).toFixed(1)} mm`}
        {board.sending !== null && ` · sent ${board.sending.sent}/${board.sending.total} packets`}
      </p>
      <button
        type="button"
        title="Home the head to the rear-left corner."
        disabled={!idle}
        onClick={() => void board.home()}
      >
        Home
      </button>
      <JogButtons board={board} disabled={!idle} />
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
        disabled={!idle || board.framed === null}
        title={board.framed === null ? 'Frame this job first.' : 'Send the framed job and run it.'}
        onClick={() => void withJob('start')}
      >
        Start
      </button>
      <button
        type="button"
        title="Pause the board."
        disabled={board.phase !== 'running'}
        onClick={() => void board.pause()}
      >
        Pause
      </button>
      <button
        type="button"
        title="Continue the paused job."
        disabled={board.phase !== 'paused'}
        onClick={() => void board.resume()}
      >
        Resume
      </button>
      <button
        type="button"
        title="Stop sending and reset the board. Keep a hand on the machine's power switch."
        disabled={!active}
        onClick={() => void board.abort()}
      >
        Abort
      </button>
      {compileError !== '' && <p role="alert">{compileError}</p>}
    </>
  );
}

function JogButtons({
  board,
  disabled,
}: {
  readonly board: LihuiyuUsbState;
  readonly disabled: boolean;
}): JSX.Element {
  const [stepMm, setStepMm] = useState<number>(JOG_STEPS_MM[1]);
  return (
    <span role="group" aria-label="Jog (laser off)">
      <select
        aria-label="Jog step"
        value={stepMm}
        onChange={(event) => setStepMm(Number(event.target.value))}
      >
        {JOG_STEPS_MM.map((mm) => (
          <option key={mm} value={mm}>
            {mm} mm
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Jog left"
        disabled={disabled}
        onClick={() => void board.jog(-stepMm, 0)}
      >
        ←
      </button>
      <button
        type="button"
        aria-label="Jog right"
        disabled={disabled}
        onClick={() => void board.jog(stepMm, 0)}
      >
        →
      </button>
      <button
        type="button"
        aria-label="Jog toward the back"
        disabled={disabled}
        onClick={() => void board.jog(0, -stepMm)}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="Jog toward the front"
        disabled={disabled}
        onClick={() => void board.jog(0, stepMm)}
      >
        ↓
      </button>
    </span>
  );
}
