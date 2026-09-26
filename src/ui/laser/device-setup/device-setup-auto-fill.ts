// What Machine Setup fills in by itself from a connected controller (ADR-420).
// The plan is a list of the ordinary draft actions, so auto-fill edits the draft
// exactly as the operator's own clicks would, and nothing reaches the project
// before Save. It runs once per setup, only for a machine that has not been
// through setup, and one Undo restores the draft it started from.

import { selectControllerDriver } from '../../../core/controllers';
import type { ControllerKind, DeviceProfile } from '../../../core/devices';
import type { MachineKind } from '../../../core/scene';
import type { DeviceSetupAction, DeviceSetupState } from './device-setup-flow';

export type DeviceSetupAutoFillSummary = {
  /** Firmware the controller's banner named, when it differed from the draft. */
  readonly controllerKind: ControllerKind | null;
  /** The baud that answered, when it differed from the draft. */
  readonly baudRate: number | null;
  /** Set from the reported laser mode ($32), when it changed the machine type. */
  readonly machineKind: MachineKind | null;
  /** True when the reported work area, speed and power values were copied. */
  readonly values: boolean;
};

export type DeviceSetupAutoFillPlan = {
  readonly actions: ReadonlyArray<DeviceSetupAction>;
  readonly summary: DeviceSetupAutoFillSummary;
};

export type DeviceSetupAutoFillRecord =
  | {
      readonly status: 'applied';
      /** The draft before the first fill, which Undo restores. */
      readonly undo: DeviceSetupState;
      readonly summary: DeviceSetupAutoFillSummary;
      /** The settings read the fill came from, so a later read fills again. */
      readonly readAt: number | null;
    }
  | { readonly status: 'undone' };

/** What the live connection reported: the mapped settings read, the firmware
 *  its banner named, and the baud it opened at. */
export type ControllerReport = {
  readonly detected: Partial<DeviceProfile>;
  readonly controllerKind: ControllerKind | null;
  readonly baudRate: number | null;
};

/** The fill a settings read calls for, and the record it leaves: the first
 *  fill, a later read (Read again, or the reconnect after adopting a firmware)
 *  on top of it, or nothing. Undo always restores the draft from before the
 *  first fill; after Undo nothing fills again until the next Find. */
export function nextAutoFill(
  state: DeviceSetupState,
  record: DeviceSetupAutoFillRecord | null,
  report: ControllerReport & { readonly readAt: number | null },
): {
  readonly actions: ReadonlyArray<DeviceSetupAction>;
  readonly record: DeviceSetupAutoFillRecord;
} | null {
  const earlier = record?.status === 'applied' && record.readAt !== report.readAt ? record : null;
  if (record !== null && earlier === null) return null;
  const plan = planControllerAutoFill(state, report);
  const { readAt } = report;
  if (earlier === null) {
    if (plan === null) return null;
    return {
      actions: plan.actions,
      record: { status: 'applied', undo: state, summary: plan.summary, readAt },
    };
  }
  if (plan === null) return { actions: [], record: { ...earlier, readAt } };
  const summary = mergeAutoFillSummary(earlier.summary, plan.summary);
  return { actions: plan.actions, record: { ...earlier, summary, readAt } };
}

function mergeAutoFillSummary(
  first: DeviceSetupAutoFillSummary,
  next: DeviceSetupAutoFillSummary,
): DeviceSetupAutoFillSummary {
  return {
    controllerKind: next.controllerKind ?? first.controllerKind,
    baudRate: next.baudRate ?? first.baudRate,
    machineKind: next.machineKind ?? first.machineKind,
    values: first.values || next.values,
  };
}

/** The draft actions that adopt what the controller reported, or null when it
 *  reported nothing the draft does not already hold. */
export function planControllerAutoFill(
  state: DeviceSetupState,
  report: ControllerReport,
): DeviceSetupAutoFillPlan | null {
  const actions: DeviceSetupAction[] = [];
  const controllerKind = adoptedControllerKind(state, report.controllerKind);
  if (controllerKind !== null) {
    actions.push({ kind: 'select-controller', controllerKind });
  }
  // Choosing a controller resets the baud to its default, so the baud that
  // actually answered is written after it.
  const baudRate = adoptedBaudRate(state, controllerKind, report.baudRate);
  if (baudRate !== null) actions.push({ kind: 'edit', patch: { baudRate } });
  const machineKind = machineKindFromLaserMode(state, report.detected);
  if (machineKind !== null) {
    actions.push({ kind: 'set-machine-kinds', machineKinds: [machineKind] });
  }
  const values = Object.keys(report.detected).length > 0;
  if (values) actions.push({ kind: 'accept-detected', patch: report.detected });
  if (actions.length === 0) return null;
  return { actions, summary: { controllerKind, baudRate, machineKind, values } };
}

function adoptedControllerKind(
  state: DeviceSetupState,
  detected: ControllerKind | null,
): ControllerKind | null {
  if (detected === null || detected === (state.draft.controllerKind ?? 'grbl-v1.1')) return null;
  // Only a firmware KerfDesk talks to over the same serial link can be adopted.
  return selectControllerDriver(detected).capabilities.transport === 'serial' ? detected : null;
}

function adoptedBaudRate(
  state: DeviceSetupState,
  controllerKind: ControllerKind | null,
  connectedBaudRate: number | null,
): number | null {
  if (connectedBaudRate === null) return null;
  const draftBaud =
    controllerKind === null
      ? (state.draft.baudRate ?? selectControllerDriver(state.draft.controllerKind).defaultBaudRate)
      : selectControllerDriver(controllerKind).defaultBaudRate;
  return connectedBaudRate === draftBaud ? null : connectedBaudRate;
}

// GRBL's $32 is the one reported fact about the tool: laser mode on is how a
// laser runs, off is how a spindle runs. A two-tool machine keeps both.
function machineKindFromLaserMode(
  state: DeviceSetupState,
  detected: Partial<DeviceProfile>,
): MachineKind | null {
  if (state.machineKinds.length !== 1) return null;
  const laserMode: DeviceProfile['laserModeEnabled'] | undefined = detected.laserModeEnabled;
  if (laserMode === undefined) return null;
  const reported: MachineKind = laserMode ? 'laser' : 'cnc';
  return state.machineKinds[0] === reported ? null : reported;
}
