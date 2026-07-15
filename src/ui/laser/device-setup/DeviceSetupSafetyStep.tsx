// Step 5: software safety boundaries and optional calibrated features. These
// editors stay draft-bound; no live project state or hardware command changes
// when a field is edited.

import {
  DEFAULT_ROTARY_SETUP,
  type DeviceProfile,
  type RotarySetup,
  type RotaryType,
} from '../../../core/devices';
import { NumberField } from '../../common/NumberField';
import { AutofocusEditor } from '../AutofocusEditor';
import { ZRows } from '../DeviceProfileRows';
import { SafetyZonesPanel } from '../MachineSetupSafetyZones';
import { PlannerAdvanced } from '../PlannerAdvanced';
import { ScanOffsetEditor } from '../ScanOffsetEditor';
import { Row, numInputStyle, unitStyle } from '../device-settings-shared';
import { deviceSetupSupportsMachineKind, type DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupSafetyStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const draft = state.draft;
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      <div style={introStyle}>
        <strong>Safety boundaries and calibrated options</strong>
        <span>
          Safety zones are enforced by job, frame, export, resume, and bounded jog checks. Optional
          Z, rotary, camera, scan, and focus features stay off or uncalibrated until configured.
        </span>
      </div>
      <details open style={detailsStyle}>
        <summary style={summaryStyle} title="Show or hide software no-go-zone boundaries.">
          No-go zones
        </summary>
        <SafetyZonesPanel zones={draft.noGoZones} onChange={(noGoZones) => update({ noGoZones })} />
      </details>
      <details style={detailsStyle}>
        <summary style={summaryStyle} title="Show or hide powered-Z and probe metadata.">
          Z axis and probe
        </summary>
        <div style={bodyStyle}>
          <ZRows device={draft} update={update} />
          <p style={mutedStyle}>
            Recording a probe does not run a probe cycle. Work-zero probing remains a separate,
            supervised hardware operation after setup is saved.
          </p>
        </div>
      </details>
      <details style={detailsStyle}>
        <summary
          style={summaryStyle}
          title="Show or hide planner and duration-estimate calibration values."
        >
          Planner and time-estimate calibration
        </summary>
        <div style={bodyStyle}>
          <PlannerAdvanced
            accel={draft.accelMmPerSec2}
            jd={draft.junctionDeviationMm}
            cutTimeScale={draft.estimateCutTimeScale ?? 1}
            travelTimeScale={draft.estimateTravelTimeScale ?? 1}
            onAccelChange={(accelMmPerSec2) => update({ accelMmPerSec2 })}
            onJdChange={(junctionDeviationMm) => update({ junctionDeviationMm })}
            onCutTimeScaleChange={(estimateCutTimeScale) => update({ estimateCutTimeScale })}
            onTravelTimeScaleChange={(estimateTravelTimeScale) =>
              update({ estimateTravelTimeScale })
            }
          />
        </div>
      </details>
      {deviceSetupSupportsMachineKind(state, 'laser') ? (
        <LaserCalibrationSections draft={draft} update={update} />
      ) : null}
    </section>
  );
}

function LaserCalibrationSections(props: {
  readonly draft: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  const { draft, update } = props;
  return (
    <>
      <details style={detailsStyle}>
        <summary
          style={summaryStyle}
          title="Show or hide raster scan-offset and autofocus calibration."
        >
          Raster and autofocus calibration
        </summary>
        <div style={bodyStyle}>
          <ScanOffsetEditor
            value={draft.scanningOffsets}
            onChange={(scanningOffsets) => update({ scanningOffsets })}
          />
          <AutofocusEditor
            value={draft.autofocusCommand}
            onChange={(autofocusCommand) => update({ autofocusCommand })}
          />
        </div>
      </details>
      <details style={detailsStyle}>
        <summary style={summaryStyle} title="Show or hide rotary attachment configuration.">
          Rotary attachment
        </summary>
        <RotaryDraftFields
          value={draft.rotary ?? DEFAULT_ROTARY_SETUP}
          onChange={(rotary) => update({ rotary })}
        />
      </details>
      <CameraStatus profile={draft} />
    </>
  );
}

function RotaryDraftFields(props: {
  readonly value: RotarySetup;
  readonly onChange: (value: RotarySetup) => void;
}): JSX.Element {
  const { value, onChange } = props;
  const number = (field: 'objectDiameterMm' | 'mmPerRotation', next: number): void =>
    onChange({ ...value, [field]: next });
  return (
    <div style={bodyStyle}>
      <Row label="Rotary">
        <label style={inlineStyle}>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
            aria-label="Enable rotary attachment"
            title="Enable rotary output only while the attachment is installed and calibrated."
          />
          Enable only while the attachment is installed
        </label>
      </Row>
      <Row label="Type">
        <select
          value={value.type}
          onChange={(event) => onChange({ ...value, type: event.target.value as RotaryType })}
          aria-label="Rotary type"
          title="Choose whether the rotary attachment uses rollers or a chuck."
        >
          <option value="roller">Roller</option>
          <option value="chuck">Chuck</option>
        </select>
      </Row>
      <RotaryNumber
        label="Object diameter"
        value={value.objectDiameterMm}
        onCommit={(next) => number('objectDiameterMm', next)}
      />
      <RotaryNumber
        label="Motion per turn"
        value={value.mmPerRotation}
        onCommit={(next) => number('mmPerRotation', next)}
      />
      <Row label="Direction">
        <label style={inlineStyle}>
          <input
            type="checkbox"
            checked={value.reverseAxis === true}
            onChange={(event) => onChange({ ...value, reverseAxis: event.target.checked })}
            aria-label="Reverse rotary direction"
            title="Reverse rotary travel only if the calibration test moves in the wrong direction."
          />
          Reverse rotary axis
        </label>
      </Row>
      <p style={mutedStyle}>
        Run the rotary calibration pattern after saving and measure one full revolution before
        production.
      </p>
    </div>
  );
}

function RotaryNumber(props: {
  readonly label: string;
  readonly value: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <Row label={props.label}>
      <NumberField
        ariaLabel={props.label}
        value={props.value}
        min={0.1}
        max={100000}
        step={0.1}
        onCommit={props.onCommit}
        style={numInputStyle}
      />
      <span style={unitStyle}>mm</span>
    </Row>
  );
}

function CameraStatus({ profile }: { readonly profile: DeviceProfile }): JSX.Element {
  return (
    <details style={detailsStyle}>
      <summary style={summaryStyle} title="Show or hide camera calibration status.">
        Camera
      </summary>
      <dl style={definitionStyle}>
        <dt>Camera profile</dt>
        <dd>{profile.cameraProfile === undefined ? 'Not selected' : 'Configured'}</dd>
        <dt>Lens calibration</dt>
        <dd>{profile.cameraCalibration === undefined ? 'Pending' : 'Saved'}</dd>
        <dt>Bed alignment</dt>
        <dd>{profile.cameraAlignment === undefined ? 'Pending' : 'Saved'}</dd>
      </dl>
      <p style={mutedStyle}>
        Camera capture and four-point alignment require the live camera view, so use Camera Setup
        after saving this machine draft. Existing calibration remains attached to the profile.
      </p>
    </details>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const introStyle: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12, lineHeight: 1.45 };
const detailsStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12, fontWeight: 600 };
const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 8,
};
const mutedStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.45,
};
const inlineStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 5,
  alignItems: 'center',
  fontSize: 12,
};
const definitionStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px minmax(0, 1fr)',
  gap: '5px 10px',
  fontSize: 12,
};
