import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppCommand } from '../commands/command-registry';
import { Toolbar } from './Toolbar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe('Toolbar overflow interactions', () => {
  it('prioritises the file-to-preview workflow and reveals image actions with an image selection', async () => {
    const fresh = command('file.new', 'New');
    const trace = command('tools.trace-image', 'Trace Image...', {
      enabled: false,
      disabledReason: 'Select an image first.',
    });
    const commands = [
      fresh,
      command('file.open', 'Open...'),
      command('file.import', 'Import...'),
      command('file.import-image', 'Import Image...'),
      command('file.save', 'Save'),
      command('window.toggle-preview', 'Preview', { active: false }),
      command('tools.add-text', 'Text...'),
      trace,
      command('tools.edit-image', 'Image Studio...'),
    ];
    await render(commands);
    expect(
      [...(host?.querySelectorAll('button[data-help-id]') ?? [])].map((item) =>
        item.getAttribute('aria-label'),
      ),
    ).toEqual(['Open...', 'Import...', 'Import Image...', 'Save', 'Preview']);
    await act(async () => button('More commands').click());
    expect(document.querySelectorAll('button[data-help-id]')).toHaveLength(commands.length);
    expect(button('Trace Image...').disabled).toBe(true);
    expect(button('Image Studio...').closest('[role="menu"]')).not.toBeNull();
    await act(async () => button('New').click());
    expect(fresh.invoke).toHaveBeenCalledOnce();

    const withImage = commands.map((item) =>
      item.id === 'tools.trace-image' ? { ...item, enabled: true } : item,
    );
    await act(async () => root?.render(<Toolbar commands={withImage} machineKind="laser" />));
    expect(host?.querySelector('button[aria-label="Trace Image..."]')).not.toBeNull();
    expect(host?.querySelector('button[aria-label="Image Studio..."]')).toBeNull();
    await act(async () => button('Trace Image...').click());
    expect(trace.invoke).toHaveBeenCalledOnce();

    await act(async () => root?.render(<Toolbar commands={commands} machineKind="laser" />));
    expect(host?.querySelector('button[aria-label="Trace Image..."]')).toBeNull();
    await act(async () => button('More commands').click());
    expect(document.querySelectorAll('button[data-help-id]')).toHaveLength(commands.length);
    expect(button('Trace Image...').disabled).toBe(true);
    await press('Escape');
  });

  it('keeps extra commands reachable with registry help, shortcuts, disabled state and dispatch', async () => {
    const save = command('file.save-gcode', 'Save G-code...', { shortcut: 'Ctrl+Shift+E' });
    const camera = command('tools.camera', 'Camera', {
      enabled: false,
      disabledReason: 'Set up the camera first.',
    });
    await render([command('file.new', 'New'), camera, save]);
    const trigger = button('More commands');
    await act(async () => trigger.click());
    const cameraButton = button('Camera');
    expect(cameraButton.disabled).toBe(true);
    expect(cameraButton.title).toContain('Set up the camera first.');
    expect(cameraButton.dataset['helpId']).toBe('command:tools.camera');
    await act(async () => cameraButton.click());
    expect(camera.invoke).not.toHaveBeenCalled();
    const saveButton = button('Save G-code...');
    expect(saveButton.title).toContain('Ctrl+Shift+E');
    expect(saveButton.querySelector('kbd')?.textContent).toBe('Ctrl+Shift+E');
    await act(async () => saveButton.click());
    expect(save.invoke).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('moves tools into More as available width shrinks and restores them as it grows', async () => {
    let available = 800;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = this.classList.contains('lf-toolbar-command-groups')
        ? available
        : this.hasAttribute('data-measure-more')
          ? 70
          : this.dataset['measureCommand']?.startsWith('tools.') ||
              this.dataset['measureCommand'] === 'file.import-image'
            ? 100
            : 32;
      return DOMRect.fromRect({ width, height: 30 });
    });
    const commands = [
      command('file.new', 'New'),
      command('file.save', 'Save'),
      command('file.import', 'Import...'),
      command('file.import-image', 'Import Image...'),
      command('tools.add-text', 'Text...'),
      command('tools.trace-image', 'Trace Image...'),
      command('tools.edit-image', 'Image Studio...'),
      command('tools.camera', 'Camera'),
    ];
    await render(commands);
    expect(host?.querySelector('button[aria-label="Import Image..."]')).not.toBeNull();
    // Image Studio is never a primary button now, at any width.
    expect(host?.querySelector('button[aria-label="Image Studio..."]')).toBeNull();
    available = 200;
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(host?.querySelector('button[aria-label="Import Image..."]')).toBeNull();
    expect(host?.querySelector('button[aria-label="Trace Image..."]')).toBeNull();
    await act(async () => button('More commands').click());
    expect(button('Import Image...').closest('[role="menu"]')).not.toBeNull();
    expect(button('Image Studio...').closest('[role="menu"]')).not.toBeNull();
    expect(button('Trace Image...').closest('[role="menu"]')).not.toBeNull();
    expect(document.querySelectorAll('button[data-help-id]')).toHaveLength(commands.length);
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    available = 800;
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(host?.querySelector('button[aria-label="Import Image..."]')).not.toBeNull();
  });

  it('supports keyboard opening, skips disabled commands, and restores focus on Escape', async () => {
    await render([
      command('file.save-as', 'Save As...'),
      command('tools.camera', 'Camera', { enabled: false }),
      command('tools.box-generator', 'Box Generator...'),
      command('file.save-gcode', 'Save G-code...'),
    ]);
    const trigger = button('More commands');
    await act(async () =>
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    expect(document.activeElement).toBe(button('Save As...'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(button('Box Generator...'));
    await press('End');
    expect(document.activeElement).toBe(button('Save G-code...'));
    await press('Home');
    expect(document.activeElement).toBe(button('Save As...'));
    await press('Escape');
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await act(async () =>
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })),
    );
    expect(document.activeElement).toBe(button('Save G-code...'));
    await press('Tab');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on outside pointer input without running a command or stealing focus', async () => {
    const camera = command('tools.camera', 'Camera');
    await render([camera]);
    await act(async () => button('More commands').click());
    const layout = document.querySelector<HTMLButtonElement>('[aria-label="Workspace layout"]');
    layout?.focus();
    await act(async () => layout?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(layout);
    expect(camera.invoke).not.toHaveBeenCalled();
  });

  it('clamps the menu inside a short viewport and repositions on resize', async () => {
    await render([command('tools.camera', 'Camera')]);
    const trigger = button('More commands');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 1000, y: 720, width: 70, height: 30 }),
    );
    await act(async () => trigger.click());
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    if (menu === null) throw new Error('Menu missing');
    Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 292 });
    Object.defineProperty(menu, 'scrollHeight', { configurable: true, value: 600 });
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(Number.parseFloat(menu.style.left) + 292).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(menu.style.top) + 600).toBeLessThanOrEqual(720);
    expect(menu.parentElement).toBe(document.body);
  });
});

async function render(commands: ReadonlyArray<AppCommand>): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<Toolbar commands={commands} machineKind="laser" />);
  });
}

function command(
  id: AppCommand['id'],
  label: string,
  overrides: Partial<AppCommand> = {},
): AppCommand {
  return {
    id,
    label,
    title: label,
    family: id.startsWith('file.') ? 'file' : 'tools',
    enabled: true,
    invoke: vi.fn(),
    ...overrides,
  };
}

function button(label: string): HTMLButtonElement {
  const element = document.querySelector(`button[aria-label="${label}"]`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`${label} missing`);
  return element;
}

async function press(key: string): Promise<void> {
  await act(async () =>
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
  );
}
