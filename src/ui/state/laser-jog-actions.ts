// laser-jog-actions — Home / Jog / Frame motion actions, extracted from
// laser-store.ts when the board-capture "jog to point" action (ADR-124) pushed
// the store past the ADR-015 size cap. Same factory shape as laser-job-actions /
// laser-origin-actions: receives the store's set/get, the live refs (for the
// active driver), and the connection-bound safe write. Type-only LaserState /
// LiveRefs import — no runtime cycle.

import { firstZoneCrossedBySegment } from '../../core/preflight';
import { inferCurrentMachinePosition } from './infer-machine-position';
import { buildFrameDispatchPlan } from './laser-frame-motion-plan';
import { runHomeAction } from './laser-home-action';
import {
  markMotionOperationDispatched,
  startMotionOperation,
  type LaserMotionOperation,
  type LaserMotionOperationId,
} from './laser-motion-operation';
import { runCancelJog } from './laser-motion-cancel';
import { type LaserSafetyAction } from './laser-safety-notice';
import { settleOwnedMotionPhase } from './laser-owned-motion-settlement';
import { assertAutofocusIdle, jogFrameCommandBlockMessage, pushLog } from './laser-store-helpers';
import { useStore } from './store';
import { isWorkZEvidenceCurrentForStart } from './work-z-zero-evidence';
import type { LaserState, LiveRefs } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;
type JogActionContext = {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: LiveRefs;
  readonly safeWrite: SafeWriteFn;
};

// Below this XY delta (mm) a "jog to point" is treated as already-there: GRBL
// would round it away, and an all-zero jog is rejected as a no-axis command.
const JOG_TO_POINT_EPSILON_MM = 1e-3;

export function jogActions(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'home' | 'jog' | 'jogToMachinePosition' | 'cancelJog' | 'frame'> {
  const context: JogActionContext = { set, get, refs, safeWrite };
  return {
    home: () => runHomeAction(set, get, refs, safeWrite, refs.driver),
    jogToMachinePosition: (x, y, feed) => runJogToMachinePosition(context, x, y, feed),
    jog: (params) => runJog(context, params),
    cancelJog: () => runCancelJog(set, get, refs, safeWrite),
    frame: (bounds, feed, candidate) => runFrame(context, bounds, feed, candidate),
  };
}

async function runJogToMachinePosition(
  context: JogActionContext,
  x: number,
  y: number,
  feed: number,
): Promise<void> {
  const { set, get, refs, safeWrite } = context;
  const current = inferCurrentMachinePosition(get().statusReport, get().wcoCache);
  if (current === null) {
    const message = 'Jog to point needs a live machine position. Wait for an Idle status report.';
    set({ lastWriteError: message, log: pushLog(get(), `[lf2] ${message}`) });
    throw new Error(message);
  }
  const dx = x - current.x;
  const dy = y - current.y;
  // Already there (within a step GRBL would round to zero): nothing to do,
  // and an all-zero jog would be rejected as a no-axis command.
  if (Math.abs(dx) < JOG_TO_POINT_EPSILON_MM && Math.abs(dy) < JOG_TO_POINT_EPSILON_MM) return;
  assertAutofocusIdle(get());
  assertJogFrameReady(set, get);
  assertMotionQueueSettled(set, get, 'moving to a machine position');
  assertCncPointMoveWorkZReady(set, get);
  const params = { dx, dy, feed };
  assertJogClearsNoGoZones(set, get, params);
  const operation = startSettledJogOperation(refs);
  set({ motionOperation: operation, frameVerification: null, framedRun: null });
  // CNC: after readiness is proven, lift Z to the configured safe height
  // before the XY traverse so the bit does not drag across stock or clamps.
  // Laser projects have no Z retract seam and keep the flat move (F105).
  try {
    const retracted = await retractToCncSafeZ(refs, safeWrite, feed);
    if (retracted) {
      await settleOwnedMotionPhase(
        get,
        refs,
        safeWrite,
        operation.operationId,
        'CNC safe-Z retract',
      );
      resetOwnedMotionPhase(set, operation.operationId);
    }
    await dispatchOwnedJog(context, params, operation);
  } catch (error) {
    set((state) => failOwnedMotionOperation(state, operation.operationId));
    throw error;
  }
}

async function runJog(
  context: JogActionContext,
  params: Parameters<LaserState['jog']>[0],
): Promise<void> {
  const { set, get } = context;
  assertAutofocusIdle(get());
  assertJogFrameReady(set, get);
  assertMotionQueueSettled(set, get, 'jogging');
  assertJogClearsNoGoZones(set, get, params);
  // Any deliberate head move consumes the placement proof even if the
  // head later returns to numerically identical coordinates.
  const operation = startSettledJogOperation(context.refs);
  set({ motionOperation: operation, frameVerification: null, framedRun: null });
  try {
    await dispatchOwnedJog(context, params, operation);
  } catch (error) {
    set((state) => failOwnedMotionOperation(state, operation.operationId));
    throw error;
  }
}

async function dispatchOwnedJog(
  context: JogActionContext,
  params: Parameters<LaserState['jog']>[0],
  operation: LaserMotionOperation,
): Promise<void> {
  const { set, get, refs, safeWrite } = context;
  assertMotionOperationOwner(get, operation.operationId, 'Jog');
  await safeWrite(`${refs.driver.commands.buildJog(params)}\n`, 'jog');
  set((state) => ({
    motionOperation: markMotionOperationDispatched(
      state.motionOperation,
      'jog',
      operation.operationId,
    ),
  }));
}

function startSettledJogOperation(refs: LiveRefs): LaserMotionOperation {
  const settlementLine = `${refs.driver.commands.settleDwell}\n`;
  return startMotionOperation('jog', [settlementLine], undefined, 0, 0, undefined, settlementLine);
}

async function runFrame(
  context: JogActionContext,
  bounds: Parameters<LaserState['frame']>[0],
  feed: number,
  candidate: Parameters<LaserState['frame']>[2],
): Promise<void> {
  const { set, get, refs, safeWrite } = context;
  assertAutofocusIdle(get());
  assertJogFrameReady(set, get);
  assertMotionQueueSettled(set, get, 'framing again');
  set({ frameVerification: null, framedRun: null });
  const plan = buildFrameDispatchPlan(refs, get, bounds, feed, candidate);
  if (plan.kind === 'blocked') {
    set({ lastWriteError: plan.message, log: pushLog(get(), `[lf2] ${plan.message}`) });
    throw new Error(plan.message);
  }
  // Every Frame ends with the active driver's planner-drain marker. Status
  // reports alone are not a causal completion proof: realtime replies can be
  // delayed, and Marlin M114 normally reports projected rather than physical
  // position. The marker's exact FIFO ack plus a later status is the sole
  // completion boundary that may mint the one-run permit.
  const frameSettlementLine = `${refs.driver.commands.settleDwell}\n`;
  const [firstLine, ...pendingLines] = [...plan.lines, frameSettlementLine];
  if (firstLine === undefined) {
    const message =
      'Frame is unavailable because the active controller did not provide framing motion commands.';
    set({ lastWriteError: message, log: pushLog(get(), `[lf2] ${message}`) });
    throw new Error(message);
  }
  const operation = startMotionOperation(
    'frame',
    pendingLines,
    candidate,
    refs.driver.commands.frameToolOffLines.length,
    0,
    undefined,
    frameSettlementLine,
  );
  set({ motionOperation: operation });
  try {
    assertMotionOperationOwner(get, operation.operationId, 'Frame');
    await safeWrite(firstLine, 'frame');
    set((state) => ({
      motionOperation: markMotionOperationDispatched(
        state.motionOperation,
        'frame',
        operation.operationId,
      ),
    }));
  } catch (error) {
    set((state) => failOwnedMotionOperation(state, operation.operationId));
    throw error;
  }
}

function assertMotionOperationOwner(
  get: GetFn,
  operationId: LaserMotionOperationId,
  label: string,
): void {
  const operation = get().motionOperation;
  if (operation?.operationId === operationId && operation.cancelRequested !== true) return;
  throw new Error(`${label} was cancelled or replaced before its first command was dispatched.`);
}

function assertMotionQueueSettled(set: SetFn, get: GetFn, action: string): void {
  const state = get();
  if (state.pendingUntrackedAcks === 0 && (state.pendingTransportWrites ?? 0) === 0) return;
  const message = `Wait for the previous controller write and acknowledgement to settle before ${action}.`;
  set({ lastWriteError: message, log: pushLog(state, `[lf2] Motion command blocked: ${message}`) });
  throw new Error(message);
}

function failOwnedMotionOperation(
  state: LaserState,
  operationId: LaserMotionOperationId,
): Partial<Pick<LaserState, 'motionOperation' | 'frameVerification' | 'framedRun'>> {
  if (state.motionOperation?.operationId !== operationId) return {};
  return {
    motionOperation: { ...state.motionOperation, cancelRequested: true },
    frameVerification: null,
    framedRun: null,
  };
}

function resetOwnedMotionPhase(set: SetFn, operationId: LaserMotionOperationId): void {
  set((state) => {
    const operation = state.motionOperation;
    if (operation?.operationId !== operationId || operation.cancelRequested === true) return {};
    return {
      motionOperation: {
        ...operation,
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: false,
      },
    };
  });
}

// Emit the driver's Z-safe retract for a CNC project before an XY traverse, so a
// return-to-zero (or any point move) lifts the bit clear of stock/clamps. Mirrors
// the retract prefix frame() uses; laser projects and drivers without a jog-based
// Z retract return undefined and skip it (F105).
async function retractToCncSafeZ(
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  feed: number,
): Promise<boolean> {
  const machine = useStore.getState().project.machine;
  const safeZMm = machine?.kind === 'cnc' ? machine.params.safeZMm : undefined;
  if (safeZMm === undefined) return false;
  const retractLine = refs.driver.commands.buildFrameRetract?.(safeZMm, feed);
  if (retractLine === undefined) return false;
  await safeWrite(retractLine, 'jog');
  return true;
}

function assertCncPointMoveWorkZReady(set: SetFn, get: GetFn): void {
  if (useStore.getState().project.machine?.kind !== 'cnc') return;
  const state = get();
  if (
    isWorkZEvidenceCurrentForStart(
      state.workZZeroEvidence,
      state.workZReferenceEpoch,
      state.controllerSessionEpoch,
    )
  ) {
    return;
  }
  const message =
    'CNC point move blocked: set or probe Work Z before moving. The safe-Z retract uses absolute work coordinates.';
  set({ lastWriteError: message, log: pushLog(get(), `[lf2] ${message}`) });
  throw new Error(message);
}

function assertJogFrameReady(set: SetFn, get: GetFn): void {
  const blockedMessage = jogFrameCommandBlockMessage(get());
  if (blockedMessage === null) return;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(get(), `[lf2] Motion command blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}

// DEV-04: refuse a direct manual jog whose straight path would drive the head
// through an enabled no-go/keep-out zone. Framed-job review reports those zones
// as warnings instead of treating them as a second Start-authorization gate.
// A relative jog with no known machine position can't be
// resolved to a target, so it is allowed (the operator has no live position to
// reason about either); homing and continuous jog are out of scope.
function assertJogClearsNoGoZones(
  set: SetFn,
  get: GetFn,
  params: { readonly dx?: number; readonly dy?: number },
): void {
  const dx = params.dx ?? 0;
  const dy = params.dy ?? 0;
  // A Z-only jog (or a no-op) has no XY motion, so no XY keep-out can be crossed.
  // Testing the degenerate start==end segment would wrongly block a safe Z
  // retract / touch-off whenever the head is parked inside a zone (DEV-04 audit).
  if (dx === 0 && dy === 0) return;
  const zones = useStore.getState().project.device.noGoZones;
  if (zones === undefined || zones.length === 0) return;
  const current = inferCurrentMachinePosition(get().statusReport, get().wcoCache);
  if (current === null) return;
  const target = { x: current.x + dx, y: current.y + dy };
  const zone = firstZoneCrossedBySegment(current, target, zones);
  if (zone === null) return;
  const message = `Jog blocked: this move would cross the no-go zone "${zone.name}". Jog around it, or disable the zone in Machine Setup → Safety Zones.`;
  set({ lastWriteError: message, log: pushLog(get(), `[lf2] ${message}`) });
  throw new Error(message);
}
