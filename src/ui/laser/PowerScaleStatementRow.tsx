// PowerScaleStatementRow — where the operator records, once per machine
// profile, that they checked Full-power S against a firmware that reports no
// power scale (Marlin, Smoothieware; ADR-095 Amendment 1).
//
// The tick is the operator's statement. KerfDesk checks nothing when it is
// made, and the row says so. Editing Full-power S, the controller or the
// output dialect clears it (device-profile-patch.ts).

import {
  createOperatorPowerScaleStatement,
  powerScaleCheckInstruction,
  standingPowerScaleStatement,
  unreportedPowerScaleFirmware,
  unreportedPowerScaleFirmwareName,
} from '../../core/devices/power-scale-statement';
import type { DeviceProfile } from '../../core/devices';
import { Row } from './device-settings-shared';

export const POWER_SCALE_STATEMENT_LABEL = 'I have checked this';

export function PowerScaleStatementRow(props: {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
  /** Injected in tests; the statement records when it was made. */
  readonly now?: () => Date;
}): JSX.Element | null {
  const { device, update } = props;
  const firmware = unreportedPowerScaleFirmware(device.controllerKind);
  if (firmware === null) return null;
  const standing = standingPowerScaleStatement(device);
  const name = unreportedPowerScaleFirmwareName(firmware);
  const explanation =
    `${name} does not report its laser power scale, so KerfDesk cannot check Full-power S on this machine. ` +
    `${powerScaleCheckInstruction(device)} ` +
    'Ticking this records your own statement. KerfDesk does not test it: Job Review shows it as operator-stated, ' +
    'and it is cleared when Full-power S, the controller or the output dialect changes.';
  return (
    <Row label="Power scale check">
      <span style={wrapStyle}>
        <label style={labelStyle} title={explanation}>
          <input
            type="checkbox"
            checked={standing !== null}
            aria-label={`${POWER_SCALE_STATEMENT_LABEL}: full power is S${device.maxPowerS} on this machine`}
            onChange={(event) =>
              update({
                operatorPowerScaleStatement: event.target.checked
                  ? (createOperatorPowerScaleStatement(
                      device,
                      (props.now?.() ?? new Date()).toISOString(),
                    ) ?? undefined)
                  : undefined,
              })
            }
          />
          <span>
            {POWER_SCALE_STATEMENT_LABEL}: full power is S{device.maxPowerS} on this machine
          </span>
        </label>
        <span style={noteStyle}>{explanation}</span>
        {standing === null ? null : (
          <span style={noteStyle}>
            Your statement, recorded {standing.statedAtIso.slice(0, 10)}.
          </span>
        )}
      </span>
    </Row>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const labelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  cursor: 'pointer',
};

const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
