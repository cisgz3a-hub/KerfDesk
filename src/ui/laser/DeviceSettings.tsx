// DeviceSettings — full editor for the active DeviceProfile. Every field
// in DeviceProfile is editable here, including the two that originally
// required hand-editing device-profile.json: origin corner (controls
// Y-flip in toMachineCoords) and homing (controls whether $H is sent
// on connect).
//
// Phase C closure of "settings panel" — kept inline in the Laser rail
// rather than a separate modal page. The fields are few enough that
// a modal would add modality without adding clarity (CLAUDE.md
// "simplicity first").
//
// The per-field editors (BasicRows/FeedRows/OriginSelect/HomingEditor) live in
// DeviceProfileFields.tsx, the power/air-assist rows in
// DeviceProfilePowerFields.tsx, and AutofocusEditor + PlannerAdvanced in
// sibling files, so this file stays a thin composition under the 400-line hard
// cap and the same controls can be reused by the unified Machine Setup flow.

import { useStore } from '../state';
import { AutofocusEditor } from './AutofocusEditor';
import { Row } from './device-settings-shared';
import { BasicRows, HomingEditor } from './DeviceProfileFields';
import { AirAssistRow, FireControlRow, LaserPowerRows } from './DeviceProfilePowerFields';
import { ProfileRows, ZRows } from './DeviceProfileRows';
import { PlannerAdvanced } from './PlannerAdvanced';
import { ScanOffsetEditor } from './ScanOffsetEditor';

export function DeviceSettings(): JSX.Element {
  const device = useStore((s) => s.project.device);
  const update = useStore((s) => s.updateDeviceProfile);
  // ADR-101 §6 (provisional): laser-output-only device fields — power range
  // ($30/$31/$32), air assist, scanning offsets, autofocus command — hide on
  // a router. H.7 CNC machine profiles add the CNC counterparts.
  const isCncMachine = useStore((s) => s.project.machine?.kind === 'cnc');
  // Open by default when this legacy composition is embedded in a profile
  // surface, because the operator opened it to inspect or edit the profile, so
  // the fields should be visible on arrival rather than one click away — the
  // same directness LightBurn's Device Settings gives. <details> (not React
  // state) still lets the operator collapse it; the browser DOM owns the toggle
  // for the rest of the session. PlannerAdvanced has its own nested <details>
  // for the power-user knobs — that nesting is intentional, not accidental.
  return (
    <details open style={panelStyle}>
      <summary
        style={summaryStyle}
        title="Choose the local KerfDesk machine profile: bed size, origin, feed limits, power range, homing, focus, and air output. This does not write firmware settings."
      >
        Device Profile
      </summary>
      <div style={bodyStyle}>
        <BasicRows device={device} update={update} />
        {!isCncMachine && (
          <>
            <LaserPowerRows device={device} update={update} />
            <AirAssistRow device={device} update={update} />
            <FireControlRow device={device} update={update} />
            <ScanOffsetEditor
              value={device.scanningOffsets}
              onChange={(scanningOffsets) => update({ scanningOffsets })}
            />
          </>
        )}
        <ProfileRows device={device} update={update} />
        <ZRows device={device} update={update} />
        <Row label="Homing">
          <HomingEditor
            enabled={device.homing.enabled}
            direction={device.homing.direction}
            onChange={(homing) => update({ homing })}
          />
        </Row>
        {!isCncMachine && (
          <AutofocusEditor
            value={device.autofocusCommand}
            onChange={(autofocusCommand) => update({ autofocusCommand })}
          />
        )}
        <PlannerAdvanced
          accel={device.accelMmPerSec2}
          jd={device.junctionDeviationMm}
          cutTimeScale={device.estimateCutTimeScale ?? 1}
          travelTimeScale={device.estimateTravelTimeScale ?? 1}
          onAccelChange={(accelMmPerSec2) => update({ accelMmPerSec2 })}
          onJdChange={(junctionDeviationMm) => update({ junctionDeviationMm })}
          onCutTimeScaleChange={(estimateCutTimeScale) => update({ estimateCutTimeScale })}
          onTravelTimeScaleChange={(estimateTravelTimeScale) => update({ estimateTravelTimeScale })}
        />
      </div>
    </details>
  );
}

// File-local styles. Anything shared with AutofocusEditor / PlannerAdvanced
// lives in device-settings-shared.tsx; the per-field editors carry their own
// styles in DeviceProfileFields.tsx; what's left here is DeviceSettings-only.
const panelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 6,
  background: 'var(--lf-bg-2)',
};
const summaryStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  userSelect: 'none',
};
const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 6,
};
