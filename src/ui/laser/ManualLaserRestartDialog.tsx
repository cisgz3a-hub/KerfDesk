import { useRef, useState } from 'react';
import { Dialog, DialogActions } from '../kit';
import { LaserRecoveryCanvas } from './LaserRecoveryCanvas';
import type { PreparedRecoverySource } from './start-job-source';
import { streamResumeFromRawLine } from './start-job-resume-stream';

const RESTART_HINT =
  'Zoom in and click a burn movement. The head moves to its beginning with the beam off, then ' +
  'runs the remaining job. For an incomplete image row, choose an earlier movement; overlap ' +
  'may darken the engraving.';

/** Inspect a frozen preparation without changing the document or moving the machine. */
export function ManualLaserRestartDialog(props: {
  readonly source: PreparedRecoverySource;
  readonly initialLine: number;
  readonly onClose: () => void;
}): JSX.Element {
  const maximumLine = props.source.canvasPlan.fingerprint.lines;
  const [fromLine, setFromLine] = useState(Math.min(props.initialLine, maximumLine));
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState('');
  const inFlight = useRef(false);
  const close = (): void => {
    if (!inFlight.current) props.onClose();
  };
  const start = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(true);
    setFailure('');
    try {
      const source = props.source;
      const started = await streamResumeFromRawLine(
        source.project,
        source.gcode,
        fromLine,
        source.canvasPlan,
        source.laserModeStartSnapshot,
        undefined,
        source.controllerSnapshot,
      );
      if (started) props.onClose();
      else setFailure('Recovery was not started. Check the selected movement and machine setup.');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  };
  return (
    <Dialog title="Choose laser restart point" size="lg" tutorialId="recovery" onClose={close}>
      <p>{RESTART_HINT}</p>
      <LaserRecoveryCanvas
        plan={props.source.canvasPlan}
        ackedLines={0}
        fromLine={fromLine}
        disabled={starting}
        onSelect={setFromLine}
      />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        Restart from G-code line
        <input
          type="number"
          min={1}
          max={maximumLine}
          step={1}
          value={fromLine}
          disabled={starting}
          style={{ width: 110 }}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 1 && value <= maximumLine) setFromLine(value);
          }}
        />
      </label>
      <ManualRestartExplanation />
      {failure === '' ? null : <p role="alert">{failure}</p>}
      <DialogActions>
        <button type="button" disabled={starting} onClick={close}>
          Cancel
        </button>
        <button type="button" disabled={starting} onClick={() => void start()}>
          {starting ? 'Starting recovery…' : 'Start selected remainder'}
        </button>
      </DialogActions>
    </Dialog>
  );
}

function ManualRestartExplanation(): JSX.Element {
  return (
    <p style={{ color: 'var(--lf-text-muted)', fontSize: 12 }}>
      Prepared from the current project. Keep the original work zero and material position. This
      replays the selected movement and everything after it. To keep recovery tracking, use the
      saved interrupted-job card when available. Manual restart creates no new recovery record.
    </p>
  );
}
