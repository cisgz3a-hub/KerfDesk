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
import { useRemoteAccessStore } from './remote-access-store';

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
});
