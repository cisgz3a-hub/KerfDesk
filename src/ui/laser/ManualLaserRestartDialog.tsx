import { useMemo, useRef, useState } from 'react';
import { Dialog, DialogActions } from '../kit';
import { LaserRecoveryCanvas } from './LaserRecoveryCanvas';
import { recoveryRouteFromCanvasPlan } from './laser-recovery-preview-route';
import { noteManualRestartStarted, type ManualRestartSource } from './manual-restart-source';
import { streamResumeFromRawLine } from './start-job-resume-stream';

const RESTART_HINT =
  'Zoom in and click a burn movement. The head moves to its beginning with the beam off, then ' +
  'runs the remaining job. For an incomplete image row, choose an earlier movement; overlap ' +
  'may darken the engraving.';

/** Inspect a frozen preparation without changing the document or moving the machine. */
export function ManualLaserRestartDialog(props: {
  readonly restart: ManualRestartSource;
  readonly initialLine: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { source: prepared, placementNote } = props.restart;
  const maximumLine = prepared.canvasPlan.fingerprint.lines;
  // The preparation already parsed this program; packing it is a linear copy.
  const route = useMemo(
    () => recoveryRouteFromCanvasPlan(prepared.canvasPlan),
    [prepared.canvasPlan],
  );
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
      const started = await streamResumeFromRawLine(
        prepared.project,
        prepared.gcode,
        fromLine,
        prepared.canvasPlan,
        prepared.laserModeStartSnapshot,
        prepared.controllerSnapshot,
        placementNote,
      );
      if (started) {
        noteManualRestartStarted(props.restart);
        props.onClose();
      } else setFailure('Recovery was not started. Check the selected movement and machine setup.');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  };
  return (
    <Dialog title="Choose laser restart point" size="lg" onClose={close}>
      <p>{RESTART_HINT}</p>
      <LaserRecoveryCanvas
        route={route}
        ackedLines={0}
        fromLine={fromLine}
        disabled={starting}
        onSelect={setFromLine}
      />
      <ManualRestartLine
        maximum={maximumLine}
        fromLine={fromLine}
        disabled={starting}
        onChange={setFromLine}
      />
      <p>{placementNote}</p>
      <ManualRestartExplanation />
      {failure === '' ? null : <p role="alert">{failure}</p>}
      <ManualRestartActions starting={starting} onCancel={close} onStart={() => void start()} />
    </Dialog>
  );
}

function ManualRestartActions(props: {
  readonly starting: boolean;
  readonly onCancel: () => void;
  readonly onStart: () => void;
}): JSX.Element {
  return (
    <DialogActions>
      <button
        type="button"
        title="Close the restart preview without starting the job."
        disabled={props.starting}
        onClick={props.onCancel}
      >
        Cancel
      </button>
      <button
        type="button"
        title="Review recovery, then move with the beam off to replay the selected movement and remaining job."
        disabled={props.starting}
        onClick={props.onStart}
      >
        {props.starting ? 'Starting recovery…' : 'Start selected remainder'}
      </button>
    </DialogActions>
  );
}

function ManualRestartLine(props: {
  readonly maximum: number;
  readonly fromLine: number;
  readonly disabled: boolean;
  readonly onChange: (line: number) => void;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
      Restart from G-code line
      <input
        type="number"
        title="Prepared G-code line number, starting at 1. Restart replays this line and the rest of the job."
        min={1}
        max={props.maximum}
        step={1}
        value={props.fromLine}
        disabled={props.disabled}
        style={{ width: 110 }}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isInteger(value) && value >= 1 && value <= props.maximum)
            props.onChange(value);
        }}
      />
    </label>
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
