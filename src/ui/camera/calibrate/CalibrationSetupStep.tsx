// CalibrationSetupStep — the target screen of the camera setup (ADR-441,
// ADR-663): the sheet thickness up front, the rest of the engrave settings
// folded away, then either engrave the ring target as a temporary job or go
// straight to the photo when a target is already on the bed. A camera on the
// laser head (ADR-449) gets a small square target in the middle of the bed.

import { useState } from 'react';
import { bedTargetLayoutWithRings } from '../../../core/camera/target/bed-target';
import { machineKindOf } from '../../../core/scene';
import { useStore } from '../../state';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';
import { useLaserStore } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';
import { useAssumedTarget } from './assumed-target';
import {
  addCalibrationTargetToCanvas,
  calibrationTargetArea,
  engraveCalibrationTarget,
} from './calibration-actions';
import { useCameraCalibrationStore, type CalibrationSettings } from './camera-calibration-store';
import {
  columnStyle,
  errStyle,
  fieldStyle,
  inputStyle,
  noteStyle,
  rowStyle,
  warnStyle,
} from './wizard-styles';

export function CalibrationSetupStep(props: { readonly note: string | null }): JSX.Element {
  const settings = useCameraCalibrationStore((s) => s.settings);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  const updateSettings = useCameraCalibrationStore((s) => s.updateSettings);
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const area = calibrationTargetArea(bedWidth, bedHeight, settings);
  const rings = bedTargetLayoutWithRings(area, settings.ringDiameterMm).marks.length;

  return (
    <div style={columnStyle}>
      <p style={leadStyle}>Engrave the target</p>
      <p style={textStyle}>
        Put a flat sheet of scrap (card, plywood or anodised aluminium) in the middle of the bed and
        enter {settings.headCamera ? 'how thick it is' : 'its size and how thick it is'}.
      </p>
      <div style={rowStyle}>
        {settings.headCamera ? null : (
          <>
            <NumberField
              label="Sheet width (mm)"
              value={settings.sheetWidthMm}
              step={10}
              title="Width of the sheet, left to right. About A4 (300 × 200 mm) calibrates the whole bed well; a sheet larger than the bed covers the bed."
              onChange={(value) => updateSettings({ sheetWidthMm: value ?? settings.sheetWidthMm })}
            />
            <NumberField
              label="Sheet height (mm)"
              value={settings.sheetHeightMm}
              step={10}
              title="Height of the sheet, front to back."
              onChange={(value) =>
                updateSettings({ sheetHeightMm: value ?? settings.sheetHeightMm })
              }
            />
          </>
        )}
        <NumberField
          label="Sheet thickness (mm)"
          value={settings.sheetThicknessMm}
          step={0.1}
          title="Thickness of the sheet the target is engraved on. The camera is fitted to its top surface."
          onChange={(value) =>
            updateSettings({ sheetThicknessMm: value ?? settings.sheetThicknessMm })
          }
        />
      </div>
      <p style={noteStyle}>
        KerfDesk engraves {rings} small rings across {Math.round(area.width)} ×{' '}
        {Math.round(area.height)} mm, then one photo of them calibrates the lens, finds where the
        camera is, and maps the picture onto the bed. Your project and undo history are not touched.
      </p>
      <p style={mountLineStyle}>
        Camera: {settings.headCamera ? 'on the laser head' : 'above the bed'}
        <button
          type="button"
          className="lf-btn"
          onClick={() => setStep({ kind: 'mount' })}
          title="Change where the camera is mounted."
        >
          Change
        </button>
      </p>
      <details style={foldStyle}>
        <summary
          style={summaryStyle}
          title="Show or hide the power, speed, margin and camera height used to engrave the target."
        >
          Engrave settings
        </summary>
        <SettingsFields settings={settings} />
      </details>
      <TargetActions settings={settings} note={props.note} />
    </div>
  );
}

// Engrave the target, or go to the photo of one already engraved, and Back.
function TargetActions(props: {
  readonly settings: CalibrationSettings;
  readonly note: string | null;
}): JSX.Element {
  const { settings } = props;
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  const assumed = useAssumedTarget();

  const engrave = async (): Promise<void> => {
    // A new target is engraved where these settings put it, whatever area an
    // earlier target (a check of the saved calibration) had.
    useCameraCalibrationStore.setState({ targetArea: null });
    const earlierJob = useLaserStore.getState().streamer;
    setStep({ kind: 'engraving', started: false, earlierJob });
    const started = await engraveCalibrationTarget(settings);
    setStep(
      started
        ? { kind: 'engraving', started: true, earlierJob }
        : {
            kind: 'setup',
            note: 'The target was not engraved. Fix the reported reason and try again.',
          },
    );
  };

  return (
    <>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={!connected}
          onClick={() => void engrave()}
          title="Frame and engrave the ring target as a temporary job, with the usual review before it starts."
        >
          Engrave target
        </button>
        <AddTargetToCanvasButton settings={settings} />
        <button
          type="button"
          className="lf-btn"
          onClick={() => setStep({ kind: 'photo', status: { kind: 'idle' } })}
          title="The ring target is already engraved on the bed. Go to the photo."
        >
          Target already engraved
        </button>
      </div>
      <p style={noteStyle}>
        Target already engraved looks for {assumed.description}.
        {assumed.source === 'settings' ? correctionHint(settings.headCamera) : null}
      </p>
      {connected ? null : (
        <p style={noteStyle}>
          Connect the machine to engrave from here, add the target to the canvas to engrave it like
          any job, or use a target engraved earlier.
        </p>
      )}
      <TargetPlacementNote connected={connected} />
      {props.note === null ? null : <p style={errStyle}>{props.note}</p>}
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn"
          onClick={() => setStep({ kind: 'picture' })}
          title="Back to the camera picture."
        >
          Back
        </button>
      </div>
    </>
  );
}

// Puts the target on the canvas as artwork, for an operator who engraves it
// like any job (ADR-441 Amendment 5), and waits at the photo.
function AddTargetToCanvasButton(props: { readonly settings: CalibrationSettings }): JSX.Element {
  const cncCanvas = useStore((s) => machineKindOf(s.project.machine) === 'cnc');
  const add = (): void => {
    if (useStore.getState().dirty && !jobAwareConfirm(REPLACE_ARTWORK_QUESTION)) return;
    addCalibrationTargetToCanvas(props.settings);
    useCameraCalibrationStore.setState({ targetArea: null, minimized: true });
    useCameraCalibrationStore.getState().setStep({ kind: 'photo', status: { kind: 'idle' } });
    useToastStore.getState().pushToast(TARGET_ON_CANVAS_MESSAGE, 'success');
  };
  return (
    <button
      type="button"
      className="lf-btn"
      disabled={cncCanvas}
      onClick={add}
      title={
        cncCanvas
          ? 'Switch the canvas to Laser to add the target: the rings are a laser engraving.'
          : 'Put the ring target on the canvas in place of the current artwork (Undo brings it back), to Frame and Start like any job. This wizard waits, minimised, at the photo step.'
      }
    >
      Add target to canvas
    </button>
  );
}

function TargetPlacementNote(props: { readonly connected: boolean }): JSX.Element | null {
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const homed = useLaserStore((s) => s.homingState === 'confirmed');
  const note = targetPlacementNote(props.connected, homingEnabled, homed);
  return note === null ? null : (
    <p role="status" style={homingEnabled ? warnStyle : noteStyle}>
      {note}
    </p>
  );
}

const REPLACE_ARTWORK_QUESTION =
  'Adding the calibration target replaces the current artwork (Undo brings it back). Continue?';
export const TARGET_ON_CANVAS_MESSAGE =
  'Calibration target added to the canvas and locked in place. Start from is now Absolute Coordinates. Frame and Start it, leave the sheet where it is, then press Expand on the Camera setup panel at the bottom right to take the photo.';
export const HOME_BEFORE_TARGET_NOTE =
  'Home the machine before engraving the target. Until it is homed, the rings are placed from wherever the head was when the machine was switched on, so the calibration would hold only until the next Home.';
export const NO_HOMING_TARGET_NOTE =
  'This machine has no homing, so the camera lines up only while the controller keeps the zero it has when the target is engraved.';

// The target runs at Absolute coordinates, which name a fixed place on the bed
// only once the machine is homed (ADR-441 Amendment 5). Advice, not a gate.
function targetPlacementNote(
  connected: boolean,
  homingEnabled: boolean,
  homed: boolean,
): string | null {
  if (!connected) return null;
  if (!homingEnabled) return NO_HOMING_TARGET_NOTE;
  return homed ? null : HOME_BEFORE_TARGET_NOTE;
}

// The rings are matched to the layout the settings describe, so a target
// engraved with other settings must be described first.
function correctionHint(headCamera: boolean): string {
  return headCamera
    ? ' If it was engraved at another size, enter that size first.'
    : ' If it was engraved with another margin, enter that margin first.';
}

// The rest of the target settings, folded away: most cameras never need them.
function SettingsFields(props: { readonly settings: CalibrationSettings }): JSX.Element {
  const { settings } = props;
  const update = useCameraCalibrationStore((s) => s.updateSettings);
  return (
    <div style={foldBodyStyle}>
      <div style={rowStyle}>
        <NumberField
          label="Power %"
          value={settings.powerPercent}
          step={1}
          title="Engrave power for the rings: dark enough to see clearly, not cut through."
          onChange={(value) => update({ powerPercent: value ?? settings.powerPercent })}
        />
        <NumberField
          label="Speed mm/min"
          value={settings.speedMmPerMin}
          step={100}
          title="Engrave speed for the rings."
          onChange={(value) => update({ speedMmPerMin: value ?? settings.speedMmPerMin })}
        />
      </div>
      <div style={rowStyle}>
        {settings.headCamera ? (
          <NumberField
            label="Target size (mm)"
            value={settings.headTargetSizeMm}
            step={5}
            title="Width of the square target in the middle of the bed. Pick a size the head camera sees whole, with some room around it."
            onChange={(value) => update({ headTargetSizeMm: value ?? settings.headTargetSizeMm })}
          />
        ) : (
          <NumberField
            label="Margin (mm)"
            value={settings.marginMm}
            step={1}
            title="Space kept clear around the target on every side of the sheet."
            onChange={(value) => update({ marginMm: value ?? settings.marginMm })}
          />
        )}
        <NumberField
          label="Ring size (mm)"
          value={settings.ringDiameterMm}
          step={1}
          title="Outer diameter of the target's rings; they are spaced four sizes apart. 10 mm suits most cameras. If the photo says the rings are too small, use the size it suggests."
          onChange={(value) => update({ ringDiameterMm: value ?? settings.ringDiameterMm })}
        />
        <NumberField
          label="Camera height (mm)"
          value={settings.cameraHeightMm}
          step={1}
          placeholder="optional"
          title="Height of the camera lens above the bed, by tape measure. Leave empty if unsure; enter it for a camera that looks straight down."
          onChange={(value) => update({ cameraHeightMm: value })}
        />
      </div>
      <p style={noteStyle}>
        {settings.headCamera
          ? 'A camera on the head sees a small patch of the bed, so the target is a small square in the middle. After engraving, move the head until the camera sees the whole square; KerfDesk records where the head was for the photo.'
          : 'A camera height is optional. For a camera that looks almost straight down, one photo cannot tell how high the camera is, and the measured height keeps thick material lined up.'}
      </p>
    </div>
  );
}

// Holds the typed text while the field has focus, so clearing a field to type
// a new number does not snap back to the stored value on the way.
export function NumberField(props: {
  readonly label: string;
  readonly value: number | null;
  readonly step: number;
  readonly title: string;
  readonly placeholder?: string;
  readonly onChange: (value: number | null) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const optional = props.placeholder !== undefined;
  return (
    <label style={fieldStyle}>
      {props.label}
      <input
        type="number"
        className="lf-input"
        step={props.step}
        value={draft ?? (props.value === null ? '' : String(props.value))}
        placeholder={props.placeholder}
        title={props.title}
        onChange={(event) => {
          const text = event.currentTarget.value.trim();
          setDraft(text);
          if (text === '') {
            if (optional) props.onChange(null);
            return;
          }
          const value = Number(text);
          if (Number.isFinite(value)) props.onChange(value);
        }}
        onBlur={() => setDraft(null)}
        style={inputStyle}
      />
    </label>
  );
}

const leadStyle: React.CSSProperties = { margin: 0, fontWeight: 600 };
const textStyle: React.CSSProperties = { margin: 0 };
const mountLineStyle: React.CSSProperties = {
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
const foldStyle: React.CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 6,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontWeight: 600 };
const foldBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingTop: 8,
};
