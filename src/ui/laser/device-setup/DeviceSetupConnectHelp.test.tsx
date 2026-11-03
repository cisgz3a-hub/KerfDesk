// UX audit U2-P3-6 and the KNOWN empty-picker item: Machine Setup is modal, so
// Help > Can't connect? behind it could not be clicked, and a cancelled or
// empty port picker returned silently to "Not connected". The strip now says
// what happened and opens the help over the setup window.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Dialog } from '../../kit';
import type { ConnectionState } from '../../state/laser-store';
import { DeviceSetupConnectHelp } from './DeviceSetupConnectHelp';
import type { FindMachinePhaseKind } from './find-machine-phase';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

async function renderInSetup(
  connection: ConnectionState,
  phase: FindMachinePhaseKind,
): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLElement);
    root.render(
      <Dialog title="Machine Setup" onClose={() => undefined}>
        <DeviceSetupConnectHelp connection={connection} phase={phase} />
      </Dialog>,
    );
  });
  return host;
}

function button(name: string): HTMLButtonElement | undefined {
  return [...(host?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name);
}

describe('DeviceSetupConnectHelp', () => {
  it('names the USB driver after the picker came back with no port', async () => {
    const view = await renderInSetup({ kind: 'disconnected', noPortChosen: true }, 'idle');
    expect(view.textContent).toContain('No port was chosen.');
    expect(view.textContent).toContain('USB driver (CH340 or CP210x)');
  });

  it('opens the connection help over Machine Setup, with the published guide', async () => {
    const view = await renderInSetup({ kind: 'disconnected' }, 'idle');
    expect(view.textContent).not.toContain('No port was chosen.');

    await act(async () => button('Can’t connect?')?.click());

    const dialogs = view.querySelectorAll('[role="dialog"]');
    expect(dialogs).toHaveLength(2);
    const help = dialogs[1];
    expect(help?.textContent).toContain('INSTALL THE USB-TO-SERIAL DRIVER');
    expect(help?.textContent).not.toContain('docs/connection-troubleshooting.md');
    expect(button('Full guide on kerfdesk.com')?.title).toContain(
      'https://kerfdesk.com/docs/#troubleshooting',
    );

    await act(async () => button('Close')?.click());
    expect(view.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('stays out of the way once the machine has answered', async () => {
    const view = await renderInSetup({ kind: 'connected' }, 'found');
    expect(view.querySelector('button')).toBeNull();
  });
});
