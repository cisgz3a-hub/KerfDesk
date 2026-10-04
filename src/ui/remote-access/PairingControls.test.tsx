import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeQrModules } from '../../__fixtures__/barcode/qr-decoder';
import { PairingControls } from './PairingControls';
import {
  setRemoteSession,
  useRemoteAccessStore,
  type RemoteAccessStatus,
} from './remote-access-store';
import { oneTimePairingLink } from './pairing-link';
import { pairingFixture, renderedQrModules } from './pairing-test-support';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement;
let monotonic = 100;
const clipboard = vi.fn(async (_value: string) => undefined);
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
beforeEach(() => {
  monotonic = 100;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
  clipboard.mockClear();
  setRemoteSession('pairing-ui-test');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  setRemoteSession(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard');
  else Object.defineProperty(navigator, 'clipboard', originalClipboard);
});
async function publish(status: RemoteAccessStatus = pairingFixture): Promise<void> {
  await act(async () => {
    useRemoteAccessStore.getState().publish(status);
  });
  await act(async () => root?.render(<PairingControls />));
}
function button(label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (result === undefined) throw new Error(`Missing button: ${label}`);
  return result;
}

describe('easy PC pairing presentation', () => {
  it('decodes the actual rendered SVG to the exact fragment link without new network work', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await publish();
    const svg = host.querySelector<SVGElement>('svg[aria-label="One-time pairing QR code"]')!;
    const grid = renderedQrModules(svg);
    const decoded = decodeQrModules(grid.modules, grid.size);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.reason);
    expect(decoded.text).toBe(oneTimePairingLink(pairingFixture));
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('white');
    expect(svg.querySelector('path')?.getAttribute('fill')).toBe('black');
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(false);
    await act(async () => button('Copy pairing link').click());
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(decoded.text);
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.textContent).toContain('5:00');
  });
  it('removes expired QR, link and code with a stopped poll and wall-clock correction', async () => {
    await publish({
      ...pairingFixture,
      pairing: { ...pairingFixture.pairing!, expiresInMs: 1000 },
    });
    vi.setSystemTime(new Date('2000-01-01'));
    monotonic += 1000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(host.querySelector('svg')).toBeNull();
    expect(host.querySelector('a[href*="#device="]')).toBeNull();
    expect(host.textContent).not.toContain(pairingFixture.pairing!.code);
    expect(host.textContent).toContain('Pairing link expired');
  });
  it('blocks a stale click before the next expiry render and replaces old links immediately', async () => {
    await publish({ ...pairingFixture, pairing: { ...pairingFixture.pairing!, expiresInMs: 1 } });
    monotonic += 1;
    await act(async () => button('Copy pairing link').click());
    expect(clipboard).not.toHaveBeenCalled();
    await publish({ ...pairingFixture, statusRevision: 2, pairing: null, pairingPending: true });
    expect(host.querySelector('svg')).toBeNull();
    expect(host.textContent).not.toContain(pairingFixture.pairing!.code);
    await publish({
      ...pairingFixture,
      statusRevision: 3,
      pairing: { ...pairingFixture.pairing!, code: 'NewCode123-A' },
    });
    await act(async () => button('Copy pairing link').click());
    expect(clipboard.mock.calls[0]?.[0]).toContain('code=NewCode123-A');
    expect(clipboard.mock.calls[0]?.[0]).not.toContain(pairingFixture.pairing!.code);
  });
  it('keeps manual copying and ChatGPT endpoint accessible and reports clipboard refusal', async () => {
    clipboard.mockRejectedValueOnce(new Error('Synthetic clipboard refusal'));
    await publish();
    await act(async () => button('Copy pairing link').click());
    expect(host.textContent).toContain(
      'Sharing is unavailable. Scan the QR code or use manual setup below.',
    );
    await act(async () => button('Copy server URL').click());
    expect(clipboard).toHaveBeenLastCalledWith(pairingFixture.mcpUrl);
    await act(async () => button('Copy computer ID').click());
    expect(clipboard).toHaveBeenLastCalledWith(pairingFixture.deviceId);
    await act(async () => button('Copy code').click());
    expect(clipboard).toHaveBeenLastCalledWith(pairingFixture.pairing!.code);
  });
});
