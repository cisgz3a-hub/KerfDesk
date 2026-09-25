// DeviceProfilePowerFields — the laser-output field editors: GRBL power range
// ($30/$31/$32) and the air-assist coolant command. Split from
// DeviceProfileFields so Machine Setup can place controller power and air-assist
// together on its machine-output step. The inline Device Profile panel
// renders both directly and hides them in CNC mode (ADR-101 §6).

import {
  DEFAULT_FIRE_POWER_PERCENT,
  HARD_MAX_FIRE_POWER_PERCENT,
  profileSupportsCapability,
  type DeviceProfile,
} from '../../core/devices';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { numInputStyle, Row } from './device-settings-shared';
import { PresetAirAssistOffer } from './PresetAirAssistOffer';

const MAX_POWER_S = 100000;

type DeviceRowsProps = {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
  /** Default preserves the GRBL-specific labels used by the legacy panels. */
  readonly grblLabels?: boolean;
  /** Setup uses plain labels; exact firmware references stay in accessible help. */
  readonly plainLabels?: boolean;
};

// GRBL $30/$31 power range + $32 laser mode — the machine-reported beam scale.
export function LaserPowerRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  const grblLabels = props.grblLabels ?? true;
  const labels = powerRowLabels(grblLabels, props.plainLabels === true);
  return (
    <>
      <Row label={labels.max}>
        <ClearableNumberField
          min={1}
          max={MAX_POWER_S}
          step={1}
          value={device.maxPowerS}
          onCommit={(v) => update({ maxPowerS: Math.floor(v) })}
          style={numInputStyle}
          ariaLabel={grblLabels ? 'GRBL $30 max power S' : 'Maximum laser power S'}
          title={
            grblLabels
              ? "Maximum GRBL spindle/laser S value. Match your controller's $30 setting."
              : 'Maximum S value expected by the selected firmware and laser output mode.'
          }
        />
      </Row>
      <Row label={labels.min}>
        <ClearableNumberField
          min={0}
          max={MAX_POWER_S}
          step={1}
          value={device.minPowerS}
          onCommit={(v) => update({ minPowerS: Math.floor(v) })}
          style={numInputStyle}
          ariaLabel={grblLabels ? 'GRBL $31 controller minimum S' : 'Controller minimum S'}
          title="Saved reference for the minimum S value used by the controller's PWM mapping. Generated job S values scale from zero to Maximum S; this field does not set a minimum emitted S."
        />
      </Row>
      <Row label={labels.mode}>
        <label
          style={inlineLabelStyle}
          title="Record the laser-mode setting expected on the controller. Profile edits do not write firmware settings."
        >
          <input
            type="checkbox"
            checked={device.laserModeEnabled}
            onChange={(e) => update({ laserModeEnabled: e.target.checked })}
            aria-label={grblLabels ? 'GRBL $32 laser mode enabled' : 'Laser mode enabled'}
            title={
              grblLabels
                ? 'Record that GRBL laser mode ($32=1) is expected. This checkbox does not change controller firmware settings.'
                : 'Record that the controller is configured for laser output. This checkbox does not change controller firmware settings.'
            }
          />
          <span>Enabled</span>
        </label>
      </Row>
    </>
  );
}

function powerRowLabels(grbl: boolean, plain: boolean): { max: string; min: string; mode: string } {
  if (plain) return { max: 'Full-power S', min: 'Minimum S', mode: 'Laser mode' };
  if (grbl) return { max: '$30 (max S)', min: '$31 (min S ref)', mode: '$32 laser mode' };
  return { max: 'Maximum S', min: 'Controller min S', mode: 'Laser mode' };
}

// Air-assist coolant command (M7/M8/none) wired to the controller output.
// Operator-supplied: $$ cannot report which pin (if any) is wired. A saved
// preset whose air predates the preset's is offered the preset's settings.
export function AirAssistRow(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
    <>
      <Row label="Air output">
        <select
          value={device.airAssistCommand}
          onChange={(e) =>
            update({ airAssistCommand: e.target.value as DeviceProfile['airAssistCommand'] })
          }
          aria-label="Air output command"
          title="Choose the GRBL coolant output wired to air assist for Job Air and Manual Air. Leave Disabled unless you have tested the output."
        >
          <option value="none">Disabled</option>
          <option value="M8">M8 flood coolant</option>
          <option value="M7">M7 mist coolant</option>
        </select>
      </Row>
      <PresetAirAssistOffer device={device} update={update} />
    </>
  );
}

// ADR-335. Creality's A1 family cannot be trusted to restart its pump inside a
// running job, so the emitter holds air on across an Air-off operation that
// sits between two Air-on ones. Clearing this restores plain per-operation
// air, which is what an operator wants once `$152=100` (no standby: the pump
// and laser module stay powered) is sent from the Console (ADR-370), or an air
// test shows the installed firmware restarting the pump (A1 and A1 Pro firmware
// are numbered separately). Hidden while air output is disabled, where it would
// mean nothing.
export function AirRestartRow({ device, update }: DeviceRowsProps): JSX.Element | null {
  if (device.airAssistCommand === 'none') return null;
  return (
    <Row label="Air restart">
      <input
        type="checkbox"
        checked={device.airAssistRestartUnreliable === true}
        aria-label="Controller cannot restart air assist mid-job"
        title="Tick when the controller cannot switch air off and on again inside a running job — Creality A1 firmware holds the pump in standby after M9 and may not restart it. Air is then held on through operations that sit between two air-on operations, and Job Review says so. Untick once $152=100 (no standby) is sent from the Console, or after an air test shows your firmware restarting the pump."
        onChange={(event) => update({ airAssistRestartUnreliable: event.target.checked })}
      />
      <span style={{ opacity: 0.7 }}>cannot switch air off and on mid-job</span>
    </Row>
  );
}

export function FireControlRow({ device, update }: DeviceRowsProps): JSX.Element | null {
  if (!profileSupportsCapability(device, 'low-power-fire')) return null;
  const control = device.fireControl ?? {
    enabled: false,
    maxPowerPercent: DEFAULT_FIRE_POWER_PERCENT,
  };
  return (
    <Row label="Low-power Fire">
      <span style={fireControlStyle}>
        <label
          style={inlineLabelStyle}
          title="Explicitly allow the momentary Fire positioning beam for this machine profile."
        >
          <input
            type="checkbox"
            checked={control.enabled}
            onChange={(event) =>
              update({ fireControl: { ...control, enabled: event.target.checked } })
            }
            aria-label="Enable low-power Fire for this machine"
            title="Enable the capped momentary Fire positioning beam for this machine profile."
          />
          <span>Enabled</span>
        </label>
        <ClearableNumberField
          min={0.1}
          max={HARD_MAX_FIRE_POWER_PERCENT}
          step={0.1}
          value={control.maxPowerPercent}
          onCommit={(maxPowerPercent) => update({ fireControl: { ...control, maxPowerPercent } })}
          style={firePowerInputStyle}
          ariaLabel="Maximum Fire power percent"
          title={`Maximum momentary Fire power. KerfDesk never allows more than ${HARD_MAX_FIRE_POWER_PERCENT}%.`}
        />
        <span>% max</span>
      </span>
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

const fireControlStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
  fontSize: 12,
};

const firePowerInputStyle: React.CSSProperties = {
  ...numInputStyle,
  width: 64,
};
