// Step 3 of the Device Setup wizard: confirm the controller-reported settings.
// Renders the shared bed, feed, and laser-power rows bound to the wizard draft;
// operator-supplied fields (name, origin, air assist) live on the safety step.

import type { DeviceProfile } from '../../../core/devices';
import { BedRows, FeedRows } from '../DeviceProfileFields';
import { LaserPowerRows } from '../DeviceProfilePowerFields';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupConfirmStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      <p style={hintStyle}>
        These are the values your controller reported via $$. Confirm the work area, feed, and power
        scale, and fix anything that doesn&apos;t match your laser.
      </p>
      <BedRows device={state.draft} update={update} />
      <FeedRows device={state.draft} update={update} />
      <LaserPowerRows device={state.draft} update={update} />
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
