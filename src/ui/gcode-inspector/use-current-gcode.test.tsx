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
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { createStreamer } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import {
  registerCanvasProgramRun,
  registerCanvasProgramSource,
} from '../state/canvas-program-source';
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

async function rerender(active: boolean): Promise<void> {
  await act(async () => {
    root?.render(
      <PlatformProvider adapter={mockPlatform()}>
        <Probe active={active} />
      </PlatformProvider>,
    );
  });
}

// What a store commit does: a spread replaces the project object identity
// while the view stays open.
async function commitAnEdit(): Promise<void> {
  await act(async () => {
    useStore.setState({ project: { ...useStore.getState().project } });
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

describe('useCurrentGcode', () => {
  it('shows the exact started program instead of recompiling during a run', async () => {
    useLaserStore.setState(liveInspectorState());
    await mount(true);
    const context = latest?.state.kind === 'ready' ? latest.state.context : null;
    await commitAnEdit();
    await act(async () => latest?.refresh());
    expect(compileCount()).toBe(0);
    expect(latest?.state).toMatchObject({ text: LIVE_PROGRAM, liveLifecycle: 'running' });
    expect(latest?.stale).toBe(false);
    expect(latest?.state.kind === 'ready' ? latest.state.context : null).toBe(context);
  });

  it('keeps the started program visible while its accepted queue drains', async () => {
    useLaserStore.setState(liveInspectorState(LIVE_PROGRAM, 'done'));
    await mount(true);
    expect(compileCount()).toBe(0);
    expect(latest?.state).toMatchObject({ text: LIVE_PROGRAM, programName: 'Running program' });
  });

  it('retains a finished program until Refresh returns to the current design', async () => {
    useLaserStore.setState({ liveCanvasRun: { ...liveInspectorRun(), lifecycle: 'finished' } });
    await mount(true);
    expect(latest?.state).toMatchObject({ text: LIVE_PROGRAM, liveLifecycle: 'finished' });
    await act(async () => latest?.refresh());
    expect(compileCount()).toBe(1);
    expect(latest?.state).toMatchObject({ text: 'G21 G90\nG1 X10 F600\n' });
  });

  it('does not substitute an older retained plan for a different active stream', async () => {
    useLaserStore.setState({
      liveCanvasRun: liveInspectorRun(),
      streamer: { ...createStreamer('G1 X50'), status: 'streaming' },
    });
    await mount(true);
    expect(compileCount()).toBe(1);
    expect(latest?.state).toMatchObject({ text: 'G21 G90\nG1 X10 F600\n' });
  });

  it.each(['marlin', 'smoothieware'] as const)(
    'uses the started %s power context even after the project changes',
    async (controllerKind) => {
      const state = liveInspectorState();
      const plan = {
        ...state.liveCanvasRun.plan,
        device: {
          ...state.liveCanvasRun.plan.device,
          controllerKind,
          gcodeDialect: { dialectId: 'marlin-fan' as const },
        },
      };
      registerCanvasProgramSource(plan, LIVE_PROGRAM);
      registerCanvasProgramRun(
        plan,
        state.streamer.queued,
        state.liveCanvasRun.startedAtMs,
        LIVE_PROGRAM,
      );
      useLaserStore.setState({ ...state, liveCanvasRun: { ...state.liveCanvasRun, plan } });
      useStore.setState({
        project: { ...useStore.getState().project, machine: DEFAULT_CNC_MACHINE_CONFIG },
      });
      await mount(true);
      expect(latest?.state).toMatchObject({
        kind: 'ready',
        text: LIVE_PROGRAM,
        context: {
          machineKind: 'laser',
          laserPowerControl: controllerKind === 'marlin' ? 'fan' : 'smoothieware',
        },
      });
      expect(compileCount()).toBe(0);
    },
  );

  it('cancels a design compilation when a live run takes over and ignores its late output', async () => {
    let lateOutput: ((name: string, text: string) => void) | undefined;
    let signal: AbortSignal | undefined;
    let finish: ((result: InspectCurrentGcodeResult) => void) | undefined;
    inspectMocks.handleInspectCurrentGcode.mockImplementationOnce(async (_ctx, open, options) => {
      lateOutput = open;
      signal = options?.signal;
      return await new Promise((resolve) => {
        finish = resolve;
      });
    });
    await mount(true);
    await act(async () => useLaserStore.setState(liveInspectorState()));
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      lateOutput?.('obsolete', 'G1 X999');
      finish?.({ kind: 'ready' });
    });
    expect(latest?.state).toMatchObject({ text: LIVE_PROGRAM, liveLifecycle: 'running' });
    expect(compileCount()).toBe(1);
  });

  it('compiles once when the view becomes active', async () => {
    await mount(true);
    expect(compileCount()).toBe(1);
    expect(latest?.state.kind).toBe('ready');
    expect(latest?.state).toMatchObject({
      context: { machineKind: 'laser', laserPowerControl: 'spindle' },
    });
    expect(latest?.stale).toBe(false);
  });

  it('carries CNC context from the compiled project into the preview', async () => {
    useStore.setState({
      project: { ...useStore.getState().project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    await mount(true);
    expect(latest?.state).toMatchObject({ kind: 'ready', context: { machineKind: 'cnc' } });
  });

  it('does not compile while the view is hidden', async () => {
    await mount(false);
    expect(compileCount()).toBe(0);
    expect(latest?.state.kind).toBe('idle');
  });

  it('does not recompile on every edit — it marks the program stale instead', async () => {
    await mount(true);
    expect(compileCount()).toBe(1);

    await commitAnEdit();
    await commitAnEdit();
    await commitAnEdit();

    expect(compileCount()).toBe(1);
    expect(latest?.stale).toBe(true);
    expect(latest?.state.kind).toBe('ready');
  });

  it('recompiles when the operator asks, clearing stale', async () => {
    await mount(true);
    await commitAnEdit();
    expect(latest?.stale).toBe(true);

    await act(async () => latest?.refresh());

    expect(compileCount()).toBe(2);
    expect(latest?.stale).toBe(false);
  });

  it('recompiles when the view is re-opened after an edit', async () => {
    await mount(true);
    await commitAnEdit();
    await rerender(false);
    expect(compileCount()).toBe(1);

    await rerender(true);

    expect(compileCount()).toBe(2);
    expect(latest?.stale).toBe(false);
  });

  it('cancels stale background compilation when the design changes', async () => {
    let observedSignal: AbortSignal | undefined;
    inspectMocks.handleInspectCurrentGcode.mockImplementation(
      async (
        _ctx: unknown,
        _openInspector: (programName: string, text: string) => void,
        options?: InspectCurrentGcodeOptions,
      ) => {
        observedSignal = options?.signal;
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener('abort', () => resolve()),
        );
        return { kind: 'cancelled' as const };
      },
    );
    await mount(true);
    expect(latest?.state.kind).toBe('compiling');

    await commitAnEdit();

    expect(observedSignal?.aborted).toBe(true);
    expect(latest?.state.kind).toBe('stale');
    expect(latest?.stale).toBe(true);
    expect(compileCount()).toBe(1);
  });

  it('surfaces background compiler progress and unavailable state', async () => {
    let finish:
      | ((value: { readonly kind: 'unavailable'; readonly message: string }) => void)
      | null = null;
    inspectMocks.handleInspectCurrentGcode.mockImplementation(
      async (
        _ctx: unknown,
        _openInspector: (programName: string, text: string) => void,
        options?: InspectCurrentGcodeOptions,
      ) => {
        options?.onProgress?.({
          phase: 'planning',
          mode: 'parallel',
          completed: 2,
          active: 2,
          queued: 3,
          total: 7,
        });
        return await new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    await mount(true);
    expect(latest?.state).toMatchObject({
      kind: 'compiling',
      progress: { phase: 'planning', completed: 2, total: 7 },
    });

    await act(async () =>
      finish?.({ kind: 'unavailable', message: 'Worker capacity unavailable.' }),
    );

    expect(latest?.state).toEqual({
      kind: 'unavailable',
      reason: 'Worker capacity unavailable.',
    });
  });
});
