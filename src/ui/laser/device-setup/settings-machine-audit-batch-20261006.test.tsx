import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection, PlatformAdapter } from '../../../platform/types';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { useMachineSetupSave } from './use-machine-setup-save';
import { initDeviceSetup } from './device-setup-flow';
import { useLaserStore } from '../../state/laser-store';
import { useStore } from '../../state/store';
import { resetStore } from '../../state/test-helpers';
import { flushConnect } from '../../state/laser-store-console.test-support';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
type Fake = SerialConnection & { emit: (line: string) => void; writes: string[] };
function controller(): Fake {
  const handlers = new Set<(line: string) => void>();
  const emit = (line: string) => handlers.forEach((handler) => handler(line));
  const writes: string[] = [];
  const settings = new Map([
    [30, '900'],
    [31, '1'],
    [32, '1'],
  ]);
  const later = (lines: string[]) =>
    queueMicrotask(() => queueMicrotask(() => lines.forEach(emit)));
  return {
    emit,
    writes,
    write: async (data) => {
      writes.push(data);
      if (data === '?') return later(['<Idle|MPos:0.000,0.000,0.000|FS:0,0>']);
      if (data === '$I\n') return later(['[VER:1.1h.20190830:test]', '[OPT:VM,15,128]', 'ok']);
      if (data === '$G\n') return later(['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok']);
      if (data === '$$\n')
        return later([...settings].map(([id, value]) => `$${id}=${value}`).concat('ok'));
      const setting = /^\$(\d+)=(.+)\n$/.exec(data);
      if (setting?.[1] !== undefined && setting[2] !== undefined) {
        settings.set(Number(setting[1]), setting[2]);
        return later(['ok']);
      }
      if (data.endsWith('\n')) later(['ok']);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
  };
}
function platform(connection: Fake): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}
async function connect(connection: Fake): Promise<void> {
  await useLaserStore.getState().connect(platform(connection));
  connection.emit("Grbl 1.1h ['$' for help]");
  connection.emit('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  for (let i = 0; i < 6; i++) await flushConnect();
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
  expect(useLaserStore.getState().controllerOperation).toBeNull();
}
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let unsubscribe: (() => void) | undefined;
afterEach(async () => {
  unsubscribe?.();
  unsubscribe = undefined;
  const mountedRoot = root;
  if (mountedRoot) await act(async () => mountedRoot.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  await useLaserStore.getState().disconnect();
  resetStore();
});

describe('bounded settings batch audit with actual per-setting and transport guards', () => {
  it('stops a two-setting Save when Disconnect begins at the first successful write boundary', async () => {
    resetStore();
    const original = controller();
    await connect(original);
    const close = vi.fn();
    let save: ReturnType<typeof useMachineSetupSave> | undefined;
    const draft = {
      ...initDeviceSetup(DEFAULT_DEVICE_PROFILE, null),
      firmwareBackupConfirmed: true,
      queuedFirmwareWriteIds: [30, 31],
    };
    function Probe(): null {
      save = useMachineSetupSave({
        state: draft,
        operationDrafts: [],
        customTools: [],
        materialApplyRequested: false,
        onClose: close,
      });
      return null;
    }
    function requireMountedSave(): ReturnType<typeof useMachineSetupSave> {
      if (!save) throw new Error('Machine setup save hook fixture missing');
      return save;
    }
    host = document.createElement('div');
    document.body.append(host);
    const mountedRoot = createRoot(host);
    root = mountedRoot;
    await act(async () => mountedRoot.render(<Probe />));
    const mountedSave = requireMountedSave();
    expect(mountedSave.firmwareWriteCount).toBe(2);
    let disconnected: Promise<void> | undefined;
    unsubscribe = useLaserStore.subscribe((next, previous) => {
      if (
        disconnected ||
        previous.controllerOperation?.kind !== 'interactive-command' ||
        previous.controllerOperation.label !== 'Verifying $30' ||
        next.controllerOperation !== null
      )
        return;
      // Calls the actual disconnect lifecycle at the earliest ordinary first
      // setting completion publication, with no write-method wrapper delay.
      disconnected = useLaserStore.getState().disconnect();
    });
    original.writes.length = 0;
    await act(async () => {
      mountedSave.onSave();
      for (let i = 0; i < 8; i++) await flushConnect();
    });
    await disconnected;
    expect(original.writes).toContain('$30=1000\n');
    expect(original.writes).not.toContain('$31=0\n');
    expect(close).toHaveBeenCalledTimes(1);
    const replacement = controller();
    await connect(replacement);
    expect(replacement.writes).not.toContain('$31=0\n');
    expect(useStore.getState().project.device.maxPowerS).toBe(1000);
  });
});
