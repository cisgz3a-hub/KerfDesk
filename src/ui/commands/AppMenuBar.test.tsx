import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppCommand } from './command-registry';
import { AppMenuBar } from './AppMenuBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function commands(onNew = vi.fn()): ReadonlyArray<AppCommand> {
  return [
    {
      id: 'file.new',
      family: 'file',
      label: 'New',
      title: 'New project',
      shortcut: 'Ctrl+N',
      enabled: true,
      invoke: onNew,
    },
    {
      id: 'tools.trace-image',
      family: 'tools',
      label: 'Trace Image...',
      title: 'Select an image first',
      enabled: false,
      disabledReason: 'Select an image first.',
      invoke: vi.fn(),
    },
  ];
}

async function renderMenu(appCommands: ReadonlyArray<AppCommand>): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<AppMenuBar commands={appCommands} />);
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AppMenuBar', () => {
  it('renders command families and runs enabled commands', async () => {
    const onNew = vi.fn();
    const { host, root } = await renderMenu(commands(onNew));
    try {
      expect(host.textContent).toContain('File');
      expect(host.textContent).toContain('Tools');
      expect(host.querySelector('.lf-menu')).toBeNull();

      const file = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'File',
      );
      if (!(file instanceof HTMLElement)) throw new Error('File menu missing');
      await act(async () => {
        file.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(openFamilyLabels(host)).toEqual(['File']);

      const button = [...host.querySelectorAll('button')].find((item) =>
        item.textContent?.startsWith('New'),
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error('New button missing');
      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onNew).toHaveBeenCalled();
      expect(openFamilyLabels(host)).toEqual([]);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('leaves disabled commands disabled with a reason', async () => {
    const { host, root } = await renderMenu(commands());
    try {
      const tools = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'Tools',
      );
      if (!(tools instanceof HTMLElement)) throw new Error('Tools menu missing');
      await act(async () => {
        tools.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const button = [...host.querySelectorAll('button')].find((item) =>
        item.textContent?.includes('Trace Image'),
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error('Trace button missing');

      expect(button.disabled).toBe(true);
      expect(button.title).toContain('Select an image first.');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('marks menu families and command items with stable help ids', async () => {
    const { host, root } = await renderMenu(commands());
    try {
      expect(
        host.querySelector('summary[data-help-id="menu:file"]')?.getAttribute('title'),
      ).toContain('File menu');

      const file = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'File',
      );
      if (!(file instanceof HTMLElement)) throw new Error('File menu missing');
      await act(async () => {
        file.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(
        host.querySelector('button[data-help-id="command:file.new"]')?.getAttribute('title'),
      ).toContain('new blank project');

      const tools = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'Tools',
      );
      if (!(tools instanceof HTMLElement)) throw new Error('Tools menu missing');
      await act(async () => {
        tools.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(
        host
          .querySelector('button[data-help-id="command:tools.trace-image"]')
          ?.getAttribute('title'),
      ).toContain('Select an image first.');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps only one top menu family open at a time', async () => {
    const { host, root } = await renderMenu(commands());
    try {
      const file = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'File',
      );
      const tools = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'Tools',
      );
      if (!(file instanceof HTMLElement)) throw new Error('File menu missing');
      if (!(tools instanceof HTMLElement)) throw new Error('Tools menu missing');

      await act(async () => {
        file.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        tools.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(openFamilyLabels(host)).toEqual(['Tools']);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('closes the open top menu when the user clicks outside the menu bar', async () => {
    const { host, root } = await renderMenu(commands());
    const outside = document.createElement('button');
    outside.textContent = 'Workspace';
    document.body.appendChild(outside);
    try {
      const file = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'File',
      );
      if (!(file instanceof HTMLElement)) throw new Error('File menu missing');

      await act(async () => {
        file.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(openFamilyLabels(host)).toEqual(['File']);

      await act(async () => {
        outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      });

      expect(openFamilyLabels(host)).toEqual([]);
    } finally {
      outside.remove();
      await act(async () => root.unmount());
    }
  });

  it('closes the open top menu when Escape is pressed', async () => {
    const { host, root } = await renderMenu(commands());
    try {
      const file = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'File',
      );
      if (!(file instanceof HTMLElement)) throw new Error('File menu missing');

      await act(async () => {
        file.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(openFamilyLabels(host)).toEqual(['File']);

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      });

      expect(openFamilyLabels(host)).toEqual([]);
      expect(host.querySelector('.lf-menu')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function openFamilyLabels(host: HTMLElement): Array<string | undefined> {
  return [...host.querySelectorAll('details[open]')].map(
    (details) => details.querySelector('summary')?.textContent,
  );
}
