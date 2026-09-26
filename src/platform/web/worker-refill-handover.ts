import type { StreamerState } from '../../core/controllers/grbl';
import type { HostedStreamRefill } from '../types';
import { encodeProgramLines } from './serial-program-buffer';
import type { SerialWorkerRequest, SerialWorkerResponse } from './serial-worker-protocol';

// The program crosses to the worker once per run, as two transferred buffers,
// and every arm names it instead of carrying it (audit SER-1; ADR-354
// Amendment 3). The deadline stops while a program is encoded and posted: that
// work grows with the job and is not the worker's to answer for. It restarts
// for an arm whose size does not depend on the job, so a large job gets the
// same prompt check of a silent worker as a small one. A Resume or tool-change
// Continue of the same run finds its program already in the worker.

type Pending = {
  readonly id: number;
  readonly promise: Promise<void>;
  readonly finish: () => void;
  /** Stops the deadline until `restart`. */
  readonly hold: () => void;
  /** Restarts the deadline, `ms` from now. */
  readonly restart: (ms: number) => void;
};
type HandoverState = {
  phase: 'main' | 'preparing' | 'arming' | 'worker' | 'releasing' | 'closed';
  handedOver: boolean;
  nextId: number;
  pending: Pending | null;
  snapshot: (() => unknown | null) | null;
  /** The id of the program the worker holds, or null when it holds none. */
  workerProgram: number | null;
  nextProgramId: number;
  /** A run keeps its queue array for its whole life, Pause, Resume and tool
   * changes included, and a new run or a changed program gets a new one. Weak,
   * so this record never keeps a finished job's lines alive. */
  readonly programIds: WeakMap<ReadonlyArray<string>, number>;
};
type HandoverDeps = {
  readonly post: (message: SerialWorkerRequest, transfer?: ReadonlyArray<ArrayBuffer>) => void;
  readonly timeoutMs: number;
  readonly fail: () => void;
  readonly onWriteError: HostedStreamRefill['onWriteError'];
};

/** The ready barrier drains all previously forwarded lines before capturing
 * the stream. No new lines cross it until the worker adopts that snapshot. */
export function createWorkerRefillHandover(deps: HandoverDeps): {
  readonly refill: HostedStreamRefill;
  readonly receive: (message: SerialWorkerResponse) => boolean;
  readonly close: () => void;
} {
  const state: HandoverState = {
    phase: 'main',
    handedOver: false,
    nextId: 1,
    pending: null,
    snapshot: null,
    workerProgram: null,
    nextProgramId: 1,
    programIds: new WeakMap(),
  };
  return {
    refill: {
      isArmed: () => state.handedOver,
      arm: (readSnapshot) => {
        if (state.phase !== 'main') return state.pending?.promise ?? Promise.resolve();
        state.phase = 'preparing';
        const request = begin(state, deps);
        state.snapshot = readSnapshot;
        post(deps, { kind: 'prepare-arm', id: request.id });
        return request.promise;
      },
      release: () => release(state, deps),
      onWriteError: deps.onWriteError,
    },
    receive: (message) => {
      if (message.kind !== 'refill-stopped') return receive(state, deps, message);
      // A stop marker queued before native teardown cannot revive an owner
      // that close has already retired while its final acknowledgement waits.
      if (state.phase === 'closed') return true;
      // The worker let go of its program with the refill.
      state.workerProgram = null;
      state.handedOver = false;
      state.phase = 'main';
      finish(state);
      return true;
    },
    close: () => {
      state.phase = 'closed';
      state.handedOver = false;
      finish(state);
    },
  };
}

function finish(state: HandoverState): void {
  const previous = state.pending;
  state.pending = null;
  state.snapshot = null;
  previous?.finish();
}

function begin(state: HandoverState, deps: HandoverDeps): Pending {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  let timer = setTimeout(deps.fail, deps.timeoutMs);
  state.pending = {
    id: state.nextId++,
    promise,
    finish: () => {
      clearTimeout(timer);
      resolve();
    },
    hold: () => clearTimeout(timer),
    restart: (ms) => {
      clearTimeout(timer);
      timer = setTimeout(deps.fail, ms);
    },
  };
  return state.pending;
}

/** False when the worker could not be asked; `fail` has then retired it. */
function post(
  deps: HandoverDeps,
  message: SerialWorkerRequest,
  transfer?: ReadonlyArray<ArrayBuffer>,
): boolean {
  try {
    deps.post(message, transfer);
    return true;
  } catch {
    deps.fail();
    return false;
  }
}

function release(state: HandoverState, deps: HandoverDeps): Promise<void> {
  if (state.phase === 'main' || state.phase === 'closed') return Promise.resolve();
  if (state.phase === 'releasing') return state.pending?.promise ?? Promise.resolve();
  // Cancel a pending arm before accepting another ready/armed reply. Keep
  // suppressing refills if its snapshot has already been sent.
  finish(state);
  state.phase = 'releasing';
  const request = begin(state, deps);
  post(deps, { kind: 'release', id: request.id });
  return request.promise;
}

function receive(state: HandoverState, deps: HandoverDeps, message: SerialWorkerResponse): boolean {
  if (message.kind !== 'ready' && message.kind !== 'armed' && message.kind !== 'released')
    return false;
  // Even a late release reply is the worker's word on which program it holds.
  if (message.kind === 'released' && message.retiredProgram === state.workerProgram)
    state.workerProgram = null;
  if (message.id === state.pending?.id) settle(state, deps, message);
  return true;
}

function settle(
  state: HandoverState,
  deps: HandoverDeps,
  message: Extract<SerialWorkerResponse, { readonly kind: 'ready' | 'armed' | 'released' }>,
): void {
  switch (message.kind) {
    case 'ready':
      if (state.phase === 'preparing') captureSnapshot(state, deps, message.id);
      return;
    case 'armed':
      if (state.phase === 'arming') {
        state.phase = 'worker';
        finish(state);
      }
      return;
    case 'released':
      if (state.phase === 'releasing') {
        state.handedOver = false;
        state.phase = 'main';
        finish(state);
      }
      return;
  }
}

function captureSnapshot(state: HandoverState, deps: HandoverDeps, id: number): void {
  const streamer = (state.snapshot?.() ?? null) as StreamerState | null;
  if (streamer === null) {
    void release(state, deps);
    return;
  }
  const { queued, ...position } = streamer;
  // Encoding and posting a program takes time that grows with the job. The
  // worker is not late while this thread works, so the deadline waits.
  state.pending?.hold();
  let programId: number | null;
  try {
    programId = workerProgramFor(state, deps, queued);
  } catch (error) {
    // Not a program the worker can hold. This thread keeps the refill, exactly
    // as on a transport that cannot host it.
    console.warn('Background streaming could not take this program:', error);
    void release(state, deps);
    return;
  }
  if (programId === null) return;
  state.phase = 'arming';
  state.handedOver = true;
  // From here the deadline covers only the worker adopting this message: the
  // position and the in-flight lines, which the controller's receive buffer
  // bounds, never the program.
  state.pending?.restart(deps.timeoutMs);
  post(deps, { kind: 'arm', id, programId, position });
}

/** The id of the worker's copy of `lines`, posted first when the worker does not
 * hold it. Null when that post failed and `fail` retired the worker. Throws
 * when the lines cannot be encoded. */
function workerProgramFor(
  state: HandoverState,
  deps: HandoverDeps,
  lines: ReadonlyArray<string>,
): number | null {
  const known = state.programIds.get(lines);
  if (known !== undefined && known === state.workerProgram) return known;
  const buffers = encodeProgramLines(lines);
  const programId = state.nextProgramId++;
  // Transferred, not copied: both buffers move to the worker and are detached
  // here, so this thread keeps only the queue it already had.
  const message = { kind: 'program', programId, ...buffers } as const;
  if (!post(deps, message, [buffers.bytes, buffers.offsets])) return null;
  state.programIds.set(lines, programId);
  state.workerProgram = programId;
  return programId;
}
