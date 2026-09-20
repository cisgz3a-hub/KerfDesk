import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppCommand } from '../commands/command-registry';
import { Dialog } from '../kit/Dialog';
import { Toolbar } from './Toolbar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function ResponsiveDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const commands: AppCommand[] = [
    {
      id: 'tools.trace-image',
      label: 'Trace Image...',
      title: 'Trace Image...',
      family: 'tools',
      enabled: true,
      invoke: () => setOpen(true),
    },
    {
      id: 'tools.camera',
      label: 'Camera',
      title: 'Camera',
      family: 'tools',
      enabled: true,
      invoke: () => undefined,
    },
  ];
  return (
    <>
      <Toolbar commands={commands} machineKind="laser" />
      {open ? (
        <Dialog ariaLabel="Trace image" onClose={() => setOpen(false)}>
          <button type="button">Trace action</button>
        </Dialog>
      ) : null}
    </>
  );
}

it('returns dialog focus to More when resizing removes the original toolbar opener', async () => {
  let available = 800;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({
      width: this.classList.contains('lf-toolbar-command-groups') ? available : 100,
      height: 30,
    });
  });
  const host = document.createElement('div');
  document.body.append(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<ResponsiveDialog />);
  });
  const opener = button('Trace Image...');
  await act(async () => {
    opener.focus();
    opener.click();
  });
  expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();

  available = 120;
  await act(async () => window.dispatchEvent(new Event('resize')));
  expect(opener.isConnected).toBe(false);
  expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button('More commands'));
});

function button(label: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (found === null) throw new Error(`Missing ${label}`);
  return found;
}
