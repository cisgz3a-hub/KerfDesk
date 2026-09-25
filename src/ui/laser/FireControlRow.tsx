// FireControlRow — Machine Setup's per-machine opt-in for the momentary
// low-power Fire button: LightBurn's "Enable Laser Fire Button" and its power
// field (ADR-162, amended by ADR-387). Off by default. The power shows as the
// S word a press sends, and a machine that cannot offer Fire says why instead
// of hiding the row.
// https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/BasicSettings/

import {
  DEFAULT_FIRE_POWER_PERCENT,
  HARD_MAX_FIRE_POWER_PERCENT,
  type DeviceProfile,
  type LaserFireControl,
} from '../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import {
  enabledFireControl,
  fireButtonPercent,
  fireButtonPowerS,
  fireOfferIssue,
  firePowerIssue,
  formatFirePercent,
} from '../../core/devices/fire-availability';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { profileFireController } from '../state/laser-fire-readiness';
import { numInputStyle, Row } from './device-settings-shared';

const MIN_FIRE_POWER_PERCENT = 0.1;

type FireControlRowProps = {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
};

export function FireControlRow({ device, update }: FireControlRowProps): JSX.Element {
  const offerIssue = fireOfferIssue(device, profileFireController(device));
  if (offerIssue !== null) {
    return (
      <Row label="Fire button">
        <span role="note" style={noteStyle}>
          {offerIssue}
        </span>
      </Row>
    );
  }
  const control: LaserFireControl = device.fireControl ?? {
    enabled: false,
    maxPowerPercent: DEFAULT_FIRE_POWER_PERCENT,
  };
  const change = (patch: Partial<LaserFireControl>): void =>
    update({ fireControl: { ...control, ...patch } });
  return (
    <>
      <Row label="Fire button">
        <label style={inlineLabelStyle} title={ENABLE_TITLE}>
          <input
            type="checkbox"
            checked={control.enabled}
            onChange={(event) => change({ enabled: event.target.checked })}
            aria-label="Enable Fire button"
            title={ENABLE_TITLE}
          />
          <span>Enable Fire button</span>
        </label>
        <span style={noteStyle}>Diode lasers only. Hold to fire; release sends M5.</span>
      </Row>
      <FirePowerRow control={control} maxPowerS={device.maxPowerS} onChange={change} />
    </>
  );
}

/** Setup summaries: "On, 1% (S10)", "Off", or "Not available". */
export function fireSetupSummary(device: DeviceProfile): string {
  const controller = profileFireController(device);
  if (fireOfferIssue(device, controller) !== null) return 'Not available';
  const control = enabledFireControl(device, controller);
  if (control === null) return 'Off';
  const percent = formatFirePercent(fireButtonPercent(control));
  return `On, ${percent}% (S${fireButtonPowerS(control, device.maxPowerS)})`;
}

function FirePowerRow(props: {
  readonly control: LaserFireControl;
  readonly maxPowerS: number;
  readonly onChange: (patch: Partial<LaserFireControl>) => void;
}): JSX.Element {
  const { control, maxPowerS } = props;
  const powerIssue = firePowerIssue(control, maxPowerS);
  return (
    <Row label="Fire power">
      <ClearableNumberField
        min={MIN_FIRE_POWER_PERCENT}
        max={HARD_MAX_FIRE_POWER_PERCENT}
        step={0.1}
        value={control.maxPowerPercent}
        onCommit={(maxPowerPercent) => props.onChange({ maxPowerPercent })}
        style={firePowerInputStyle}
        ariaLabel="Fire power percent"
        title={`Power of the momentary Fire beam. KerfDesk never allows more than ${HARD_MAX_FIRE_POWER_PERCENT}%, whatever is typed.`}
      />
      <span aria-label="Fire power as the S value sent">
        % = S{fireButtonPowerS(control, maxPowerS)} of S{maxPowerS}
      </span>
      {powerIssue === null ? null : (
        <span role="status" style={warningStyle}>
          {powerIssue}
        </span>
      )}
    </Row>
  );
}

const ENABLE_TITLE =
  'Add a hold-to-fire button to Position the head for a low-power positioning dot. For visible-beam diode lasers only: never use it on a CO2 or fiber laser. Wear eye protection.';

const inlineLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  cursor: 'pointer',
};
const noteStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-muted)' };
const warningStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-warning-fg)' };
const firePowerInputStyle: React.CSSProperties = { ...numInputStyle, width: 64 };
