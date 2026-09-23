import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { PlatformProvider } from '../app/platform-context';
import { useShortcuts } from '../app/use-shortcuts';
import { useJobShortcuts } from '../laser/use-job-shortcuts';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { AppMenuBar } from './AppMenuBar';
import type { AppCommand, CommandFamily } from './command-registry';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
const initialLaser = useLaserStore.getState();
const invoke = vi.fn();
const commands: readonly AppCommand[] = [
  { id: 'file.open', family: 'file', label: 'Unavailable', title: '', enabled: false, invoke },
  { id: 'file.new', family: 'file', label: 'New', title: '', enabled: true, invoke },
  { id: 'file.save', family: 'file', label: 'Save', title: '', enabled: true, invoke },
  { id: 'edit.undo', family: 'edit', label: 'Undo', title: '', enabled: true, invoke },
  {
    id: 'edit.copy',
    family: 'edit',
    label: 'Copy',
    title: '',
    enabled: true,
    invoke: () => useStore.getState().copySelection(),
  },
  { id: 'tools.measure', family: 'tools', label: 'Measure', title: '', enabled: true, invoke },
];

function MenuWithShortcuts(): JSX.Element {
  useShortcuts();
  useJobShortcuts();
  return <AppMenuBar commands={commands} machineKind="laser" />;
}

beforeEach(async () => {
  resetStore();
  useUiStore.getState().setToolMode({ kind: 'select' });
  useUiStore.setState({ modalDepth: 0 });
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: { ...state.project.scene, objects: [svgObj('selected', ['#000000'])] },
    },
    selectedObjectId: 'selected',
    undoStack: [state.project],
    redoStack: [state.project],
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform()}>
        <MenuWithShortcuts />
      </PlatformProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  useLaserStore.setState(initialLaser);
  vi.clearAllMocks();
});

function summary(family: CommandFamily): HTMLElement {
  const element = host.querySelector(`[data-menu-family-summary="${family}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing ${family} summary`);
  return element;
}

async function press(key: string, options: KeyboardEventInit = {}, target?: EventTarget) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  await act(async () => (target ?? document.activeElement ?? document).dispatchEvent(event));
  return event;
}

function snapshot() {
  const state = useStore.getState();
  return {
    project: state.project,
    selectedObjectId: state.selectedObjectId,
    additionalSelectedIds: state.additionalSelectedIds,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    toolMode: useUiStore.getState().toolMode,
    previewMode: state.previewMode,
  };
}

describe('menu keyboard ownership', () => {
  it('focuses enabled commands after pointer opening and keeps navigation out of canvas history', async () => {
    const before = snapshot();
    await act(async () => summary('file').click());
    expect(document.activeElement?.textContent).toBe('New');
    await press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('Save');
    await press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('New');
    await press('End');
    expect(document.activeElement?.textContent).toBe('Save');
    await press('Home');
    expect(document.activeElement?.textContent).toBe('New');
    await press('Escape');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(summary('file'));
    expect(snapshot()).toEqual(before);
  });

  it('opens from the keyboard and navigates between menu families', async () => {
    await act(async () => summary('file').focus());
    await press('ArrowUp');
    expect(document.activeElement?.textContent).toBe('Save');
    await press('ArrowRight');
    expect(document.activeElement?.textContent).toBe('Undo');
    await press('ArrowLeft');
    expect(document.activeElement?.textContent).toBe('New');
    await press('Escape');
    await press('End');
    expect(document.activeElement).toBe(summary('tools'));
    await press('Home');
    expect(document.activeElement).toBe(summary('file'));
    await press('Enter');
    expect(document.activeElement?.textContent).toBe('New');
    await act(async () => summary('file').focus());
    await press('ArrowUp');
    expect(document.activeElement?.textContent).toBe('Save');
  });

  it('keeps a menu with only disabled commands on its summary for dismissal', async () => {
    await act(async () => {
      root?.render(
        <AppMenuBar
          commands={commands.map((command) => ({ ...command, enabled: false }))}
          machineKind="laser"
        />,
      );
    });
    await act(async () => summary('tools').click());
    expect(document.activeElement).toBe(summary('tools'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(summary('tools'));
    await press('Escape');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(summary('tools'));
  });

  it.each([false, true])(
    'closes on Tab (shift=%s) while allowing focus to leave the menubar',
    async (shiftKey) => {
      const before = snapshot();
      await act(async () => summary('file').click());
      expect(
        [...host.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].every(
          (button) => button.tabIndex === -1,
        ),
      ).toBe(true);
      const event = await press('Tab', { shiftKey });
      expect(event.defaultPrevented).toBe(false);
      expect(host.querySelector('[role="menu"]')).toBeNull();
      // jsdom does not perform native Tab traversal; the persistent summary is
      // its departure point so removal of a focused menu item cannot trap focus.
      expect(document.activeElement).toBe(summary('file'));
      expect(snapshot()).toEqual(before);
    },
  );

  it('does not run edit, transform, tool or Start shortcuts while a menu owns focus', async () => {
    const before = snapshot();
    const windowKeys = vi.fn();
    window.addEventListener('keydown', windowKeys);
    try {
      await act(async () => summary('file').click());
      for (const key of ['z', 'y', 'a', 'c', 'v', 'Enter']) await press(key, { ctrlKey: true });
      await press('Delete');
      await press('v');
      await press('ArrowUp');
      expect(windowKeys).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(useStore.getState().sceneClipboard).toBeNull();
      expect(snapshot()).toEqual(before);
    } finally {
      window.removeEventListener('keydown', windowKeys);
    }
  });

  it.each([
    { modifier: 'ctrlKey', close: 'escape' },
    { modifier: 'metaKey', close: 'escape' },
    { modifier: 'ctrlKey', close: 'copy-command' },
    { modifier: 'metaKey', close: 'copy-command' },
  ] as const)(
    'allows internal Copy/Paste with $modifier after $close returns focus to a closed summary',
    async ({ modifier, close }) => {
      const before = useStore.getState().project;
      const undoCount = useStore.getState().undoStack.length;
      if (close === 'escape') {
        await act(async () => summary('file').click());
        await press('Escape');
        expect(document.activeElement).toBe(summary('file'));
        await press('c', { [modifier]: true });
      } else {
        await act(async () => summary('edit').click());
        const copy = [...host.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(
          (button) => button.textContent === 'Copy',
        );
        if (copy === undefined) throw new Error('Missing Copy command');
        await act(async () => copy.click());
        expect(document.activeElement).toBe(summary('edit'));
      }
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(useStore.getState().sceneClipboard?.selectedObjectIds).toEqual(['selected']);
      expect(useStore.getState().project).toBe(before);

      await press('v', { [modifier]: true });

      const after = useStore.getState();
      expect(after.project.scene.objects).toHaveLength(2);
      expect(after.project.scene.objects[1]?.transform).toMatchObject({ x: 10, y: 10 });
      expect(after.selectedObjectId).toBe(after.project.scene.objects[1]?.id);
      expect(after.undoStack).toHaveLength(undoCount + 1);
    },
  );

  it('leaves native text Copy/Paste untouched after the menu closes', async () => {
    await act(async () => summary('file').click());
    await press('Escape');
    const input = document.createElement('input');
    input.value = 'text draft';
    host.appendChild(input);
    input.focus();
    const before = snapshot();
    const copy = await press('c', { ctrlKey: true });
    const paste = await press('v', { ctrlKey: true });
    expect(copy.defaultPrevented).toBe(false);
    expect(paste.defaultPrevented).toBe(false);
    expect(useStore.getState().sceneClipboard).toBeNull();
    expect(snapshot()).toEqual(before);
  });

  it.each(['ctrlKey', 'metaKey'] as const)(
    'preserves the real software Abort route with %s',
    async (modifier) => {
      const cancelJog = vi.fn(async () => undefined);
      useLaserStore.setState({
        streamer: null,
        cancelJog,
        motionOperation: {
          operationId: 1,
          kind: 'frame',
          sawControllerBusy: false,
          idleStatusReports: 0,
          dispatchComplete: true,
          pendingLines: [],
        },
      });
      await act(async () => summary('file').click());
      await press('.', { [modifier]: true });
      expect(cancelJog).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[role="menu"]')).not.toBeNull();
    },
  );

  it('dismisses an outside pointer press without changing the canvas selection', async () => {
    const before = snapshot();
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const canvasDown = vi.fn(() => useStore.getState().selectObject(null));
    canvas.addEventListener('pointerdown', canvasDown);
    await act(async () => summary('file').click());
    await act(async () =>
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })),
    );
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(canvasDown).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('handles Escape from outside the menu without leaking deselection', async () => {
    const before = snapshot();
    await act(async () => summary('file').click());
    await press('Escape', {}, document);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(summary('file'));
    expect(snapshot()).toEqual(before);
  });
});
