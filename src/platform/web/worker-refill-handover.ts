import type { HostedStreamRefill } from '../types';
import type { SerialWorkerRequest, SerialWorkerResponse } from './serial-worker-protocol';

type Pending = {
  readonly id: number;
  readonly promise: Promise<void>;
  readonly finish: () => void;
};
type HandoverState = {
  phase: 'main' | 'preparing' | 'arming' | 'worker' | 'releasing' | 'closed';
  handedOver: boolean;
  nextId: number;
  pending: Pending | null;
  snapshot: (() => unknown | null) | null;
};
type HandoverDeps = {
  readonly post: (message: SerialWorkerRequest) => void;
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
  const timer = setTimeout(deps.fail, deps.timeoutMs);
  state.pending = {
    id: state.nextId++,
    promise,
    finish: () => {
      clearTimeout(timer);
      resolve();
    },
  };
  return state.pending;
}

function post(deps: HandoverDeps, message: SerialWorkerRequest): void {
  try {
    deps.post(message);
  } catch {
    deps.fail();
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
  if (message.id !== state.pending?.id) return true;
  switch (message.kind) {
    case 'ready':
      if (state.phase === 'preparing') captureSnapshot(state, deps, message.id);
      break;
    case 'armed':
      if (state.phase === 'arming') {
        state.phase = 'worker';
        finish(state);
      }
      break;
    case 'released':
      if (state.phase === 'releasing') {
        state.handedOver = false;
        state.phase = 'main';
        finish(state);
      }
      break;
  }
  return true;
}

function captureSnapshot(state: HandoverState, deps: HandoverDeps, id: number): void {
  const streamer = state.snapshot?.() ?? null;
  if (streamer === null) {
    void release(state, deps);
    return;
  }
  state.phase = 'arming';
  state.handedOver = true;
  post(deps, { kind: 'arm', id, streamer: streamer as never });
}
