import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useMachineSetupDialogStore } from '../laser/device-setup/machine-setup-dialog-store';
import { SetupOwnedValueRow } from './SetupOwnedValueRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' } });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' } });
});

describe('SetupOwnedValueRow', () => {
  it('explains a read-only value and requests its exact Startup Setup field', async () => {
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <SetupOwnedValueRow
          label="Machine maximum"
          value="12,000 RPM"
          description="This is the machine maximum spindle speed."
          setupField="spindle-max"
        />,
      );
    });

    const reference = host.querySelector('button[aria-label^="Machine maximum:"]');
    if (!(reference instanceof HTMLButtonElement)) throw new Error('Reference button missing');
    expect(reference.disabled).toBe(false);
    expect(reference.getAttribute('aria-expanded')).toBe('false');

    await act(async () => reference.click());
    expect(reference.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role="note"]')?.textContent).toContain(
      'This is the machine maximum spindle speed.',
    );

    const edit = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Edit in Startup Setup',
    );
    if (!(edit instanceof HTMLButtonElement)) throw new Error('Startup Setup action missing');
    await act(async () => edit.click());

    expect(useMachineSetupDialogStore.getState().state).toEqual({
      kind: 'open',
      target: { kind: 'cnc', field: 'spindle-max' },
      requestId: 1,
    });
  });
});
