// AlignWizardSteps — the burn half of the alignment wizard (F-CAM9): choose
// engrave settings and burn the marker pattern as a REAL job (or skip if
// markers are already on the bed), watch the stream finish, then prompt to
// clear the bed before detection.

import { useEffect } from 'react';
import { useCameraAlignWizardStore } from './camera-align-wizard-store';
import { burnAlignMarkers } from './burn-markers-step';
import { useLaserStore } from '../../state/laser-store';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';

export function SetupStep(props: { readonly note: string | null }): JSX.Element {
  const powerPercent = useCameraAlignWizardStore((s) => s.powerPercent);
  const speedMmPerMin = useCameraAlignWizardStore((s) => s.speedMmPerMin);
  const setStep = useCameraAlignWizardStore((s) => s.setStep);
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  const homingState = useLaserStore((s) => s.homingState);
  const trustedPositionEpoch = useLaserStore((s) => s.trustedPositionEpoch ?? 0);
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const confirmedPositionEpoch = useCameraStore((s) => s.confirmedPositionEpoch);
  const confirmPositionEpoch = useCameraStore((s) => s.confirmPositionEpoch);
  const positionReady = homingEnabled
    ? homingState === 'confirmed'
    : confirmedPositionEpoch === trustedPositionEpoch;

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
        covering the bed, then reads them with the camera to align it. Your project and undo history
        stay untouched; the markers stream as a temporary calibration job.
      </p>
      <AlignmentSettingsFields />
      <p style={noteStyle}>
        Surface height is part of camera geometry. Measure the top of the burned marker sheet above
        the bed; KerfDesk uses it to compensate later for thicker or thinner material.
      </p>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={!connected || !positionReady}
          onClick={() => void burn()}
          title="Burn a temporary marker job without changing the project (normal preflight + confirmation)."
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
      {connected && !positionReady ? (
        <MarkerBurnPositionCheck
          homingEnabled={homingEnabled}
          onConfirm={() => confirmPositionEpoch(trustedPositionEpoch)}
        />
      ) : null}
      {props.note !== null ? <p style={errStyle}>{props.note}</p> : null}
    </div>
  );
}

function MarkerBurnPositionCheck(props: {
  readonly homingEnabled: boolean;
  readonly onConfirm: () => void;
}): JSX.Element {
  if (props.homingEnabled) {
    return <p style={errStyle}>Home the machine before burning the absolute bed marker pattern.</p>;
  }
  return (
    <div style={rowStyle}>
      <p style={errStyle}>
        Confirm that controller coordinates match the physical bed before burning markers.
      </p>
      <button
        type="button"
        className="lf-btn"
        onClick={props.onConfirm}
        title="Confirm the controller coordinate frame matches the machine bed for this session. Reconnect, reset, alarm, sleep, or homing invalidates it."
      >
        Confirm bed coordinates
      </button>
    </div>
  );
}

function AlignmentSettingsFields(): JSX.Element {
  const powerPercent = useCameraAlignWizardStore((s) => s.powerPercent);
  const speedMmPerMin = useCameraAlignWizardStore((s) => s.speedMmPerMin);
  const planeHeightMm = useCameraAlignWizardStore((s) => s.planeHeightMm);
  const setPowerPercent = useCameraAlignWizardStore((s) => s.setPowerPercent);
  const setSpeedMmPerMin = useCameraAlignWizardStore((s) => s.setSpeedMmPerMin);
  const setPlaneHeightMm = useCameraAlignWizardStore((s) => s.setPlaneHeightMm);
  return (
    <div style={rowStyle}>
      <NumberField
        label="Power %"
        value={powerPercent}
        min={1}
        max={100}
        title="Engrave power for the marker burn — dark enough to read, not cut through."
        onChange={setPowerPercent}
      />
      <NumberField
        label="Speed mm/min"
        value={speedMmPerMin}
        min={100}
        max={20000}
        title="Engrave speed for the marker burn."
        onChange={setSpeedMmPerMin}
      />
      <NumberField
        label="Marker surface height (mm)"
        value={planeHeightMm}
        min={0}
        max={500}
        step={0.1}
        title="Thickness of the alignment sheet or fixture above the machine bed. Use 0 only when the markers are on the bed surface itself."
        onChange={setPlaneHeightMm}
      />
    </div>
  );
}

function NumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly title: string;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      {props.label}
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        title={props.title}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
        style={inputStyle}
      />
    </label>
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
