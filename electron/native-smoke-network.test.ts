import type { Session } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeSmokeNetworkEvidence, prepareNativeSmokeNetwork } from './native-smoke-network.js';

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('native smoke offline isolation', () => {
  it('does not change ordinary launches', async () => {
    const onBeforeRequest = vi.fn();
    await prepareNativeSmokeNetwork(
      { webRequest: { onBeforeRequest } } as unknown as Session,
      null,
    );
    expect(onBeforeRequest).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('proves both main-process transports are denied before recording offline evidence', async () => {
    let intercept: (_details: unknown, callback: (value: { cancel: boolean }) => void) => void;
    const onBeforeRequest = vi.fn((_filter, listener) => {
      intercept = listener;
    });
    const chromiumFetch = vi.fn(async () => {
      intercept({}, (result) => expect(result.cancel).toBe(true));
      throw new Error('blocked');
    });
    await prepareNativeSmokeNetwork(
      { webRequest: { onBeforeRequest } } as unknown as Session,
      { licenceQualification: { phase: 'offline' } },
      chromiumFetch,
    );
    expect(onBeforeRequest.mock.calls[0]?.[0]).toEqual({
      urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'],
    });
    await expect(globalThis.fetch('https://example.invalid')).rejects.toThrow('offline');
    expect(nativeSmokeNetworkEvidence()).toEqual({
      mode: 'offline-enforced',
      chromiumProbeBlocked: true,
      nodeProbeBlocked: true,
    });
  });

  it('rejects unproven Chromium interception', async () => {
    const onBeforeRequest = vi.fn();
    await expect(
      prepareNativeSmokeNetwork(
        { webRequest: { onBeforeRequest } } as unknown as Session,
        { licenceQualification: { phase: 'offline' } },
        vi.fn().mockRejectedValue(new Error('some unrelated failure')),
      ),
    ).rejects.toThrow('could not prove network isolation');
  });
});
