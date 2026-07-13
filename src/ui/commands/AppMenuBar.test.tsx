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

async function renderMenu(
  appCommands: ReadonlyArray<AppCommand>,
  machineKind: 'laser' | 'cnc' = 'laser',
): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<AppMenuBar commands={appCommands} machineKind={machineKind} />);
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AppMenuBar', () => {
  it('renders toggle commands as checked menu items', async () => {
    const toggle: AppCommand = {
      id: 'window.toggle-layers-panel',
      family: 'window',
      label: 'Cuts / Layers Panel',
      title: 'Show or hide the panel',
      enabled: true,
      active: false,
      invoke: vi.fn(),
    };
    const { host, root } = await renderMenu([toggle]);
    try {
      const windowMenu = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'Window',
      );
      if (!(windowMenu instanceof HTMLElement)) throw new Error('Window menu missing');
      await act(async () => windowMenu.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      const item = host.querySelector('[role="menuitemcheckbox"]');
      expect(item?.getAttribute('aria-checked')).toBe('false');
      expect(item?.textContent).toBe('Cuts / Layers Panel');
    } finally {
      await act(async () => root.unmount());
    }
  });

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

  it('labels the laser command family with the machine noun (ADR-101 §7)', async () => {
    const laserFamily: ReadonlyArray<AppCommand> = [
      {
        id: 'laser.connect',
        family: 'laser',
        label: 'Connect',
        title: 'Connect to controller',
        enabled: true,
        invoke: vi.fn(),
      },
    ];
    const summaries = (host: HTMLElement): ReadonlyArray<string | null> =>
      [...host.querySelectorAll('summary')].map((summary) => summary.textContent);

    const laser = await renderMenu(laserFamily);
    try {
      expect(summaries(laser.host)).toContain('Laser');
    } finally {
      await act(async () => laser.root.unmount());
    }

    const cnc = await renderMenu(laserFamily, 'cnc');
    try {
      expect(summaries(cnc.host)).toContain('Router');
      expect(summaries(cnc.host)).not.toContain('Laser');
    } finally {
      await act(async () => cnc.root.unmount());
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

  it('renders separators between Tools menu groups and hides none of the commands', async () => {
    const tool = (id: AppCommand['id'], label: string): AppCommand => ({
      id,
      family: 'tools',
      label,
      title: label,
      enabled: true,
      invoke: vi.fn(),
    });
    const toolCommands: ReadonlyArray<AppCommand> = [
      tool('tools.measure', 'Measure'),
      tool('tools.material-test', 'Material Test...'),
      tool('tools.trace-image', 'Trace Image...'),
      // A command id MENU_GROUPS does not know about must still render, in
      // the trailing fallback block. Cast: simulating a future CommandId
      // that the grouping table has not been taught yet.
      tool('tools.some-future-tool' as AppCommand['id'], 'Future Tool'),
    ];
    const { host, root } = await renderMenu(toolCommands);
    try {
      const tools = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'Tools',
      );
      if (!(tools instanceof HTMLElement)) throw new Error('Tools menu missing');
      await act(async () => {
        tools.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const menu = host.querySelector('.lf-menu');
      if (!(menu instanceof HTMLElement)) throw new Error('menu missing');
      // 3 known commands from 3 different blocks + 1 fallback block = 3 rules.
      expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(3);
      for (const label of ['Measure', 'Material Test...', 'Trace Image...', 'Future Tool']) {
        expect(menu.textContent).toContain(label);
      }
      for (const group of ['Create & measure', 'Calibrate', 'Trace', 'Other']) {
        expect(menu.textContent).toContain(group);
      }
      // Fallback commands render last.
      const items = [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
      expect(items[items.length - 1]).toBe('Future Tool');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('renders no separators in a family without a grouping layout', async () => {
    const { host, root } = await renderMenu(commands());
    try {
      const file = [...host.querySelectorAll('summary')].find(
        (summary) => summary.textContent === 'File',
      );
      if (!(file instanceof HTMLElement)) throw new Error('File menu missing');
      await act(async () => {
        file.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      const menu = host.querySelector('.lf-menu');
      expect(menu?.querySelectorAll('[role="separator"]')).toHaveLength(0);
    } finally {
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

  it('implements menubar arrow, Home/End, and menu-item navigation', async () => {
    const runMeasure = vi.fn();
    const appCommands: ReadonlyArray<AppCommand> = [
      ...commands(),
      {
        id: 'tools.measure',
        family: 'tools',
        label: 'Measure',
        title: 'Measure',
        enabled: true,
        invoke: runMeasure,
      },
      {
        id: 'tools.material-test',
        family: 'tools',
        label: 'Material Test...',
        title: 'Material Test',
        enabled: true,
        invoke: vi.fn(),
      },
    ];
    const { host, root } = await renderMenu(appCommands);
    try {
      const bar = host.querySelector('[role="menubar"]');
      const file = host.querySelector<HTMLElement>('[data-menu-family-summary="file"]');
      const tools = host.querySelector<HTMLElement>('[data-menu-family-summary="tools"]');
      expect(bar).not.toBeNull();
      expect(file?.tabIndex).toBe(0);
      expect(tools?.tabIndex).toBe(-1);
      file?.focus();

      await act(async () => {
        file?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
      });
      expect(document.activeElement).toBe(tools);
      expect(tools?.tabIndex).toBe(0);

      await act(async () => {
        tools?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
      });
      expect(openFamilyLabels(host)).toEqual(['Tools']);
      expect(document.activeElement?.textContent).toBe('Measure');

      await act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }),
        );
      });
      expect(document.activeElement?.textContent).toBe('Material Test...');

      await act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }),
        );
      });
      expect(document.activeElement?.textContent).toBe('Measure');

      await act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
        );
      });
      expect(openFamilyLabels(host)).toEqual([]);
      expect(document.activeElement).toBe(tools);
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
