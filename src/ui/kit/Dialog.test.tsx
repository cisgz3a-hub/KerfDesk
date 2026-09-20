import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { useTutorialStore } from '../tutorials/tutorial-store';
import { Button } from './Button';
import { Dialog, DialogActions } from './Dialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(node: JSX.Element): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(node);
  });
  return host;
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  useUiStore.setState({ modalDepth: 0 });
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
});

describe('kit Dialog', () => {
  it('opens the contextual lesson without submitting or resetting the open form', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());
    const h = await render(
      <Dialog onClose={onClose} title="Array" tutorialId="array" as="form" onSubmit={onSubmit}>
        <input aria-label="Rows" defaultValue="2" />
        <button type="submit">Create array</button>
      </Dialog>,
    );
    const input = h.querySelector('input');
    if (input === null) throw new Error('Expected the draft input');
    expect(document.activeElement).toBe(input);
    input.value = '7';

    await act(async () => {
      h.querySelector<HTMLButtonElement>('[data-tutorial-id="array"]')?.click();
    });

    expect(useTutorialStore.getState()).toMatchObject({ isOpen: true, tutorialId: 'array' });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(input.value).toBe('7');
    expect(h.querySelector('form')).not.toBeNull();
  });

  it('keeps the header tutorial in the keyboard cycle after focusing the first form control', async () => {
    const h = await render(
      <Dialog onClose={() => undefined} title="Box Generator" tutorialId="box">
        <input aria-label="Width" />
        <button type="button">Add to workspace</button>
      </Dialog>,
    );
    const dialog = h.querySelector<HTMLElement>('[role="dialog"]');
    const input = h.querySelector('input');
    const tutorial = h.querySelector<HTMLButtonElement>('[data-tutorial-id="box"]');
    const last = h.querySelector<HTMLButtonElement>('button:not([data-tutorial-id])');
    if (dialog === null || tutorial === null || last === null) throw new Error('Controls missing');
    expect(document.activeElement).toBe(input);
    expect(tutorial.tabIndex).toBe(0);
    for (const control of h.querySelectorAll('input, button')) {
      Object.defineProperty(control, 'offsetParent', { configurable: true, value: dialog });
    }
    await act(async () => {
      last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(tutorial);
    await act(async () => {
      tutorial.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(last);
  });

  it('offers a lesson on an aria-labelled dialog without inventing a visible title', async () => {
    const h = await render(
      <Dialog onClose={() => undefined} ariaLabel="Image controls" tutorialId="image-adjust">
        <p>Image controls</p>
      </Dialog>,
    );
    expect(h.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Image controls');
    expect(h.querySelector('h2')).toBeNull();
    expect(h.querySelector('[data-tutorial-id="image-adjust"]')).not.toBeNull();
    expect(document.activeElement).toBe(h.querySelector('[role="dialog"]'));
  });

  it('renders the modal a11y structure with a labelled title', async () => {
    const h = await render(
      <Dialog onClose={() => undefined} title="Cut Settings">
        <p>body</p>
      </Dialog>,
    );

    const backdrop = h.querySelector('[role="dialog"]');
    expect(backdrop).not.toBeNull();
    expect(backdrop?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = backdrop?.getAttribute('aria-labelledby') ?? '';
    const heading = backdrop?.querySelector('h2');
    expect(heading?.id).toBe(labelledBy);
    expect(heading?.textContent).toBe('Cut Settings');
  });

  it('closes on Escape and restores focus to the opener', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'open';
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const h = await render(
      <Dialog onClose={onClose} ariaLabel="Test dialog">
        <Button onClick={() => undefined}>Inside</Button>
      </Dialog>,
    );

    // Initial focus lands inside the dialog.
    expect(h.contains(document.activeElement)).toBe(true);

    const backdrop = h.querySelector('[role="dialog"]');
    await act(async () => {
      backdrop?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    if (root !== null) await act(async () => root?.unmount());
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('renders as a form when asked and routes submit', async () => {
    const onSubmit = vi.fn((e: React.FormEvent<HTMLFormElement>) => e.preventDefault());
    const h = await render(
      <Dialog onClose={() => undefined} ariaLabel="Form dialog" as="form" onSubmit={onSubmit}>
        <DialogActions>
          <Button type="submit">OK</Button>
        </DialogActions>
      </Dialog>,
    );

    const form = h.querySelector('form');
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('registers modal depth while mounted and unregisters on unmount', async () => {
    expect(useUiStore.getState().modalDepth).toBe(0);

    await render(
      <Dialog onClose={() => undefined} ariaLabel="Registered dialog">
        <Button onClick={() => undefined}>Inside</Button>
      </Dialog>,
    );

    expect(useUiStore.getState().modalDepth).toBe(1);
    if (root !== null) await act(async () => root?.unmount());
    expect(useUiStore.getState().modalDepth).toBe(0);
  });
});
