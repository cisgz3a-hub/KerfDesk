// The machine choice on the Machine stage (ADR-637): one list of listed laser
// and CNC machines, "My machine isn't listed", and machine-file import/export.
// Controller and serial settings live in the connection strip's Connection
// options, beside the connection they shape (ADR-420). An import asks before
// it replaces values someone set, as a list choice does (Amendment 3).

import { mutedStyle } from '../MachineSetupStyles';
import { ImportExportPanel } from '../MachineSetupImportExport';
import { machineSetupProfile, type DeviceSetupStepProps } from './device-setup-flow';
import { DeviceSetupMachinePicker } from './DeviceSetupMachinePicker';
import { machineChoiceReplaces } from './machine-choice-replaces';
import { machinePickerEntries } from './machine-picker-entries';

export function DeviceSetupIdentifyStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  return (
    <>
      <DeviceSetupMachinePicker state={state} dispatch={dispatch} />
      <ProfileImport state={state} dispatch={dispatch} />
    </>
  );
}

function ProfileImport({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  return (
    <details className="lf-setup-disclosure">
      <summary style={summaryStyle} title="Show or hide machine-profile import and export tools.">
        Import or export a machine profile
      </summary>
      <p style={mutedStyle}>
        Load a saved profile into this draft, or export your current choices.
      </p>
      <ImportExportPanel
        profile={machineSetupProfile(state)}
        replaces={(profile) =>
          machineChoiceReplaces(state, machinePickerEntries(state), [
            { kind: 'apply-preset', profile },
          ])
        }
        onApply={(profile) => dispatch({ kind: 'apply-preset', profile })}
      />
    </details>
  );
}

const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12, fontWeight: 600 };
