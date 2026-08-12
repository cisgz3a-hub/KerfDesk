// Machine-output portion of Confirm settings. CNC limits use their own
// targetable component so project setup can deep-link into the same page.

import { selectControllerDriver } from '../../../core/controllers';
import type { DeviceProfile } from '../../../core/devices';
import { AirAssistRow, FireControlRow, LaserPowerRows } from '../DeviceProfilePowerFields';
import { deviceSetupSupportsMachineKind, type DeviceSetupStepProps } from './device-setup-flow';
import { DeviceSetupCncMachineStep } from './DeviceSetupCncMachineStep';

export function DeviceSetupMachineStep(props: DeviceSetupStepProps): JSX.Element {
  return (
    <div style={outputStackStyle}>
      {deviceSetupSupportsMachineKind(props.state, 'laser') ? (
        <LaserMachineStep {...props} />
      ) : null}
      {deviceSetupSupportsMachineKind(props.state, 'cnc') ? (
        <DeviceSetupCncMachineStep {...props} machine={props.state.cncDraft} />
      ) : null}
    </div>
  );
}

function LaserMachineStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const driver = selectControllerDriver(state.draft.controllerKind);
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      <div style={introStyle}>
        <strong>Laser output and accessories</strong>
        <span>
          The S range converts percentages into controller power values. Air and low-power Fire
          remain disabled unless you explicitly configure and hardware-test them.
        </span>
      </div>
      <LaserPowerRows
        device={state.draft}
        update={update}
        grblLabels={driver.capabilities.settings === 'grbl-dollar'}
      />
      <AirAssistRow device={state.draft} update={update} />
      <FireControlRow device={state.draft} update={update} />
      <div style={warningStyle}>
        <strong>Hardware check required:</strong> verify the beam is off at S0, test the lowest
        usable power on scrap, and confirm whether M7 or M8 operates the intended air relay.
      </div>
    </section>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const outputStackStyle: React.CSSProperties = { display: 'grid', gap: 14 };
const introStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 12,
  lineHeight: 1.45,
  marginBottom: 2,
};
const warningStyle: React.CSSProperties = {
  border: '1px solid var(--lf-warning)',
  borderRadius: 6,
  padding: 8,
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--lf-warning)',
};
