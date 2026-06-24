// DeviceProfileFields — the reusable per-field editors for a DeviceProfile
// (name, bed, origin, feed, power/air-assist, homing). Extracted verbatim
// from DeviceSettings.tsx so both the inline Device Profile panel and the
// upcoming connect-time Device Setup wizard render identical controls rather
// than duplicating them. Pure presentational components: each takes a
// `device` plus an `update` callback and owns no store wiring.

import type { DeviceProfile, Origin } from '../../core/devices';
import { numInputStyle, Row, unitStyle } from './device-settings-shared';

const ORIGIN_OPTIONS: ReadonlyArray<{ readonly value: Origin; readonly label: string }> = [
  { value: 'front-left', label: 'Front left' },
  { value: 'front-right', label: 'Front right' },
  { value: 'rear-left', label: 'Rear left' },
  { value: 'rear-right', label: 'Rear right' },
  { value: 'center', label: 'Center' },
];

type DeviceRowsProps = {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
};

export function OriginSelect(props: {
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

export function HomingEditor(props: {
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
export function BasicRows(props: DeviceRowsProps): JSX.Element {
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

export function PowerRows(props: DeviceRowsProps): JSX.Element {
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
export function FeedRows(props: DeviceRowsProps): JSX.Element {
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

const textInputStyle: React.CSSProperties = { width: 140 };
const timesStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
const inlineLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  cursor: 'pointer',
};
