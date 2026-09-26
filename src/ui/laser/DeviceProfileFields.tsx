// DeviceProfileFields — reusable per-field editors for a DeviceProfile's
// identity and geometry (name, bed, origin, feed) plus the recorded homing
// corner. Granular so Machine Setup's coordinates step can place each field
// where it belongs. Pure presentational components: each takes a value plus a
// change callback and owns no store wiring.
// Power/air-assist fields live in DeviceProfilePowerFields.tsx.

import type { DeviceProfile, Origin } from '../../core/devices';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { numInputStyle, Row, unitStyle } from './device-settings-shared';

const MAX_BED_MM = 1500;
const MAX_FEED_MM_PER_MIN = 100000;

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
  readonly ariaLabel?: string;
  readonly title?: string;
}): JSX.Element {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as Origin)}
      aria-label={props.ariaLabel ?? 'Machine origin corner'}
      title={
        props.title ??
        "Sets the canvas-to-machine coordinate orientation and jog directions. Match the controller's coordinate layout. This does not set work zero or change homing settings."
      }
    >
      {ORIGIN_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function HomingCornerSelect(props: {
  readonly value: Origin;
  readonly onChange: (next: Origin) => void;
}): JSX.Element {
  return (
    <label style={inlineLabelStyle}>
      <span>Recorded home</span>
      <OriginSelect
        value={props.value}
        onChange={props.onChange}
        ariaLabel="Recorded homing corner"
        title="Record where this machine homes. The controller's firmware determines the actual homing direction; changing this record does not change firmware."
      />
    </label>
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
      <ClearableNumberField
        min={10}
        max={MAX_BED_MM}
        step={1}
        value={device.bedWidth}
        onCommit={(bedWidth) => update({ bedWidth })}
        style={numInputStyle}
        ariaLabel="Bed width (mm)"
        title="Usable X work area in millimeters. GRBL $130 reports configured travel; confirm the actual usable width on the machine."
      />
      <span style={timesStyle}>×</span>
      <ClearableNumberField
        min={10}
        max={MAX_BED_MM}
        step={1}
        value={device.bedHeight}
        onCommit={(bedHeight) => update({ bedHeight })}
        style={numInputStyle}
        ariaLabel="Bed height (mm)"
        title="Usable Y work area in millimeters. GRBL $131 reports configured travel; confirm the actual usable height on the machine."
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

// Two distinct feed knobs: the profile output ceiling and the requested Frame
// speed. Frame preserves the request unless live per-axis controller limits are
// known, so the help text must not imply maxFeed is a hardware fact or Frame cap.
export function FeedRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
    <>
      <Row label="Output max feed">
        <ClearableNumberField
          min={1}
          max={MAX_FEED_MM_PER_MIN}
          step={100}
          value={device.maxFeed}
          onCommit={(maxFeed) => update({ maxFeed })}
          style={numInputStyle}
          ariaLabel="Output max feed (mm/min)"
          title="Laser ceiling used when compiling cut and engrave output. CNC keeps its own in Machine Setup. It is not a verified hardware limit and does not cap Frame motion."
        />
        <span style={unitStyle}>mm/min</span>
      </Row>
      <Row label="Frame feed">
        <ClearableNumberField
          min={1}
          max={MAX_FEED_MM_PER_MIN}
          step={100}
          value={device.framingFeedMmPerMin}
          onCommit={(framingFeedMmPerMin) => update({ framingFeedMmPerMin })}
          style={numInputStyle}
          ariaLabel="Framing feed (mm/min)"
          title="Requested feed used by laser Frame; CNC keeps its own. Known live X/Y controller limits cap the emitted Frame; when those limits are unknown, the full requested feed is sent."
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
