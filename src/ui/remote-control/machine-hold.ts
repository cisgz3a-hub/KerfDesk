import { jogAxisSignsForOrigin } from '../../core/devices';
import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import { machineKindOf, type Project } from '../../core/scene';
import { clampJogFeed, stepJogVector } from '../laser/jog-control-policy';
import { focusJogReady } from '../laser/FocusJogControls';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import type { MachineExecutionOwner } from '../state/machine-execution-owner';
import type { MachineExecutionContext } from './machine-execution';
import { operationIsTerminal, type OwnedMachineOperation } from './machine-operation-state';
import type { MachineCommand } from './machine-types';
import { MachineRefusal } from './machine-actions';
import { RemoteFault } from './fault';

/**
 * ADR-585. The PC owns the dead-man: a held jog stops when the phone's heartbeat is late,
 * the phone releases, its socket closes, the grant ends or this renderer session ends.
 */
export const HOLD_DEADMAN_MS = 600;
/** One hold never travels further than an ordinary remote step (ADR-569 bound). */
export const HOLD_MAX_TRAVEL_MM = 100;
export const HOLD_MAX_Z_TRAVEL_MM = 20;

type HoldInput = Extract<MachineCommand, { readonly command: 'jog_hold_start' }>;

/** The bounded jog one hold may make, using the desktop's axis signs and feed limits. */
function holdVector(input: HoldInput, project: Project) {
  const laser = useLaserStore.getState();
  if (!laser.capabilities.jogCancel)
    throw new MachineRefusal(
      'This controller cannot stop a jog early, so hold-to-jog is off. Use steps.',
    );
  if (laser.capabilities.jog === 'none') throw new RemoteFault('unsupported_operation');
  const z = input.args.axis === 'z';
  if (z && !focusJogReady(project.device, machineKindOf(project.machine)))
    throw new RemoteFault('unsupported_operation');
  const maximum = deviceForActiveHead(project.device, project.machine).maxFeed;
  const feed = clampJogFeed(
    input.args.feedMmPerMin ?? (z ? 600 : 3000),
    z ? Math.min(maximum, 600) : maximum,
  );
  if (z) return { dz: input.args.direction * HOLD_MAX_Z_TRAVEL_MM, feed };
  return stepJogVector(
    {
      x: input.args.axis === 'x' ? input.args.direction : 0,
      y: input.args.axis === 'y' ? input.args.direction : 0,
    },
    HOLD_MAX_TRAVEL_MM,
    jogAxisSignsForOrigin(project.device.origin),
    feed,
  );
}

export async function executeHold(
  input: HoldInput,
  operation: OwnedMachineOperation,
  context: MachineExecutionContext,
  owner: MachineExecutionOwner,
): Promise<void> {
  const vector = holdVector(input, (context.options.store ?? useStore).getState().project);
  if (operation.holdReleased === true) throw new RemoteFault('cancelled');
  await useLaserStore.getState().jog(vector, owner);
  operation.committed = true;
  if (operation.holdReleased === true) releaseHeldMotion(operation);
  await settleHold(operation);
  operation.state = 'completed';
  operation.message =
    operation.holdReleased === true ? 'Stopped.' : 'Reached the hold travel limit.';
}

/** A released hold is cancelled on purpose; it is complete once the controller is Idle again. */
async function settleHold(operation: OwnedMachineOperation): Promise<void> {
  if (operation.motionSettled === undefined) throw new RemoteFault('unavailable');
  try {
    await operation.motionSettled;
  } catch (error) {
    const released =
      operation.holdReleased === true && error instanceof RemoteFault && error.code === 'cancelled';
    if (!released) throw error;
    await idleAfterRelease(operation);
  }
}

function idleAfterRelease(operation: OwnedMachineOperation): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => finish(new RemoteFault('unavailable')), 5000);
    const check = () => {
      const state = useLaserStore.getState();
      if (state.controllerSessionEpoch !== operation.controllerEpoch)
        finish(new RemoteFault('unavailable'));
      else if (state.motionOperation === null && state.statusReport?.state === 'Idle') finish();
    };
    const unsubscribe = useLaserStore.subscribe(check);
    function finish(error?: RemoteFault) {
      clearTimeout(deadline);
      unsubscribe();
      if (error === undefined) resolve();
      else reject(error);
    }
    check();
  });
}

/** Stop only the motion this hold owns; never another owner's or a replacement controller's. */
export function releaseHeldMotion(operation: OwnedMachineOperation): void {
  if (operationIsTerminal(operation)) return;
  operation.holdReleased = true;
  if (operation.motionId === undefined) {
    if (operation.committed === false) operation.controller.abort();
    return;
  }
  const state = useLaserStore.getState();
  if (
    state.controllerSessionEpoch !== operation.controllerEpoch ||
    state.motionOperation?.operationId !== operation.motionId
  )
    return;
  void state.cancelJog().catch(() => {
    operation.state = 'unknown';
    operation.message = 'The held jog stop could not be confirmed. Check the machine on the PC.';
  });
}

type Hold = {
  readonly clientId: string;
  readonly operation: OwnedMachineOperation;
  timer: ReturnType<typeof setTimeout>;
};

/** Heartbeats arrive through the phone socket; each one re-arms the PC-side timer. */
export class HoldDeadman {
  private readonly holds = new Map<string, Hold>();
  constructor(private readonly timeoutMs = HOLD_DEADMAN_MS) {}
  arm(operationId: string, clientId: string, operation: OwnedMachineOperation): void {
    this.release(operationId);
    const hold: Hold = {
      clientId,
      operation,
      timer: setTimeout(() => this.release(operationId), this.timeoutMs),
    };
    this.holds.set(operationId, hold);
  }
  beat(clientId: string, operationId: string): boolean {
    const hold = this.holds.get(operationId);
    if (hold === undefined || hold.clientId !== clientId || operationIsTerminal(hold.operation))
      return false;
    clearTimeout(hold.timer);
    hold.timer = setTimeout(() => this.release(operationId), this.timeoutMs);
    return true;
  }
  find(clientId: string, operationId: string): OwnedMachineOperation | undefined {
    const hold = this.holds.get(operationId);
    return hold?.clientId === clientId ? hold.operation : undefined;
  }
  release(operationId: string): void {
    const hold = this.holds.get(operationId);
    if (hold === undefined) return;
    clearTimeout(hold.timer);
    this.holds.delete(operationId);
    releaseHeldMotion(hold.operation);
  }
  releaseClient(clientId: string | null): void {
    for (const [id, hold] of [...this.holds])
      if (clientId === null || hold.clientId === clientId) this.release(id);
  }
  active(): boolean {
    for (const [id, hold] of [...this.holds]) {
      if (operationIsTerminal(hold.operation)) {
        clearTimeout(hold.timer);
        this.holds.delete(id);
      }
    }
    return this.holds.size > 0;
  }
}
