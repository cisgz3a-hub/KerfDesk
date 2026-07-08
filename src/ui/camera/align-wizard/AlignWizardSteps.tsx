// AlignWizardSteps — the burn half of the alignment wizard (F-CAM9): choose
// engrave settings and burn the marker pattern as a REAL job (or skip if
// markers are already on the bed), watch the stream finish, then prompt to
// clear the bed before detection.

import { useEffect } from 'react';
import { useCameraAlignWizardStore } from './camera-align-wizard-store';
import { burnAlignMarkers } from './burn-markers-step';
import { useLaserStore } from '../../state/laser-store';

export function SetupStep(props: { readonly note: string | null }): JSX.Element {
  const powerPercent = useCameraAlignWizardStore((s) => s.powerPercent);
  const speedMmPerMin = useCameraAlignWizardStore((s) => s.speedMmPerMin);
  const setPowerPercent = useCameraAlignWizardStore((s) => s.setPowerPercent);
  const setSpeedMmPerMin = useCameraAlignWizardStore((s) => s.setSpeedMmPerMin);
  const setStep = useCameraAlignWizardStore((s) => s.setStep);
  const connected = useLaserStore((s) => s.connection.kind === 'connected');

  const burn = async (): Promise<void> => {
    setStep({ kind: 'burning' });
    const result = await burnAlignMarkers({ powerPercent, speedMmPerMin });
    if (result.kind === 'not-started') {
      setStep({
        kind: 'setup',
        note: 'The burn did not start — fix the reported reason (or cancel) and try again.',
      });
    }
  };

  return (
    <div style={columnStyle}>
      <p style={noteStyle}>
        The wizard engraves five small marker patches near the bed corners on a piece of scrap
        covering the bed, then reads them with the camera to align it. The scene is replaced by the
        marker pattern (undo restores your work).
      </p>
      <div style={rowStyle}>
        <label style={fieldStyle}>
          Power %
          <input
            type="number"
            min={1}
            max={100}
            value={powerPercent}
            title="Engrave power for the marker burn — dark enough to read, not cut through."
            onChange={(e) => setPowerPercent(Number(e.currentTarget.value))}
            style={inputStyle}
          />
        </label>
        <label style={fieldStyle}>
          Speed mm/min
          <input
            type="number"
            min={100}
            max={20000}
            value={speedMmPerMin}
            title="Engrave speed for the marker burn."
            onChange={(e) => setSpeedMmPerMin(Number(e.currentTarget.value))}
            style={inputStyle}
          />
        </label>
      </div>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={!connected}
          onClick={() => void burn()}
          title="Replace the scene with the marker pattern and burn it now (normal job flow: preflight + confirmation)."
        >
          Burn markers
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={() => setStep({ kind: 'detect', status: { kind: 'idle' } })}
          title="The marker pattern is already burned on the bed — skip to detection."
        >
          Markers already burned
        </button>
      </div>
      {!connected ? (
        <p style={noteStyle}>Connect the machine to burn — or skip to detection.</p>
      ) : null}
      {props.note !== null ? <p style={errStyle}>{props.note}</p> : null}
    </div>
  );
}

export function BurningStep(): JSX.Element {
  const streamer = useLaserStore((s) => s.streamer);
  const setStep = useCameraAlignWizardStore((s) => s.setStep);

  useEffect(() => {
    if (streamer === null) return;
    if (streamer.status === 'done') {
      setStep({ kind: 'clear-bed' });
      return;
    }
    if (
      streamer.status === 'errored' ||
      streamer.status === 'cancelled' ||
      streamer.status === 'disconnected'
    ) {
      setStep({
        kind: 'setup',
        note: `The marker burn did not finish (${streamer.status}). Fix the cause and burn again.`,
      });
    }
  }, [streamer, setStep]);

  const progress =
    streamer !== null && streamer.total > 0
      ? ` ${Math.round((streamer.completed / streamer.total) * 100)}%`
      : '';
  return (
    <p style={noteStyle}>
      Burning the marker pattern{progress} — keep clear of the machine. The wizard continues when
      the job finishes.
    </p>
  );
}

export function ClearBedStep(): JSX.Element {
  const setStep = useCameraAlignWizardStore((s) => s.setStep);
  return (
    <div style={columnStyle}>
      <p style={noteStyle}>
        Leave the burned scrap exactly where it is — the markers must stay visible. Remove
        everything else from the bed (tools, offcuts, hold-downs near the corners), then detect.
      </p>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          onClick={() => setStep({ kind: 'detect', status: { kind: 'idle' } })}
          title="The bed shows only the burned markers — continue to detection."
        >
          Bed is clear — detect
        </button>
      </div>
    </div>
  );
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
};
const inputStyle: React.CSSProperties = { width: 110 };
const noteStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-faint)' };
const errStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-danger)' };
