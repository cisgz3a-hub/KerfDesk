import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { PlatformProvider } from './platform-context';
import { useShortcuts } from './use-shortcuts';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Subject() {
  useShortcuts();
  return (
    <div>
      <button type="button">Connect</button>
      <div role="menuitem" tabIndex={0}>
        Frame
      </div>
      <div data-testid="canvas" tabIndex={0} />
    </div>
  );
}

function startPenDraft(): void {
  useUiStore.setState({
    modalDepth: 0,
    toolMode: { kind: 'draw', shape: 'polyline' },
    penDraft: {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      cursor: null,
    },
  });
}

afterEach(() => {
  useUiStore.getState().setToolMode({ kind: 'select' });
  useUiStore.getState().setPenDraft(null);
  resetStore();
});

it('leaves Enter on a focused button or menu item to that control, not the pen', async () => {
  resetStore();
  startPenDraft();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <PlatformProvider adapter={mockPlatform()}>
          <Subject />
        </PlatformProvider>,
      ),
    );
    const before = useStore.getState().project;
    for (const selector of ['button', '[role="menuitem"]']) {
      const control = host.querySelector<HTMLElement>(selector);
      if (control === null) throw new Error(`missing ${selector}`);
      control.focus();
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      await act(async () => control.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
      expect(useStore.getState().project).toBe(before);
      expect(useUiStore.getState().penDraft).not.toBeNull();
    }
    // Enter from a non-control target still finishes the pen.
    const canvas = host.querySelector<HTMLElement>('[data-testid="canvas"]');
    canvas?.focus();
    const finish = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => canvas?.dispatchEvent(finish));
    expect(finish.defaultPrevented).toBe(true);
    expect(useUiStore.getState().penDraft).toBeNull();
    expect(useStore.getState().project).not.toBe(before);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
