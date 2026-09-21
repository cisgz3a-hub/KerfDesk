import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorAdjustMenus } from './EditorAdjustMenus';
import { createEditorTestBuffer } from './create-editor-test-buffer';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import { useResizeDialogStore } from './resize-dialog-store';

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
  useResizeDialogStore.setState({ dialog: null });
  useImageEditorStore.setState({ session: null, sessionOwner: null, transform: null });
});

function trigger(name: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === `${name} ▾`,
  );
  if (button === undefined) throw new Error(`${name} menu trigger missing`);
  return button;
}

async function key(target: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    );
  });
}

function menuItems(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

describe('Image Studio operation menus', () => {
  it('opens at either end with arrow keys, moves focus, and dismisses with Escape', async () => {
    const onEditorKey = vi.fn();
    await act(async () =>
      root.render(
        <div onKeyDown={onEditorKey}>
          <EditorAdjustMenus />
        </div>,
      ),
    );
    const image = trigger('Image');
    image.focus();
    await key(image, 'ArrowDown');
    const items = menuItems();
    expect(items).toHaveLength(2);
    expect(document.activeElement).toBe(items[0]);
    expect(image.getAttribute('aria-controls')).toBe(host.querySelector('[role="menu"]')?.id);
    await key(items[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    await key(items[1]!, 'Escape');
    expect(menuItems()).toHaveLength(0);
    expect(document.activeElement).toBe(image);
    expect(onEditorKey).not.toHaveBeenCalled();

    await key(image, 'ArrowUp');
    expect(document.activeElement).toBe(menuItems()[1]);
    await key(menuItems()[1]!, 'Home');
    expect(document.activeElement).toBe(menuItems()[0]);
  });

  it('hands the selected image operation to its dialog and keeps a usable focus return target', async () => {
    useImageEditorStore.setState({
      session: createSession('menu-image', 'source.png', createEditorTestBuffer(2, 2), {
        minX: 0,
        minY: 0,
        maxX: 2,
        maxY: 2,
      }),
      transform: null,
    });
    await act(async () => root.render(<EditorAdjustMenus />));
    const image = trigger('Image');
    await act(async () => image.click());
    const first = menuItems()[0];
    if (first === undefined) throw new Error('Image Size menu item missing');
    await act(async () => first.click());
    expect(useResizeDialogStore.getState().dialog?.kind).toBe('image-size');
    expect(menuItems()).toHaveLength(0);
    expect(document.activeElement).toBe(image);
  });

  it('dismisses on Tab before focus moves to the next studio control', async () => {
    await act(async () => root.render(<EditorAdjustMenus />));
    const filter = trigger('Filter');
    await act(async () => filter.click());
    const first = menuItems()[0];
    if (first === undefined) throw new Error('Filter menu item missing');
    await key(first, 'Tab');
    expect(menuItems()).toHaveLength(0);
    expect(document.activeElement).toBe(filter);
  });

  it('explains why image operations cannot run during an unfinished transform', async () => {
    useImageEditorStore.setState({
      session: createSession('transform-menu', 'source.png', createEditorTestBuffer(2, 2), {
        minX: 0,
        minY: 0,
        maxX: 2,
        maxY: 2,
      }),
      transform: null,
    });
    useImageEditorStore.getState().startTransform();
    expect(useImageEditorStore.getState().transform).not.toBeNull();
    await act(async () => root.render(<EditorAdjustMenus />));
    for (const name of ['Image', 'Adjust', 'Filter']) {
      expect(trigger(name).disabled).toBe(true);
      expect(trigger(name).title).toContain('Finish or cancel Free Transform');
    }
    await act(async () => useImageEditorStore.getState().cancelTransform());
    expect(trigger('Image').disabled).toBe(false);
    await act(async () => trigger('Image').click());
    expect(menuItems()).toHaveLength(2);
  });
});
