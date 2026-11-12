import type { JogParams } from '../../core/controllers/grbl';
import { jogAxisSignsForOrigin } from '../../core/devices';
import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import type { Project } from '../../core/scene';
import { clampJogFeed, continuousJogVector } from '../laser/jog-control-policy';
import { holdJogAim, holdZRoomMm, type HoldJogInput } from '../laser/jog-hold-aim';
import { focusJogReady } from '../laser/FocusJogControls';
import { motionMachineKind } from '../state/job-motion-machine';
import { useLaserStore } from '../state/laser-store';
import { selectNativeBedEvidence } from '../state/native-bed-frame';
import { useStore } from '../state/store';
import type { MachineExecutionOwner } from '../state/machine-execution-owner';
import type { MachineExecutionContext } from './machine-execution';
import {
  completeRemoteJog,
  operationIsTerminal,
  type OwnedMachineOperation,
} from './machine-operation-state';
import type { MachineCommand } from './machine-types';
import { MachineRefusal } from './machine-actions';
import { cancelOwnedMotionOnce } from './machine-owned-operation';
import { RemoteFault } from './fault';

/**
 * ADR-585. The PC owns the dead-man: a held jog stops when the phone's heartbeat is late,
 * the phone releases, its socket closes, the grant ends or this renderer session ends.
 */
export const HOLD_DEADMAN_MS = 600;
/**
 * One hold never travels further than an ordinary remote step (ADR-569 bound), nor past the
 * travel edge the PC's own hold stops at (ADR-375 Amendment 8).
 */
export const HOLD_MAX_TRAVEL_MM = 100;
export const HOLD_MAX_Z_TRAVEL_MM = 20;
// continuousJogVector drops a distance of 1 µm or less, so a hold never asks for less.
const HOLD_MIN_TRAVEL_MM = 1e-3;
const AT_LIMIT = 'The head is already at the travel limit in that direction.';

type HoldInput = Extract<MachineCommand, { readonly command: 'jog_hold_start' }>;

/** The bounded jog one hold may make, using the desktop's axis signs and feed limits. */
function holdVector(input: HoldInput, project: Project): JogParams {
  const laser = useLaserStore.getState();
  if (!laser.capabilities.jogCancel)
    throw new MachineRefusal(
      'This controller cannot stop a jog early, so hold-to-jog is off. Use steps.',
    );
  if (laser.capabilities.jog === 'none') throw new RemoteFault('unsupported_operation');
  const z = input.args.axis === 'z';
  // A running job's own kind decides Z jog (ADR-416 Amendment 3).
  if (z && !focusJogReady(project.device, motionMachineKind(laser, project)))
    throw new RemoteFault('unsupported_operation');
  const maximum = deviceForActiveHead(project.device, project.machine).maxFeed;
  const feed = clampJogFeed(
    input.args.feedMmPerMin ?? (z ? 600 : 3000),
    z ? Math.min(maximum, 600) : maximum,
  );
  // The PC hold's own aim: up to the travel edge, measured from the head
  // (ADR-375 decision 3, Amendments 4 and 8), and never past the remote bound.
  const aim: HoldJogInput = {
    device: project.device,
    evidence: selectNativeBedEvidence(laser),
    statusReport: laser.statusReport,
    wcoCache: laser.wcoCache,
    reportInches: laser.controllerSettings?.reportInches === true,
  };
  return z ? holdZVector(input, aim, feed) : holdXyVector(input, aim, feed);
}

function holdZVector(input: HoldInput, aim: HoldJogInput, feed: number): JogParams {
  const { direction } = input.args;
  const travel = Math.min(HOLD_MAX_Z_TRAVEL_MM, holdZRoomMm(aim, direction) ?? Infinity);
  if (travel <= HOLD_MIN_TRAVEL_MM) throw new MachineRefusal(AT_LIMIT);
  return { dz: direction * travel, feed };
}

function holdXyVector(input: HoldInput, aim: HoldJogInput, feed: number): JogParams {
  const { axis, direction } = input.args;
  const { bounds, position } = holdJogAim(aim);
  const vector = continuousJogVector(
    { x: axis === 'x' ? direction : 0, y: axis === 'y' ? direction : 0 },
    position,
    bounds,
    jogAxisSignsForOrigin(aim.device.origin),
    feed,
  );
  if (vector === null) throw new MachineRefusal(AT_LIMIT);
  return {
    ...(vector.dx === undefined ? {} : { dx: capped(vector.dx) }),
    ...(vector.dy === undefined ? {} : { dy: capped(vector.dy) }),
    feed,
  };
}

function capped(distanceMm: number): number {
  return Math.sign(distanceMm) * Math.min(Math.abs(distanceMm), HOLD_MAX_TRAVEL_MM);
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
  completeRemoteJog(
    operation,
    operation.holdReleased === true ? 'Stopped.' : 'Reached the hold travel limit.',
  );
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
  // A release reaches here from jog_hold_stop, the socket, the dead-man and the
  // post-dispatch check; only the first sends the Cancel (ADR-585 Amendment 1).
  cancelOwnedMotionOnce(
    operation,
    'The held jog stop could not be confirmed. Check the machine on the PC.',
  );
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
