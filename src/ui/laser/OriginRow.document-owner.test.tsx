import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { fileShortcutContext } from '../app/shortcut-contexts';
import { handleFileShortcut } from '../app/shortcuts';
import { useLaserStore } from '../state/laser-store';
import {
  respondToTestGrblHandshake,
  settleTestGrblHandshake,
} from '../state/laser-test-start-helpers';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { OriginRow } from './OriginRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type OriginKind = 'ordinary' | 'persistent';
const initialApp = useStore.getState();
let root: Root | null = null;
let host: HTMLDivElement | null = null;
const originDetails = {
  ordinary: {
    button: 'Set origin here',
    firstCommand: 'G54 G92 X0 Y0\n',
    label: 'Set work origin',
    source: 'g92',
    toast: 'Origin set to current head position (G92).',
  },
  persistent: {
    button: 'Set persistent origin',
    firstCommand: 'G54 G92.1\n',
    label: 'Set persistent origin',
    source: 'g54-persistent',
    toast: 'Persistent G54 XY origin set; temporary offsets cleared.',
  },
} as const;

async function flush(): Promise<void> {
  for (let index = 0; index < 64; index += 1) await Promise.resolve();
}

function simulatedTransport() {
  const handlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of handlers) handler(line);
  };
  const writes: string[] = [];
  const connection: SerialConnection = {
    write: async (line) => {
      writes.push(line);
      respondToTestGrblHandshake(line, emit);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
  };
  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
  return { adapter, emit, writes };
}

type SimulatedTransport = ReturnType<typeof simulatedTransport>;
const IDLE = '<Idle|MPos:12,34,0|FS:0,0>';

beforeEach(() => {
  useStore.getState().setProject(
    createProject({
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    }),
  );
  useStore.setState({ dirty: false });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(useLaserStore.getInitialState(), true);
  useStore.setState(initialApp, true);
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  vi.restoreAllMocks();
});

async function connectedRow(kind: OriginKind): Promise<SimulatedTransport> {
  const serial = simulatedTransport();
  await useLaserStore.getState().connect(serial.adapter);
  serial.emit('Grbl 1.1f');
  serial.emit(IDLE);
  await flush();
  serial.emit('ok');
  serial.emit(IDLE);
  await settleTestGrblHandshake();
  expect(useLaserStore.getState().connection.kind).toBe('connected');
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(
      <OriginRow
        disabled={false}
        streaming={false}
        layout={kind === 'ordinary' ? 'set-only' : 'all'}
      />,
    );
  });
  return serial;
}

async function beginOrigin(serial: SimulatedTransport, kind: OriginKind): Promise<void> {
  const button = [...host!.querySelectorAll('button')].find(
    (node) => node.textContent === originDetails[kind].button,
  );
  expect(button?.disabled).toBe(false);
  await act(async () => {
    serial.emit(IDLE);
    button!.click();
    await flush();
  });
  expect(serial.writes).toContain(originDetails[kind].firstCommand);
  expect(useLaserStore.getState().controllerOperation).toMatchObject({
    label: originDetails[kind].label,
  });
  expect(useLaserStore.getState().workOriginActive).toBe(false);
}

async function acknowledgeOrigin(serial: SimulatedTransport, kind: OriginKind): Promise<void> {
  await act(async () => {
    serial.emit('ok');
    await flush();
    if (kind === 'persistent') {
      expect(serial.writes).toContain('G10 L20 P1 X0 Y0\n');
      serial.emit('ok');
    } else {
      serial.emit('<Idle|MPos:12,34,0|WCO:12,34,0|FS:0,0>');
    }
    await vi.waitFor(() => expect(useLaserStore.getState().controllerOperation).toBeNull());
    await flush();
  });
  expect(useLaserStore.getState().workOriginSource).toBe(originDetails[kind].source);
  expect(useLaserStore.getState().workOriginActive).toBe(true);
  expect(useToastStore.getState().toasts).toContainEqual(
    expect.objectContaining({ message: originDetails[kind].toast, variant: 'success' }),
  );
}

async function newDocument(serial: SimulatedTransport): Promise<void> {
  await act(async () => {
    const event = new KeyboardEvent('keydown', {
      key: 'n',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    expect(handleFileShortcut(event, fileShortcutContext(serial.adapter))).toBe(true);
    await flush();
  });
}

describe.each(['ordinary', 'persistent'] as const)('%s origin document ownership', (kind) => {
  it('keeps a replacement document placement while completing the real controller origin', async () => {
    const serial = await connectedRow(kind);
    await beginOrigin(serial, kind);
    const owner = useLaserStore.getState().controllerOperation;
    const epoch = useStore.getState().projectDocumentEpoch;
    await newDocument(serial);
    expect(useStore.getState().projectDocumentEpoch).toBe(epoch + 1);
    const replacement = useStore.getState();
    expect(replacement.jobPlacement.startFrom).toBe('absolute');
    expect(useLaserStore.getState().controllerOperation).toBe(owner);
    await acknowledgeOrigin(serial, kind);
    expect(useStore.getState().project).toBe(replacement.project);
    expect(useStore.getState().jobPlacement).toBe(replacement.jobPlacement);
    expect(useStore.getState().dirty).toBe(replacement.dirty);
  });

  it('captures ownership at click after a document change with unchanged rendered values', async () => {
    const serial = await connectedRow(kind);
    await newDocument(serial);
    await beginOrigin(serial, kind);
    await acknowledgeOrigin(serial, kind);
    expect(useStore.getState().jobPlacement.startFrom).toBe('user-origin');
  });

  it.each(['current-position', 'verified-origin', 'absolute'] as const)(
    'reads the same-document %s choice at acknowledgement time',
    async (startFrom) => {
      const serial = await connectedRow(kind);
      if (startFrom === 'absolute') {
        await act(async () =>
          useStore.getState().setJobPlacement({ startFrom: 'current-position' }),
        );
      }
      await beginOrigin(serial, kind);
      await act(async () => useStore.getState().setJobPlacement({ startFrom }));
      await acknowledgeOrigin(serial, kind);
      expect(useStore.getState().jobPlacement.startFrom).toBe(
        startFrom === 'absolute' ? 'user-origin' : startFrom,
      );
    },
  );
});
