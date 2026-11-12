import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppDialogStore } from '../state/app-dialog-store';
import { clearAppDialogs } from '../state/app-dialog-test-helpers';
import { appAlert, appConfirm, appPrompt } from '../state/app-dialogs';
import { forgetDontAskAgain } from '../state/dont-ask-again';
import { useUiStore } from '../state/ui-store';
import { AppDialogHost } from './AppDialogHost';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<AppDialogHost />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearAppDialogs();
  forgetDontAskAgain();
  useUiStore.setState({ modalDepth: 0 });
});

/** Tracks a promise without awaiting it, so a test can assert "still open". */
function track<T>(promise: Promise<T>): { readonly settled: () => T | 'pending' } {
  let value: T | 'pending' = 'pending';
  void promise.then((answer) => {
    value = answer;
  });
  return { settled: () => value };
}

async function ask<T>(open: () => Promise<T>): Promise<{ readonly settled: () => T | 'pending' }> {
  let tracked = track<T>(new Promise<T>(() => undefined));
  await act(async () => {
    tracked = track(open());
  });
  return tracked;
}

function dialog(): HTMLElement {
  const node = host.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
  if (node === null) throw new Error('no dialog is open');
  return node;
}

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (found === undefined) throw new Error(`button "${text}" missing`);
  return found;
}

async function click(text: string): Promise<void> {
  await act(async () => button(text).click());
}

/** A key event as the browser delivers it; returns whether it was cancelled,
 *  which is what stops Chromium turning it into a click or a submit. */
async function key(
  target: HTMLElement,
  type: 'keydown' | 'keyup',
  init: KeyboardEventInit,
): Promise<boolean> {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

const deletePreset = {
  title: 'Delete preset?',
  message: 'Delete preset "Birch - 3 mm"?\n\nThis cannot be undone.',
  confirmLabel: 'Delete',
  tone: 'danger',
} as const;

describe('AppDialogHost confirm', () => {
  it('renders nothing until a question is asked', () => {
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the title, the message as paragraphs, and buttons in the caller’s words', async () => {
    await ask(() => appConfirm(deletePreset));

    expect(dialog().querySelector('h2')?.textContent).toBe('Delete preset?');
    expect([...dialog().querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Delete preset "Birch - 3 mm"?',
      'This cannot be undone.',
    ]);
    expect([...dialog().querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Delete',
      'Cancel',
    ]);
    expect(dialog().textContent).not.toMatch(/\bOK\b/);
  });

  it('resolves true on the named button and closes', async () => {
    const answer = await ask(() => appConfirm(deletePreset));

    await click('Delete');

    expect(answer.settled()).toBe(true);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('resolves false on Cancel and on Escape', async () => {
    const cancelled = await ask(() => appConfirm(deletePreset));
    await click('Cancel');
    expect(cancelled.settled()).toBe(false);

    const escaped = await ask(() => appConfirm(deletePreset));
    await key(dialog(), 'keydown', { key: 'Escape' });
    expect(escaped.settled()).toBe(false);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('counts as a modal for window shortcuts while it is open', async () => {
    await ask(() => appConfirm(deletePreset));
    expect(useUiStore.getState().modalDepth).toBe(1);

    await click('Cancel');
    expect(useUiStore.getState().modalDepth).toBe(0);
  });

  it('shows the next queued question after the first is answered', async () => {
    await ask(() => appConfirm(deletePreset));
    const second = await ask(() => appAlert({ title: 'Imported', message: 'Three presets.' }));

    expect(dialog().querySelector('h2')?.textContent).toBe('Delete preset?');
    await click('Cancel');

    expect(dialog().querySelector('h2')?.textContent).toBe('Imported');
    await click('OK');
    expect(second.settled()).toBeUndefined();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('AppDialogHost going away', () => {
  // A render crash swaps the workspace for the crash screen, which mounts no
  // host: a question nobody can see is cancelled, never left waiting or taken
  // as a yes.
  it('answers what was waiting as cancelled when it unmounts', async () => {
    const confirmed = await ask(() => appConfirm(deletePreset));
    const named = await ask(() =>
      appPrompt({ title: 'Save preset', message: '', label: 'Name', confirmLabel: 'Save' }),
    );

    await act(async () => root.unmount());

    expect(confirmed.settled()).toBe(false);
    expect(named.settled()).toBeNull();
    expect(useAppDialogStore.getState().queue).toEqual([]);
    // afterEach unmounts again; give it a root to unmount.
    await act(async () => {
      root = createRoot(host);
      root.render(<AppDialogHost />);
    });
  });
});

describe('AppDialogHost focus and held keys (ADR-207 Amendment 3)', () => {
  it('opens on the confirm button by default', async () => {
    await ask(() => appConfirm(deletePreset));
    expect(document.activeElement).toBe(button('Delete'));
  });

  it('opens on the dialog itself when the caller asks for the surface', async () => {
    await ask(() => appConfirm({ ...deletePreset, initialFocus: 'surface' }));
    expect(document.activeElement).toBe(dialog());
  });

  it('cancels the auto-repeats of an Enter that was already down when it opened', async () => {
    const answer = await ask(() => appConfirm(deletePreset));
    const confirm = button('Delete');

    // Chromium clicks a focused button on each Enter keypress, repeats
    // included; cancelling the keydown is what stops the click.
    expect(await key(confirm, 'keydown', { key: 'Enter', repeat: true })).toBe(true);
    expect(await key(confirm, 'keydown', { key: 'Enter', repeat: true })).toBe(true);
    expect(await key(confirm, 'keyup', { key: 'Enter' })).toBe(false);
    expect(answer.settled()).toBe('pending');

    // A fresh press is the operator's answer and goes through.
    expect(await key(confirm, 'keydown', { key: 'Enter' })).toBe(false);
  });

  it('cancels the release of a Space that was pressed before it opened', async () => {
    await ask(() => appConfirm(deletePreset));
    const confirm = button('Delete');

    // Space clicks on release: one with no press inside the dialog is refused.
    expect(await key(confirm, 'keyup', { key: ' ' })).toBe(true);
    expect(await key(confirm, 'keydown', { key: ' ' })).toBe(false);
    expect(await key(confirm, 'keyup', { key: ' ' })).toBe(false);
  });

  it('guards Cancel and the alert button the same way', async () => {
    await ask(() => appConfirm(deletePreset));
    expect(await key(button('Cancel'), 'keydown', { key: 'Enter', repeat: true })).toBe(true);
    await click('Cancel');

    await ask(() => appAlert({ title: 'Imported', message: 'Three presets.' }));
    expect(await key(button('OK'), 'keydown', { key: 'Enter', repeat: true })).toBe(true);
  });
});

describe('AppDialogHost "Don’t ask again"', () => {
  it('shows no box unless the caller opts in', async () => {
    await ask(() => appConfirm(deletePreset));
    expect(dialog().querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('remembers a ticked yes, and never takes the opening focus', async () => {
    const options = { ...deletePreset, dontAskAgainKey: 'test.host' };
    const first = await ask(() => appConfirm(options));
    const box = dialog().querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (box === null) throw new Error('checkbox missing');
    expect(box.closest('label')?.textContent).toBe("Don't ask again");
    expect(document.activeElement).toBe(button('Delete'));

    await act(async () => box.click());
    await click('Delete');
    expect(first.settled()).toBe(true);

    const second = await ask(() => appConfirm(options));
    expect(second.settled()).toBe(true);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('AppDialogHost prompt', () => {
  const namePreset = {
    title: 'Save image preset',
    message: '',
    label: 'Preset name',
    confirmLabel: 'Save',
    validate: (value: string) => (value.trim() === '' ? 'A name is required.' : null),
  };

  function field(): HTMLInputElement {
    const input = dialog().querySelector<HTMLInputElement>('input[type="text"]');
    if (input === null) throw new Error('text field missing');
    return input;
  }

  async function type(value: string): Promise<void> {
    await act(async () => {
      Simulate.change(field(), { target: { value } as unknown as EventTarget });
    });
  }

  async function submit(): Promise<void> {
    const form = dialog().querySelector('form');
    if (form === null) throw new Error('form missing');
    await act(async () => {
      Simulate.submit(form);
    });
  }

  it('opens on a labelled text field and resolves the typed text', async () => {
    const answer = await ask(() => appPrompt(namePreset));

    expect(document.activeElement).toBe(field());
    expect(field().closest('label')?.textContent).toBe('Preset name');
    await type('Wood logo');
    await submit();

    expect(answer.settled()).toBe('Wood logo');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps the dialog and the text, with the reason, when the value is refused', async () => {
    const answer = await ask(() => appPrompt(namePreset));

    await submit();

    expect(answer.settled()).toBe('pending');
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('A name is required.');
    expect(field().getAttribute('aria-invalid')).toBe('true');

    await type('Oak');
    expect(dialog().querySelector('[role="alert"]')).toBeNull();
    await submit();
    expect(answer.settled()).toBe('Oak');
  });

  it('resolves null on Cancel and on Escape', async () => {
    const cancelled = await ask(() => appPrompt(namePreset));
    await type('Oak');
    await click('Cancel');
    expect(cancelled.settled()).toBeNull();

    const escaped = await ask(() => appPrompt(namePreset));
    await key(field(), 'keydown', { key: 'Escape' });
    expect(escaped.settled()).toBeNull();
  });

  it('offers the initial value', async () => {
    await ask(() => appPrompt({ ...namePreset, initialValue: 'Birch' }));
    expect(field().value).toBe('Birch');
  });

  it('ignores a held Enter in the field but lets a held Space type', async () => {
    const answer = await ask(() => appPrompt(namePreset));

    // Cancelling the keydown stops the form's implicit submit.
    expect(await key(field(), 'keydown', { key: 'Enter', repeat: true })).toBe(true);
    expect(answer.settled()).toBe('pending');
    expect(await key(field(), 'keydown', { key: ' ', repeat: true })).toBe(false);
    expect(await key(field(), 'keyup', { key: ' ' })).toBe(false);
  });
});
