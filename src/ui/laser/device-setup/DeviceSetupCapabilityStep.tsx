// Step 1: declare what the physical machine is before anything else. The
// capability contract decides which later pages and settings apply (ADR-239,
// maintainer-ordered step sequence).

import { DeviceSetupMachineCapability } from './DeviceSetupMachineCapability';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupCapabilityStep(props: DeviceSetupStepProps): JSX.Element {
  return (
    <section style={sectionStyle}>
      <div style={introStyle}>
        <strong>What kind of machine is this?</strong>
        <span>
          This decides which setup pages and settings apply. Next you pick the machine profile,
          connect, and confirm every value — nothing is saved until the final step.
        </span>
      </div>
      <DeviceSetupMachineCapability state={props.state} dispatch={props.dispatch} />
    </section>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const introStyle: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12, lineHeight: 1.45 };
