import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { usePreviewToolpath, type PreviewBuildScheduler } from './use-preview-toolpath';

const previewMocks = vi.hoisted(() => ({
  buildPreviewToolpath: vi.fn(),
}));

vi.mock('./draw-preview', () => previewMocks);

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
