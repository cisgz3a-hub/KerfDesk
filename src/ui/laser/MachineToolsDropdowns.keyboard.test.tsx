import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { PlatformProvider } from '../app/platform-context';
import { useShortcuts } from '../app/use-shortcuts';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { MachineToolsDropdowns } from './MachineToolsDropdowns';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
function Subject() {
  useShortcuts();
  return (
    <MachineToolsDropdowns
      origin={<span>Origin tools</span>}
      placement={<span>Placement tools</span>}
      console={() => <span>Console tools</span>}
    />
  );
}
it.each(['Origin', 'Placement & output', 'Console'])(
  '%s owns native activation without committing a pen draft',
  async (label) => {
    resetStore();
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
      const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      if (!trigger) throw new Error('Missing utility trigger');
      trigger.focus();
      const before = useStore.getState().project;
      for (const key of ['Enter', ' ']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        await act(async () => trigger.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(false);
        expect(useStore.getState().project).toBe(before);
        expect(useUiStore.getState().penDraft).not.toBeNull();
      }
      // jsdom does not synthesise the browser's activation click.
      await act(async () => trigger.click());
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      useUiStore.getState().setToolMode({ kind: 'select' });
      useUiStore.getState().setPenDraft(null);
      resetStore();
    }
  },
);
