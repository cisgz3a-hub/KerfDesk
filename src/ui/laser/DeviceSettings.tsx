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
// cap and the same controls can be reused by the connect-time Device Setup
// wizard.

import { useStore } from '../state';
import { AutofocusEditor } from './AutofocusEditor';
import { Row } from './device-settings-shared';
import { BasicRows, HomingEditor } from './DeviceProfileFields';
import { ProfileRows, ZRows } from './DeviceProfileRows';
import { PlannerAdvanced } from './PlannerAdvanced';
import { ScanOffsetEditor } from './ScanOffsetEditor';

export function DeviceSettings(): JSX.Element {
  const device = useStore((s) => s.project.device);
  const update = useStore((s) => s.updateDeviceProfile);
  // Whole panel collapses to one row by default. <details> gives us the
  // disclosure widget without any React state — the user's last-chosen
  // open/closed status persists for the session (browser DOM owns it).
  // Closed by default keeps the laser rail compact; opening it is an explicit
  // operator choice. PlannerAdvanced has its own nested <details> for the
  // power-user knobs — that nesting is intentional, not accidental.
  return (
    <details style={panelStyle}>
      <summary
        style={summaryStyle}
        title="Choose the local LaserForge machine profile: bed size, origin, feed limits, power range, homing, focus, and air assist. This does not write firmware settings."
      >
        Device Profile
      </summary>
      <div style={bodyStyle}>
        <BasicRows device={device} update={update} />
        <ScanOffsetEditor
          value={device.scanningOffsets}
          onChange={(scanningOffsets) => update({ scanningOffsets })}
        />
        <ProfileRows device={device} update={update} />
        <ZRows device={device} update={update} />
        <Row label="Homing">
          <HomingEditor
            enabled={device.homing.enabled}
            direction={device.homing.direction}
            onChange={(homing) => update({ homing })}
          />
        </Row>
        <AutofocusEditor
          value={device.autofocusCommand}
          onChange={(autofocusCommand) => update({ autofocusCommand })}
        />
        <PlannerAdvanced
          accel={device.accelMmPerSec2}
          jd={device.junctionDeviationMm}
          onAccelChange={(accelMmPerSec2) => update({ accelMmPerSec2 })}
          onJdChange={(junctionDeviationMm) => update({ junctionDeviationMm })}
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
