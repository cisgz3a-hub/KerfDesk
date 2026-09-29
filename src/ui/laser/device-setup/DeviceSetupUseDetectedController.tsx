// "Use detected … in draft" on Find my machine's identity card (ADR-375).
// Choosing another controller runs the controller compatibility policy, which
// can also move the receive window, streaming mode or output dialect, drop a
// vendor command set, reset the baud and power range, and clear a scan-offset
// calibration (device-setup-controller-selection.ts). Those changes are listed
// and wait for Apply; a choice that changes nothing else applies at once.
// Nothing reaches the project before Save.

import { useState } from 'react';
import type { ControllerKind } from '../../../core/devices';
import { Button } from '../../kit';
import { controllerSelectionChanges } from './device-setup-controller-selection';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { machineSetupControllerGuide } from './machine-setup-controller-guide';

export function DeviceSetupUseDetectedController(
  props: DeviceSetupStepProps & { readonly detected: ControllerKind },
): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const label = machineSetupControllerGuide(props.detected).label;
  const changes = controllerSelectionChanges(props.state.draft, props.detected);
  const apply = (): void => {
    setConfirming(false);
    props.dispatch({ kind: 'select-controller', controllerKind: props.detected });
  };
  if (!confirming || changes.length === 0) {
    return (
      <Button
        onClick={() => (changes.length === 0 ? apply() : setConfirming(true))}
        title={`Use ${label} as this setup's controller. Any other value that changes is listed first, for you to apply.`}
      >
        Use detected {label} in draft
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Changes from using ${label}`} className="lf-setup-find-changes">
      <strong>Using {label} in this draft also changes:</strong>
      <ul>
        {changes.map((change) => (
          <li key={change.label}>
            {change.label}: {change.from} → <strong>{change.to}</strong>
            {change.reason === undefined ? null : `. ${change.reason}`}
          </li>
        ))}
      </ul>
      <div className="lf-setup-find-actions">
        <Button
          variant="primary"
          onClick={apply}
          title={`Use ${label} and apply the listed changes to this draft. Nothing is saved until the last step.`}
        >
          Apply to draft
        </Button>
        <Button onClick={() => setConfirming(false)} title="Keep this draft as it is.">
          Cancel
        </Button>
      </div>
    </div>
  );
}
