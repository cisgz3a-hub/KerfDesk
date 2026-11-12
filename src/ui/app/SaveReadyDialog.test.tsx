import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useSaveReadyDialogStore,
  type SaveReadyDialogRequest,
} from '../state/save-ready-dialog-store';
import { useUiStore } from '../state/ui-store';
import { SaveReadyDialog } from './SaveReadyDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useSaveReadyDialogStore.setState({ request: null });
  useUiStore.setState({ modalDepth: 0 });
});

async function show(request: Partial<SaveReadyDialogRequest>): Promise<SaveReadyDialogRequest> {
  const full: SaveReadyDialogRequest = {
    title: 'Export SVG',
    message: 'The SVG is ready.',
    phase: 'ready',
    cancel: vi.fn(),
    choose: vi.fn(),
    ...request,
  };
  await act(async () => {
    root.render(<SaveReadyDialog />);
    useSaveReadyDialogStore.getState().show(full);
  });
  return full;
}

const button = (name: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === name);

describe('SaveReadyDialog', () => {
  it('asks where to save prepared output', async () => {
    await show({});

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      'The SVG is ready. Choose a filename and folder to save it.',
    );
  });

  it('an Open says only its own message, and what the file dialog is for', async () => {
    const message = 'coaster.lf2 is saved. Choose the project to open.';
    await show({ title: 'Open project', message, picks: 'open' });

    expect(host.querySelector('.lf-dialog-body')?.textContent).toBe(message);

    await show({ title: 'Open project', message, picks: 'open', phase: 'choosing' });

    expect(host.querySelector('.lf-dialog-body')?.textContent).toBe(
      'Choose the file in the file dialog.',
    );
    expect(button('Choose file…')?.disabled).toBe(true);
    expect(button('Cancel')?.disabled).toBe(true);
  });

  it('an Open puts the first focus on Choose file…, so Enter continues it', async () => {
    const request = await show({ title: 'Open project', picks: 'open' });

    expect(document.activeElement).toBe(button('Choose file…'));
    await act(async () => button('Choose file…')?.click());
    expect(request.choose).toHaveBeenCalledOnce();
    expect(request.cancel).not.toHaveBeenCalled();
  });

  it('Cancel answers the request', async () => {
    const request = await show({ title: 'Open project', picks: 'open' });

    await act(async () => button('Cancel')?.click());

    expect(request.cancel).toHaveBeenCalledOnce();
    expect(request.choose).not.toHaveBeenCalled();
  });
});
