import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { AdjustDialogPanel } from './AdjustDialog';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  useImageEditorStore.setState({
    session: createSession('image', 'image.png', createRgbaBuffer(2, 1), {
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 1,
    }),
    transform: null,
  });
  useAdjustDialogStore.getState().open('brightness-contrast');
  useAdjustDialogStore.getState().setParams({ brightness: -100 });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<AdjustDialogPanel />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  useAdjustDialogStore.getState().cancel();
  useImageEditorStore.setState({ session: null });
});

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (element) => element.textContent === label,
  );
  if (found === undefined) throw new Error(`missing ${label}`);
  return found;
}

async function key(target: HTMLElement, value: string): Promise<KeyboardEvent> {
  target.focus();
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('adjustment dialog keyboard actions', () => {
  it.each(['Cancel', 'Reset', 'OK'])('preserves native Enter activation of %s', async (label) => {
    const target = button(label);
    const event = await key(target, 'Enter');
    // jsdom does not synthesize the browser's Enter -> click default action.
    // The bubbled keydown must leave the edit untouched before that click.
    expect(event.defaultPrevented).toBe(false);
    expect(useAdjustDialogStore.getState().dialog).not.toBeNull();
    expect(useImageEditorStore.getState().session?.history.undoStack).toHaveLength(0);
    await act(async () => {
      target.click();
    });
    const session = useImageEditorStore.getState().session;
    expect(session?.history.undoStack).toHaveLength(label === 'OK' ? 1 : 0);
    expect(session?.doc.data[0]).toBe(label === 'OK' ? 127 : 255);
    if (label === 'Reset') {
      expect(useAdjustDialogStore.getState().dialog?.params['brightness']).toBe(0);
    } else {
      expect(useAdjustDialogStore.getState().dialog).toBeNull();
    }
  });

  it('commits once from a numeric field and prevents its default Enter behavior', async () => {
    const target = host.querySelector<HTMLInputElement>('input[type="number"]');
    if (target === null) throw new Error('missing numeric field');
    const event = await key(target, 'Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(useAdjustDialogStore.getState().dialog).toBeNull();
    expect(useImageEditorStore.getState().session?.history.undoStack).toHaveLength(1);
    expect(useImageEditorStore.getState().session?.doc.data[0]).toBe(127);
  });

  it('cancels with Escape without changing pixels or history', async () => {
    await key(button('OK'), 'Escape');
    expect(useAdjustDialogStore.getState().dialog).toBeNull();
    expect(useImageEditorStore.getState().session?.history.undoStack).toHaveLength(0);
    expect(useImageEditorStore.getState().session?.doc.data[0]).toBe(255);
  });
});

// ADR-245 Amendment 2: a neighbourhood filter rendering in the worker shows a
// bar with Cancel; Cancel stops it and turns Preview off, and OK still applies.
describe('preview render progress', () => {
  it('shows the bar only while a render is pending, and Cancel turns Preview off', async () => {
    expect(host.querySelector('progress')).toBeNull();
    await act(async () => {
      useAdjustDialogStore.getState().setPreviewProgress(0.42);
    });
    const bar = host.querySelector('progress');
    expect(bar?.getAttribute('aria-label')).toBe('Preview render progress');
    expect(bar?.value).toBe(0.42);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Rendering preview… 42%');
    await act(async () => {
      button('Cancel preview').click();
    });
    expect(host.querySelector('progress')).toBeNull();
    const dialog = useAdjustDialogStore.getState().dialog;
    expect(dialog?.previewEnabled).toBe(false);
    expect(dialog?.previewProgress).toBeNull();
    await act(async () => {
      button('OK').click();
    });
    expect(useImageEditorStore.getState().session?.doc.data[0]).toBe(127);
  });
});
