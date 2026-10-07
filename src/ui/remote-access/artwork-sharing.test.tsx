import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ARTWORK_SHARING_EVENT,
  ARTWORK_SHARING_KEY,
  artworkSharingEnabled,
  setArtworkSharingEnabled,
} from './artwork-sharing';
import { RemoteAccessSection } from './RemoteAccessSection';
import { useRemoteAccessStore, type RemoteAccessStatus } from './remote-access-store';

let root: Root | null = null;
let host: HTMLDivElement;
async function renderSection(): Promise<void> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<RemoteAccessSection />));
}
function sharingBox(): HTMLInputElement {
  const label = Array.from(host.querySelectorAll('label')).find((item) =>
    item.textContent?.includes('Share artwork previews and text with approved phones and MCP apps'),
  );
  const input = label?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw Error('Sharing checkbox missing');
  return input;
}
function connectedStatus(code = 'ExampleCode1'): RemoteAccessStatus {
  return {
    statusRevision: 1,
    available: true,
    enabled: true,
    connected: true,
    deviceId: '11111111-1111-4111-8111-111111111111',
    controlUrl: 'https://example.test/control?device=11111111-1111-4111-8111-111111111111',
    mcpUrl: 'https://example.test/mcp',
    pairing: { code, expiresAt: Date.now() + 300_000, expiresInMs: 300_000 },
    pairingPending: false,
    requests: [],
    clients: [],
    error: null,
  };
}
function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent === label,
  );
  if (found === undefined) throw Error(`Button missing: ${label}`);
  return found;
}
async function openManualSetup(): Promise<void> {
  const summary = Array.from(host.querySelectorAll('summary')).find(
    (item) => item.textContent === 'Manual phone setup',
  );
  const details = summary?.parentElement;
  if (summary === undefined || !(details instanceof HTMLDetailsElement))
    throw Error('Manual phone setup missing');
  expect(details.open).toBe(false);
  await act(async () => summary.click());
  expect(details.open).toBe(true);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  setArtworkSharingEnabled(false);
  localStorage.removeItem(ARTWORK_SHARING_KEY);
  useRemoteAccessStore.setState({ status: null, busy: false, message: null });
});
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setArtworkSharingEnabled(false);
  localStorage.clear();
});

describe('desktop artwork-sharing consent', () => {
  it('stays off for missing and malformed older preferences', () => {
    expect(artworkSharingEnabled()).toBe(false);
    for (const saved of ['1', 'TRUE', 'yes', '{}', 'false']) {
      localStorage.setItem(ARTWORK_SHARING_KEY, saved);
      expect(artworkSharingEnabled()).toBe(false);
    }
  });
  it('persists only the explicit boolean and reads it again independently', () => {
    expect(setArtworkSharingEnabled(true)).toBe(true);
    expect(localStorage.getItem(ARTWORK_SHARING_KEY)).toBe('true');
    expect(artworkSharingEnabled()).toBe(true);
    localStorage.setItem(ARTWORK_SHARING_KEY, 'false');
    expect(artworkSharingEnabled()).toBe(false);
  });
  it('cannot enable sharing when storage is unavailable', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('storage denied');
    });
    expect(setArtworkSharingEnabled(true)).toBe(false);
    expect(artworkSharingEnabled()).toBe(false);
    write.mockRestore();
  });
  it('fails closed immediately if disabling cannot be persisted', () => {
    setArtworkSharingEnabled(true);
    const changed = vi.fn();
    window.addEventListener(ARTWORK_SHARING_EVENT, changed);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('storage denied');
    });
    expect(setArtworkSharingEnabled(false)).toBe(false);
    expect(artworkSharingEnabled()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(ARTWORK_SHARING_EVENT, changed);
  });
  it('reads a denied storage API as off without raising an application error', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw Error('storage denied');
    });
    expect(artworkSharingEnabled()).toBe(false);
  });
  it('shows a separate disabled opt-in without desktop remote access', async () => {
    await renderSection();
    const box = sharingBox();
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(host.textContent).toContain('its AI provider');
  });
  it('lets the desktop explicitly opt in and immediately opt out', async () => {
    useRemoteAccessStore.setState({
      status: {
        statusRevision: 1,
        available: true,
        enabled: false,
        connected: false,
        deviceId: null,
        controlUrl: 'https://example.test/control',
        mcpUrl: 'https://example.test/mcp',
        pairing: null,
        pairingPending: false,
        requests: [],
        clients: [],
        error: null,
      },
    });
    await renderSection();
    const box = sharingBox();
    await act(async () => box.click());
    expect(artworkSharingEnabled()).toBe(true);
    expect(box.checked).toBe(true);
    await act(async () => box.click());
    expect(artworkSharingEnabled()).toBe(false);
    expect(box.checked).toBe(false);
  });
  it('copies the pairing code and computer ID without enabling artwork sharing', async () => {
    const status = connectedStatus();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    useRemoteAccessStore.setState({ status });
    await renderSection();
    await openManualSetup();
    await act(async () => button('Copy code').click());
    expect(writeText).toHaveBeenNthCalledWith(1, status.pairing!.code);
    await act(async () => button('Copy computer ID').click());
    expect(writeText).toHaveBeenNthCalledWith(2, status.deviceId);
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Ready to pair');
    expect(host.querySelector('a[href^="https://example.test"]')).toBeNull();
    expect(sharingBox().checked).toBe(false);
    expect(artworkSharingEnabled()).toBe(false);
  });
  it('offers the exact value for manual copying when clipboard access is denied', async () => {
    const status = connectedStatus();
    const writeText = vi.fn().mockRejectedValue(Error('clipboard denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    useRemoteAccessStore.setState({ status });
    await renderSection();
    await openManualSetup();
    await act(async () => button('Copy computer ID').click());
    expect(writeText).toHaveBeenNthCalledWith(1, status.deviceId);
    expect(host.textContent).toContain('Copy is unavailable. Select and copy this text:');
    expect(host.querySelector('code')?.textContent).toBe(status.deviceId);
    await act(async () => button('Copy code').click());
    expect(writeText).toHaveBeenNthCalledWith(2, status.pairing!.code);
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(Array.from(host.querySelectorAll('code'), (item) => item.textContent)).toEqual([
      status.deviceId,
      status.pairing!.code,
    ]);
    expect(button('Copy computer ID').disabled).toBe(false);
    expect(button('Copy code').disabled).toBe(false);
    expect(sharingBox().checked).toBe(false);
    expect(artworkSharingEnabled()).toBe(false);
  });
  it('does not mark a replacement code copied when an older clipboard request finishes', async () => {
    let finish: (() => void) | undefined;
    const writeText = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    useRemoteAccessStore.setState({ status: connectedStatus('OriginalCode') });
    await renderSection();
    await act(async () => button('Copy code').click());
    expect(button('Copy code').disabled).toBe(true);
    await act(async () =>
      useRemoteAccessStore.setState({ status: connectedStatus('NewCodeValue') }),
    );
    await act(async () => finish?.());
    expect(host.textContent).toContain('NewCodeValue');
    expect(host.textContent).not.toContain('OriginalCode');
    expect(host.textContent).not.toContain('Copied.');
    expect(button('Copy code').disabled).toBe(false);
  });
});
