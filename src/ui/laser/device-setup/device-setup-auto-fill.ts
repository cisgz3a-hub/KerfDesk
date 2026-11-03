// What Machine Setup fills in by itself from a connected controller (ADR-420).
// The plan is a list of the ordinary draft actions, so auto-fill edits the draft
// exactly as the operator's own clicks would, and nothing reaches the project
// before Save. It runs once per setup, only for a machine that has not been
// through setup, and one Undo restores the draft it started from.

import { selectControllerDriver } from '../../../core/controllers';
import type { ControllerKind, DeviceProfile } from '../../../core/devices';
import { setupChangeRows, type SetupChangeRow } from './device-setup-accept-detected';
import {
  deviceSetupReducer,
  type DeviceSetupAction,
  type DeviceSetupState,
} from './device-setup-flow';
import { draftIsListedMachine, machinePickerEntries } from './machine-picker-entries';

export type DeviceSetupAutoFillSummary = {
  /** Firmware the controller's banner named, when it differed from the draft. */
  readonly controllerKind: ControllerKind | null;
  /** The baud that answered, when it differed from the draft. */
  readonly baudRate: number | null;
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
      /** Each value row as the latest fill to change it left it. The card lists
       *  a change only while the draft still holds that value, so a machine
       *  chosen afterwards never reads as reported (controller audit v4 E2-P3-1). */
      readonly written: ReadonlyArray<SetupChangeRow>;
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
    const written = writtenRows([], state, plan.actions);
    return {
      actions: plan.actions,
      record: { status: 'applied', undo: state, summary: plan.summary, readAt, written },
    };
  }
  if (plan === null) return { actions: [], record: { ...earlier, readAt } };
  const summary = mergeAutoFillSummary(earlier.summary, plan.summary);
  const written = writtenRows(earlier.written, state, plan.actions);
  return { actions: plan.actions, record: { ...earlier, summary, readAt, written } };
}

function writtenRows(
  earlier: ReadonlyArray<SetupChangeRow>,
  state: DeviceSetupState,
  actions: ReadonlyArray<DeviceSetupAction>,
): ReadonlyArray<SetupChangeRow> {
  const rows = setupChangeRows(state, actions.reduce(deviceSetupReducer, state));
  const replaced = new Set(rows.map((row) => row.label));
  return [...earlier.filter((row) => !replaced.has(row.label)), ...rows];
}

/** The rows of the card that the fills wrote and the draft still holds. */
export function autoFilledRows(
  record: Extract<DeviceSetupAutoFillRecord, { readonly status: 'applied' }>,
  state: DeviceSetupState,
): ReadonlyArray<SetupChangeRow> {
  return setupChangeRows(record.undo, state).filter((row) =>
    record.written.some(
      (written) => written.label === row.label && written.newText === row.newText,
    ),
  );
}

function mergeAutoFillSummary(
  first: DeviceSetupAutoFillSummary,
  next: DeviceSetupAutoFillSummary,
): DeviceSetupAutoFillSummary {
  return {
    controllerKind: next.controllerKind ?? first.controllerKind,
    baudRate: next.baudRate ?? first.baudRate,
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
  // Decided on the draft as the fill finds it: a listed machine (a chosen row,
  // or a listed laser profile however edited) keeps what the list says it is.
  const listed = draftIsListedMachine(state, machinePickerEntries(state));
  const controllerKind = adoptedControllerKind(state, report.controllerKind);
  if (controllerKind !== null) {
    actions.push({ kind: 'select-controller', controllerKind });
  }
  // Choosing a controller resets the baud to its default, so the baud that
  // actually answered is written after it.
  const baudRate = adoptedBaudRate(state, controllerKind, report.baudRate);
  if (baudRate !== null) actions.push({ kind: 'edit', patch: { baudRate } });
  // The machine type is never taken from `$32`: stock GRBL ships with laser
  // mode off, so `$32=0` cannot tell a laser from a router. The type stays the
  // one chosen, and the card asks a laser to turn laser mode on (ADR-637
  // Amendment 7, replacing ADR-420 rule 5's type from `$32`).
  const values = Object.keys(report.detected).length > 0;
  if (values) {
    // `$130`/`$131` are travel, not the bed (ADR-420 rule 8): a listed
    // machine keeps its sourced work area (ADR-637 Amendment 2).
    actions.push({
      kind: 'accept-detected',
      patch: report.detected,
      ...(listed ? { keepWorkArea: true } : {}),
    });
  }
  if (actions.length === 0) return null;
  return { actions, summary: { controllerKind, baudRate, values } };
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
