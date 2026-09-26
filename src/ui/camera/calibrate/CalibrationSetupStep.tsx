// CalibrationSetupStep — step 1 of the camera calibration wizard (ADR-441):
// the engrave settings, the sheet thickness and the optional tape-measured
// camera height, then either engrave the ring target as a temporary job or
// go straight to the photo when a target is already on the bed.

import { useState } from 'react';
import { bedTargetLayout } from '../../../core/camera/target/bed-target';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { engraveCalibrationTarget, targetAreaForBed } from './calibration-actions';
import { useCameraCalibrationStore, type CalibrationSettings } from './camera-calibration-store';
import {
  columnStyle,
  errStyle,
  fieldStyle,
  inputStyle,
  noteStyle,
  rowStyle,
} from './wizard-styles';

export function CalibrationSetupStep(props: { readonly note: string | null }): JSX.Element {
  const settings = useCameraCalibrationStore((s) => s.settings);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const area = targetAreaForBed(bedWidth, bedHeight, settings.marginMm);
  const rings = bedTargetLayout({ area }).marks.length;

  const engrave = async (): Promise<void> => {
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
    <div style={columnStyle}>
      <p style={noteStyle}>
        Cover the bed with one flat sheet of scrap (card, plywood or anodised aluminium). KerfDesk
        engraves {rings} small rings across {Math.round(area.width)} × {Math.round(area.height)} mm,
        then one photo of them calibrates the lens, finds where the camera is, and maps the picture
        onto the bed. Your project and undo history are not touched.
      </p>
      <SettingsFields settings={settings} />
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
        <button
          type="button"
          className="lf-btn"
          onClick={() => setStep({ kind: 'photo', status: { kind: 'idle' } })}
          title="The ring target is already engraved on the bed with these margins. Go to the photo."
        >
          Target already engraved
        </button>
      </div>
      {connected ? null : (
        <p style={noteStyle}>Connect the machine to engrave, or use a target engraved earlier.</p>
      )}
      {props.note === null ? null : <p style={errStyle}>{props.note}</p>}
    </div>
  );
}

function SettingsFields(props: { readonly settings: CalibrationSettings }): JSX.Element {
  const { settings } = props;
  const update = useCameraCalibrationStore((s) => s.updateSettings);
  return (
    <>
      <div style={rowStyle}>
        <NumberField
          label="Sheet thickness (mm)"
          value={settings.sheetThicknessMm}
          step={0.1}
          title="Thickness of the sheet the target is engraved on. The camera is fitted to its top surface."
          onChange={(value) => update({ sheetThicknessMm: value ?? settings.sheetThicknessMm })}
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
        <NumberField
          label="Margin (mm)"
          value={settings.marginMm}
          step={1}
          title="Space kept clear around the target on every side of the bed."
          onChange={(value) => update({ marginMm: value ?? settings.marginMm })}
        />
      </div>
      <p style={noteStyle}>
        A camera height is optional. For a camera that looks almost straight down, one photo cannot
        tell how high the camera is, and the measured height keeps thick material lined up.
      </p>
    </>
  );
}

// Holds the typed text while the field has focus, so clearing a field to type
// a new number does not snap back to the stored value on the way.
function NumberField(props: {
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
