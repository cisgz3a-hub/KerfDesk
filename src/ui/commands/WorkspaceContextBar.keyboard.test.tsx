import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { jogAxisSignsForOrigin } from '../../core/devices/jog-direction';
import { PlatformProvider } from '../app/platform-context';
import { useShortcuts } from '../app/use-shortcuts';
import { installJogShortcuts } from '../laser/use-jog-shortcuts';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import type { AppCommand, CommandFamily, CommandId } from './command-registry';
import { WorkspaceContextBar } from './WorkspaceContextBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;
let uninstallJog: (() => void) | null = null;
const invoke = vi.fn();
const windowKeys = vi.fn();
const commands: readonly AppCommand[] = [
  command('edit.copy', 'Copy'),
  command('edit.cut', 'Cut', false),
  command('edit.duplicate', 'Duplicate'),
  command('edit.delete', 'Delete'),
  command('arrange.align-left', 'Align Left'),
  command('arrange.align-right', 'Align Right', false),
  command('window.fit-view', 'Fit View'),
];

function ContextMenuWithShortcuts(): JSX.Element {
  useShortcuts();
  return <WorkspaceContextBar commands={commands} />;
}

beforeEach(async () => {
  resetStore();
  useUiStore.setState({ modalDepth: 0, workspaceContextBar: null });
  useUiStore.getState().setToolMode({ kind: 'select' });
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: { ...state.project.scene, objects: [svgObj('selected', ['#000000'])] },
    },
    selectedObjectId: 'selected',
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  useUiStore.getState().openWorkspaceContextBar({ x: 80, y: 90, context: 'workspace-selection' });
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform()}>
        <ContextMenuWithShortcuts />
      </PlatformProvider>,
    );
  });
  window.addEventListener('keydown', windowKeys);
});

afterEach(async () => {
  window.removeEventListener('keydown', windowKeys);
  uninstallJog?.();
  uninstallJog = null;
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  useUiStore.getState().closeWorkspaceContextBar();
  resetStore();
  vi.clearAllMocks();
});

describe('WorkspaceContextBar keyboard ownership', () => {
  it('navigates primary and More actions, skips disabled rows and keeps artwork unchanged', async () => {
    const before = snapshot();
    expect(document.activeElement).toBe(button('Copy'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(button('Duplicate'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(button('Delete'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(button('More'));
    await openMore();
    await press('ArrowDown');
    expect(document.activeElement).toBe(button('Align Left'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(button('Fit View'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(button('Copy'));
    await press('ArrowUp');
    expect(document.activeElement).toBe(button('Fit View'));
    expect(windowKeys).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('uses Home and End across the expanded menu without bubbling to the workspace', async () => {
    await openMore();
    const end = await press('End');
    expect(document.activeElement).toBe(button('Fit View'));
    expect(end.defaultPrevented).toBe(true);
    const home = await press('Home');
    expect(document.activeElement).toBe(button('Copy'));
    expect(home.defaultPrevented).toBe(true);
    expect(windowKeys).not.toHaveBeenCalled();
  });

  it('leaves Page keys scrolling the menu without requesting machine motion', async () => {
    const before = snapshot();
    const motion = installMotionSpies();
    await openMore();
    button('Align Left').focus();
    for (const key of ['PageDown', 'PageUp']) {
      const event = await press(key);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(motion.onFocusJog).not.toHaveBeenCalled();
    expect(motion.onXyJog).not.toHaveBeenCalled();
    expect(windowKeys).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('does not let editing, tool, Start or XY jog shortcuts escape focused menu controls', async () => {
    const before = snapshot();
    const motion = installMotionSpies();
    for (const key of ['a', 'c', 'v', 'z', 'Enter']) await press(key, { ctrlKey: true });
    for (const key of ['Delete', 'v', 't', 'ArrowDown']) await press(key);
    await press('[', { code: 'BracketLeft', ctrlKey: true, altKey: true });
    await press('8', { code: 'Numpad8' });
    expect(windowKeys).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(motion.onFocusJog).not.toHaveBeenCalled();
    expect(motion.onXyJog).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it.each(['ctrlKey', 'metaKey'] as const)(
    'keeps the %s software Abort shortcut reachable',
    async (modifier) => {
      await openMore();
      button('Align Left').focus();
      const event = await press('.', { [modifier]: true });
      expect(windowKeys).toHaveBeenCalledTimes(1);
      expect(windowKeys).toHaveBeenCalledWith(event);
      expect(event.defaultPrevented).toBe(false);
      expect(useUiStore.getState().workspaceContextBar).not.toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each(['Enter', ' '] as const)(
    'retains native %s button activation and runs a More action once',
    async (key) => {
      await openMore();
      const action = button('Align Left');
      action.focus();
      const event = await press(key);
      expect(event.defaultPrevented).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
      // jsdom does not synthesize native keyboard clicks. Deliver that default
      // once and prove the key handler did not also invoke the command itself.
      await act(async () => action.click());
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(windowKeys).not.toHaveBeenCalled();
      expect(useUiStore.getState().workspaceContextBar).toBeNull();
      expect(host.querySelector('[role="menu"]')).toBeNull();
    },
  );

  it.each([false, true])('leaves native Tab traversal available (shift=%s)', async (shiftKey) => {
    const event = await press('Tab', { shiftKey });
    expect(event.defaultPrevented).toBe(false);
    expect(windowKeys).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('consumes Escape to dismiss the popup while retaining the artwork selection', async () => {
    const before = snapshot();
    await openMore();
    const event = await press('Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(windowKeys).not.toHaveBeenCalled();
    expect(useUiStore.getState().workspaceContextBar).toBeNull();
    expect(snapshot()).toEqual(before);
  });
});

function button(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (match === undefined) throw new Error(`Missing ${label} menu button`);
  return match;
}

async function openMore(): Promise<void> {
  await act(async () => {
    button('More').focus();
    button('More').click();
  });
}

async function press(key: string, options: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  await act(async () => (document.activeElement ?? document.body).dispatchEvent(event));
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
    sceneClipboard: state.sceneClipboard,
    toolMode: useUiStore.getState().toolMode,
  };
}

function installMotionSpies() {
  const onFocusJog = vi.fn();
  const onXyJog = vi.fn();
  uninstallJog = installJogShortcuts(window, {
    focusDisabled: () => false,
    onFocusJog,
    xyDisabled: () => false,
    xyStep: () => ({ stepMm: 10, feed: 3000, signs: jogAxisSignsForOrigin('front-left') }),
    onXyJog,
  });
  return { onFocusJog, onXyJog };
}

function command(id: CommandId, label: string, enabled = true): AppCommand {
  const family = id.split('.')[0] as CommandFamily;
  return { id, family, label, title: label, enabled, invoke };
}
