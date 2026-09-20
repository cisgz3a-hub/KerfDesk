import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { CommandShell } from './CommandShell';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mockPlatform(): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async () => []),
    pickFileForSave: vi.fn(async () => null),
    serial: {
      isSupported: () => false,
      requestPort: vi.fn(async () => null),
    },
  };
}

async function renderShell(platform: PlatformAdapter): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <PlatformProvider adapter={platform}>
        <CommandShell />
      </PlatformProvider>,
    );
  });
  return { host, root };
}

afterEach(() => {
  useStore.getState().newProject();
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('CommandShell file boundaries', () => {
  it('routes unified import and batch trace pickers through PlatformAdapter', async () => {
    const platform = mockPlatform();
    const { host, root } = await renderShell(platform);
    try {
      expect(host.querySelector('input[type="file"]')).toBeNull();

      // Import lives in the toolbar's "More" overflow (use-toolbar-overflow:
      // only the six primary commands render inline); the popover portals to
      // document.body, so the command is looked up there.
      await clickButton(host, 'More commands');
      await clickButton(document.body, 'Import...');
      expect(platform.pickFilesForOpen).toHaveBeenLastCalledWith({
        accept: ['.svg', '.dxf', '.png', '.jpg', '.jpeg', '.stl'],
        multiple: true,
      });

      await clickMenuCommand(host, 'Tools', 'Multi-File Trace...');
      expect(platform.pickFilesForOpen).toHaveBeenLastCalledWith({
        accept: ['.png', '.jpg', '.jpeg'],
        multiple: true,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

async function clickButton(host: HTMLElement, text: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === text || candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button missing`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

async function clickMenuCommand(
  host: HTMLElement,
  family: string,
  commandText: string,
): Promise<void> {
  const summary = [...host.querySelectorAll('summary')].find(
    (candidate) => candidate.textContent === family,
  );
  if (!(summary instanceof HTMLElement)) throw new Error(`${family} menu missing`);
  await act(async () => {
    summary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await clickButton(host, commandText);
}
