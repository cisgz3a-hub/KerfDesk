// ADR-354 Amendment 1: a requested worker transport that falls back to the
// window is recorded on every host, but only a host whose hidden window pauses
// sending asks the operator to keep KerfDesk visible.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import type { PlatformAdapter } from '../../platform/types';
import { BACKGROUND_STREAMING_FALLBACK_LOG } from './laser-background-streaming-notice';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  useToastStore.setState({ toasts: [] });
});

/** Connect a GRBL profile through `host`; the port reports whether its worker transport was usable. */
async function connectThrough(
  host: PlatformAdapter['id'],
  backgroundStreamingUnavailable: boolean,
): Promise<void> {
  const port = createFakeSerialPort();
  const adapter: PlatformAdapter = {
    ...port.adapter,
    id: host,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({
        open: async () =>
          backgroundStreamingUnavailable
            ? { ...port.connection, backgroundStreamingUnavailable: true }
            : port.connection,
      }),
    },
  };
  await useLaserStore.getState().connect(adapter, { controllerKind: 'grbl-v1.1' });
}

function warnings(): string[] {
  return useToastStore
    .getState()
    .toasts.filter((toast) => toast.variant === 'warning')
    .map((toast) => toast.message);
}

describe('background streaming fallback notice', () => {
  it('asks a browser operator to keep KerfDesk visible and records the fallback', async () => {
    await connectThrough('web', true);
    expect(warnings()).toEqual([expect.stringContaining('Keep KerfDesk visible')]);
    expect(useLaserStore.getState().log).toContain(BACKGROUND_STREAMING_FALLBACK_LOG);
  });

  it('records the fallback without a visibility warning in the desktop app', async () => {
    await connectThrough('electron', true);
    expect(warnings()).toEqual([]);
    expect(useLaserStore.getState().log).toContain(BACKGROUND_STREAMING_FALLBACK_LOG);
  });

  it('says nothing when background streaming is available', async () => {
    await connectThrough('web', false);
    expect(warnings()).toEqual([]);
    expect(useLaserStore.getState().log).not.toContain(BACKGROUND_STREAMING_FALLBACK_LOG);
  });
});
