import { useMemo } from 'react';
import type { AutomaticRestart } from '../../core/recovery/automatic-restart-line';
import type { ExecutionArtifactV1, RecoveryCapsule } from '../state/recovery';
import { LaserRecoveryCanvas } from './LaserRecoveryCanvas';
import { automaticRecoveryRestart, automaticRestartHint } from './laser-recovery-automatic-restart';
import { useLaserRecoveryPreviewRoute } from './use-laser-recovery-preview-route';

export function LaserRecoveryRestartPicker(props: {
  readonly capsule: RecoveryCapsule;
  readonly fromLine: number | undefined;
  readonly disabled: boolean;
  readonly onChange: (line: number | undefined) => void;
  /** The automatic restart, when the caller has already derived it. */
  readonly automatic?: AutomaticRestart | null;
}): JSX.Element {
  const artifact = props.capsule.artifact;
  const given = props.automatic;
  const automatic = useMemo(
    () => (given !== undefined ? given : automaticRecoveryRestart(props.capsule)),
    [given, props.capsule],
  );
  return (
    <section aria-labelledby="laser-recovery-restart-title" style={{ marginTop: 14 }}>
      <h3 id="laser-recovery-restart-title" style={{ fontSize: 13, margin: '0 0 5px' }}>
        Choose where to restart
      </h3>
      {artifact.kind === 'exact-execution' ? (
        <SealedRoutePreview
          key={artifact.runId}
          artifact={artifact}
          ackedLines={props.capsule.ackedLines}
          fromLine={props.fromLine}
          disabled={props.disabled}
          onSelect={props.onChange}
        />
      ) : (
        <p style={hintStyle}>
          This fingerprint-only record has no saved route to display. Reopen the original project
          and choose a line from its matching G-code, or use the transport estimate. Recovery first
          checks that the project still produces the saved fingerprint.
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label htmlFor="laser-recovery-start-line" style={{ fontSize: 12 }}>
          Restart from G-code line
        </label>
        <input
          id="laser-recovery-start-line"
          type="number"
          title="Original G-code line number, starting at 1. Recovery replays this line and the rest of the job."
          min={1}
          max={artifact.fingerprint.lines}
          step={1}
          value={props.fromLine ?? ''}
          placeholder={automatic === null ? 'Automatic' : `Automatic: ${automatic.line}`}
          disabled={props.disabled}
          style={{ width: 150 }}
          onChange={(event) =>
            changeRawLine(event.target.value, artifact.fingerprint.lines, props.onChange)
          }
        />
        <button
          type="button"
          title="Go back to the automatic restart line, taken from acknowledged command progress (or the line the controller rejected); it does not prove where engraving physically stopped."
          disabled={props.disabled || props.fromLine === undefined}
          onClick={() => props.onChange(undefined)}
        >
          Use automatic line
        </button>
      </div>
      <p style={hintStyle}>
        {props.fromLine === undefined
          ? automaticRestartHint(automatic)
          : `Recovery replays line ${props.fromLine} and every later line. A canvas choice starts at the beginning of the selected G-code movement, not partway along it.`}{' '}
        For image and fill engraving, choose an earlier scan line if the last row is incomplete;
        replayed areas may become darker. Overlapping passes share the same position, so check the
        selected line number. This continues the remainder of the job; it is not an area-only second
        pass.
      </p>
    </section>
  );
}

/** The sealed program is parsed off the UI thread. Until the route arrives the
 * numeric line field is the operator's control; a failure keeps it available. */
function SealedRoutePreview(props: {
  readonly artifact: ExecutionArtifactV1;
  readonly ackedLines: number;
  readonly fromLine: number | undefined;
  readonly disabled: boolean;
  readonly onSelect: (line: number) => void;
}): JSX.Element {
  const preview = useLaserRecoveryPreviewRoute(props.artifact);
  if (preview.status === 'preparing') {
    return (
      <p role="status" style={hintStyle}>
        Preparing the saved route preview in the background. The G-code line field below already
        works; the clickable route appears when it is ready.
      </p>
    );
  }
  if (preview.status === 'failed') {
    return (
      <p role="alert" style={hintStyle}>
        The saved route preview could not be prepared ({preview.message}). Use the original G-code
        line numbers below; recovery still replays the exact saved program.
      </p>
    );
  }
  return (
    <LaserRecoveryCanvas
      route={preview.route}
      ackedLines={props.ackedLines}
      fromLine={props.fromLine}
      disabled={props.disabled}
      onSelect={props.onSelect}
    />
  );
}

function changeRawLine(
  raw: string,
  maximum: number,
  onChange: (line: number | undefined) => void,
): void {
  if (raw === '') onChange(undefined);
  else {
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 1 && value <= maximum) onChange(value);
  }
}

const hintStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.5,
  margin: '6px 0',
};
