import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { ConsolePanel } from './ConsolePanel';
import { ConsoleCommandDeck } from './console/ConsoleCommandDeck';
import { useConsoleWorkspaceState } from './console/console-workspace-state';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useLaserStore.getState();

afterEach(() => {
  useLaserStore.setState(initial, true);
  useConsoleWorkspaceState.setState({ command: '', showStatus: false, showStream: false });
});

it('keeps an unsent draft and filters through full remounts without sending or sharing it with Super Console', async () => {
  const send = vi.fn(async () => undefined);
  useLaserStore.setState({
    connection: { kind: 'connected' },
    activeControllerKind: 'grbl-v1.1',
    sendConsoleCommand: send,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ConsolePanel />));
    const input = host.querySelector<HTMLInputElement>('[aria-label="Console command"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'G0 X12');
      Simulate.change(input);
      host
        .querySelector<HTMLInputElement>('input[title="Show periodic controller status reports."]')!
        .click();
      host
        .querySelector<HTMLInputElement>(
          'input[title="Show high-volume job stream writes that are hidden by default."]',
        )!
        .click();
    });
    await act(async () => root.render(<div />));
    await act(async () => root.render(<ConsolePanel />));
    expect(host.querySelector<HTMLInputElement>('[aria-label="Console command"]')!.value).toBe(
      'G0 X12',
    );
    expect(
      host.querySelector<HTMLInputElement>(
        'input[title="Show periodic controller status reports."]',
      )!.checked,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>(
        'input[title="Show high-volume job stream writes that are hidden by default."]',
      )!.checked,
    ).toBe(true);
    await act(async () => root.render(<ConsoleCommandDeck />));
    expect(host.querySelector<HTMLInputElement>('[aria-label="Console command"]')!.value).toBe('');
    await act(async () => root.render(<ConsolePanel />));
    expect(host.querySelector<HTMLInputElement>('[aria-label="Console command"]')!.value).toBe(
      'G0 X12',
    );
    expect(send).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
