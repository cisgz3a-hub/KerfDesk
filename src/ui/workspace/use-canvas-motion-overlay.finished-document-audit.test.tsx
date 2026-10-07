import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completedRun } from '../laser/CompletedJobNotice.test-support';
import { LiveJobTimeBadge } from '../laser/LiveJobTimeBadge';
import * as executionTracking from '../laser/start-job-execution-tracking';
import { useCanvasViewStore } from '../state/canvas-view-store';
import { startLiveCanvasRun } from '../state/canvas-motion-plan';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import type * as IdlePlanModule from './idle-canvas-motion-plan';
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import { IDLE_CANVAS_PLAN_DELAY_MS, useCanvasMotionOverlay } from './use-canvas-motion-overlay';

const preparation = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('./idle-canvas-motion-plan', async (importOriginal) => ({
  ...(await importOriginal<typeof IdlePlanModule>()),
  buildIdleCanvasMotionPlanFromRequest: preparation.build,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let observed: CanvasMotionOverlay | null;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [svgObj('old-job', ['#000000'])] } },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  });
  useLaserStore.setState(initialLaserState());
  useCanvasViewStore.setState({ showGcode: false });
  preparation.build.mockReset().mockResolvedValue(null);
  observed = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(initialLaserState());
  useCanvasViewStore.setState({ showGcode: false });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function Harness() {
  const project = useStore((state) => state.project);
  observed = useCanvasMotionOverlay(project, false);
  return (
    <LiveJobTimeBadge
      estimate={{
        kind: 'estimated',
        label: '2m',
        totalSeconds: 120,
        breakdown: { cutSeconds: 100, travelSeconds: 20 },
      }}
    />
  );
}

describe('terminal display document ownership', () => {
  it('does not re-hash execution inputs for pointer movement or trailing terminal status', async () => {
    const old = completedRun();
    useLaserStore.setState({ liveCanvasRun: old });
    useCanvasViewStore.setState({ showGcode: true });
    await act(async () => root.render(<Harness />));
    const signature = vi.spyOn(executionTracking, 'currentReplayExecutionSignature');
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        useStore.getState().setCursorMm({ x: i, y: i });
        useLaserStore.setState({ liveCanvasRun: { ...old, reportedFeedMmPerMin: i } });
      }
    });
    expect(signature).not.toHaveBeenCalled();
    expect(useLaserStore.getState().liveCanvasRun?.plan).toBe(old.plan);
  });

  it('treats optional missing run snapshots as absent', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      const withoutRun = { ...useLaserStore.getState() };
      delete withoutRun.liveCanvasRun;
      useLaserStore.setState(withoutRun, true);
      useStore.getState().setProjectNotes('No prior live run');
      useLaserStore.setState({ liveCanvasRun: completedRun() });
    });
    expect(host.textContent).toBe('Complete');
  });

  it('retains completion when the current document has not changed', async () => {
    const old = completedRun();
    useLaserStore.setState({ liveCanvasRun: old });
    useCanvasViewStore.setState({ showGcode: true });
    await act(async () => root.render(<Harness />));
    await act(async () => {
      useStore.setState({ selectedObjectId: 'old-job' });
      await vi.advanceTimersByTimeAsync(IDLE_CANVAS_PLAN_DELAY_MS + 1);
    });
    expect(useLaserStore.getState().liveCanvasRun).toBe(old);
    expect(host.textContent).toBe('Complete');
  });

  it('preserves the active machine run when another document is opened', async () => {
    const active = startLiveCanvasRun(completedRun().plan);
    useLaserStore.setState({ liveCanvasRun: active });
    await act(async () => root.render(<Harness />));
    const previous = useStore.getState().project;
    await act(async () => {
      useStore.getState().setProject({
        ...previous,
        scene: { ...previous.scene, objects: [svgObj('different-job', ['#000000'])] },
      });
      await vi.advanceTimersByTimeAsync(IDLE_CANVAS_PLAN_DELAY_MS + 1);
    });
    expect(useLaserStore.getState().liveCanvasRun).toBe(active);
    expect(observed?.run).toBe(active);
  });

  it.each(['notes', 'machine labels'] as const)(
    'keeps the completed display through advisory %s edits',
    async (kind) => {
      const old = completedRun();
      useLaserStore.setState({ liveCanvasRun: old });
      useCanvasViewStore.setState({ showGcode: true });
      await act(async () => root.render(<Harness />));
      await act(async () => {
        if (kind === 'notes') useStore.getState().setProjectNotes('Job notes changed');
        else
          useStore.setState((state) => ({
            project: {
              ...state.project,
              device: { ...state.project.device, name: 'Named machine' },
            },
          }));
      });
      expect(useLaserStore.getState().liveCanvasRun).toBe(old);
      expect(host.textContent).toBe('Complete');
    },
  );

  it('uses the active run document when it finishes just after another document opens', async () => {
    const active = startLiveCanvasRun(completedRun().plan);
    useLaserStore.setState({ liveCanvasRun: active });
    await act(async () => root.render(<Harness />));
    const previous = useStore.getState().project;
    await act(async () => {
      useStore.getState().setProject({
        ...previous,
        scene: { ...previous.scene, objects: [svgObj('replacement-job', ['#000000'])] },
      });
      useLaserStore.setState({
        liveCanvasRun: { ...active, lifecycle: 'finished', timing: { kind: 'complete' } },
      });
    });
    expect(useLaserStore.getState().liveCanvasRun).toBeNull();
    expect(host.textContent).toBe('≈ 2m');
  });

  it.each(['G-code view covers the canvas', 'idle marker preparation cannot produce a plan'])(
    'retires an old completed display on Open when %s',
    async (scenario) => {
      const old = completedRun();
      useLaserStore.setState({ liveCanvasRun: old });
      if (scenario === 'G-code view covers the canvas') {
        useCanvasViewStore.setState({ showGcode: true });
      }
      await act(async () => root.render(<Harness />));
      expect(host.textContent).toBe('Complete');
      const previous = useStore.getState().project;
      await act(async () => {
        useStore.getState().setProject({
          ...previous,
          scene: { ...previous.scene, objects: [svgObj('different-job', ['#000000'])] },
        });
        useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
        await vi.advanceTimersByTimeAsync(IDLE_CANVAS_PLAN_DELAY_MS + 1);
      });
      const displayAfterOpen = useLaserStore.getState().liveCanvasRun;
      const textAfterOpen = host.textContent;
      const overlayAfterOpen = observed;
      // Drain the retained display before asserting so a regression cannot
      // leave another test's controller/UI lifecycle contaminated.
      await act(async () => useLaserStore.setState({ liveCanvasRun: null }));
      expect({ hasOldDisplay: displayAfterOpen === old, badge: textAfterOpen }).toEqual({
        hasOldDisplay: false,
        badge: '≈ 2m',
      });
      expect(overlayAfterOpen?.run).not.toBe(old);
    },
  );
});
