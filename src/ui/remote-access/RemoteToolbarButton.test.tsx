import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsDialogStore } from '../settings/settings-dialog-store';
import {
  setRemoteSession,
  useRemoteAccessStore,
  type RemoteAccessStatus,
} from './remote-access-store';
import { pairingFixture } from './pairing-test-support';

const runtime = vi.hoisted(() => ({ desktop: true }));
vi.mock('./desktop-only', () => ({ isRemoteAccessRenderer: () => runtime.desktop }));

import { Toolbar } from '../common/Toolbar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const phone = { id: 'client-1', label: 'Workshop phone', scopes: ['read', 'edit'] as const };
let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(async () => {
  runtime.desktop = true;
  setRemoteSession('toolbar-test');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Toolbar commands={[]} machineKind="laser" />));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  setRemoteSession(null);
  useSettingsDialogStore.setState({ open: false, section: 'general' });
  vi.unstubAllGlobals();
});

async function publish(status: Partial<RemoteAccessStatus>): Promise<void> {
  await act(async () => useRemoteAccessStore.getState().publish({ ...pairingFixture, ...status }));
}
function trigger(): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>('button[aria-label="Phone & MCP"]');
}
function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-label="Phone & MCP"]');
}
function panelButton(label: string): HTMLButtonElement {
  const found = [...(panel()?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent === label,
  );
  if (found === undefined) throw new Error(`Missing panel button: ${label}`);
  return found;
}
async function openPanel(): Promise<HTMLElement> {
  await act(async () => trigger()?.click());
  const opened = panel();
  if (opened === null) throw new Error('Phone & MCP panel did not open');
  return opened;
}

describe('Phone & MCP toolbar button', () => {
  it('appears only in the desktop app', async () => {
    expect(trigger()).not.toBeNull();
    runtime.desktop = false;
    await act(async () => root?.render(<Toolbar commands={[]} machineKind="cnc" />));
    expect(trigger()).toBeNull();
  });

  it('shows the live connection state on the toolbar', async () => {
    await publish({ statusRevision: 1, clients: [phone] });
    expect(trigger()?.dataset['remoteState']).toBe('live');
    expect(trigger()?.title).toBe('Phone & MCP: 1 approved connection');
    await publish({
      statusRevision: 2,
      requests: [
        {
          pairingId: 'pair-1',
          clientLabel: 'ChatGPT',
          requestedScopes: ['read'],
          expiresAt: 1,
          expiresInMs: 60_000,
        },
      ],
    });
    expect(trigger()?.dataset['remoteState']).toBe('attention');
    await publish({ statusRevision: 3, connected: false });
    expect(trigger()?.title).toBe('Phone & MCP: Connecting to the remote service…');
    await publish({ statusRevision: 4, enabled: false, connected: false, pairing: null });
    expect(trigger()?.dataset['remoteState']).toBe('off');
    expect(trigger()?.title).toBe('Phone & MCP: Remote access is off');
  });

  it('opens a quick panel with pairing, the MCP server URL and approved connections', async () => {
    await publish({ statusRevision: 1, clients: [phone] });
    const opened = await openPanel();
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    expect(opened.querySelector('[role="switch"]')).toHaveProperty('checked', true);
    expect(opened.textContent).toContain('1 approved connection');
    expect(panelButton('Create pairing link')).toBeDefined();
    expect(opened.querySelector('svg[aria-label="One-time pairing QR code"]')).not.toBeNull();
    expect(opened.textContent).toContain('Connect ChatGPT or another MCP app');
    expect(opened.textContent).toContain(pairingFixture.mcpUrl);
    expect(opened.textContent).toContain('Workshop phone · View and edit');
    expect(panelButton('Revoke')).toBeDefined();
    expect(opened.textContent).toContain('Share artwork previews and text');
  });

  it('turns remote access off from the panel and explains what turning it on shares', async () => {
    await publish({ statusRevision: 1 });
    const off = { ...pairingFixture, statusRevision: 2, enabled: false, pairing: null };
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      json: async () => off,
    }));
    vi.stubGlobal('fetch', fetcher);
    const opened = await openPanel();
    const toggle = opened.querySelector<HTMLInputElement>('[role="switch"]');
    await act(async () => toggle?.click());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('./api/remote/configure');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1].body))).toMatchObject({
      sessionId: 'toolbar-test',
      enabled: false,
    });
    expect(toggle?.checked).toBe(false);
    expect(opened.textContent).toContain('Remote access is off');
    expect(opened.textContent).toContain('may send what it reads to its AI provider');
    expect(opened.textContent).not.toContain('Create pairing link');
  });

  it('opens the full Phone & MCP settings and closes the panel', async () => {
    await publish({ statusRevision: 1 });
    await openPanel();
    await act(async () => panelButton('All Phone & MCP settings…').click());
    expect(useSettingsDialogStore.getState()).toMatchObject({ open: true, section: 'remote' });
    expect(panel()).toBeNull();
  });

  it('closes on Escape and returns focus to the toolbar button', async () => {
    await publish({ statusRevision: 1 });
    const opened = await openPanel();
    await act(async () =>
      opened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
  });
});
