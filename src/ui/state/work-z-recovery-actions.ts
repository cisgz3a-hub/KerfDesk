import { parseOwnedWorkOffsetReadback } from '../../core/controllers/grbl/work-offset-readback';
import type { ControllerDriver } from '../../core/controllers';
import { activeCncTool } from '../../core/scene';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import { pushLog, setupCommandBlockMessage } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { useStore } from './store';
import { captureControllerWorkZEvidence } from './work-z-zero-evidence';

export type WorkZRecoveryConfirmation = {
  readonly activeToolId: string;
  readonly controllerOffsetRepresentsStockTop: true;
};

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type WriteFn = (line: string) => Promise<void>;
type DriverFn = () => ControllerDriver;

export function workZRecoveryActions(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  write: WriteFn,
  driver: DriverFn,
): Pick<LaserState, 'recoverWorkZFromController'> {
  return {
    recoverWorkZFromController: (confirmation) =>
      recoverWorkZ(set, get, refs, write, driver, confirmation),
  };
}

async function recoverWorkZ(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  write: WriteFn,
  driver: DriverFn,
  confirmation: WorkZRecoveryConfirmation,
): Promise<void> {
  const context = recoveryContext(get(), refs, driver(), confirmation);
  set({ controllerOperation: { kind: 'work-z-recovery', phase: 'modal-state' } });
  try {
    const beforeModal = await query(refs, write, context.modalQuery, 'active WCS');
    set({ controllerOperation: { kind: 'work-z-recovery', phase: 'offsets' } });
    const offsets = await query(refs, write, context.offsetsQuery, 'work offsets');
    set({ controllerOperation: { kind: 'work-z-recovery', phase: 'modal-state' } });
    const afterModal = await query(refs, write, context.modalQuery, 'active WCS recheck');
    const before = parseOwnedWorkOffsetReadback(beforeModal, offsets);
    const after = parseOwnedWorkOffsetReadback(afterModal, offsets);
    if (!before.ok) throw new Error(before.reason);
    if (!after.ok) throw new Error(after.reason);
    if (before.activeWcs !== after.activeWcs) {
      throw new Error('The active WCS changed during Work-Z recovery. Review setup and try again.');
    }
    assertRecoveryReservation(get(), context);
    set((state) => ({
      workZZeroEvidence: captureControllerWorkZEvidence({
        referenceEpoch: context.workZReferenceEpoch,
        controllerSessionEpoch: context.controllerSessionEpoch,
        toolId: context.toolId,
        activeWcs: after.activeWcs,
        offsetZMm: after.offset.z,
        observedAtMs: Date.now(),
      }),
      lastWriteError: null,
      log: pushLog(
        state,
        `[lf2] Recovered ${after.activeWcs} Work Z from owned controller readback.`,
      ),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set((state) => ({
      lastWriteError: message,
      log: pushLog(state, `[lf2] Work-Z recovery blocked: ${message}`),
    }));
    throw error;
  } finally {
    set((state) => ({
      controllerOperation:
        state.controllerOperation?.kind === 'work-z-recovery' ? null : state.controllerOperation,
    }));
  }
}

type RecoveryContext = {
  readonly modalQuery: string;
  readonly offsetsQuery: string;
  readonly toolId: string;
  readonly controllerSessionEpoch: number;
  readonly workZReferenceEpoch: number;
};

function recoveryContext(
  state: LaserState,
  refs: ControllerLifecycleRefs,
  driver: ControllerDriver,
  confirmation: WorkZRecoveryConfirmation,
): RecoveryContext {
  const issue = recoveryReadinessIssue(state, refs, driver, confirmation);
  if (issue !== null) throw new Error(issue);
  return {
    modalQuery: driver.commands.modalStateQuery ?? '',
    offsetsQuery: driver.commands.offsetsQuery ?? '',
    toolId: confirmation.activeToolId,
    controllerSessionEpoch: state.controllerSessionEpoch,
    workZReferenceEpoch: state.workZReferenceEpoch,
  };
}

function recoveryReadinessIssue(
  state: LaserState,
  refs: ControllerLifecycleRefs,
  driver: ControllerDriver,
  confirmation: WorkZRecoveryConfirmation,
): string | null {
  const projectMachine = useStore.getState().project.machine;
  return (
    recoveryProjectIssue(projectMachine, confirmation) ??
    recoveryMachineStateIssue(state) ??
    recoveryOwnershipIssue(refs) ??
    recoveryCapabilityIssue(driver)
  );
}

function recoveryProjectIssue(
  projectMachine: ReturnType<typeof useStore.getState>['project']['machine'],
  confirmation: WorkZRecoveryConfirmation,
): string | null {
  if (projectMachine?.kind !== 'cnc') return 'Work-Z recovery is available only for CNC projects.';
  if (confirmation.controllerOffsetRepresentsStockTop !== true) {
    return 'Confirm that the controller Work Z represents the stock top before recovery.';
  }
  if (activeCncTool(projectMachine).id !== confirmation.activeToolId) {
    return 'The Active bit changed before Work-Z recovery. Review and confirm the current bit.';
  }
  return null;
}

function recoveryMachineStateIssue(state: LaserState): string | null {
  const busy =
    setupCommandBlockMessage(state) ??
    controllerOperationCommandBlockMessage(state.controllerOperation);
  if (busy !== null) return busy;
  if (state.connection.kind !== 'connected') return 'Connect to the CNC controller first.';
  if (state.statusReport?.state !== 'Idle') return 'CNC must report Idle before Work-Z recovery.';
  if (state.pendingUntrackedAcks > 0 || (state.pendingTransportWrites ?? 0) > 0) {
    return 'Wait for earlier controller writes and acknowledgements before Work-Z recovery.';
  }
  return null;
}

function recoveryOwnershipIssue(refs: ControllerLifecycleRefs): string | null {
  if (refs.controllerCommand !== null || refs.controllerIdleWait !== null) {
    return 'Wait for the active controller command before Work-Z recovery.';
  }
  return null;
}

function recoveryCapabilityIssue(driver: ControllerDriver): string | null {
  if (driver.commands.modalStateQuery === null || driver.commands.offsetsQuery === null) {
    return `${driver.label} cannot provide owned modal and WCS offset readback.`;
  }
  return null;
}

async function query(
  refs: ControllerLifecycleRefs,
  write: WriteFn,
  command: string,
  label: string,
): Promise<ReadonlyArray<string>> {
  return startControllerCommand(refs, write, {
    kind: 'work-z-recovery',
    label: `Read CNC ${label}`,
    command: `${command}\n`,
    source: 'console',
  });
}

function assertRecoveryReservation(state: LaserState, expected: RecoveryContext): void {
  const currentMachine = useStore.getState().project.machine;
  const unchanged =
    state.controllerOperation?.kind === 'work-z-recovery' &&
    state.connection.kind === 'connected' &&
    state.controllerSessionEpoch === expected.controllerSessionEpoch &&
    state.workZReferenceEpoch === expected.workZReferenceEpoch &&
    currentMachine?.kind === 'cnc' &&
    activeCncTool(currentMachine).id === expected.toolId;
  if (!unchanged) {
    throw new Error('CNC setup changed during Work-Z recovery. Review setup and try again.');
  }
}
