// rotary-test-rotation — Rotary Setup's Test rotation (ADR-373): turn the
// object, or the motor-driven chuck/roller, one full revolution at a slow
// feed, pause, then turn back, so the operator can check the setup against a
// mark on the part before anything burns. LightBurn's Test does the same
// 360° out-pause-back: https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/
//
// Both turns are ordinary jogs through the laser store's jog action, so they
// use the active driver's own jog emitter ($J=G91 on GRBL, G91/G0/G90 on
// Marlin and Smoothieware, M5 + G1 … S0 on the Falcon contract), the jog
// readiness gate (Idle, no alarm, no job, no other motion), its cancel path
// and its Frame expiry. A jog carries no power word, the test refuses while
// momentary Fire holds the beam on, and nothing here writes to the
// controller directly.

import type { JogParams } from '../../core/controllers/grbl';
import {
  rotaryRevolutionTravelMm,
  type RotaryRevolutionTarget,
  type RotarySetup,
} from '../../core/devices/rotary';
import type { MachineKind } from '../../core/scene';
import type { LaserState } from '../state/laser-store';
import { useLaserStore } from '../state/laser-store';
import {
  activeJobCommandBlockMessage,
  jogFrameCommandBlockMessage,
} from '../state/laser-store-helpers';
import type { LaserMotionOperationId } from '../state/laser-motion-operation';
import { clampJogFeed } from './jog-control-policy';
import { isDeliberateCancellation } from './report-controller-action-failure';

// One revolution in about this long: slow enough to follow a mark round.
const TEST_REVOLUTION_SECONDS = 10;
const TEST_MIN_FEED_MM_PER_MIN = 100;
const TEST_MAX_FEED_MM_PER_MIN = 1500;
export const ROTARY_TEST_PAUSE_MS = 1000;

export type RotaryTestPlan = {
  readonly target: RotaryRevolutionTarget;
  // Machine-Y mm for one revolution of the target.
  readonly travelMm: number;
  readonly feedMmPerMin: number;
  readonly legSeconds: number;
  // Out, then back by exactly the same distance.
  readonly legs: readonly [JogParams, JogParams];
};

export type RotaryTestPhase = 'turning' | 'pausing' | 'returning';

export type RotaryTestOutcome =
  | { readonly kind: 'done' }
  // The operator stopped the test or closed Rotary Setup.
  | { readonly kind: 'stopped' }
  // A turn could not start, or ended before it finished.
  | { readonly kind: 'failed'; readonly message: string };

type LaserStorePort = {
  readonly getState: () => LaserState;
  readonly subscribe: (listener: (state: LaserState) => void) => () => void;
};

export function planRotaryTestRotation(
  setup: RotarySetup,
  target: RotaryRevolutionTarget,
  maxFeedMmPerMin: number,
): RotaryTestPlan | null {
  const travelMm = rotaryRevolutionTravelMm(setup, target);
  if (travelMm === null || !Number.isFinite(travelMm) || travelMm <= 0) return null;
  const paced = (travelMm * 60) / TEST_REVOLUTION_SECONDS;
  const feed = clampJogFeed(
    Math.min(TEST_MAX_FEED_MM_PER_MIN, Math.max(TEST_MIN_FEED_MM_PER_MIN, paced)),
    maxFeedMmPerMin,
  );
  return {
    target,
    travelMm,
    feedMmPerMin: feed,
    legSeconds: (travelMm / feed) * 60,
    legs: [
      { dy: travelMm, feed },
      { dy: -travelMm, feed },
    ],
  };
}

// Why the test cannot start now, or null. The jog action re-checks the same
// gate before each turn; this is what the dialog shows beside the buttons.
export function rotaryTestBlockReason(state: LaserState, machineKind: MachineKind): string | null {
  if (machineKind === 'cnc') {
    return 'Test rotation is for a laser rotary. CNC projects do not use the rotary mapping.';
  }
  if (state.connection.kind !== 'connected') return 'Connect the controller to test the rotation.';
  if (state.capabilities.jog === 'none') {
    return 'This controller has no jog command, so KerfDesk cannot turn the rotary.';
  }
  if (state.fireActive) {
    return 'Turn momentary Fire off first. The test rotation never runs with the beam on.';
  }
  if (state.autofocusBusy) return 'Auto-focus is running. Wait for it to finish.';
  if (state.alarmCode !== null) return 'Clear the controller alarm before testing the rotation.';
  return activeJobCommandBlockMessage(state) ?? jogFrameCommandBlockMessage(state);
}

export async function runRotaryTestRotation(args: {
  readonly plan: RotaryTestPlan;
  readonly signal: AbortSignal;
  readonly onPhase?: (phase: RotaryTestPhase) => void;
  readonly store?: LaserStorePort;
  readonly pauseMs?: number;
}): Promise<RotaryTestOutcome> {
  const store = args.store ?? useLaserStore;
  const [out, back] = args.plan.legs;
  args.onPhase?.('turning');
  const first = await runTurn(store, out, args.signal);
  if (first.kind !== 'done') return first;
  args.onPhase?.('pausing');
  await pause(args.pauseMs ?? ROTARY_TEST_PAUSE_MS, args.signal);
  if (args.signal.aborted) return STOPPED;
  args.onPhase?.('returning');
  return runTurn(store, back, args.signal);
}

// Stops the turn in flight: jog cancel where the firmware has one, otherwise
// ABORT MOTION as the Live Motion bar offers for a jog. Jog cancel also
// poisons a turn still proving fresh Idle, before it owns any motion.
export async function stopRotaryTestMotion(state: LaserState): Promise<void> {
  const moving = state.motionOperation?.kind === 'jog';
  await (moving && !state.capabilities.jogCancel ? state.stopJob() : state.cancelJog());
}

const STOPPED: RotaryTestOutcome = { kind: 'stopped' };

async function runTurn(
  store: LaserStorePort,
  params: JogParams,
  signal: AbortSignal,
): Promise<RotaryTestOutcome> {
  if (signal.aborted) return STOPPED;
  // Fire is hold-to-run and can come on between the turns; never jog under it.
  if (store.getState().fireActive) {
    return failed(
      'Momentary Fire is on, so the rotation stopped. It never turns with the beam on.',
    );
  }
  const watch = watchOwnJog(store);
  try {
    await store.getState().jog(params);
  } catch (error) {
    watch.dispose();
    // A cancel from any surface (Stop here, Esc, the Live Motion bar) poisons
    // a turn still waiting for Idle; that is a stop, not a fault.
    return signal.aborted || isDeliberateCancellation(error) ? STOPPED : failed(errorText(error));
  }
  const release = await watch.released(signal);
  if (signal.aborted) return STOPPED;
  if (release === 'unseen') return failed('The controller did not start the rotation.');
  if (release === 'cancelled') {
    return failed(
      'The rotation ended early: the move was cancelled or the controller rejected it. See the Console for its reply.',
    );
  }
  return afterTurnFault(store.getState()) ?? { kind: 'done' };
}

// A turn that settled into an alarm or a closed link is not a finished turn,
// even when its jog owner was released without a cancel.
function afterTurnFault(state: LaserState): RotaryTestOutcome | null {
  if (state.connection.kind !== 'connected') {
    return failed('The controller disconnected during the rotation.');
  }
  if (state.alarmCode !== null || state.statusReport?.state === 'Alarm') {
    return failed('The controller reported an alarm during the rotation.');
  }
  return null;
}

type JogRelease = 'released' | 'cancelled' | 'unseen';

type OwnJogWatch = {
  readonly released: (signal: AbortSignal) => Promise<JogRelease>;
  readonly dispose: () => void;
};

// Subscribed before the jog is requested: the gate guarantees no other motion
// owner exists, so the first jog owner to appear is this turn's. It is done
// when the store releases that owner (null or replaced).
function watchOwnJog(store: LaserStorePort): OwnJogWatch {
  let ownId: LaserMotionOperationId | undefined;
  let cancelled = false;
  let outcome: JogRelease | null = null;
  let notify: (() => void) | null = null;
  const observe = (state: LaserState): void => {
    const operation = state.motionOperation;
    if (ownId === undefined) {
      if (operation?.kind !== 'jog') return;
      ownId = operation.operationId;
    }
    if (operation !== null && operation.operationId === ownId) {
      if (operation.cancelRequested === true || operation.mpgInterruptionId !== undefined) {
        cancelled = true;
      }
      return;
    }
    outcome = cancelled ? 'cancelled' : 'released';
    unsubscribe();
    notify?.();
  };
  const unsubscribe = store.subscribe(observe);
  return {
    dispose: unsubscribe,
    released: (signal) => {
      if (ownId === undefined && outcome === null) {
        unsubscribe();
        return Promise.resolve('unseen');
      }
      return new Promise<JogRelease>((resolve) => {
        const finish = (): void => {
          signal.removeEventListener('abort', finish);
          unsubscribe();
          resolve(outcome ?? 'cancelled');
        };
        if (outcome !== null || signal.aborted) return finish();
        notify = finish;
        signal.addEventListener('abort', finish, { once: true });
      });
    },
  };
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

function failed(message: string): RotaryTestOutcome {
  return { kind: 'failed', message };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
