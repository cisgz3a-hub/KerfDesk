import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionBar } from './ConnectionBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('compact machine connection', () => {
  it('opens the full machine profile and module from the keyboard, then restores focus', async () => {
    const onModuleChange = vi.fn();
    const host = await renderBar({
      machine: <div>358 × 268 mm · Falcon A1 Pro (GRBL-compatible commands)</div>,
      details: (
        <label>
          Laser module
          <select aria-label="Laser module" defaultValue="20" onChange={onModuleChange}>
            <option value="20">20 W blue (455 nm)</option>
            <option value="40">40 W blue (455 nm)</option>
          </select>
        </label>
      ),
    });
    const trigger = machineTrigger(host);
    expect(trigger?.title).toContain('Creality Falcon A1 Pro (vendor command set)');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Not connected');
    expect(document.querySelector('[aria-label="Laser module"]')).toBeNull();

    await act(async () => {
      trigger?.focus();
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Machine details"]',
    );
    expect(dialog?.textContent).toContain('358 × 268 mm');
    expect(trigger?.getAttribute('aria-controls')).toBe(dialog?.id);
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    const module = dialog?.querySelector<HTMLSelectElement>('[aria-label="Laser module"]');
    expect(document.activeElement).toBe(module);
    await act(async () => {
      if (module !== undefined && module !== null) module.value = '40';
      module?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onModuleChange).toHaveBeenCalledOnce();

    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[aria-label="Machine details"]')).toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Connect, Machine Setup and the connection options available without opening details', async () => {
    const onConnect = vi.fn();
    const onSetup = vi.fn();
    const onChoosePort = vi.fn();
    const onAutoConnectChange = vi.fn();
    const host = await renderBar({
      onConnect,
      onChoosePort,
      autoConnect: true,
      onAutoConnectChange,
      setup: (
        <button aria-label="Machine Setup" onClick={onSetup}>
          Setup
        </button>
      ),
    });
    await act(async () => button(host, 'Connect')?.click());
    expect(onConnect).toHaveBeenCalledOnce();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Machine Setup"]')?.click(),
    );
    expect(onSetup).toHaveBeenCalledOnce();
    expect(document.querySelector('[aria-label="Machine details"]')).toBeNull();

    await openMenu(host);
    expect(menuItem('Connect automatically')?.getAttribute('aria-checked')).toBe('true');
    await act(async () => menuItem('Connect automatically')?.click());
    expect(onAutoConnectChange).toHaveBeenCalledExactlyOnceWith(false);
    await openMenu(host);
    await act(async () => menuItem('Use a different port…')?.click());
    expect(onChoosePort).toHaveBeenCalledOnce();
  });

  it('retains Disconnect and Forget Controller while closing details for a row action', async () => {
    const onDisconnect = vi.fn();
    const onForget = vi.fn();
    const host = await renderBar({ connection: { kind: 'connected' }, onDisconnect, onForget });
    await act(async () => machineTrigger(host)?.click());
    expect(document.querySelector('[aria-label="Machine details"]')).not.toBeNull();
    await act(async () => button(host, 'Disconnect')?.click());
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(onForget).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Machine details"]')).toBeNull();

    await openMenu(host);
    await act(async () => menuItem('Forget Controller')?.click());
    expect(onForget).toHaveBeenCalledOnce();
  });

  it('announces status outside the machine button and keeps its accessible name stable', async () => {
    const host = await renderBar({ connection: { kind: 'disconnected' } });
    const trigger = machineTrigger(host);
    const name = 'Machine details: Creality Falcon A1 Pro (vendor command set)';
    expect(trigger?.getAttribute('aria-label')).toBe(name);
    expect(trigger?.querySelector('[role="status"], [aria-live]')).toBeNull();
    const description = () =>
      document.getElementById(trigger?.getAttribute('aria-describedby') ?? '')?.textContent;
    expect(description()).toBe('Not connected');

    await renderBar({ connection: { kind: 'connected' } }, host);
    expect(trigger?.getAttribute('aria-label')).toBe(name);
    expect(description()).toBe('Connected');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Connected');
  });

  it('shows a failed connection while details are closed', async () => {
    const host = await renderBar({
      connection: { kind: 'failed', error: 'Failed to open serial port.' },
    });
    expect(document.querySelector('[aria-label="Machine details"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Couldn’t connect');
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(host.textContent).toContain('The port is busy or unavailable');
  });

  it('shows missing controller information and recovery actions on an open connection', async () => {
    const onRetryQualification = vi.fn();
    const onReconnectQualification = vi.fn();
    const host = await renderBar({
      connection: { kind: 'connected' },
      qualification: { kind: 'failed', epoch: 4, message: 'The settings response timed out.' },
      qualificationReadBlockReason: null,
      reconnectRecommended: true,
      onRetryQualification,
      onReconnectQualification,
    });
    expect(document.querySelector('[aria-label="Machine details"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Connected');
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(host.textContent).toContain('The settings response timed out.');
    await act(async () => button(host, 'Retry reading controller settings')?.click());
    expect(onRetryQualification).toHaveBeenCalledOnce();
    await act(async () => button(host, 'Reconnect controller')?.click());
    expect(onReconnectQualification).toHaveBeenCalledOnce();
  });

  it('prevents Connect while connecting and keeps machine details available', async () => {
    const onConnect = vi.fn();
    const host = await renderBar({
      connection: { kind: 'connecting' },
      qualification: { kind: 'qualifying', epoch: 4, phase: 'settings-read' },
      onConnect,
    });
    const primary = button(host, 'Connecting…');
    expect(primary?.disabled).toBe(true);
    await act(async () => primary?.click());
    expect(onConnect).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Machine details"]')).toBeNull();
    await act(async () => machineTrigger(host)?.click());
    expect(document.querySelector('[aria-label="Machine details"]')).not.toBeNull();
  });

  it('keeps the pending settings read visible on an open connection', async () => {
    const host = await renderBar({
      connection: { kind: 'connected' },
      qualification: { kind: 'qualifying', epoch: 4, phase: 'settings-read' },
    });
    expect(host.textContent).toContain('Reading controller settings…');
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(2);
    expect(document.querySelector('[aria-label="Machine details"]')).toBeNull();
    expect(button(host, 'Disconnect')).toBeInstanceOf(HTMLButtonElement);
  });
});

let mountedRoot: Root | null = null;

async function renderBar(
  overrides: Partial<ComponentProps<typeof ConnectionBar>>,
  rerenderInto?: HTMLDivElement,
): Promise<HTMLDivElement> {
  if (rerenderInto !== undefined && mountedRoot !== null) {
    const root = mountedRoot;
    await act(async () => root.render(bar(overrides)));
    return rerenderInto;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoot = root;
  await act(async () => root.render(bar(overrides)));
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
    mountedRoot = null;
  };
  return host;
}

function bar(overrides: Partial<ComponentProps<typeof ConnectionBar>>): JSX.Element {
  return (
    <ConnectionBar
      machineName="Creality Falcon A1 Pro (vendor command set)"
      connection={{ kind: 'disconnected' }}
      machineNoun="laser"
      onConnect={() => undefined}
      onDisconnect={() => undefined}
      onForget={() => undefined}
      disabled={false}
      {...overrides}
    />
  );
}

function machineTrigger(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector('button[aria-haspopup="dialog"]');
}

function button(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((item) => item.textContent === label);
}

async function openMenu(host: HTMLElement): Promise<void> {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="More connection options"]')?.click(),
  );
}

function menuItem(label: string): HTMLButtonElement | undefined {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemcheckbox"]'),
  ].find((item) => item.querySelector('span')?.textContent === label);
}
