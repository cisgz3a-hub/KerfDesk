import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});

describe('kit Dialog', () => {
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
});
