// Machine profile choice on the Machine stage: the reviewed catalog, CNC
// presets, and profile import/export. Controller and serial settings live in
// Find my machine's Connection options, beside the connection they shape
// (ADR-420).

import { mutedStyle } from '../MachineSetupStyles';
import { ImportExportPanel } from '../MachineSetupImportExport';
import {
  deviceSetupSupportsMachineKind,
  machineSetupProfile,
  type DeviceSetupStepProps,
} from './device-setup-flow';
import { DeviceSetupCncPreset } from './DeviceSetupCncPreset';
import { DeviceSetupProfilePicker } from './DeviceSetupProfilePicker';

export function DeviceSetupIdentifyStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  return (
    <section style={sectionStyle}>
      {deviceSetupSupportsMachineKind(state, 'laser') ? (
        <DeviceSetupProfilePicker state={state} dispatch={dispatch} />
      ) : null}
      <DeviceSetupCncPreset state={state} dispatch={dispatch} />
      <ProfileImport state={state} dispatch={dispatch} />
    </section>
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
        onApply={(profile) => dispatch({ kind: 'apply-preset', profile })}
      />
    </details>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12, fontWeight: 600 };
