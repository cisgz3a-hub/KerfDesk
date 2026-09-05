// End-to-end regression cases from the feature code-quality audit.
// Real controller store and dialog shortcuts; transport and WebGL are simulated.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../core/scene';
import { createStreamer, step } from '../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../platform/types';
import { useLaserStore } from '../ui/state/laser-store';
import { useStore } from '../ui/state/store';
import { respondToTestGrblHandshake } from '../ui/state/laser-test-start-helpers';
import { dispatchPositionLaser } from '../ui/workspace/position-laser-click';
import { InspectorView } from '../ui/gcode-inspector/InspectorView';
import { inspectGcodeText } from '../ui/gcode-inspector/gcode-inspector-parse';
import type * as Viewer3dModule from '../ui/viewer3d';
import type * as ExecutionTrackingModule from '../ui/laser/start-job-execution-tracking';
import { transmitPreparedStart } from '../ui/laser/start-job-transmission';
import { cancelVariableStreamAdvancement } from '../ui/laser/variable-stream-advancement';
import { Cnc3DFullPage } from '../ui/workspace/Cnc3DFullPage';
import { PlatformProvider } from '../ui/app/platform-context';
import { useShortcuts } from '../ui/app/use-shortcuts';
import { useUiStore } from '../ui/state/ui-store';

const mocks = vi.hoisted(() => ({ createScene: vi.fn(), activate: vi.fn() }));
vi.mock('../ui/viewer3d', async (load) => ({
  ...(await load<typeof Viewer3dModule>()),
  createViewer3dScene: mocks.createScene,
}));
vi.mock('../ui/laser/start-job-execution-tracking', async (load) => ({
  ...(await load<typeof ExecutionTrackingModule>()),
  activateAcceptedFreshRun: mocks.activate,
}));
vi.mock('../ui/workspace/use-cnc-3d-scene', () => ({
  cnc3dPaneDisplayResolution: () => ({ reason: null }),
  useCnc3dScene: () => ({
    canvasRef: { current: null },
    state: 'ready',
    controls: {
      setDisplayMode: vi.fn(),
      setSectionFraction: vi.fn(),
      capturePng: vi.fn(),
      probeAt: vi.fn(),
    },
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const initialLaser = useLaserStore.getState();
const initialApp = useStore.getState();
const initialUi = useUiStore.getState();
let closePhysical: (() => void) | null = null;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function fakeConnection(writes: string[]) {
  const lines = new Set<(line: string) => void>();
  const closes = new Set<() => void>();
  const emitLine = (line: string) => {
    for (const handler of lines) handler(line);
  };
  const connection: SerialConnection & { emitLine: typeof emitLine } = {
    write: async (data) => {
      if (useLaserStore.getState().controllerOperation?.kind === 'connection-handshake') {
        respondToTestGrblHandshake(data, emitLine);
        return;
      }
      writes.push(data);
    },
    onLine: (handler) => {
      lines.add(handler);
      return () => lines.delete(handler);
    },
    onClose: (handler) => {
      closes.add(handler);
      return () => closes.delete(handler);
    },
    close: async () => undefined,
    emitLine,
  };
  closePhysical = () => {
    for (const handler of [...closes]) handler();
  };
  return connection;
}
async function connect(writes: string[]) {
  const connection = fakeConnection(writes);
  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
  await useLaserStore.getState().connect(adapter);
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  writes.length = 0;
  return connection;
}
beforeEach(() => {
  useStore.setState({ project: createProject() });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  cancelVariableStreamAdvancement();
  closePhysical?.();
  closePhysical = null;
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaser, true);
  useStore.setState(initialApp, true);
  useUiStore.setState(initialUi, true);
  vi.restoreAllMocks();
});

describe('feature controller and workspace regressions', () => {
  it('retires acknowledged G92 work when its physical port closes', async () => {
    const connection = await connect([]);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().wcoCache).toBeNull();
    vi.useFakeTimers();
    const pending = useLaserStore
      .getState()
      .setOriginHere()
      .catch((error: unknown) => error);
    await flush();
    connection.emitLine('ok');
    await flush();
    expect(useLaserStore.getState().controllerOperation?.kind).toBe('interactive-command');
    const oldEpoch = useLaserStore.getState().controllerSessionEpoch;
    closePhysical?.();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().controllerSessionEpoch).toBeGreaterThan(oldEpoch);
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    const retired = useLaserStore.getState();
    await vi.advanceTimersByTimeAsync(60);
    expect(await pending).toBeInstanceOf(Error);
    expect(useLaserStore.getState()).toBe(retired);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().workOriginSource).toBe('none');
    expect(useLaserStore.getState().workOriginActive).toBe(false);
  });

  it('converts a canvas machine target independently of the active work offset', async () => {
    const writes: string[] = [];
    const connection = await connect(writes);
    const project = createProject();
    const device = { ...project.device, origin: 'rear-left' as const };
    useStore.setState({ project: { ...project, device } });
    connection.emitLine('<Idle|MPos:50.000,70.000,0.000|WCO:40.000,50.000,0.000|FS:0,0>');
    dispatchPositionLaser({ x: 100, y: 100 }, device);
    await flush();
    const jog = writes.find((line) => line.startsWith('$J='));
    expect(jog).toBe('$J=G91 G21 X50.000 Y30.000 F3000\n');
  });

  it('preserves the replacement controller origin after an old G92 finishes', async () => {
    const original = await connect([]);
    original.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');
    vi.useFakeTimers();
    const pending = useLaserStore
      .getState()
      .setOriginHere()
      .catch((error: unknown) => error);
    await flush();
    original.emitLine('ok');
    await flush();
    closePhysical?.();
    const replacement = await connect([]);
    replacement.emitLine('<Idle|MPos:50.000,70.000,0.000|WCO:40.000,50.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 40, y: 50, z: 0 });
    const replacementState = useLaserStore.getState();
    await vi.advanceTimersByTimeAsync(60);
    expect(await pending).toBeInstanceOf(Error);
    expect(useLaserStore.getState()).toBe(replacementState);
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 40, y: 50, z: 0 });
  });

  it('applies the latest travel visibility when the asynchronous scene becomes ready', async () => {
    const scene = deferred<Viewer3dModule.Viewer3dSceneResult>();
    mocks.createScene.mockReturnValue(scene.promise);
    const program = 'G21 G90\nM3 S500\nG0 X10 Y0\nG1 X20 Y0 F600';
    const result = inspectGcodeText(program);
    if (result.parsed.kind !== 'ok' || result.analysis === null)
      throw new Error('fixture parse failed');
    const model = result.parsed.model;
    const analysis = result.analysis;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const setTravelVisible = vi.fn();
    const handle: Viewer3dModule.Viewer3dSceneHandle = {
      setSegments: vi.fn(),
      fitToBounds: vi.fn(),
      setTravelVisible,
      setPlayhead: vi.fn(),
      setLiveMachine: vi.fn(),
      recolor: vi.fn(),
      setView: vi.fn(),
      captureImage: vi.fn(() => ''),
      setDirectionArrows: vi.fn(),
      resize: vi.fn(),
      requestRender: vi.fn(),
      dispose: vi.fn(),
    };
    try {
      await act(async () =>
        root.render(
          <InspectorView
            model={model}
            analysis={analysis}
            source={{ kind: 'text', text: program }}
            sourceIndex={result.sourceIndex}
          />,
        ),
      );
      const toggle = [...host.querySelectorAll('input')].find(
        (input) => input.title === 'Show or hide the non-cutting moves between shapes',
      );
      if (!toggle) throw new Error('travel control missing');
      await act(async () => toggle.click());
      expect(toggle.checked).toBe(false);
      await act(async () => {
        scene.resolve({ kind: 'ok', handle });
        await flush();
      });
      expect(host.querySelector('[data-viewer-state]')?.getAttribute('data-viewer-state')).toBe(
        'ready',
      );
      expect(toggle.checked).toBe(false);
      expect(setTravelVisible).toHaveBeenLastCalledWith(false);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('advances variables when terminal completion precedes recovery activation', async () => {
    const activation = deferred<undefined>();
    mocks.activate.mockReturnValue(activation.promise);
    const project = createProject();
    const withVariables = {
      ...project,
      variables: { ...project.variables, advancement: 'after-successful-stream' },
    } as typeof project;
    const advance = vi.fn();
    useStore.setState({ project: withVariables, advanceVariablesAfter: advance });
    const started = step(createStreamer('G1 X1')).state;
    const startJob = vi.fn(async () => {
      useLaserStore.setState((state) => ({
        streamer: started,
        activeRunId: 'audit-variable-run' as NonNullable<typeof state.activeRunId>,
        streamerEpoch: state.streamerEpoch + 1,
      }));
    });
    const args = {
      project: withVariables,
      prepared: { gcode: 'G1 X1', prepared: {}, canvasPlan: {} },
      machineKind: 'laser',
      laser: {},
      completedReceipt: null,
      checkpointToReplace: null,
      repository: {},
      reviewedAtIso: new Date().toISOString(),
      reviewModel: {},
    };
    const pending = transmitPreparedStart({
      args,
      runId: 'audit-variable-run',
      staged: true,
      handoffArmed: true,
      authorizationArgs: {},
      authorization: { ok: true, laser: { startJob } },
    } as unknown as Parameters<typeof transmitPreparedStart>[0]);
    await flush();
    expect(startJob).toHaveBeenCalledOnce();
    expect(mocks.activate).toHaveBeenCalled();
    useLaserStore.setState({ streamer: { ...started, status: 'done' } });
    useLaserStore.setState({ streamer: null });
    activation.resolve(undefined);
    await pending;
    expect(advance).toHaveBeenCalledExactlyOnceWith(withVariables, 'successful-stream');
  });

  it('protects underlying artwork from shortcuts while the full-page CNC dialog is open', async () => {
    const removeSceneObjects = vi.fn();
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    useStore.setState({
      selectedObjectId: 'selected-artwork',
      additionalSelectedIds: new Set(),
      removeSceneObjects,
    });
    useUiStore.setState({ modalDepth: 0, textDialog: null, imageDialog: null });
    const adapter: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };
    function Shortcuts() {
      useShortcuts();
      return null;
    }
    const source = { grid: {}, moves: [], toolProfile: [] } as unknown as Parameters<
      typeof Cnc3DFullPage
    >[0]['source'];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <PlatformProvider adapter={adapter}>
            <Shortcuts />
            <Cnc3DFullPage
              source={source}
              stockThicknessMm={10}
              scrubberT={1}
              live={null}
              onClose={onClose}
            />
          </PlatformProvider>,
        ),
      );
      const dialog = document.querySelector('[aria-label="3D result, full page"]');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(useUiStore.getState().modalDepth).toBe(1);
      const close = dialog?.querySelector('button');
      if (!close) throw new Error('full-page Close button missing');
      expect(document.activeElement).toBe(close);
      await act(async () => {
        close.focus();
        close.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
        );
      });
      expect(removeSceneObjects).not.toHaveBeenCalled();
      await act(async () =>
        close.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        ),
      );
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      expect(useUiStore.getState().modalDepth).toBe(0);
      expect(document.activeElement).toBe(opener);
      opener.remove();
      host.remove();
    }
  });
});
