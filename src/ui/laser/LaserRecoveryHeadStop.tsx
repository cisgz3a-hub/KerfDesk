// Continue from where the head stopped (ADR-341 Amendment 6). After a lost
// link the controller ran what it had received and the head stayed at the end
// of the last line sent. When the saved origin cannot come back, one G92 makes
// the head's spot that program point, so the rest of the job continues from it
// without moving the head. An operator action beside Restore saved origin, not
// a gate (ADR-228).

import { useState } from 'react';
import type { RecoveryHeadStop } from './laser-recovery-head-stop';
import { formatOriginMm } from './laser-recovery-origin';

export type HeadStopContinue = {
  readonly stop: RecoveryHeadStop;
  readonly sendableLines: number;
  /** True once the origin was set from the head stop and the controller still has it. */
  readonly anchored: boolean;
  readonly onContinue: () => Promise<void>;
};

export function ContinueFromHeadStop(
  props: HeadStopContinue & { readonly disabled: boolean },
): JSX.Element {
  const [setting, setSetting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { stop } = props;
  const point = `X ${formatOriginMm(stop.pointMm.x)}, Y ${formatOriginMm(stop.pointMm.y)} mm`;
  if (props.anchored) {
    return (
      <p role="status" style={noteStyle}>
        The origin is set from where the head stopped, so the head stands at {point} in the job and
        recovery continues from line {stop.line}. Frame the remaining area to check it lines up with
        the finished part before you start.
      </p>
    );
  }
  const run = async (): Promise<void> => {
    if (setting) return;
    setSetting(true);
    setFailure(null);
    try {
      await props.onContinue();
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSetting(false);
    }
  };
  return (
    <div style={boxStyle}>
      <p style={noteStyle}>
        The laser had received {formatCount(stop.sentLines)} of {formatCount(props.sendableLines)}{' '}
        lines when the link dropped. It keeps running what it has received, so the head should be
        sitting at the end of the last of them, {point} in the job. Continue from where the head
        stopped sets the origin so that spot is that point, without moving the head, and restarts
        from line {stop.line}. Use it when the saved origin cannot come back, for example on a
        machine that was not homed before the job, and only if nobody has moved the head since the
        stop. If the laser itself restarted or lost power during the burn, the head stopped earlier
        than that; Frame remaining area shows the difference before anything burns.
      </p>
      <button
        type="button"
        disabled={props.disabled || setting}
        onClick={() => void run()}
        title="Set the origin so the head's current spot is where the job stopped, with one G92. The head does not move."
      >
        {setting ? 'Setting origin…' : 'Continue from where the head stopped'}
      </button>
      {failure === null ? null : (
        <p role="alert" style={warningStyle}>
          {failure}
        </p>
      )}
    </div>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

const boxStyle: React.CSSProperties = { margin: '4px 0 8px' };
const noteStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.5,
  margin: '6px 0',
};
const warningStyle: React.CSSProperties = {
  borderLeft: '3px solid var(--lf-warning)',
  margin: '6px 0',
  padding: '5px 9px',
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
  lineHeight: 1.45,
};
