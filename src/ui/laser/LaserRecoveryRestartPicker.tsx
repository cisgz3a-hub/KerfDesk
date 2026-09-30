import { useMemo, useRef, useState } from 'react';
import type { AutomaticRestart } from '../../core/recovery/automatic-restart-line';
import type { ExecutionArtifactV1, RecoveryCapsule } from '../state/recovery';
import { LaserRecoveryCanvas } from './LaserRecoveryCanvas';
import { automaticRecoveryRestart, automaticRestartHint } from './laser-recovery-automatic-restart';
import { useLaserRecoveryPreviewRoute } from './use-laser-recovery-preview-route';

/** Undefined chooses automatic recovery; null means the visible draft is invalid. */
export type RecoveryRestartLine = number | undefined | null;

type RestartPickerProps = {
  readonly capsule: RecoveryCapsule;
  readonly fromLine: RecoveryRestartLine;
  readonly disabled: boolean;
  readonly onChange: (line: RecoveryRestartLine) => void;
  /** The automatic restart, when the caller has already derived it. */
  readonly automatic?: AutomaticRestart | null;
};

export function LaserRecoveryRestartPicker(props: RestartPickerProps): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ text: string; line: RecoveryRestartLine } | null>(null);
  const chooseLine = (line: number | undefined): void => {
    // Native unfinished numbers have value "" while their editing buffer still
    // shows "-" or "1e". React skips an unchanged empty value, so an explicit
    // selection must also replace that buffer before enabling the chosen line.
    if (input.current !== null) input.current.value = line === undefined ? '' : String(line);
    setDraft(null);
    props.onChange(line);
  };
  const artifact = props.capsule.artifact;
  const given = props.automatic;
  const automatic = useMemo(
    () => (given !== undefined ? given : automaticRecoveryRestart(props.capsule)),
    [given, props.capsule],
  );
  const value = draft !== null && draft.line === props.fromLine ? draft.text : props.fromLine;
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
          fromLine={props.fromLine ?? undefined}
          disabled={props.disabled}
          onSelect={chooseLine}
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
          ref={input}
          id="laser-recovery-start-line"
          type="number"
          title="Original G-code line number, starting at 1. Recovery replays this line and the rest of the job."
          min={1}
          max={artifact.fingerprint.lines}
          step={1}
          value={value ?? ''}
          aria-invalid={props.fromLine === null}
          aria-describedby={props.fromLine === null ? 'laser-recovery-line-error' : undefined}
          placeholder={automatic === null ? 'Automatic' : `Automatic: ${automatic.line}`}
          disabled={props.disabled}
          style={{ width: 150 }}
          onInput={(event) => {
            // Native badInput (e.g. "-") and a cleared field both report value "".
            // onChange can deduplicate them; every input event must update validity.
            const text = event.currentTarget.value;
            const line = event.currentTarget.validity.badInput
              ? null
              : parseRestartLine(text, artifact.fingerprint.lines);
            setDraft({ text, line });
            props.onChange(line);
          }}
        />
        <button
          type="button"
          title="Go back to the automatic restart line, taken from acknowledged command progress (or the line the controller rejected); it does not prove where engraving physically stopped."
          disabled={props.disabled || props.fromLine === undefined}
          onClick={() => chooseLine(undefined)}
        >
          Use automatic line
        </button>
      </div>
      <RestartHint
        fromLine={props.fromLine}
        maximum={artifact.fingerprint.lines}
        automatic={automatic}
      />
    </section>
  );
}

function RestartHint(props: {
  readonly fromLine: RecoveryRestartLine;
  readonly maximum: number;
  readonly automatic: AutomaticRestart | null;
}): JSX.Element {
  return (
    <>
      {props.fromLine === null ? (
        <p id="laser-recovery-line-error" role="alert" style={hintStyle}>
          Enter a whole G-code line from 1 to {props.maximum}, or use the automatic line. Recovery
          cannot use the unfinished line shown above.
        </p>
      ) : null}
      <p style={hintStyle}>
        {props.fromLine === null
          ? null
          : props.fromLine === undefined
            ? automaticRestartHint(props.automatic)
            : `Recovery replays line ${props.fromLine} and every later line. A canvas choice starts at the beginning of the selected G-code movement, not partway along it.`}{' '}
        For image and fill engraving, choose an earlier scan line if the last row is incomplete;
        replayed areas may become darker. Overlapping passes share the same position, so check the
        selected line number. This continues the remainder of the job; it is not an area-only second
        pass.
      </p>
    </>
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

function parseRestartLine(raw: string, maximum: number): RecoveryRestartLine {
  if (raw === '') return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= maximum ? value : null;
}

const hintStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.5,
  margin: '6px 0',
};
