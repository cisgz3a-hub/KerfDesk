// "My machine isn't listed" (ADR-637): the four things KerfDesk needs to know
// first, on the Machine stage, so a machine outside the list is as quick to set
// up as one in it. Everything else is on Essentials. The firmware choice is the
// same draft value as Connection options' controller; on a draft that is still
// a firmware starter it also brings that firmware's own starter values, such as
// Ruida's origin and work area (ADR-637 Amendment 1).

import type { ControllerKind } from '../../../core/devices';
import { NumberField } from '../../common/NumberField';
import { MAX_BED_MM } from '../DeviceProfileFields';
import { controllerOptionLabel } from './DeviceSetupConnectionOptions';
import { DeviceSetupMachineCapability } from './DeviceSetupMachineCapability';
import { deviceSetupSupportsMachineKind, type DeviceSetupStepProps } from './device-setup-flow';
import { chooseCustomFirmwareActions } from './machine-picker-entries';
import { machineSetupControllerGuides } from './machine-setup-controller-guide';

export function DeviceSetupCustomMachine({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const includesCnc = deviceSetupSupportsMachineKind(state, 'cnc');
  return (
    <div className="lf-setup-custom" aria-label="Your machine">
      <label className="lf-setup-custom-row">
        <span>Name</span>
        <input
          type="text"
          value={state.draft.name}
          onChange={(event) => dispatch({ kind: 'edit', patch: { name: event.target.value } })}
          aria-label="Machine name"
          title="A name for this machine. It appears in the machine toolbar."
        />
      </label>
      <DeviceSetupMachineCapability state={state} dispatch={dispatch} />
      <div className="lf-setup-custom-row">
        <span>Work area</span>
        <span className="lf-setup-custom-size">
          <NumberField
            min={10}
            max={MAX_BED_MM}
            step={1}
            value={state.draft.bedWidth}
            onCommit={(bedWidth) => dispatch({ kind: 'edit', patch: { bedWidth } })}
            ariaLabel="Work area width (mm)"
            title="How far the head travels left to right, in millimetres. Check the machine's manual or measure it."
          />
          <span aria-hidden="true">×</span>
          <NumberField
            min={10}
            max={MAX_BED_MM}
            step={1}
            value={state.draft.bedHeight}
            onCommit={(bedHeight) => dispatch({ kind: 'edit', patch: { bedHeight } })}
            ariaLabel="Work area height (mm)"
            title="How far the head travels front to back, in millimetres. Check the machine's manual or measure it."
          />
          <span>mm</span>
        </span>
      </div>
      <label className="lf-setup-custom-row">
        <span>Firmware</span>
        <select
          aria-label="Firmware"
          title="The controller firmware. Connecting reads it for you; most diode lasers run GRBL."
          value={state.draft.controllerKind ?? 'grbl-v1.1'}
          onChange={(event) =>
            chooseCustomFirmwareActions(state, event.target.value as ControllerKind).forEach(
              dispatch,
            )
          }
        >
          {machineSetupControllerGuides().map((guide) => (
            <option key={guide.kind} value={guide.kind}>
              {controllerOptionLabel(guide, includesCnc)}
            </option>
          ))}
        </select>
      </label>
      <p className="lf-setup-muted">
        Not sure? Most diode lasers and hobby CNC machines run GRBL. Connecting reads the firmware
        and work area for you. You can check origin, homing and speeds on the next step.
      </p>
    </div>
  );
}
