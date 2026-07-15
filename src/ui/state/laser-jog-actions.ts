// laser-jog-actions — Home / Jog / Frame motion actions, extracted from
// laser-store.ts when the board-capture "jog to point" action (ADR-124) pushed
// the store past the ADR-015 size cap. Same factory shape as laser-job-actions /
// laser-origin-actions: receives the store's set/get, the live refs (for the
// active driver), and the connection-bound safe write. Type-only LaserState /
// LiveRefs import — no runtime cycle.

import { firstZoneCrossedBySegment } from '../../core/preflight';
import { buildCncFrameMotion, type CncFrameMotionPlan } from './cnc-frame-lines';
import { currentWorkZMm, inferCurrentMachinePosition } from './infer-machine-position';
import { runHomeAction } from './laser-home-action';
import { markMotionOperationDispatched, startMotionOperation } from './laser-motion-operation';
import { type LaserSafetyAction } from './laser-safety-notice';
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

// Below this XY delta (mm) a "jog to point" is treated as already-there: GRBL
// would round it away, and an all-zero jog is rejected as a no-axis command.
const JOG_TO_POINT_EPSILON_MM = 1e-3;

export function jogActions(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'home' | 'jog' | 'jogToMachinePosition' | 'cancelJog' | 'frame'> {
  return {
    home: async () => {
      await runHomeAction(set, get, refs, safeWrite, refs.driver);
    },
    jogToMachinePosition: async (x, y, feed) => {
      const current = inferCurrentMachinePosition(get().statusReport, get().wcoCache);
      if (current === null) {
        const message =
          'Jog to point needs a live machine position. Wait for an Idle status report.';
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
      assertCncPointMoveWorkZReady(set, get);
      // CNC: after readiness is proven, lift Z to the configured safe height
      // before the XY traverse so the bit does not drag across stock or clamps.
      // Laser projects have no Z retract seam and keep the flat move (F105).
      await retractToCncSafeZ(refs, safeWrite, feed);
      await get().jog({ dx, dy, feed });
    },
    jog: async (params) => {
      assertAutofocusIdle(get());
      assertJogFrameReady(set, get);
      assertJogClearsNoGoZones(set, get, params);
      set({ motionOperation: startMotionOperation('jog') });
      try {
        await safeWrite(`${refs.driver.commands.buildJog(params)}\n`, 'jog');
        set((s) => ({
          motionOperation: markMotionOperationDispatched(s.motionOperation, 'jog'),
        }));
      } catch (err) {
        set({ motionOperation: null });
        throw err;
      }
    },
    cancelJog: async () => {
      const jogCancel = refs.driver.realtime.jogCancel;
      if (jogCancel === null) {
        set({ motionOperation: null, frameVerification: null });
        return;
      }
      await safeWrite(jogCancel, 'jog').finally(() =>
        set({ motionOperation: null, frameVerification: null }),
      );
    },
    frame: async (bounds, feed) => {
      assertAutofocusIdle(get());
      assertJogFrameReady(set, get);
      const plan = buildFrameDispatchPlan(refs, get, bounds, feed);
      if (plan.kind === 'blocked') {
        set({ lastWriteError: plan.message, log: pushLog(get(), `[lf2] ${plan.message}`) });
        throw new Error(plan.message);
      }
      const [firstLine, ...pendingLines] = plan.lines;
      if (firstLine === undefined) return;
      set({ motionOperation: startMotionOperation('frame', pendingLines) });
      try {
        await safeWrite(firstLine, 'frame');
        set((s) => ({
          motionOperation: markMotionOperationDispatched(s.motionOperation, 'frame'),
        }));
      } catch (err) {
        set({ motionOperation: null });
        throw err;
      }
    },
  };
}

// Ordered frame line list for dispatch. Laser projects trace the driver's
// Z-silent XY perimeter; CNC projects wrap it with a safe-Z retract (the bit
// would otherwise drag through stock) and a restore back to the pre-frame Z so
// the bit does not end parked at safe height (ADR-192). The retract/restore is
// gated on a current work-Z zero; buildCncFrameMotion orders driver-produced
// lines only (ADR-094 — no protocol bytes are hardcoded here).
function buildFrameDispatchPlan(
  refs: LiveRefs,
  get: GetFn,
  bounds: Parameters<LaserState['frame']>[0],
  feed: number,
): CncFrameMotionPlan {
  const perimeter = refs.driver.commands.buildFrameLines(bounds, feed);
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') return { kind: 'ready', lines: perimeter };
  const state = get();
  return buildCncFrameMotion({
    perimeter,
    safeZMm: machine.params.safeZMm,
    preFrameWorkZMm: currentWorkZMm(state.statusReport, state.wcoCache),
    hasCurrentWorkZEvidence: isWorkZEvidenceCurrentForStart(
      state.workZZeroEvidence,
      state.workZReferenceEpoch,
      state.controllerSessionEpoch,
    ),
    buildRetract: refs.driver.commands.buildFrameRetract,
    feed,
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
): Promise<void> {
  const machine = useStore.getState().project.machine;
  const safeZMm = machine?.kind === 'cnc' ? machine.params.safeZMm : undefined;
  if (safeZMm === undefined) return;
  const retractLine = refs.driver.commands.buildFrameRetract?.(safeZMm, feed);
  if (retractLine === undefined) return;
  await safeWrite(retractLine, 'frame');
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

// DEV-04: refuse a jog whose straight path would drive the head through an
// enabled no-go/keep-out zone — the same zones Start/Frame/export already honor,
// which jog was blind to. A relative jog with no known machine position can't be
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
