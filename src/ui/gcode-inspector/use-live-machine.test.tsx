import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatusReport, StreamerState } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLiveMachine, type LiveMachine } from './use-live-machine';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let renders = 0;
let latest: LiveMachine | null = null;

function Probe(): null {
  renders += 1;
  latest = useLiveMachine();
  return null;
}

function mount(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Probe />));
}

function statusReport(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x: 1, y: 2, z: 3 },
    wPos: { x: 1, y: 2, z: 3 },
    wco: null,
    feed: 0,
    spindle: 0,
    ...overrides,
  };
}

function streamer(status: StreamerState['status'], completed: number): StreamerState {
  return {
    status,
    streamingMode: 'char-counted',
    queued: ['G0 X0\n', 'G1 X1\n', 'G1 X2\n'],
    queueIndex: completed,
    inFlight: [],
    inFlightBytes: 0,
    completed,
    total: 3,
    rxBufferBytes: 128,
    toolChangePause: false,
  };
}

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
  renders = 0;
  latest = null;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useLaserStore.setState(initialLaserState());
});

describe('useLiveMachine', () => {
  // The 250 ms poll replaces statusReport with a fresh object every tick even
  // when the controller said exactly the same thing, and the streamer object
  // is replaced on every ack during a burn. Subscribing to those objects
  // re-rendered the whole Inspector view four times a second at idle.
  it('ignores a status report that repeats what the controller already said', () => {
    act(() => useLaserStore.setState({ statusReport: statusReport() }));
    mount();
    const before = renders;

    act(() => useLaserStore.setState({ statusReport: statusReport(), statusSequence: 7 }));
    act(() => useLaserStore.setState({ statusReport: statusReport(), statusSequence: 8 }));

    expect(renders).toBe(before);
  });

  it('ignores a streamer replacement that changes nothing the view shows', () => {
    act(() => useLaserStore.setState({ streamer: streamer('streaming', 2) }));
    mount();
    const before = renders;

    act(() => useLaserStore.setState({ streamer: streamer('streaming', 2) }));

    expect(renders).toBe(before);
  });

  it('re-renders when the machine actually moves', () => {
    act(() => useLaserStore.setState({ statusReport: statusReport() }));
    mount();
    const before = renders;

    act(() =>
      useLaserStore.setState({ statusReport: statusReport({ wPos: { x: 9, y: 2, z: 3 } }) }),
    );

    expect(renders).toBeGreaterThan(before);
    expect(latest?.point).toEqual({ x: 9, y: 2, z: 3 });
  });

  it('re-renders when the run state changes', () => {
    act(() => useLaserStore.setState({ statusReport: statusReport() }));
    mount();
    const before = renders;

    act(() => useLaserStore.setState({ statusReport: statusReport({ state: 'Run' }) }));

    expect(renders).toBeGreaterThan(before);
    expect(latest?.state).toBe('Run');
  });

  it('re-renders as acknowledged lines advance', () => {
    act(() => useLaserStore.setState({ streamer: streamer('streaming', 1) }));
    mount();
    const before = renders;

    act(() => useLaserStore.setState({ streamer: streamer('streaming', 2) }));

    expect(renders).toBeGreaterThan(before);
    expect(latest?.progress).toEqual({ completed: 2, total: 3 });
    expect(latest?.streaming).toBe(true);
  });

  it('reports no position until the controller says one', () => {
    mount();

    expect(latest?.point).toBeNull();
    expect(latest?.streaming).toBe(false);
    expect(latest?.progress).toBeNull();
  });
});
