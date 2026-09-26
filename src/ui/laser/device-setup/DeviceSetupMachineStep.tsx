// Machine-output portion of Essentials. CNC limits use their own
// targetable component so project setup can deep-link into the same page.

import { selectControllerDriver } from '../../../core/controllers';
import type { DeviceProfile } from '../../../core/devices';
import {
  AirAssistRow,
  AirRestartRow,
  FireControlRow,
  LaserPowerRows,
} from '../DeviceProfilePowerFields';
import { LaserArcMovesRow } from '../LaserArcMovesRow';
import { deviceSetupSupportsMachineKind, type DeviceSetupStepProps } from './device-setup-flow';
import { DeviceSetupCncMachineStep } from './DeviceSetupCncMachineStep';
import type { DeviceSetupHighlight } from './machine-setup-dialog-store';

export function DeviceSetupMachineStep(
  props: DeviceSetupStepProps & { readonly highlight?: DeviceSetupHighlight | undefined },
): JSX.Element {
  return (
    <div className="lf-setup-fields" style={outputStackStyle}>
      {deviceSetupSupportsMachineKind(props.state, 'laser') ? (
        <LaserMachineStep {...props} />
      ) : null}
      {deviceSetupSupportsMachineKind(props.state, 'cnc') ? (
        <DeviceSetupCncMachineStep {...props} machine={props.state.cncDraft} />
      ) : null}
    </div>
  );
}

function LaserMachineStep({
  state,
  dispatch,
  highlight,
}: DeviceSetupStepProps & { readonly highlight?: DeviceSetupHighlight | undefined }): JSX.Element {
  const driver = selectControllerDriver(
    state.draft.controllerKind,
    state.draft.controllerCommandSet,
  );
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      <div style={introStyle}>
        <strong>Laser output</strong>
        <span>
          Full-power S is the controller value for 100% power.{' '}
          {state.draft.controllerKind === 'smoothieware'
            ? 'Smoothieware holds it at 1.'
            : 'Match it to your controller settings.'}
        </span>
      </div>
      <LaserPowerRows
        plainLabels
        device={state.draft}
        update={update}
        grblLabels={driver.capabilities.settings === 'grbl-dollar'}
      />
      <LaserArcMovesRow device={state.draft} update={update} />
      <details
        className="lf-setup-disclosure lf-setup-disclosure--nested"
        open={highlight === 'air-assist'}
      >
        <summary title="Configure the air-assist relay and low-power test-fire controls.">
          <span>Air assist and test fire</span>
          <small>
            {state.draft.airAssistCommand} · Fire{' '}
            {state.draft.fireControl?.enabled === true ? 'enabled' : 'off'}
          </small>
        </summary>
        <div className="lf-setup-disclosure-body">
          <AirAssistRow device={state.draft} update={update} />
          <AirRestartRow device={state.draft} update={update} />
          <FireControlRow device={state.draft} update={update} />
          <p className="lf-setup-muted">
            Verify the beam is off at S0 and test power on scrap. Confirm which relay controls your
            air assist.
          </p>
        </div>
      </details>
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
