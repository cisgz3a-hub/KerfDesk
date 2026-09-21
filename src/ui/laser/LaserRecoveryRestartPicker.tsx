import type { RecoveryCapsule } from '../state/recovery';
import { LaserRecoveryCanvas } from './LaserRecoveryCanvas';
import { laserRecoveryPreviewPlan } from './laser-recovery-preview-plan';

export function LaserRecoveryRestartPicker(props: {
  readonly capsule: RecoveryCapsule;
  readonly fromLine: number | undefined;
  readonly disabled: boolean;
  readonly onChange: (line: number | undefined) => void;
}): JSX.Element {
  const artifact = props.capsule.artifact;
  return (
    <section aria-labelledby="laser-recovery-restart-title" style={{ marginTop: 14 }}>
      <h3 id="laser-recovery-restart-title" style={{ fontSize: 13, margin: '0 0 5px' }}>
        Choose where to restart
      </h3>
      {artifact.kind === 'exact-execution' ? (
        <LaserRecoveryCanvas
          plan={laserRecoveryPreviewPlan(artifact)}
          ackedLines={props.capsule.ackedLines}
          fromLine={props.fromLine}
          disabled={props.disabled}
          onSelect={props.onChange}
        />
      ) : (
        <p style={hintStyle}>
          This older record has no saved route to display. Reopen the original project and choose a
          line from its matching G-code, or use the transport estimate. Recovery first checks that
          the project still produces the saved fingerprint.
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label htmlFor="laser-recovery-start-line" style={{ fontSize: 12 }}>
          Restart from G-code line
        </label>
        <input
          id="laser-recovery-start-line"
          type="number"
          min={1}
          max={artifact.fingerprint.lines}
          step={1}
          value={props.fromLine ?? ''}
          placeholder="Automatic"
          disabled={props.disabled}
          style={{ width: 110 }}
          onChange={(event) =>
            changeRawLine(event.target.value, artifact.fingerprint.lines, props.onChange)
          }
        />
        <button
          type="button"
          disabled={props.disabled || props.fromLine === undefined}
          onClick={() => props.onChange(undefined)}
        >
          Use transport estimate
        </button>
      </div>
      <p style={hintStyle}>
        {props.fromLine === undefined
          ? 'Automatic uses acknowledged command progress, which can be ahead of the physical cut. Inspect the work and choose an earlier movement if needed.'
          : `Recovery replays line ${props.fromLine} and every later line. A canvas choice starts at the beginning of the selected G-code movement, not partway along it.`}{' '}
        For image and fill engraving, choose an earlier scan line if the last row is incomplete;
        replayed areas may become darker. Overlapping passes share the same position, so check the
        selected line number. This continues the remainder of the job; it is not an area-only second
        pass.
      </p>
    </section>
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
