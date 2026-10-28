// ADR-354 Amendment 1 and ADR-676: a requested worker transport that falls
// back to the window is recorded and shown on every host, since a busy window
// can stop the machine with a constant-power beam on; only a host whose hidden
// window pauses sending asks the operator to keep KerfDesk visible.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import type { ControllerKind } from '../../core/devices';
import type { PlatformAdapter } from '../../platform/types';
import {
  BACKGROUND_STREAMING_FALLBACK_LOG,
  BACKGROUND_STREAMING_OFF_LOG,
} from './laser-background-streaming-notice';
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

/** Connect through `host`; the port reports whether its worker transport was usable. */
async function connectThrough(
  host: PlatformAdapter['id'],
  backgroundStreamingUnavailable: boolean,
  options: { readonly controllerKind?: ControllerKind; readonly hostedStreaming?: boolean } = {},
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
  await useLaserStore.getState().connect(adapter, {
    controllerKind: options.controllerKind ?? 'grbl-v1.1',
    ...(options.hostedStreaming === undefined ? {} : { hostedStreaming: options.hostedStreaming }),
  });
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
    expect(warnings()[0]).toContain('stop the head with a constant-power beam on');
    expect(useLaserStore.getState().log).toContain(BACKGROUND_STREAMING_FALLBACK_LOG);
    expect(useLaserStore.getState().jobStreamHost).toBe('window');
  });

  it('shows the desktop fallback too, naming the lit stop but not visibility', async () => {
    await connectThrough('electron', true, { controllerKind: 'marlin' });
    expect(warnings()).toEqual([expect.stringContaining('Job Review flags affected jobs')]);
    expect(warnings()[0]).toContain('stop the head with a constant-power beam on');
    expect(warnings()[0]).not.toContain('Keep KerfDesk visible');
    expect(useLaserStore.getState().log).toContain(BACKGROUND_STREAMING_FALLBACK_LOG);
  });

  it('logs a profile that turned background streaming off, without a toast', async () => {
    await connectThrough('electron', false, { hostedStreaming: false });
    expect(warnings()).toEqual([]);
    expect(useLaserStore.getState().log).toContain(BACKGROUND_STREAMING_OFF_LOG);
  });

  it('says nothing when background streaming is available', async () => {
    await connectThrough('web', false);
    expect(warnings()).toEqual([]);
    expect(useLaserStore.getState().log).not.toContain(BACKGROUND_STREAMING_FALLBACK_LOG);
    expect(useLaserStore.getState().log).not.toContain(BACKGROUND_STREAMING_OFF_LOG);
  });
});
