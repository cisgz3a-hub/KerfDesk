// U1-P2-1 (ADR-688): in Firefox or Safari the file pickers are missing. The
// app says so as it opens, and the Save-changes question offers no Save that
// can only fail.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { webAdapter } from '../../platform/web/web-adapter';
import { ConfirmSaveDialog } from '../common/ConfirmSaveDialog';
import { useStore } from '../state';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { useUiStore } from '../state/ui-store';
import { BrowserFilesNotice } from './BrowserFilesNotice';
import { confirmDiscardAsync } from './confirm-discard';
import { PlatformProvider } from './platform-context';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type PickerWindow = {
  showOpenFilePicker?: unknown;
  showSaveFilePicker?: unknown;
};

let host: HTMLDivElement;
let root: Root;
const pickerWindow = window as unknown as PickerWindow;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete pickerWindow.showOpenFilePicker;
  delete pickerWindow.showSaveFilePicker;
  useConfirmSaveStore.getState().choose('cancel');
  useConfirmSaveStore.setState({ request: null });
  useUiStore.setState({ modalDepth: 0 });
  useStore.getState().newProject();
  vi.restoreAllMocks();
});

async function render(node: React.ReactNode): Promise<void> {
  await act(async () => root.render(node));
}

function mockPlatform(filePickersAvailable: boolean): PlatformAdapter {
  return {
    id: 'web',
    filePickersAvailable: () => filePickersAvailable,
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => {
      throw new Error('picker should not open');
    },
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

describe('browser file notice', () => {
  it('appears on load when showOpenFilePicker is undefined', async () => {
    expect(pickerWindow.showOpenFilePicker).toBeUndefined();
    await render(
      <PlatformProvider adapter={webAdapter}>
        <BrowserFilesNotice />
      </PlatformProvider>,
    );

    const notice = host.querySelector('[aria-label="Browser file support"]');
    expect(notice?.textContent).toContain("This browser can't open or save files.");
    expect(notice?.textContent).toContain('Use Chrome or Edge, or the desktop app.');
    expect(notice?.textContent).toContain('drag files onto the canvas');
    expect(notice?.querySelector('a')?.getAttribute('href')).toBe(
      'https://kerfdesk.com/download.html',
    );
  });

  it('stays away where the browser has file pickers', async () => {
    pickerWindow.showOpenFilePicker = () => undefined;
    pickerWindow.showSaveFilePicker = () => undefined;
    await render(
      <PlatformProvider adapter={webAdapter}>
        <BrowserFilesNotice />
      </PlatformProvider>,
    );

    expect(host.querySelector('[aria-label="Browser file support"]')).toBeNull();
  });

  it('names the browser, not the API, when Open fails', async () => {
    await expect(
      webAdapter.pickFilesForOpen({ accept: ['.lf2'], multiple: false }),
    ).rejects.toThrow(
      "This browser can't open files. Use Chrome or Edge, or the KerfDesk desktop app.",
    );
  });
});

describe('Save changes question without file pickers', () => {
  it('offers no Save, and explains why', async () => {
    useStore.setState({ dirty: true });
    await render(<ConfirmSaveDialog />);

    const result = confirmDiscardAsync(mockPlatform(false), 'open a project');
    await act(async () => undefined);

    const dialog = host.querySelector('[role="dialog"]');
    const labels = [...(dialog?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
    expect(labels).not.toContain('Save');
    expect(labels).toEqual(expect.arrayContaining(['Cancel', "Don't Save"]));
    expect(dialog?.textContent).toContain("this browser can't save files");
    expect(dialog?.textContent).toContain('Chrome or Edge');

    await act(async () => useConfirmSaveStore.getState().choose('cancel'));
    await expect(result).resolves.toBe(false);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('never runs a save that would fail, even if one is chosen', async () => {
    useStore.setState({ dirty: true });
    const platform = mockPlatform(false);
    const pick = vi.spyOn(platform, 'pickFileForSave');

    const result = confirmDiscardAsync(platform, 'open a project');
    expect(useConfirmSaveStore.getState().request?.canSave).toBe(false);
    useConfirmSaveStore.getState().choose('save');

    await expect(result).resolves.toBe(false);
    expect(pick).not.toHaveBeenCalled();
  });

  it('keeps Save where the pickers exist', async () => {
    useStore.setState({ dirty: true });
    await render(<ConfirmSaveDialog />);

    const result = confirmDiscardAsync(mockPlatform(true), 'open a project');
    await act(async () => undefined);

    const labels = [...host.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent);
    expect(labels).toContain('Save');
    await act(async () => useConfirmSaveStore.getState().choose('cancel'));
    await expect(result).resolves.toBe(false);
  });
});
