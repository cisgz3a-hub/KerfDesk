import { useEffect } from 'react';
import type { DeviceSetupStep } from './device-setup-flow';
import type { MachineSetupTarget } from './machine-setup-dialog-store';
import { machineSetupFieldId } from './machine-setup-field-anchor';

export function useMachineSetupTargetFocus(
  target: MachineSetupTarget | undefined,
  step: DeviceSetupStep,
): void {
  useEffect(() => {
    if (target?.kind !== 'cnc' || step !== 'cnc-setup') return;
    const field = document.getElementById(machineSetupFieldId(target.field));
    if (!(field instanceof HTMLElement)) return;
    field.focus();
    field.scrollIntoView?.({ block: 'center' });
  }, [step, target]);
}
