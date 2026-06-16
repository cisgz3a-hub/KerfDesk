import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, type DeviceProfile } from '../../core/devices';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { numInputStyle, Row, unitStyle } from './device-settings-shared';

type DeviceRowsProps = {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
};

export function ProfileRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  const active = device.machineFamily === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.machineFamily;
  const laserLabel = device.laserSubProfile?.model ?? 'Generic GRBL diode';
  return (
    <>
      <Row label="Profile">
        <button
          type="button"
          onClick={() => {
            if (!jobAwareConfirm(neotronicsProfileConfirmation())) return;
            update(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
          }}
          title="Apply the researched Neotronics 4040 Max / LT-4LDS-V2 20W diode defaults. Confirm live $$ settings after connecting."
        >
          Use Neotronics 4040 Max
        </button>
      </Row>
      <Row label="Laser">
        <span style={profileTextStyle}>
          {active ? 'Neotronics profile active' : 'Profile not selected'} - {laserLabel}
        </span>
      </Row>
    </>
  );
}

export function ZRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  return (
    <>
      <Row label="Z travel">
        <input
          type="number"
          min={0}
          step={1}
          value={device.zTravelMm ?? ''}
          onChange={(e) => {
            const value = Number(e.target.value);
            const patch: Partial<DeviceProfile> = { zTravelConfirmed: false };
            if (Number.isFinite(value) && value > 0) {
              Object.assign(patch, { zTravelMm: value });
            }
            update(patch);
          }}
          style={numInputStyle}
          aria-label="Z travel (mm)"
          title="Informational Z travel from the machine profile or GRBL $132. Confirm this on the real machine before using Z workflows."
        />
        <span style={unitStyle}>mm</span>
        <label style={inlineLabelStyle} title="Mark Z travel as checked against the machine.">
          <input
            type="checkbox"
            checked={device.zTravelConfirmed === true}
            onChange={(e) => update({ zTravelConfirmed: e.target.checked })}
            aria-label="Z travel confirmed"
            title="Confirm only after checking the real Z travel / clearance on this machine."
          />
          <span>Confirmed</span>
        </label>
      </Row>
      <Row label="Z probe">
        <label style={inlineLabelStyle} title="Records whether this machine has a Z-probe.">
          <input
            type="checkbox"
            checked={device.zProbePresent === true}
            onChange={(e) => update({ zProbePresent: e.target.checked })}
            aria-label="Z probe present"
            title="Enable when the machine has a usable Z-probe. This does not send any probe command by itself."
          />
          <span>Present</span>
        </label>
      </Row>
    </>
  );
}

function neotronicsProfileConfirmation(): string {
  return [
    'Apply the Neotronics 4040 Max / LT-4LDS-V2 20W laser profile?',
    '',
    'This updates the local LaserForge profile only. After connecting, read $$, export a backup, and confirm Z travel, homing, and air-assist wiring before changing GRBL settings.',
  ].join('\n');
}

const profileTextStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const inlineLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  cursor: 'pointer',
};
