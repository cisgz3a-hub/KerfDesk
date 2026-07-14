// Compatibility entry point for callers that still import MachineSetupDialog.
// There is intentionally only one setup experience now: the draft-based,
// step-by-step Machine Setup wizard.

import { DeviceSetupWizard } from './device-setup/DeviceSetupWizard';

export function MachineSetupDialog(props: {
  readonly onClose: () => void;
  /** Legacy callback retained at the type boundary; the guided flow is now the dialog itself. */
  readonly onRunGuidedSetup?: () => void;
}): JSX.Element {
  return <DeviceSetupWizard onClose={props.onClose} />;
}
