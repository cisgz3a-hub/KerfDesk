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
      const buttons = [...view.host.querySelectorAll('button[data-help-id]')];
      expect(buttons).toHaveLength(commands.length);
      for (const button of buttons) {
        expect(button.getAttribute('aria-label')).not.toBe('');
        expect(button.querySelector('.lf-toolbar-icon svg')).not.toBeNull();
      }
    } finally {
      await view.unmount();
    }
  });

  it('uses a Lucide icon and hides the label for familiar file commands', async () => {
    const view = await renderToolbar(command('file.new', 'New'));
    try {
      const button = view.host.querySelector('button[aria-label="New"]');
      expect(button?.querySelector('.lf-toolbar-icon svg')).not.toBeNull();
      expect(button?.querySelector('.lf-toolbar-command-label')).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it('keeps specialist labels available for wide toolbar layouts', async () => {
    const view = await renderToolbar(command('tools.box-generator', 'Box Generator...'));
    try {
      const button = view.host.querySelector('button[aria-label="Box Generator..."]');
      expect(button?.querySelector('.lf-toolbar-icon svg')).not.toBeNull();
      expect(button?.querySelector('.lf-toolbar-command-label')?.textContent).toBe(
        'Box Generator...',
      );
    } finally {
      await view.unmount();
    }
  });
});

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
  ['file.import-svg', 'Import SVG...'],
  ['file.import-image', 'Import Image...'],
  ['tools.add-text', 'Text...'],
  ['tools.registration-jig', 'Registration Jig'],
  ['tools.camera', 'Camera'],
  ['tools.place-board', 'Place Board'],
  ['tools.box-generator', 'Box Generator...'],
  ['tools.trace-image', 'Trace Image...'],
  ['tools.convert-to-bitmap', 'Convert to Bitmap...'],
  ['file.save-gcode', 'Save G-code...'],
  ['window.toggle-preview', 'Preview'],
];
