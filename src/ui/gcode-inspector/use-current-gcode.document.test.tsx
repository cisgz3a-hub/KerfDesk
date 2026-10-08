import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { PlatformProvider } from '../app/platform-context';
import type {
  InspectCurrentGcodeOptions,
  InspectCurrentGcodeResult,
} from '../app/inspect-current-gcode-action';
import { useStore } from '../state';
import { useCurrentGcode, type CurrentGcode } from './use-current-gcode';
import { createProject } from '../../core/scene';
import { createStreamer } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { liveCanvasStartPatch } from '../state/live-canvas-run';
import { LIVE_PROGRAM, liveInspectorRun, liveInspectorState } from './inspector-live-test-fixture';

type InspectCurrentGcodeMock = (
  ctx: unknown,
  openInspector: (programName: string, text: string) => void,
  options?: InspectCurrentGcodeOptions,
) => Promise<InspectCurrentGcodeResult>;

const inspectMocks = vi.hoisted(() => ({
  handleInspectCurrentGcode: vi.fn<InspectCurrentGcodeMock>(
    async (_ctx: unknown, openInspector: (programName: string, text: string) => void) => {
      openInspector('untitled (current canvas)', 'G21 G90\nG1 X10 F600\n');
      return { kind: 'ready' as const };
    },
  ),
}));

vi.mock('../app/inspect-current-gcode-action', () => ({
  handleInspectCurrentGcode: inspectMocks.handleInspectCurrentGcode,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = {
  readonly state: CurrentGcode;
  readonly stale: boolean;
  readonly refresh: () => void;
  readonly followingRun: boolean;
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: HookResult | null = null;

function Probe(props: { readonly active: boolean }): null {
  latest = useCurrentGcode(props.active);
  return null;
}

async function mount(active: boolean): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <PlatformProvider adapter={mockPlatform()}>
        <Probe active={active} />
      </PlatformProvider>,
    );
  });
}

function compileCount(): number {
  return inspectMocks.handleInspectCurrentGcode.mock.calls.length;
}

beforeEach(() => {
  useStore.getState().newProject();
  useStore.setState({ project: createProject() });
  inspectMocks.handleInspectCurrentGcode.mockReset();
  inspectMocks.handleInspectCurrentGcode.mockImplementation(
    async (_ctx: unknown, openInspector: (programName: string, text: string) => void) => {
      openInspector('untitled (current canvas)', 'G21 G90\nG1 X10 F600\n');
      return { kind: 'ready' as const };
    },
  );
  latest = null;
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
});

describe('useCurrentGcode document ownership', () => {
  it('follows a fresh execution that reuses a finished plan dismissed by Refresh', async () => {
    const previous = liveInspectorRun();
    const started = liveCanvasStartPatch(previous.plan, 1234).liveCanvasRun;
    if (started == null) throw new Error('Started plan missing');
    useLaserStore.setState({ liveCanvasRun: { ...started, lifecycle: 'finished' } });
    await mount(true);
    await act(async () => latest?.refresh());
    expect(latest?.followingRun).toBe(false);
    expect(compileCount()).toBe(1);

    const streamer = { ...createStreamer(LIVE_PROGRAM), status: 'streaming' as const };
    await act(async () => {
      useLaserStore.setState({
        streamer,
        ...liveCanvasStartPatch(
          previous.plan,
          5678,
          undefined,
          'running',
          streamer.queued,
          LIVE_PROGRAM,
        ),
      });
    });

    expect(useLaserStore.getState().liveCanvasRun?.startedAtMs).toBe(5678);
    expect(latest?.followingRun).toBe(true);
    expect(latest?.state).toMatchObject({ text: LIVE_PROGRAM, liveLifecycle: 'running' });
    await act(async () => latest?.refresh());
    expect(latest?.followingRun).toBe(true);
    expect(latest?.state).toMatchObject({ text: LIVE_PROGRAM, liveLifecycle: 'running' });
    expect(compileCount()).toBe(1);
  });

  it('rejects a previous finished document on a fresh Inspector mount after identical Open', async () => {
    const previous = liveInspectorRun();
    const started = liveCanvasStartPatch(previous.plan, 1234).liveCanvasRun;
    if (started == null) throw new Error('Started plan missing');
    useLaserStore.setState({ liveCanvasRun: { ...started, lifecycle: 'finished' } });
    const project = useStore.getState().project;
    const documentEpoch = useStore.getState().projectDocumentEpoch;
    useStore.getState().setProject(project);
    expect(useStore.getState().projectDocumentEpoch).toBe(documentEpoch + 1);

    await mount(true);

    expect(useLaserStore.getState().liveCanvasRun).toBeNull();
    expect(latest?.followingRun).toBe(false);
    expect(latest?.state).toMatchObject({ text: 'G21 G90\nG1 X10 F600\n' });
    expect(latest?.state).not.toHaveProperty('liveLifecycle');
    expect(compileCount()).toBe(1);
  });

  it('retires finished bytes when selected output becomes empty without idle preparation', async () => {
    useLaserStore.setState({ liveCanvasRun: { ...liveInspectorRun(), lifecycle: 'finished' } });
    await mount(true);
    expect(latest?.state).toMatchObject({ text: LIVE_PROGRAM, liveLifecycle: 'finished' });

    await act(async () => {
      useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });
      useStore.getState().selectObject(null);
    });

    expect(useLaserStore.getState().liveCanvasRun).toBeNull();
    expect(latest?.followingRun).toBe(false);
    expect(latest?.state).not.toHaveProperty('liveLifecycle');
  });

  it('keeps owned running bytes and context visible across New', async () => {
    const execution = liveInspectorState();
    const patch = liveCanvasStartPatch(
      execution.liveCanvasRun.plan,
      1234,
      undefined,
      'running',
      execution.streamer.queued,
      LIVE_PROGRAM,
    );
    useLaserStore.setState({ ...execution, ...patch });
    await mount(true);

    await act(async () => useStore.getState().newProject());

    expect(latest?.followingRun).toBe(true);
    expect(latest?.state).toMatchObject({ text: LIVE_PROGRAM, liveLifecycle: 'running' });
    expect(compileCount()).toBe(0);
  });

  it.each(['New', 'identical Open'] as const)(
    'retires compiled design bytes at %s while the next document is compiling',
    async (boundary) => {
      await mount(true);
      expect(latest?.state).toMatchObject({ kind: 'ready' });
      inspectMocks.handleInspectCurrentGcode.mockImplementationOnce(
        async (_ctx, _openInspector, options) => {
          await new Promise<void>((resolve) =>
            options?.signal?.addEventListener('abort', () => resolve()),
          );
          return { kind: 'cancelled' };
        },
      );
      const sameProject = useStore.getState().project;
      await act(async () => {
        if (boundary === 'New') useStore.getState().newProject();
        else useStore.getState().setProject(sameProject);
      });

      expect(compileCount()).toBe(2);
      expect(latest?.state.kind).toBe('compiling');
      expect(latest?.state).not.toHaveProperty('text');
      expect(latest?.state).not.toHaveProperty('liveLifecycle');
    },
  );

  it('rejects old worker publication during an identical Open before React cancellation runs', async () => {
    let publishOld: ((name: string, text: string) => void) | undefined;
    let progressOld: InspectCurrentGcodeOptions['onProgress'];
    let finishOld: ((result: InspectCurrentGcodeResult) => void) | undefined;
    let signal: AbortSignal | undefined;
    inspectMocks.handleInspectCurrentGcode.mockImplementationOnce(async (_ctx, open, options) => {
      publishOld = open;
      progressOld = options?.onProgress;
      signal = options?.signal;
      return await new Promise((resolve) => {
        finishOld = resolve;
      });
    });
    await mount(true);
    const project = useStore.getState().project;
    let publishedBeforeAbort = false;
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.projectDocumentEpoch === previous.projectDocumentEpoch) return;
      publishedBeforeAbort = signal?.aborted === false;
      publishOld?.('obsolete document', 'G1 X999');
      progressOld?.({
        phase: 'planning',
        mode: 'parallel',
        completed: 1,
        active: 0,
        queued: 0,
        total: 1,
      });
      finishOld?.({ kind: 'failed', message: 'obsolete failure' });
    });
    try {
      await act(async () => useStore.getState().setProject(project));
    } finally {
      unsubscribe();
    }

    expect(publishedBeforeAbort).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(compileCount()).toBe(2);
    expect(latest?.state).toMatchObject({ text: 'G21 G90\nG1 X10 F600\n' });
    expect(latest?.state).not.toHaveProperty('programName', 'obsolete document');
    expect(latest?.state).not.toHaveProperty('reason', 'obsolete failure');
    expect(latest?.stale).toBe(false);
  });
});
