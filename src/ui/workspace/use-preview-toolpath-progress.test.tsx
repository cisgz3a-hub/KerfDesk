// S8-P3-3: a large CNC pocket can prepare for minutes in the worker. Preview
// passes the worker's progress into its "preparing" issue, so the banner can
// name the phase and count, and ignores a report that comes after the route.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import { createProject } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import type * as PreparationWorkerClient from './preparation-worker-client';
import { usePreviewToolpath, type PreviewBuildScheduler } from './use-preview-toolpath';

const previewMocks = vi.hoisted(() => ({ buildPreviewToolpath: vi.fn() }));
vi.mock('./draw-preview', () => previewMocks);

const workerMocks = vi.hoisted(() => ({ prepareLargeJobOffThread: vi.fn() }));
vi.mock('./preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof PreparationWorkerClient>()),
  prepareLargeJobOffThread: workerMocks.prepareLargeJobOffThread,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const project = createProject();
const builtToolpath = { totalLength: 1, steps: [] };
let host: HTMLDivElement;
let root: Root | null;
let probe: { current: ReturnType<typeof usePreviewToolpath> };

beforeEach(() => {
  resetStore();
  previewMocks.buildPreviewToolpath.mockReset();
  previewMocks.buildPreviewToolpath.mockReturnValue({
    totalLength: 0,
    steps: [],
    previewIssue: { kind: 'too-complex' as const },
  });
  workerMocks.prepareLargeJobOffThread.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  probe = { current: null };
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host.remove();
});

function Harness(props: { readonly scheduleBuild: PreviewBuildScheduler }): null {
  probe.current = usePreviewToolpath(project, true, props.scheduleBuild);
  return null;
}

describe('usePreviewToolpath while the worker prepares (S8-P3-3)', () => {
  it("shows the worker's progress, and never after the route arrives", async () => {
    let scheduled: (() => void) | null = null;
    const scheduleBuild: PreviewBuildScheduler = (work) => {
      scheduled = work;
      return () => undefined;
    };
    let resolveWorker: (value: { toolpath: unknown; estimate: unknown }) => void = () => undefined;
    workerMocks.prepareLargeJobOffThread.mockReturnValue(
      new Promise((resolve) => {
        resolveWorker = resolve;
      }),
    );
    await act(async () => root?.render(<Harness scheduleBuild={scheduleBuild} />));
    await act(async () => scheduled?.());
    const report = workerMocks.prepareLargeJobOffThread.mock.calls[0]?.[2] as (
      progress: OutputCompilationProgress,
    ) => void;
    const progress: OutputCompilationProgress = {
      phase: 'planning',
      mode: 'parallel',
      completed: 2,
      active: 1,
      queued: 2,
      total: 5,
    };

    await act(async () => report(progress));
    expect(probe.current?.previewIssue).toEqual({ kind: 'preparing-large-job', progress });

    await act(async () => {
      resolveWorker({ toolpath: builtToolpath, estimate: { kind: 'estimated' } });
    });
    await act(async () => report({ ...progress, phase: 'finalizing', completed: 5 }));
    expect(probe.current).toBe(builtToolpath);
  });
});
