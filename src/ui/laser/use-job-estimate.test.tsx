import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import type { LiveJobEstimate } from './live-job-estimate';
import { JOB_ESTIMATE_DEBOUNCE_MS, useJobEstimate } from './use-job-estimate';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function lineProject(): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 50, y: 10 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: '#000000', color: '#000000' })),
  };
}

const probe: { current: LiveJobEstimate | null } = { current: null };

function Probe(): null {
  probe.current = useJobEstimate();
  return null;
}

async function renderProbe(): Promise<() => Promise<void>> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<Probe />);
  });
  return async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  probe.current = null;
});

afterEach(() => {
  useStore.getState().newProject();
  vi.useRealTimers();
});

describe('useJobEstimate debounce (H16)', () => {
  it('computes the first estimate synchronously on mount', async () => {
    useStore.setState({ project: lineProject() });
    const unmount = await renderProbe();

    expect(probe.current?.kind).toBe('estimated');

    await unmount();
  });

  it('does not recompute during rapid project mutations (drag), then settles after the quiet period', async () => {
    useStore.setState({ project: lineProject() });
    const unmount = await renderProbe();
    const initial = probe.current;

    // Simulate a drag: many project identity changes in quick succession.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        useStore.setState({ project: { ...useStore.getState().project } });
        vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS / 2);
      });
    }
    // Mid-drag: the settled estimate object is unchanged (no recompute).
    expect(probe.current).toBe(initial);

    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
    });
    // After the quiet period the estimate re-settles on the latest project.
    expect(probe.current).not.toBe(initial);
    expect(probe.current?.kind).toBe('estimated');

    await unmount();
  });

  it('reflects a meaningful scene change after the debounce window', async () => {
    const unmount = await renderProbe();
    expect(probe.current?.kind).toBe('empty');

    await act(async () => {
      useStore.setState({ project: lineProject() });
    });
    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
    });

    expect(probe.current?.kind).toBe('estimated');

    await unmount();
  });
});
