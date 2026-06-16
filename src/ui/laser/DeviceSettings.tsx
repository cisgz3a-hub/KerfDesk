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
// AutofocusEditor + PlannerAdvanced live in sibling files (F-1 audit
// fix) so this file stays under the 400-line hard cap.

import type { DeviceProfile, Origin } from '../../core/devices';
import { useStore } from '../state';
import { AutofocusEditor } from './AutofocusEditor';
import { numInputStyle, Row, unitStyle } from './device-settings-shared';
import { ProfileRows, ZRows } from './DeviceProfileRows';
import { PlannerAdvanced } from './PlannerAdvanced';

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

const ORIGIN_OPTIONS: ReadonlyArray<{ readonly value: Origin; readonly label: string }> = [
  { value: 'front-left', label: 'Front left' },
  { value: 'front-right', label: 'Front right' },
  { value: 'rear-left', label: 'Rear left' },
  { value: 'rear-right', label: 'Rear right' },
  { value: 'center', label: 'Center' },
];

type DeviceRowsProps = {
  readonly device: ReturnType<typeof useStore.getState>['project']['device'];
  readonly update: ReturnType<typeof useStore.getState>['updateDeviceProfile'];
};

function OriginSelect(props: {
  readonly value: Origin;
  readonly onChange: (next: Origin) => void;
}): JSX.Element {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as Origin)}
      aria-label="Machine origin corner"
      title="Where (0,0) sits on your machine. Match this to the corner your GRBL homes to — most Falcon / xTool diode lasers are front-left."
    >
      {ORIGIN_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function HomingEditor(props: {
  readonly enabled: boolean;
  readonly direction: Origin;
  readonly onChange: (next: { enabled: boolean; direction: Origin }) => void;
}): JSX.Element {
  return (
    <>
      <label
        style={inlineLabelStyle}
        title="If enabled, the Home button sends $H and waits for completion."
      >
        <input
          type="checkbox"
          checked={props.enabled}
          onChange={(e) =>
            props.onChange({ enabled: e.target.checked, direction: props.direction })
          }
          aria-label="Homing enabled"
          title="Enable this only when the controller supports GRBL $H homing."
        />
        <span>$H supported</span>
      </label>
      {props.enabled && (
        <select
          value={props.direction}
          onChange={(e) =>
            props.onChange({ enabled: props.enabled, direction: e.target.value as Origin })
          }
          aria-label="Homes to corner"
          title="Which corner the controller homes to. Usually matches the machine origin."
        >
          {ORIGIN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

// The five always-visible numeric fields: Name, Bed (W×H), Origin,
// Max feed, $30 max power. Sub-component so DeviceSettings itself
// stays under the 80-line function cap and reads as a list.
function BasicRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
    <>
      <Row label="Name">
        <input
          type="text"
          value={device.name}
          onChange={(e) => update({ name: e.target.value })}
          style={textInputStyle}
          aria-label="Device name"
          title="Name for this machine profile."
        />
      </Row>
      <Row label="Bed">
        <input
          type="number"
          min={10}
          step={1}
          value={device.bedWidth}
          onChange={(e) => update({ bedWidth: Math.max(10, Number(e.target.value) || 0) })}
          style={numInputStyle}
          aria-label="Bed width (mm)"
          title="Usable machine bed width in millimeters. Match GRBL $130."
        />
        <span style={timesStyle}>×</span>
        <input
          type="number"
          min={10}
          step={1}
          value={device.bedHeight}
          onChange={(e) => update({ bedHeight: Math.max(10, Number(e.target.value) || 0) })}
          style={numInputStyle}
          aria-label="Bed height (mm)"
          title="Usable machine bed height in millimeters. Match GRBL $131."
        />
        <span style={unitStyle}>mm</span>
      </Row>
      <Row label="Origin">
        <OriginSelect value={device.origin} onChange={(origin) => update({ origin })} />
      </Row>
      <FeedRows device={device} update={update} />
      <PowerRows device={device} update={update} />
    </>
  );
}

function PowerRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
    <>
      <Row label="$30 (max S)">
        <input
          type="number"
          min={1}
          step={1}
          value={device.maxPowerS}
          onChange={(e) =>
            update({ maxPowerS: Math.max(1, Math.floor(Number(e.target.value) || 0)) })
          }
          style={numInputStyle}
          aria-label="GRBL $30 max power S"
          title="Maximum GRBL spindle/laser S value. Match your controller's $30 setting."
        />
      </Row>
      <Row label="$31 (min S)">
        <input
          type="number"
          min={0}
          step={1}
          value={device.minPowerS}
          onChange={(e) =>
            update({ minPowerS: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
          style={numInputStyle}
          aria-label="GRBL $31 min power S"
          title="Minimum nonzero spindle/laser S value. Diode lasers usually use 0."
        />
      </Row>
      <Row label="$32 laser mode">
        <label
          style={inlineLabelStyle}
          title="GRBL laser mode. Keep this enabled for M4 dynamic-power image engraving."
        >
          <input
            type="checkbox"
            checked={device.laserModeEnabled}
            onChange={(e) => update({ laserModeEnabled: e.target.checked })}
            aria-label="GRBL $32 laser mode enabled"
            title="Enable GRBL laser mode ($32=1) for laser jobs."
          />
          <span>Enabled</span>
        </label>
      </Row>
      <Row label="Air assist">
        <select
          value={device.airAssistCommand}
          onChange={(e) =>
            update({ airAssistCommand: e.target.value as DeviceProfile['airAssistCommand'] })
          }
          aria-label="Air assist command"
          title="Choose the GRBL coolant command wired to your air assist. Leave Disabled unless you have tested the output."
        >
          <option value="none">Disabled</option>
          <option value="M8">M8 flood coolant</option>
          <option value="M7">M7 mist coolant</option>
        </select>
      </Row>
    </>
  );
}

// Two related feed knobs: machine hardware ceiling + dedicated frame
// speed. Sit next to each other so the relationship (one caps the
// other) is immediately legible. Extracted from BasicRows so each
// component stays under the 80-line per-function lint cap.
function FeedRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
    <>
      <Row label="Max feed">
        <input
          type="number"
          min={1}
          step={100}
          value={device.maxFeed}
          onChange={(e) => update({ maxFeed: Math.max(1, Number(e.target.value) || 0) })}
          style={numInputStyle}
          aria-label="Max feed (mm/min)"
          title="Hardware ceiling on commanded feed — the planner clamps every move to this."
        />
        <span style={unitStyle}>mm/min</span>
      </Row>
      <Row label="Frame feed">
        <input
          type="number"
          min={1}
          step={100}
          value={device.framingFeedMmPerMin}
          onChange={(e) =>
            update({ framingFeedMmPerMin: Math.max(1, Number(e.target.value) || 0) })
          }
          style={numInputStyle}
          aria-label="Framing feed (mm/min)"
          title="Feed used by the Frame button. Independent of cut/engrave speeds — capped at Max feed at emit time."
        />
        <span style={unitStyle}>mm/min</span>
      </Row>
    </>
  );
}

// File-local styles. Anything shared with AutofocusEditor /
// PlannerAdvanced lives in device-settings-shared.tsx; what's left
// here is genuinely DeviceSettings-only.
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
const textInputStyle: React.CSSProperties = { width: 140 };
const timesStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
const inlineLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  cursor: 'pointer',
};
