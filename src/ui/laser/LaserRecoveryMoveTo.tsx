// Move the head to the job's origin or to where recovery will resume (ADR-341
// Amendment 8). Offered once the controller's origin is the one the job ran
// with, or was set from where the head stopped, so both points land where the
// job put them. Each is a beam-off jog like Go to work zero; operator actions,
// not gates (ADR-228).

import { useState } from 'react';
import { resumeEntryPointMm } from '../../core/controllers/grbl/resume-program';
import type { ExecutionArtifactV1 } from '../state/recovery';

type WorkPointMm = { readonly x: number; readonly y: number };
type Target = 'origin' | 'restart';

const JOB_ORIGIN: WorkPointMm = { x: 0, y: 0 };

export function MoveToJobPoints(props: {
  readonly artifact: ExecutionArtifactV1;
  readonly restartLine: number | undefined;
  readonly disabled: boolean;
  readonly onMove: (pointMm: WorkPointMm) => Promise<void>;
}): JSX.Element {
  const [moving, setMoving] = useState<Target | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { restartLine } = props;
  const move = async (target: Target): Promise<void> => {
    if (moving !== null) return;
    setMoving(target);
    setFailure(null);
    try {
      await props.onMove(
        target === 'origin' ? JOB_ORIGIN : restartPoint(props.artifact, restartLine),
      );
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setMoving(null);
    }
  };
  const busy = props.disabled || moving !== null;
  return (
    <>
      <div style={rowStyle}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void move('origin')}
          title="Move the head with the beam off to the job's origin, work X0 Y0."
        >
          {moving === 'origin' ? 'Moving…' : 'Go to job origin'}
        </button>
        <button
          type="button"
          disabled={busy || restartLine === undefined}
          onClick={() => void move('restart')}
          title="Move the head with the beam off to where the chosen restart line begins."
        >
          {moving === 'restart' ? 'Moving…' : 'Go to restart point'}
        </button>
      </div>
      {failure === null ? null : (
        <p role="alert" style={warningStyle}>
          {failure}
        </p>
      )}
    </>
  );
}

/** Where the head stands before the restart line runs, in work mm. Worked
 * out on demand: a long program takes a moment to follow. */
function restartPoint(artifact: ExecutionArtifactV1, restartLine: number | undefined): WorkPointMm {
  const point = restartLine === undefined ? null : resumeEntryPointMm(artifact.gcode, restartLine);
  if (point === null) {
    throw new Error(
      `KerfDesk cannot follow the program up to line ${String(restartLine ?? '')}, so it does not know where that line starts.`,
    );
  }
  return point;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  marginTop: 6,
};
const warningStyle: React.CSSProperties = {
  borderLeft: '3px solid var(--lf-warning)',
  margin: '6px 0',
  padding: '5px 9px',
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
  lineHeight: 1.45,
};
