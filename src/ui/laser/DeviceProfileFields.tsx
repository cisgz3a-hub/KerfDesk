// DeviceProfileFields — reusable per-field editors for a DeviceProfile's
// identity and geometry (name, bed, origin, feed) plus homing. Granular so the
// Device Setup wizard can place machine-reported geometry on its "confirm"
// step and operator-supplied placement on its "safety" step; BasicRows
// recomposes them in the original order for the inline Device Profile panel, so
// that panel renders identical controls. Pure presentational components: each
// takes a `device` plus an `update` callback and owns no store wiring.
// Power/air-assist fields live in DeviceProfilePowerFields.tsx.

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

export function NameRow(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
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
  );
}

export function BedRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
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
  );
}

export function OriginCornerRow(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
    <Row label="Origin">
      <OriginSelect value={device.origin} onChange={(origin) => update({ origin })} />
    </Row>
  );
}

// Two related feed knobs: machine hardware ceiling + dedicated frame speed. Sit
// next to each other so the relationship (one caps the other) is legible.
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

// The inline Device Profile panel's machine-agnostic fields in one block,
// composed from the granular rows so the wizard can reuse them piecemeal.
// The laser-only power/air-assist rows moved to DeviceSettings, which gates
// them on the machine kind (ADR-100 §6) — the wizard steps already mount
// LaserPowerRows / AirAssistRow directly.
export function BasicRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
    <>
      <NameRow device={device} update={update} />
      <BedRows device={device} update={update} />
      <OriginCornerRow device={device} update={update} />
      <FeedRows device={device} update={update} />
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
