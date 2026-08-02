import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatusReport, StreamerState } from '../../core/controllers/grbl';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import type { AppCommand } from './command-registry';
import { useAppCommands, type CommandShellCallbacks } from './use-app-commands';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let renders = 0;
let latest: ReadonlyArray<AppCommand> = [];

beforeEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  renders = 0;
  latest = [];
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
});

describe('useAppCommands store subscriptions', () => {
  it('ignores cursor motion, which writes the app store at mousemove cadence', () => {
    render();
    const before = renders;

    act(() => useStore.getState().setCursorMm({ x: 12, y: 34 }));

    expect(renders).toBe(before);
  });

  it('ignores the 250 ms status-report poll', () => {
    render();
    const before = renders;

    act(() => useLaserStore.setState({ statusReport: statusReport('Idle'), statusSequence: 7 }));

    expect(renders).toBe(before);
  });

  it('ignores per-ack streamer progress while the status is unchanged', () => {
    render();
    act(() => useLaserStore.setState({ streamer: streamer('streaming', 1) }));
    const before = renders;

    act(() => useLaserStore.setState({ streamer: streamer('streaming', 2) }));

    expect(renders).toBe(before);
  });

  it('still rebuilds when a watched field changes', () => {
    render();
    const beforePreview = renders;
    act(() => useStore.getState().togglePreview());
    expect(renders).toBeGreaterThan(beforePreview);

    const beforeStream = renders;
    act(() => useLaserStore.setState({ streamer: streamer('streaming', 0) }));
    expect(renders).toBeGreaterThan(beforeStream);
  });

  it('keeps every File command available while a job is streaming', () => {
    render();
    act(() => useLaserStore.setState({ streamer: streamer('streaming', 3) }));

    const fileCommands = latest.filter((command) => command.family === 'file');
    expect(fileCommands.length).toBeGreaterThan(0);
    for (const command of fileCommands) {
      expect(command.enabled, command.id).toBe(true);
    }
  });
});

function Probe(): null {
  renders += 1;
  latest = useAppCommands(callbacks());
  return null;
}

function render(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <PlatformProvider adapter={mockPlatform()}>
        <Probe />
      </PlatformProvider>,
    );
  });
}

function statusReport(state: StatusReport['state']): StatusReport {
  return {
    state,
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: { x: 0, y: 0, z: 0 },
    wco: null,
    feed: null,
    spindle: null,
  };
}

function streamer(status: StreamerState['status'], completed: number): StreamerState {
  return {
    status,
    streamingMode: 'char-counted',
    queued: ['G0 X0\n', 'G1 X1\n', 'G1 X2\n'],
    queueIndex: completed,
    inFlight: [],
    inFlightBytes: 0,
    completed,
    total: 3,
    rxBufferBytes: 128,
    toolChangePause: false,
  };
}

const doNothing = (): void => undefined;

function callbacks(): CommandShellCallbacks {
  return {
    requestImportImage: doNothing,
    requestMultiFileTrace: doNothing,
    requestConvertToBitmap: doNothing,
    requestAdjustImage: doNothing,
    requestGcodeInspector: doNothing,
    requestBoxGenerator: doNothing,
    requestBoxFitTest: doNothing,
    requestMaterialTest: doNothing,
    requestIntervalTest: doNothing,
    requestScanOffsetTest: doNothing,
    requestFocusTest: doNothing,
    requestOptimizationSettings: doNothing,
    requestArray: doNothing,
    requestQuickNest: doNothing,
    requestPrintAndCut: doNothing,
    requestRotarySetup: doNothing,
    requestLabsSettings: doNothing,
    requestProjectNotes: doNothing,
    requestUndoHistory: doNothing,
    requestCloseOpenFillContoursWithTolerance: doNothing,
    showAbout: doNothing,
    showConnectionHelp: doNothing,
    showSafety: doNothing,
  };
}
