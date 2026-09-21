import type { Layer } from '../../../core/scene';
import { useLaserStore } from '../../state/laser-store';
import type { CncStartupWizardDraft } from './cnc-startup-wizard-draft';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { machineSetupValidationIssues } from './device-setup-flow';
import { deviceSetupStage } from './device-setup-steps';
import type { DeviceSetupHighlight } from './machine-setup-dialog-store';
import { DeviceSetupMachineCapability } from './DeviceSetupMachineCapability';
import { DeviceSetupIdentifyStep } from './DeviceSetupIdentifyStep';
import { DeviceSetupConnectStep } from './DeviceSetupConnectStep';
import { DeviceSetupConfirmStep } from './DeviceSetupConfirmStep';
import { DeviceSetupMachineStep } from './DeviceSetupMachineStep';
import { DeviceSetupCncJobStep } from './DeviceSetupCncJobStep';
import { DeviceSetupOptionsStep } from './DeviceSetupOptionsStep';
import { DeviceSetupReviewStep } from './DeviceSetupReviewStep';

export type DeviceSetupStagesProps = DeviceSetupStepProps & {
  readonly highlight?: DeviceSetupHighlight | undefined;
  readonly layers: ReadonlyArray<Layer>;
  readonly cncSetup: CncStartupWizardDraft;
};

export function DeviceSetupStages(props: DeviceSetupStagesProps): JSX.Element {
  const stage = deviceSetupStage(props.state.step);
  if (stage === 'identify') return <MachineStage {...props} />;
  if (stage === 'confirm') return <EssentialsStage {...props} />;
  return <DeviceSetupReviewStep {...props} operationDrafts={props.cncSetup.operationDrafts} />;
}

function MachineStage(props: DeviceSetupStepProps): JSX.Element {
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  return (
    <div className="lf-setup-stack">
      <DeviceSetupMachineCapability {...props} />
      <DeviceSetupIdentifyStep {...props} />
      <details className="lf-setup-disclosure" open={props.state.step === 'connect'}>
        <summary>
          <span>Connect and detect</span>
          <small>{connected ? 'Connected' : 'Optional · you can do this later'}</small>
        </summary>
        <div className="lf-setup-disclosure-body">
          <DeviceSetupConnectStep {...props} />
        </div>
      </details>
    </div>
  );
}

function EssentialsStage(props: DeviceSetupStagesProps): JSX.Element {
  const issues = machineSetupValidationIssues(props.state);
  const { cncSetup } = props;
  return (
    <div className="lf-setup-stack">
      {issues.length > 0 ? (
        <div className="lf-setup-validation" role="status">
          <strong>A few settings need attention before saving</strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="lf-setup-panel">
        <DeviceSetupConfirmStep {...props} />
      </div>
      <div className="lf-setup-panel">
        <DeviceSetupMachineStep {...props} />
      </div>
      {props.state.machineKind === 'cnc' ? (
        <details className="lf-setup-disclosure" open={props.state.step === 'cnc-setup'}>
          <summary>
            <span>CNC job setup</span>
            <small>Stock, material, bits and tool plan</small>
          </summary>
          <div className="lf-setup-disclosure-body">
            <DeviceSetupCncJobStep
              {...props}
              operationDrafts={cncSetup.operationDrafts}
              customTools={cncSetup.customTools}
              onApplyMaterial={cncSetup.applyMaterial}
              onChangeOperation={cncSetup.changeOperation}
              onChangeCustomTools={cncSetup.changeCustomTools}
              onRemoveTool={cncSetup.removeTool}
            />
          </div>
        </details>
      ) : null}
      <details className="lf-setup-disclosure" open={props.state.step === 'options'}>
        <summary>
          <span>Accessories and calibration</span>
          <small>Optional · keep your existing settings</small>
        </summary>
        <div className="lf-setup-disclosure-body">
          <DeviceSetupOptionsStep {...props} openAutofocus={props.highlight === 'autofocus'} />
        </div>
      </details>
    </div>
  );
}
