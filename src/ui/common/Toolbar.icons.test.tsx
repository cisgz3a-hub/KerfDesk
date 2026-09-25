import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { AppCommand } from '../commands';
import { Toolbar } from './Toolbar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Toolbar icon presentation', () => {
  it('provides an icon and accessible name for every registered toolbar command', async () => {
    const commands = TOOLBAR_COMMANDS.map(([id, label]) => command(id, label));
    const view = await renderToolbarCommands(commands);
    try {
      await openMore(view.host);
      const buttons = [...document.querySelectorAll('button[data-help-id]')];
      expect(buttons).toHaveLength(commands.length);
      for (const button of buttons) {
        expect(button.getAttribute('aria-label')).not.toBe('');
        expect(button.querySelector('.lf-toolbar-icon svg')).not.toBeNull();
      }
    } finally {
      await view.unmount();
    }
  });

  it('shows a readable action label alongside the primary file icon', async () => {
    const view = await renderToolbar(command('file.open', 'Open...'));
    try {
      const button = view.host.querySelector('button[aria-label="Open..."]');
      expect(button?.querySelector('.lf-toolbar-icon svg')).not.toBeNull();
      expect(button?.querySelector('.lf-toolbar-command-label')?.textContent).toBe('Open');
    } finally {
      await view.unmount();
    }
  });

  it('keeps specialist labels available in More', async () => {
    const view = await renderToolbar(command('tools.box-generator', 'Box Generator...'));
    try {
      await openMore(view.host);
      const button = document.querySelector('button[aria-label="Box Generator..."]');
      expect(button?.querySelector('.lf-toolbar-icon svg')).not.toBeNull();
      expect(button?.querySelector('.lf-toolbar-command-label')?.textContent).toBe(
        'Box Generator...',
      );
    } finally {
      await view.unmount();
    }
  });
});

async function openMore(host: HTMLElement): Promise<void> {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="More commands"]');
  if (trigger === null) throw new Error('More commands missing');
  await act(async () => trigger.click());
}

function command(id: AppCommand['id'], label: string): AppCommand {
  return {
    id,
    family: id.startsWith('file.') ? 'file' : id.startsWith('window.') ? 'window' : 'tools',
    label,
    title: label,
    enabled: true,
    invoke: vi.fn(),
  };
}

async function renderToolbar(commandUnderTest: AppCommand): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  return renderToolbarCommands([commandUnderTest]);
}

async function renderToolbarCommands(commands: ReadonlyArray<AppCommand>): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<Toolbar commands={commands} machineKind="laser" />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

const TOOLBAR_COMMANDS: ReadonlyArray<readonly [AppCommand['id'], string]> = [
  ['file.new', 'New'],
  ['file.open', 'Open...'],
  ['file.save', 'Save'],
  ['file.save-as', 'Save As...'],
  ['file.import', 'Import...'],
  ['file.import-image', 'Import Image...'],
  ['tools.add-text', 'Text...'],
  ['tools.registration-jig', 'Registration Jig'],
  ['tools.camera', 'Camera'],
  ['tools.place-board', 'Place Board'],
  ['tools.box-generator', 'Box Generator...'],
  ['tools.barcode', 'Barcode...'],
  ['tools.trace-image', 'Trace Image...'],
  ['tools.edit-image', 'Image Studio...'],
  ['tools.convert-to-bitmap', 'Convert to Bitmap...'],
  ['file.save-gcode', 'Save G-code...'],
  ['window.toggle-preview', 'Preview'],
  ['file.inspect-gcode', 'Inspect G-code...'],
];
