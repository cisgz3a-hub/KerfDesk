// The quick nudge fix's screens (ADR-663 Amendment 2): burn one ring in the
// middle of the bed, take a photo of it, and move the camera picture onto it.
// A small offset is fixed in place; a large one, or none, says so instead.

import { useState } from 'react';
import type { Vec2 } from '../../../core/camera/model/camera-model';
import { NUDGE_LIMIT_MM, NUDGE_NOTHING_MM, nudgeSizeMm } from '../../../core/camera/model/nudge';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';
import { CameraSourceView } from '../CameraSourceView';
import {
  useCameraCalibrationStore,
  type CalibrationStep,
  type PhotoStatus,
} from './camera-calibration-store';
import { engraveNudgeRing, nudgeRingCentre } from './nudge-actions';
import type { NudgePhotoControls } from './use-nudge-photo';
import { NumberField } from './CalibrationSetupStep';
import { columnStyle, errStyle, noteStyle, rowStyle } from './wizard-styles';

export function NudgeSetupStep(props: { readonly note: string | null }): JSX.Element {
  const settings = useCameraCalibrationStore((s) => s.settings);
  const updateSettings = useCameraCalibrationStore((s) => s.updateSettings);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  const centre = nudgeRingCentre();

  const burn = async (): Promise<void> => {
    const earlierJob = useLaserStore.getState().streamer;
    const pending: CalibrationStep = { kind: 'engraving', started: false, earlierJob };
    setStep(pending);
    const started = await engraveNudgeRing(settings);
    const wizard = useCameraCalibrationStore.getState();
    // The temporary job may finish preparing after this wizard was replaced.
    // Minimize keeps the same step; close/reopen and a new mode do not.
    if (!wizard.open || wizard.mode !== 'nudge' || wizard.step !== pending) return;
    setStep(
      started
        ? { kind: 'engraving', started: true, earlierJob }
        : {
            kind: 'nudge-setup',
            note: 'The ring was not burned. Fix the reported reason and try again.',
          },
    );
  };

  return (
    <div style={columnStyle}>
      <p style={leadStyle}>Fix a small offset</p>
      <p style={textStyle}>
        When the camera picture is a millimetre or two off, KerfDesk burns one small ring in the
        middle of the bed ({Math.round(centre.x)}, {Math.round(centre.y)} mm), finds it in a photo,
        and moves the picture onto it. Put a clean piece of scrap there, with no old target on it.
      </p>
      <NumberField
        label="Sheet thickness (mm)"
        value={settings.sheetThicknessMm}
        step={0.1}
        title="Thickness of the scrap the ring burns on. The picture is measured at its top."
        onChange={(value) =>
          updateSettings({ sheetThicknessMm: value ?? settings.sheetThicknessMm })
        }
      />
      <p style={noteStyle}>
        The ring burns at {settings.powerPercent}% power and {settings.speedMmPerMin} mm/min, the
        calibration target&apos;s settings.
      </p>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={!connected}
          onClick={() => void burn()}
          title="Frame and burn one ring as a temporary job, with the usual review before it starts."
        >
          Burn the ring
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={() => setStep({ kind: 'nudge-photo', status: { kind: 'idle' } })}
          title="The ring is already burned in the middle of the bed. Go to the photo."
        >
          Ring already burned
        </button>
      </div>
      {connected ? null : (
        <p style={noteStyle}>Connect the machine to burn, or use a ring burned earlier.</p>
      )}
      {props.note === null ? null : <p style={errStyle}>{props.note}</p>}
    </div>
  );
}

export function NudgePhotoStep(props: {
  readonly status: PhotoStatus;
  readonly take: NudgePhotoControls['take'];
}): JSX.Element {
  const sourceState = useCameraStore((s) => s.sourceState);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  const running = props.status.kind === 'running';
  return (
    <div style={columnStyle}>
      <p style={noteStyle}>
        Leave the scrap where it is, move the head clear of the ring, and light the bed evenly.
      </p>
      {sourceState.kind === 'live' ? (
        <CameraSourceView source={sourceState.source} />
      ) : (
        <p style={errStyle}>
          No camera is running. Start it in the Camera panel, then take the photo.
        </p>
      )}
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={sourceState.kind !== 'live' || running}
          onClick={() => void props.take()}
          title="Take one photo and find the ring in it."
        >
          {running ? 'Finding the ring…' : 'Take photo'}
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={running}
          onClick={() => setStep({ kind: 'nudge-setup', note: null })}
          title="Back to burning the ring."
        >
          Back
        </button>
      </div>
      {props.status.kind === 'failed' ? <p style={errStyle}>{props.status.message}</p> : null}
    </div>
  );
}

export function NudgeResultStep(props: {
  readonly offsetMm: Vec2;
  readonly apply: NudgePhotoControls['apply'];
}): JSX.Element {
  const closeWizard = useCameraCalibrationStore((s) => s.closeWizard);
  const openWizard = useCameraCalibrationStore((s) => s.openWizard);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  const [applied, setApplied] = useState(false);
  const size = nudgeSizeMm(props.offsetMm);
  const apply = (): void => {
    if (!props.apply(props.offsetMm)) {
      useToastStore
        .getState()
        .pushToast('The running camera has no calibration of its own to fix.', 'warning');
      return;
    }
    setApplied(true);
    useToastStore
      .getState()
      .pushToast(`Camera picture moved ${size.toFixed(1)} mm. Undo puts it back.`, 'success');
    closeWizard();
  };
  if (size < NUDGE_NOTHING_MM) return <NothingToFix onDone={closeWizard} />;
  const tooBig = size > NUDGE_LIMIT_MM;
  return (
    <div style={columnStyle}>
      <p style={tooBig ? warnStyle : okStyle}>
        The picture is {size.toFixed(1)} mm off: {offsetWords(props.offsetMm)}.
      </p>
      {tooBig ? (
        <p style={noteStyle}>
          That is more than a small offset: the camera or its lid has moved. Calibrate again so the
          whole picture lines up, not just the middle.
        </p>
      ) : (
        <p style={noteStyle}>
          Fix moves the camera picture {size.toFixed(1)} mm so the ring shows where it burned. It is
          one step on Undo.
        </p>
      )}
      <div style={rowStyle}>
        {tooBig ? (
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            onClick={openWizard}
            title="Engrave a new target and calibrate the camera again."
          >
            Recalibrate…
          </button>
        ) : (
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            disabled={applied}
            onClick={apply}
            title="Move the saved camera picture by this much."
          >
            Fix
          </button>
        )}
        <button
          type="button"
          className="lf-btn"
          onClick={() => setStep({ kind: 'nudge-photo', status: { kind: 'idle' } })}
          title="Take the photo again."
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function NothingToFix(props: { readonly onDone: () => void }): JSX.Element {
  return (
    <div style={columnStyle}>
      <p style={okStyle}>
        The picture already lines up with the ring (within {NUDGE_NOTHING_MM} mm).
      </p>
      <p style={noteStyle}>Nothing to fix.</p>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          onClick={props.onDone}
          title="Close: the camera picture already lines up."
        >
          Done
        </button>
      </div>
    </div>
  );
}

// Where the picture shows the ring, from where it burned: the opposite of the fix.
export function offsetWords(offsetMm: Vec2): string {
  const parts: string[] = [];
  if (Math.abs(offsetMm.x) >= 0.05) {
    const side = offsetMm.x > 0 ? 'left' : 'right';
    parts.push(`${Math.abs(offsetMm.x).toFixed(1)} mm to the ${side} of`);
  }
  // Bed y grows down the workspace canvas (ADR-440).
  if (Math.abs(offsetMm.y) >= 0.05) {
    parts.push(`${Math.abs(offsetMm.y).toFixed(1)} mm ${offsetMm.y > 0 ? 'above' : 'below'}`);
  }
  return `the ring shows ${parts.join(' and ')} where it burned`;
}

const leadStyle: React.CSSProperties = { margin: 0, fontWeight: 600 };
const textStyle: React.CSSProperties = { margin: 0 };
const okStyle: React.CSSProperties = { margin: 0, fontWeight: 600 };
const warnStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: 600,
  color: 'var(--lf-warning-fg)',
};
