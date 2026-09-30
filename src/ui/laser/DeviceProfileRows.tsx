import {
  profileSupportsCapability,
  type DeviceProfile,
  type ProfileCapability,
} from '../../core/devices';
import { numInputStyle, Row, unitStyle } from './device-settings-shared';
import { useDebouncedCommit } from '../layers/use-debounced-commit';

type DeviceRowsProps = {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
};

export function ZRows(props: DeviceRowsProps): JSX.Element {
  const { device, update } = props;
  const supportsZAxis = profileSupportsCapability(device, 'z-axis');
  const canConfirmZTravel = supportsZAxis && isPositive(device.zTravelMm);
  return (
    <>
      <Row label="Powered Z">
        <label
          style={inlineLabelStyle}
          title="Enable only when the controller can jog a motorized Z/focus axis with GRBL $J Z moves."
        >
          <input
            type="checkbox"
            checked={supportsZAxis}
            onChange={(e) => {
              const enabled = e.target.checked;
              update({
                capabilities: setCapability(device.capabilities, 'z-axis', enabled),
                zTravelConfirmed: false,
              });
            }}
            aria-label="Powered Z jog enabled"
            title="Shows manual Z focus jog buttons after Z travel is confirmed."
          />
          <span>Z jog buttons</span>
        </label>
      </Row>
      <Row label="Z travel">
        <ZTravelInput device={device} update={update} />
        <span style={unitStyle}>mm</span>
        <label style={inlineLabelStyle} title="Mark Z travel as checked against the machine.">
          <input
            type="checkbox"
            checked={device.zTravelConfirmed === true}
            disabled={!canConfirmZTravel}
            onChange={(e) => update({ zTravelConfirmed: e.target.checked })}
            aria-label="Z travel confirmed"
            title={
              canConfirmZTravel
                ? 'Confirm only after checking the real Z travel / clearance on this machine.'
                : 'Enable Powered Z and enter the measured Z travel before confirming.'
            }
          />
          <span>Confirmed</span>
        </label>
        {!canConfirmZTravel && (
          <span style={warningTextStyle}>Enable Powered Z and enter measured travel first.</span>
        )}
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

function ZTravelInput({ device, update }: DeviceRowsProps): JSX.Element {
  const field = useDebouncedCommit<number | undefined>({
    value: device.zTravelMm,
    format: (value) => (value === undefined ? '' : String(value)),
    parse: (text) => {
      const value = Number(text);
      return Number.isFinite(value) && value > 0 ? value : device.zTravelMm;
    },
    commit: (zTravelMm) => {
      if (zTravelMm !== undefined) update({ zTravelMm, zTravelConfirmed: false });
    },
    debounceMs: 0,
  });
  return (
    <input
      type="number"
      min={0}
      step={1}
      value={field.displayValue}
      onChange={(event) => {
        field.onChange(event);
        if (device.zTravelConfirmed === true) update({ zTravelConfirmed: false });
      }}
      onBlur={field.onBlur}
      style={numInputStyle}
      aria-label="Z travel (mm)"
      title="Informational Z travel from the machine profile or GRBL $132. Confirm this on the real machine before using Z workflows."
    />
  );
}

function setCapability(
  capabilities: ReadonlyArray<ProfileCapability> | undefined,
  capability: ProfileCapability,
  enabled: boolean,
): ReadonlyArray<ProfileCapability> {
  const current = capabilities ?? [];
  if (enabled) {
    return current.includes(capability) ? current : [...current, capability];
  }
  return current.filter((item) => item !== capability);
}

function isPositive(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const inlineLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  cursor: 'pointer',
};
const warningTextStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
