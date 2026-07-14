// Step 3 of the Device Setup wizard: confirm the controller-reported settings.
// Renders the shared bed, feed, and laser-power rows bound to the wizard draft;
// operator-supplied fields (name, origin, air assist) live on the safety step.

import type { DeviceProfile } from '../../../core/devices';
import { NumberInput } from '../../kit';
import { BedRows, FeedRows } from '../DeviceProfileFields';
import { LaserPowerRows } from '../DeviceProfilePowerFields';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupConfirmStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      <p style={hintStyle}>
        {state.machineKind === 'cnc'
          ? 'These are the values your controller reported via $$. Confirm the router work area and feed limits. GRBL $30 is applied as the spindle RPM ceiling.'
          : 'These are the values your controller reported via $$. Confirm the work area, feed, and power scale, and fix anything that does not match your laser.'}
      </p>
      <BedRows device={state.draft} update={update} />
      <FeedRows device={state.draft} update={update} />
      {state.machineKind === 'cnc' ? (
        <div style={spindleStyle}>
          <label style={spindleInputStyle}>
            <span>Spindle maximum ($30)</span>
            <NumberInput
              aria-label="Spindle maximum RPM"
              value={state.spindleMaxRpm ?? ''}
              min={1}
              max={100_000}
              step={100}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                dispatch({
                  kind: 'edit-spindle',
                  spindleMaxRpm:
                    event.target.value === '' || !Number.isFinite(parsed) || parsed <= 0
                      ? null
                      : Math.min(100_000, parsed),
                });
              }}
            />
            <span>RPM</span>
          </label>
          <label style={confirmStyle}>
            <input
              type="checkbox"
              title="Confirm that this spindle RPM ceiling matches the router."
              checked={state.spindleConfirmed}
              disabled={state.spindleMaxRpm === null}
              onChange={(event) =>
                dispatch({ kind: 'confirm-spindle', confirmed: event.target.checked })
              }
            />
            I confirm this spindle ceiling matches the router.
          </label>
          <span style={reportedStyle}>
            Controller report:{' '}
            {state.detected.maxPowerS === undefined
              ? 'not reported'
              : `${state.detected.maxPowerS} RPM`}
          </span>
        </div>
      ) : (
        <LaserPowerRows device={state.draft} update={update} />
      )}
    </section>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.4,
};
const spindleStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const spindleInputStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 120px auto',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};
const confirmStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const reportedStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-muted)' };
