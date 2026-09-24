// StartFromLineControl — laser start-from-line recovery plus CNC guidance to
// checkpoint-bound supervised recovery (ADR-103 H1, ADR-200).

import { useRef, useState } from 'react';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { runStartFromLineFlow } from './start-job-flow';
import { prepareManualRestartSource, type ManualRestartSource } from './manual-restart-source';
import { ManualLaserRestartDialog } from './ManualLaserRestartDialog';

const MIN_LINE = 1;
const MAX_LINE = Number.MAX_SAFE_INTEGER;

export function StartFromLineControl(props: {
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly machineKind: 'laser' | 'cnc';
}): JSX.Element {
  const [line, setLine] = useState(MIN_LINE);
  const [preparing, setPreparing] = useState(false);
  const [preview, setPreview] = useState<ManualRestartSource | null>(null);
  const inFlight = useRef(false);
  const blocked = props.disabled || props.busy || preparing || preview !== null;
  const resume = async (chooseOnCanvas = false): Promise<void> => {
    if (inFlight.current || blocked) return;
    inFlight.current = true;
    setPreparing(true);
    try {
      if (chooseOnCanvas) setPreview(await prepareManualRestartSource());
      else await runStartFromLineFlow(line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      jobAwareAlert(`Could not prepare recovery:\n\n${reason}`);
    } finally {
      inFlight.current = false;
      setPreparing(false);
    }
  };
  if (props.machineKind === 'cnc') {
    return <CncInterruptionGuidance />;
  }
  return (
    <details style={boxStyle}>
      <summary
        style={summaryStyle}
        title="Resume an interrupted job from a specific G-code line — the recovery for a mid-job stop."
      >
        Start from line…
      </summary>
      <div style={rowStyle}>
        <input
          type="number"
          aria-label="Resume from G-code line"
          title="1-based line number of the exported job to resume from."
          min={MIN_LINE}
          max={MAX_LINE}
          step={1}
          disabled={blocked}
          value={line}
          onChange={(e) => {
            const v = Math.floor(Number(e.target.value));
            if (Number.isFinite(v) && v >= MIN_LINE && v <= MAX_LINE) setLine(v);
          }}
          style={inputStyle}
        />
        <button
          type="button"
          disabled={blocked}
          onClick={() => void resume()}
          title="Rebuild spindle/feed/position state at that line and replay the rest of the job. Work zero must be unchanged."
        >
          {preparing ? 'Preparing recovery…' : 'Resume from line'}
        </button>
      </div>
      <button
        type="button"
        title="Open a zoomable preview to choose a restart movement without moving the machine."
        disabled={blocked}
        onClick={() => void resume(true)}
      >
        Choose restart point…
      </button>
      <ManualRestartGuidance />
      {preview === null ? null : (
        <ManualLaserRestartDialog
          restart={preview}
          initialLine={line}
          onClose={() => setPreview(null)}
        />
      )}
    </details>
  );
}

function ManualRestartGuidance(): JSX.Element {
  return (
    <p style={hintStyle}>
      Requires the same work zero as the original run, and uses that run&apos;s job placement when
      the project still matches it. The head moves to the recorded position with the beam off, then
      the remaining laser program is replayed. This manual tool is not an exact sealed replay and
      creates no execution-archive or recovery record.
    </p>
  );
}

function CncInterruptionGuidance(): JSX.Element {
  return (
    <details style={boxStyle}>
      <summary
        style={summaryStyle}
        title="Explain why line-number restart stays blocked and where supervised CNC recovery appears."
      >
        CNC interruption recovery
      </summary>
      <p style={hintStyle}>
        Automatic line-number restart remains blocked because acknowledgements do not prove cut
        completion. After an interrupted native contour job, use the retained checkpoint&apos;s{' '}
        <strong>Review supervised recovery</strong> action to select the uncertainty point,
        physically requalify the machine, and generate a new recovery job.
      </p>
    </details>
  );
}

const boxStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '4px 6px',
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, margin: '6px 0' };
const inputStyle: React.CSSProperties = { width: 90 };
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '2px 0 4px 0',
};
