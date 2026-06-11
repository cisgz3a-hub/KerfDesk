import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfirmSaveStore, type ConfirmSaveChoice } from '../state/confirm-save-store';
import { useUiStore } from '../state/ui-store';
import { ConfirmSaveDialog } from './ConfirmSaveDialog';

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
    root.render(<ConfirmSaveDialog />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useConfirmSaveStore.setState({ request: null });
  useUiStore.setState({ modalDepth: 0 });
  vi.restoreAllMocks();
});

async function openRequest(): Promise<ReturnType<typeof vi.fn<(c: ConfirmSaveChoice) => void>>> {
  const resolve = vi.fn<(c: ConfirmSaveChoice) => void>();
  await act(async () => {
    useConfirmSaveStore
      .getState()
      .open({ projectName: 'badge.lf2', action: 'start a new project', resolve });
  });
  return resolve;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button "${text}" missing`);
  return button;
}

describe('ConfirmSaveDialog (LU18)', () => {
  it('renders nothing without a pending request', () => {
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the three-way prompt naming the project and action', async () => {
    await openRequest();

    const dialog = host.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('badge.lf2 has unsaved changes');
    expect(dialog?.textContent).toContain('start a new project');
    expect(buttonByText('Save')).toBeInstanceOf(HTMLButtonElement);
    expect(buttonByText("Don't Save")).toBeInstanceOf(HTMLButtonElement);
    expect(buttonByText('Cancel')).toBeInstanceOf(HTMLButtonElement);
  });

  it('gives Save the initial focus and registers a modal (shortcut gate)', async () => {
    await openRequest();

    expect(document.activeElement).toBe(buttonByText('Save'));
    expect(useUiStore.getState().modalDepth).toBe(1);
  });

  it.each([
    ['Save', 'save'],
    ["Don't Save", 'discard'],
    ['Cancel', 'cancel'],
  ] as const)('clicking %s resolves %s and closes', async (label, choice) => {
    const resolve = await openRequest();

    await act(async () => {
      buttonByText(label).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(resolve).toHaveBeenCalledWith(choice);
    expect(useConfirmSaveStore.getState().request).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(useUiStore.getState().modalDepth).toBe(0);
  });

  it('Escape resolves cancel', async () => {
    const resolve = await openRequest();

    await act(async () => {
      const dialog = host.querySelector('[role="dialog"]');
      dialog?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    expect(resolve).toHaveBeenCalledWith('cancel');
    expect(useConfirmSaveStore.getState().request).toBeNull();
  });

  it('fails a second overlapping request closed instead of replacing the dialog', async () => {
    const first = await openRequest();
    const second = vi.fn<(c: ConfirmSaveChoice) => void>();

    await act(async () => {
      useConfirmSaveStore
        .getState()
        .open({ projectName: 'other.lf2', action: 'open another project', resolve: second });
    });

    expect(second).toHaveBeenCalledWith('cancel');
    expect(first).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('badge.lf2');
  });
});
