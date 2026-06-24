// Step 3 of the Device Setup wizard: confirm the machine's core settings.
// Reuses the shared BasicRows editor (name, bed, origin, feed, power, air
// assist) bound to the wizard draft, so the wizard and the inline Device
// Profile panel render identical controls.

import type { DeviceProfile } from '../../../core/devices';
import { BasicRows } from '../DeviceProfileFields';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupConfirmStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      <p style={hintStyle}>
        These values drive the G-code LaserForge generates. Confirm what your controller reported
        and fix anything that doesn&apos;t match your laser.
      </p>
      <BasicRows device={state.draft} update={update} />
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
