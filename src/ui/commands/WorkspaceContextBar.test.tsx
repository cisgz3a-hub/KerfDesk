import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import type { AppCommand, CommandId } from './command-registry';
import { WorkspaceContextBar } from './WorkspaceContextBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  useUiStore.getState().closeWorkspaceContextBar();
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  useUiStore.getState().closeWorkspaceContextBar();
  vi.restoreAllMocks();
});

describe('WorkspaceContextBar', () => {
  it('shows empty-workspace commands in a vertical dropdown without selection-only actions', async () => {
    useUiStore.getState().openWorkspaceContextBar({ x: 80, y: 90, context: 'workspace-empty' });
    const h = await renderBar(commands());
    const menu = h.querySelector('[aria-label="Workspace quick actions"]');

    expect(h.textContent).toContain('Paste');
    expect(h.textContent).toContain('Import SVG...');
    expect(h.textContent).toContain('Import Image...');
    expect(h.textContent).toContain('Text...');
    expect(h.textContent).toContain('Preview');
    expect(h.textContent).toContain('Fit View');
    expect(h.textContent).not.toContain('Copy');
    if (!(menu instanceof HTMLElement)) throw new Error('quick bar missing');
    const paste = buttonByText(h, 'Paste');
    expect(menu.getAttribute('aria-orientation')).toBe('vertical');
    expect(menu.classList.contains('lf-workspace-context-menu')).toBe(true);
    expect(menu.style.flexDirection).toBe('column');
    expect(menu.style.overflowX).toBe('hidden');
    expect(paste.classList.contains('lf-menu-item')).toBe(true);
    expect(paste.classList.contains('lf-btn')).toBe(false);
    expect(paste.style.width).toBe('100%');
  });

  it('runs enabled quick-bar commands through the command object and closes', async () => {
    const onDuplicate = vi.fn();
    useUiStore.getState().openWorkspaceContextBar({ x: 80, y: 90, context: 'workspace-selection' });
    const h = await renderBar(commands({ 'edit.duplicate': onDuplicate }));

    await clickButton(h, 'Duplicate');

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().workspaceContextBar).toBeNull();
  });

  it('shows Fill Selection in the selected-object dropdown', async () => {
    useUiStore.getState().openWorkspaceContextBar({ x: 80, y: 90, context: 'workspace-selection' });
    const h = await renderBar(commands());

    expect(h.textContent).toContain('Copy');
    expect(h.textContent).toContain('Fill Selection');
    expect(h.textContent).not.toContain('Paste');
  });

  it('keeps disabled command buttons inert', async () => {
    const onCopy = vi.fn();
    useUiStore.getState().openWorkspaceContextBar({ x: 80, y: 90, context: 'workspace-selection' });
    const h = await renderBar(commands({ 'edit.copy': onCopy }, new Set(['edit.copy'])));
    const copy = buttonByText(h, 'Copy');

    expect(copy.disabled).toBe(true);
    await clickButton(h, 'Copy');

    expect(onCopy).not.toHaveBeenCalled();
    expect(useUiStore.getState().workspaceContextBar).not.toBeNull();
  });

  it('expands context More actions inside the vertical dropdown and excludes laser machine commands', async () => {
    useUiStore.getState().openWorkspaceContextBar({ x: 80, y: 90, context: 'workspace-selection' });
    const h = await renderBar(commands());

    await clickButton(h, 'More');
    const menus = h.querySelectorAll('[role="menu"]');

    expect(menus).toHaveLength(2);
    expect((menus[1] as HTMLElement).style.position).toBe('static');
    expect((menus[1] as HTMLElement).style.flexDirection).toBe('column');
    expect(h.textContent).toContain('Align Left');
    expect(h.textContent).toContain('Break Apart');
    expect(h.textContent).toContain('Close Open Fill Contours');
    expect(h.textContent).toContain('Close Fill Contours With Tolerance...');
    expect(h.textContent).toContain('Flip Horizontal');
    expect(h.textContent).toContain('Convert to Bitmap...');
    expect(h.textContent).not.toContain('Home');
    expect(h.textContent).not.toContain('Connect');
  });

  it('clamps the floating surface inside the viewport', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(180);
    useUiStore.getState().openWorkspaceContextBar({ x: 999, y: 999, context: 'workspace-empty' });
    const h = await renderBar(commands());
    const menu = h.querySelector('[aria-label="Workspace quick actions"]');
    if (!(menu instanceof HTMLElement)) throw new Error('quick bar missing');

    expect(Number.parseFloat(menu.style.left)).toBeLessThan(999);
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(999);
  });
});

async function renderBar(appCommands: ReadonlyArray<AppCommand>): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<WorkspaceContextBar commands={appCommands} />);
  });
  return host;
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = buttonByText(container, label);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return button;
}

function commands(
  handlers: Partial<Record<CommandId, () => void>> = {},
  disabledIds: ReadonlySet<CommandId> = new Set(),
): ReadonlyArray<AppCommand> {
  return COMMAND_IDS.map((id) => ({
    id,
    family: familyForCommand(id),
    label: labelForCommand(id),
    title: labelForCommand(id),
    enabled: !disabledIds.has(id),
    ...(disabledIds.has(id) ? { disabledReason: `${labelForCommand(id)} unavailable.` } : {}),
    invoke: handlers[id] ?? vi.fn(),
  }));
}

function familyForCommand(id: CommandId): AppCommand['family'] {
  if (id.startsWith('file.')) return 'file';
  if (id.startsWith('edit.')) return 'edit';
  if (id.startsWith('tools.')) return 'tools';
  if (id.startsWith('arrange.')) return 'arrange';
  if (id.startsWith('laser.')) return 'laser';
  return 'window';
}

function labelForCommand(id: CommandId): string {
  return COMMAND_LABELS[id] ?? id;
}

const COMMAND_IDS: ReadonlyArray<CommandId> = [
  'edit.copy',
  'edit.cut',
  'edit.paste',
  'edit.group',
  'edit.ungroup',
  'edit.lock-selection',
  'edit.unlock-all',
  'edit.duplicate',
  'edit.delete',
  'file.import-svg',
  'file.import-image',
  'tools.add-text',
  'tools.adjust-image',
  'tools.trace-image',
  'tools.convert-to-bitmap',
  'tools.fill-selection',
  'tools.close-open-fill-contours',
  'tools.close-fill-contours-with-tolerance',
  'arrange.align-left',
  'arrange.break-apart',
  'arrange.flip-horizontal',
  'laser.connect',
  'laser.home',
  'window.toggle-preview',
  'window.fit-view',
];

const COMMAND_LABELS: Partial<Record<CommandId, string>> = {
  'edit.copy': 'Copy',
  'edit.cut': 'Cut',
  'edit.paste': 'Paste',
  'edit.group': 'Group',
  'edit.ungroup': 'Ungroup',
  'edit.lock-selection': 'Lock Selection',
  'edit.unlock-all': 'Unlock All',
  'edit.duplicate': 'Duplicate',
  'edit.delete': 'Delete',
  'file.import-svg': 'Import SVG...',
  'file.import-image': 'Import Image...',
  'tools.add-text': 'Text...',
  'tools.adjust-image': 'Adjust Image...',
  'tools.trace-image': 'Trace Image...',
  'tools.convert-to-bitmap': 'Convert to Bitmap...',
  'tools.fill-selection': 'Fill Selection',
  'tools.close-open-fill-contours': 'Close Open Fill Contours',
  'tools.close-fill-contours-with-tolerance': 'Close Fill Contours With Tolerance...',
  'arrange.align-left': 'Align Left',
  'arrange.break-apart': 'Break Apart',
  'arrange.flip-horizontal': 'Flip Horizontal',
  'laser.connect': 'Connect',
  'laser.home': 'Home',
  'window.toggle-preview': 'Preview',
  'window.fit-view': 'Fit View',
};
