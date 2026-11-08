// DeviceProfileFields — reusable per-field editors for a DeviceProfile's
// identity and geometry (name, bed, origin, feed) plus the recorded homing
// corner. Granular so Machine Setup's coordinates step can place each field
// where it belongs. Pure presentational components: each takes a value plus a
// change callback and owns no store wiring. The origin and the recorded homing
// corner are picked on a bed diagram (BedCornerPicker).
// Power/air-assist fields live in DeviceProfilePowerFields.tsx.

import type { DeviceProfile, Origin } from '../../core/devices';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { BedCornerPicker, bedPositionLabel } from './BedCornerPicker';
import { numInputStyle, Row, unitStyle } from './device-settings-shared';

export const MAX_BED_MM = 1500;
const MAX_FEED_MM_PER_MIN = 100000;

/** The origin corner as the bed diagram names it ("Front left"). */
export function originLabel(origin: Origin): string {
  return bedPositionLabel(origin);
}

type DeviceRowsProps = {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
};

export function OriginCornerPicker(props: {
  readonly value: Origin;
  readonly onChange: (next: Origin) => void;
}): JSX.Element {
  return (
    <span style={originStyle}>
      <BedCornerPicker
        value={props.value}
        onChange={props.onChange}
        marker="origin"
        ariaLabel="Machine origin corner"
        title="Sets the canvas-to-machine coordinate orientation and jog directions. Match the controller's coordinate layout. This does not set work zero or change homing settings."
      />
      <span style={originHintStyle}>{ORIGIN_CHECK_HINT}</span>
    </span>
  );
}

// What a wrong corner does and how to catch it before a burn, as LightBurn's
// MirroredOrBackwards page maps each symptom to a corner (UX audit U8-P3-3).
// The jog arrows follow this setting, so they show a wrong corner first.
export const ORIGIN_CHECK_HINT =
  "Most diode lasers: Front left. To check, press the jog pad's right arrow: the head should move right, and the up arrow should move it away from you. If a test burn comes out upside down, pick the other front/back corner; if it is mirrored, the other left/right corner.";

export function HomingCornerPicker(props: {
  readonly value: Origin;
  readonly onChange: (next: Origin) => void;
}): JSX.Element {
  // A span, not the <label> the old select sat in: a label forwards a click on
  // its text to the first corner button, which would change the record.
  return (
    <span style={homingStyle}>
      <span>Recorded home</span>
      <BedCornerPicker
        value={props.value}
        onChange={props.onChange}
        marker="home"
        ariaLabel="Recorded homing corner"
        title="Record where this machine homes. The controller's firmware determines the actual homing direction; changing this record does not change firmware."
      />
    </span>
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
      <OriginCornerPicker value={device.origin} onChange={(origin) => update({ origin })} />
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
// Wraps so a narrow dialog puts the 156 px diagram under its label rather than
// overflowing the field.
const originStyle: React.CSSProperties = { display: 'inline-grid', gap: 4, minWidth: 0 };
const originHintStyle: React.CSSProperties = {
  maxWidth: 360,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};

const homingStyle: React.CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  fontSize: 12,
};
