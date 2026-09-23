import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { createStreamer } from '../../core/controllers/grbl/streamer';
import { createProject, type Project } from '../../core/scene';
import { useJobEstimate } from '../laser/use-job-estimate';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { useCanvasMotionOverlay } from './use-canvas-motion-overlay';
import { usePreviewToolpath } from './use-preview-toolpath';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const original = useLaserStore.getState();
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let renders = 0;

beforeEach(() => {
  resetStore();
  renders = 0;
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  useLaserStore.setState(original, true);
  resetStore();
});

function runReport(x: number): StatusReport {
  return {
    state: 'Run',
    subState: null,
    mPos: { x, y: 3, z: 0 },
    wPos: { x, y: 3, z: 0 },
    feed: 1200,
    spindle: 400,
    wco: null,
  };
}

// The laser-store subscriptions Workspace mounts, outside Preview.
function WorkspaceHooks(props: { readonly project: Project }): null {
  renders += 1;
  usePreviewToolpath(props.project, false, () => () => undefined);
  useCanvasMotionOverlay(props.project, false);
  useJobEstimate();
  return null;
}

describe('Workspace laser-store subscriptions during a streamed job', () => {
  it.each(['absolute', 'current-position', 'user-origin'] as const)(
    'do not re-render per status poll or per acknowledged line (%s)',
    async (startFrom) => {
      const project = createProject();
      useStore.setState({ project, jobPlacement: { startFrom, anchor: 'front-left' } });
      useLaserStore.setState({
        ...initialLaserState(),
        connection: { kind: 'connected' },
        statusReport: { ...runReport(0), state: 'Idle' },
      });
      host = document.createElement('div');
      document.body.appendChild(host);
      await act(async () => {
        root = createRoot(host as HTMLDivElement);
        root.render(<WorkspaceHooks project={project} />);
      });
      // Start, and the first Run report, legitimately change what the hooks show.
      const streamer = { ...createStreamer('G1 X1\nG1 X2'), status: 'streaming' as const };
      await act(async () => useLaserStore.setState({ streamer, statusReport: runReport(0) }));
      const beforeRun = renders;

      for (let poll = 1; poll <= 40; poll += 1) {
        await act(async () => useLaserStore.setState({ statusReport: runReport(poll * 7) }));
      }
      const stringify = vi.spyOn(JSON, 'stringify');
      for (let ack = 1; ack <= 300; ack += 1) {
        await act(async () =>
          useLaserStore.setState({
            streamer: { ...streamer, completed: ack },
            pendingUntrackedAcks: ack % 2,
          }),
        );
      }

      expect(renders).toBe(beforeRun);
      expect(stringify).not.toHaveBeenCalled();
    },
  );
});
