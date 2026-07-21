import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { usePreviewToolpath, type PreviewBuildScheduler } from './use-preview-toolpath';

function idleReport(x: number, y: number): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: { x, y, z: 0 },
    feed: 0,
    spindle: 0,
    wco: null,
  };
}

const previewMocks = vi.hoisted(() => ({
  buildPreviewToolpath: vi.fn(),
}));

vi.mock('./draw-preview', () => previewMocks);

const workerMocks = vi.hoisted(() => ({
  prepareLargeJobOffThread: vi.fn(),
}));

vi.mock('./preparation-worker-client', () => workerMocks);

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const builtToolpath = {
  totalLength: 1,
  steps: [
    {
      kind: 'cut' as const,
      color: '#000000',
      length: 1,
      polyline: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    },
  ],
};
const project = createProject();

let host: HTMLDivElement;
let root: Root | null;
let probe: { current: ReturnType<typeof usePreviewToolpath> };

beforeEach(() => {
  resetStore();
  previewMocks.buildPreviewToolpath.mockReset();
  previewMocks.buildPreviewToolpath.mockReturnValue(builtToolpath);
  workerMocks.prepareLargeJobOffThread.mockReset();
  workerMocks.prepareLargeJobOffThread.mockReturnValue(null);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  probe = { current: null };
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host.remove();
});

describe('usePreviewToolpath', () => {
  it('schedules preview preparation outside render', async () => {
    let scheduled: (() => void) | null = null;
    const scheduleBuild: PreviewBuildScheduler = (work) => {
      scheduled = work;
      return () => {
        scheduled = null;
      };
    };

    await renderHarness(true, scheduleBuild);

    expect(probe.current).toBeNull();
    expect(previewMocks.buildPreviewToolpath).not.toHaveBeenCalled();

    await act(async () => scheduled?.());

    expect(previewMocks.buildPreviewToolpath).toHaveBeenCalledOnce();
    expect(probe.current).toBe(builtToolpath);
  });

  it('does not reschedule a build on a status poll that resolves to the same placement [PRF-02]', async () => {
    const scheduleBuild = vi.fn((_work: () => void) => () => undefined);
    act(() => useLaserStore.setState({ statusReport: idleReport(0, 0) }));

    await renderHarness(true, scheduleBuild);
    expect(scheduleBuild).toHaveBeenCalledTimes(1);

    // A fresh poll stores a new report object with a different position; in the
    // default 'absolute' mode the resolved placement is unchanged, so the
    // preview must NOT rebuild (this fired 4x/s before PRF-02).
    await act(async () => useLaserStore.setState({ statusReport: idleReport(40, 25) }));
    expect(scheduleBuild).toHaveBeenCalledTimes(1);
  });

  it('reschedules a build when the head moves in current-position mode [PRF-02]', async () => {
    const scheduleBuild = vi.fn((_work: () => void) => () => undefined);
    act(() => {
      useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
      useLaserStore.setState({ statusReport: idleReport(0, 0) });
    });

    await renderHarness(true, scheduleBuild);
    const afterMount = scheduleBuild.mock.calls.length;

    // The origin tracks the head, so a moved position is a legitimate rebuild.
    await act(async () => useLaserStore.setState({ statusReport: idleReport(40, 25) }));
    expect(scheduleBuild.mock.calls.length).toBeGreaterThan(afterMount);
  });

  it('builds a User Origin preview before the machine origin is set', async () => {
    let scheduled: (() => void) | null = null;
    const scheduleBuild: PreviewBuildScheduler = (work) => {
      scheduled = work;
      return () => undefined;
    };
    act(() => useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'center' } }));

    await renderHarness(true, scheduleBuild);
    await act(async () => scheduled?.());

    expect(previewMocks.buildPreviewToolpath).toHaveBeenCalledWith(
      project,
      expect.objectContaining({
        jobOrigin: { startFrom: 'user-origin', anchor: 'center' },
      }),
    );
    expect(probe.current).toBe(builtToolpath);
  });

  it('cancels stale scheduled preparation when preview exits', async () => {
    let scheduled: (() => void) | null = null;
    const scheduleBuild: PreviewBuildScheduler = (work) => {
      scheduled = work;
      return () => undefined;
    };

    await renderHarness(true, scheduleBuild);
    await renderHarness(false, scheduleBuild);
    await act(async () => scheduled?.());

    expect(previewMocks.buildPreviewToolpath).not.toHaveBeenCalled();
    expect(probe.current).toBeNull();
  });

  it('fills a paused over-budget preview in from the preparation worker (ADR-244)', async () => {
    let scheduled: (() => void) | null = null;
    const scheduleBuild: PreviewBuildScheduler = (work) => {
      scheduled = work;
      return () => undefined;
    };
    const pausedToolpath = {
      totalLength: 0,
      steps: [],
      previewIssue: { kind: 'too-complex' as const },
    };
    previewMocks.buildPreviewToolpath.mockReturnValue(pausedToolpath);
    let resolveWorker: (value: { toolpath: unknown; estimate: unknown }) => void = () => undefined;
    workerMocks.prepareLargeJobOffThread.mockReturnValue(
      new Promise((resolve) => {
        resolveWorker = resolve;
      }),
    );

    await renderHarness(true, scheduleBuild);
    await act(async () => scheduled?.());

    expect(
      (probe.current as { readonly previewIssue?: { kind: string } } | null)?.previewIssue,
    ).toEqual({ kind: 'preparing-large-job' });

    await act(async () => {
      resolveWorker({ toolpath: builtToolpath, estimate: { kind: 'estimated' } });
    });
    expect(probe.current).toBe(builtToolpath);
  });

  it('keeps the paused banner when workers are unavailable', async () => {
    let scheduled: (() => void) | null = null;
    const scheduleBuild: PreviewBuildScheduler = (work) => {
      scheduled = work;
      return () => undefined;
    };
    const pausedToolpath = {
      totalLength: 0,
      steps: [],
      previewIssue: { kind: 'too-complex' as const },
    };
    previewMocks.buildPreviewToolpath.mockReturnValue(pausedToolpath);
    workerMocks.prepareLargeJobOffThread.mockReturnValue(null);

    await renderHarness(true, scheduleBuild);
    await act(async () => scheduled?.());

    expect(probe.current).toBe(pausedToolpath);
  });
});

async function renderHarness(
  previewMode: boolean,
  scheduleBuild: PreviewBuildScheduler,
): Promise<void> {
  await act(async () => {
    root?.render(<Harness previewMode={previewMode} scheduleBuild={scheduleBuild} />);
  });
}

function Harness(props: {
  readonly previewMode: boolean;
  readonly scheduleBuild: PreviewBuildScheduler;
}): JSX.Element | null {
  probe.current = usePreviewToolpath(project, props.previewMode, props.scheduleBuild);
  return null;
}
