import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControllerKind } from '../../core/devices';
import type { PlatformAdapter, SerialOpenRequest } from '../../platform/types';
import { useLaserStore } from './laser-store';

afterEach(() => {
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    activeControllerKind: 'grbl-v1.1',
    lastWriteError: null,
    safetyNotice: null,
    log: [],
    transcript: [],
  });
});

async function requestTransport(controllerKind?: ControllerKind, hostedStreaming = true) {
  const open = vi.fn(async (_request: SerialOpenRequest) => {
    // Inspect the real connect/open boundary without creating a serial session.
    throw new Error('Captured transport request');
  });
  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open }),
    },
  };
  await useLaserStore.getState().connect(adapter, {
    controllerKind,
    baudRate: 250_000,
    hostedStreaming,
  });
  return open;
}

describe('worker transport firmware eligibility', () => {
  it.each(['marlin', 'smoothieware'] as const)(
    'ignores a saved worker opt-in when the selected driver is %s',
    async (controllerKind) => {
      const open = await requestTransport(controllerKind);
      expect(open).toHaveBeenCalledExactlyOnceWith({ baudRate: 250_000 });
    },
  );

  it.each(['grbl-v1.1', 'grblhal', 'fluidnc', undefined] as const)(
    'keeps an explicit worker opt-in for the GRBL-family driver %s',
    async (controllerKind) => {
      const open = await requestTransport(controllerKind);
      expect(open).toHaveBeenCalledExactlyOnceWith({ baudRate: 250_000, hostedStreaming: true });
    },
  );

  it('keeps the ordinary transport when the compatible driver has no worker opt-in', async () => {
    const open = await requestTransport('grbl-v1.1', false);
    expect(open).toHaveBeenCalledExactlyOnceWith({ baudRate: 250_000 });
  });
});
