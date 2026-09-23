import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { StatusReport } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import type * as LiveJobEstimateModule from './live-job-estimate';
import { JOB_ESTIMATE_DEBOUNCE_MS, useJobEstimate } from './use-job-estimate';

const spies = vi.hoisted(() => ({ estimateLiveJob: vi.fn() }));
vi.mock('./live-job-estimate', async (importOriginal) => {
  const actual = await importOriginal<typeof LiveJobEstimateModule>();
  spies.estimateLiveJob.mockImplementation(actual.estimateLiveJob);
  return { ...actual, estimateLiveJob: spies.estimateLiveJob };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe(): null {
  useJobEstimate();
  return null;
}

function lineProject(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  spies.estimateLiveJob.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => useStore.getState().newProject());
  act(() => useLaserStore.setState({ statusReport: null }));
  vi.useRealTimers();
});

describe('useJobEstimate memoization', () => {
  it('computes one synchronous estimate per project for two mounted consumers', () => {
    // Workspace and the job action controls both mount the hook. Before the
    // memo each ran its own estimate after every edit (ADR-346).
    act(() => {
      root.render(
        <>
          <Probe />
          <Probe />
        </>,
      );
    });
    const mountCalls = spies.estimateLiveJob.mock.calls.length;
    expect(mountCalls).toBeLessThanOrEqual(1);

    act(() => {
      useStore.getState().setProject(lineProject());
    });
    act(() => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
    });
    expect(spies.estimateLiveJob.mock.calls.length - mountCalls).toBe(1);
  });

  it('reuses a recent head position but does not keep one estimate per position', () => {
    act(() => {
      useStore.getState().setProject(lineProject());
    });
    act(() => {
      root.render(<Probe />);
    });
    const settleHeadAt = (x: number): void => {
      act(() => {
        useLaserStore.setState({ statusReport: idleAt(x) });
      });
      act(() => {
        vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
      });
    };
    for (const x of [0, 10, 20, 30, 40]) settleHeadAt(x);
    const calls = spies.estimateLiveJob.mock.calls.length;

    settleHeadAt(30);
    expect(spies.estimateLiveJob.mock.calls.length).toBe(calls);
    settleHeadAt(0);
    expect(spies.estimateLiveJob.mock.calls.length).toBe(calls + 1);
  });
});

function idleAt(x: number): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y: 0, z: 0 },
    wPos: null,
    feed: 0,
    spindle: 0,
    wco: null,
  };
}
