// DeviceProfilePowerFields — the laser-output field editors: GRBL power range
// ($30/$31/$32) and the air-assist coolant command. Split from
// DeviceProfileFields so the Device Setup wizard can place the controller-
// reported power on its "confirm settings" step and air-assist (which $$ cannot
// report) on its "placement & safety" step. The inline Device Profile panel
// renders both directly and hides them in CNC mode (ADR-101 §6).

import type { DeviceProfile } from '../../core/devices';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { numInputStyle, Row } from './device-settings-shared';

const MAX_POWER_S = 100000;

type DeviceRowsProps = {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
};

// GRBL $30/$31 power range + $32 laser mode — the machine-reported beam scale.
export function LaserPowerRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
    <>
      <Row label="$30 (max S)">
        <ClearableNumberField
          min={1}
          max={MAX_POWER_S}
          step={1}
          value={device.maxPowerS}
          onCommit={(v) => update({ maxPowerS: Math.floor(v) })}
          style={numInputStyle}
          ariaLabel="GRBL $30 max power S"
          title="Maximum GRBL spindle/laser S value. Match your controller's $30 setting."
        />
      </Row>
      <Row label="$31 (min S)">
        <ClearableNumberField
          min={0}
          max={MAX_POWER_S}
          step={1}
          value={device.minPowerS}
          onCommit={(v) => update({ minPowerS: Math.floor(v) })}
          style={numInputStyle}
          ariaLabel="GRBL $31 min power S"
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
    </>
  );
}

// Air-assist coolant command (M7/M8/none) wired to the controller output.
// Operator-supplied: $$ cannot report which pin (if any) is wired.
export function AirAssistRow(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
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
  );
}

const inlineLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  cursor: 'pointer',
};
