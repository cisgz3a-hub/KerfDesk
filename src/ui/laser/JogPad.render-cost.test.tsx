import { Profiler, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { JogPad } from './JogPad';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function runAt(x: number): StatusReport {
  return {
    state: 'Run',
    subState: null,
    mPos: { x, y: 0, z: 0 },
    wPos: null,
    feed: 3000,
    spindle: 0,
    wco: null,
  };
}

afterEach(() => {
  useLaserStore.setState({ statusReport: null });
});

// A running job disables the pad and moves the head four times a second. The
// pad reads the position only to aim a continuous jog, which a disabled pad
// cannot start, so those polls must not re-render the jog panel (ADR-352).
describe('JogPad during a job', () => {
  it('does not re-render the disabled pad on status polls', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let commits = 0;
    await act(async () => {
      root.render(
        <Profiler id="jog" onRender={() => (commits += 1)}>
          <JogPad disabled />
        </Profiler>,
      );
    });
    const afterMount = commits;

    for (let poll = 1; poll <= 8; poll += 1) {
      await act(async () => useLaserStore.setState({ statusReport: runAt(poll) }));
    }

    expect(commits - afterMount).toBe(0);
    await act(async () => root.unmount());
    host.remove();
  });
});
