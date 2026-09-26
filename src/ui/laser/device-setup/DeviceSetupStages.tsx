import type { Layer } from '../../../core/scene';
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
import type { DeviceSetupAutomatic } from './use-controller-auto-fill';

export type DeviceSetupStagesProps = DeviceSetupStepProps & {
  readonly highlight?: DeviceSetupHighlight | undefined;
  readonly layers: ReadonlyArray<Layer>;
  readonly cncSetup: CncStartupWizardDraft;
  readonly automatic?: DeviceSetupAutomatic | undefined;
};

export function DeviceSetupStages(props: DeviceSetupStagesProps): JSX.Element {
  const stage = deviceSetupStage(props.state.step);
  if (stage === 'identify') return <MachineStage {...props} />;
  if (stage === 'confirm') return <EssentialsStage {...props} />;
  return <DeviceSetupReviewStep {...props} operationDrafts={props.cncSetup.operationDrafts} />;
}

// Find my machine leads (ADR-420): connecting first lets the controller fill
// in the type and values below it; each choice stays editable after.
function MachineStage(props: DeviceSetupStagesProps): JSX.Element {
  return (
    <div className="lf-setup-stack">
      <DeviceSetupConnectStep
        state={props.state}
        dispatch={props.dispatch}
        automatic={props.automatic}
        openOptions={props.state.step === 'connect'}
      />
      <DeviceSetupMachineCapability {...props} />
      <DeviceSetupIdentifyStep {...props} />
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
          <summary title="Set up CNC stock, material, cutting tools and the operation tool plan.">
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
        <summary title="Configure optional accessories, focus settings and calibration.">
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
