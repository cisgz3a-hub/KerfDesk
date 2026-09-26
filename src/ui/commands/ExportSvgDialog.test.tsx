import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { handleExportArtworkSvg } from '../app/export-artwork-svg';
import { PlatformProvider } from '../app/platform-context';
import { useExportSvgDialogStore } from './export-svg-dialog-store';
import { ExportSvgDialogHost } from './ExportSvgDialog';

vi.mock('../app/export-artwork-svg', () => ({
  handleExportArtworkSvg: vi.fn(async () => undefined),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.mocked(handleExportArtworkSvg).mockClear();
});

function mount(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  const mounted = createRoot(host);
  root = mounted;
  act(() =>
    mounted.render(
      <PlatformProvider adapter={mockPlatform()}>
        <ExportSvgDialogHost />
      </PlatformProvider>,
    ),
  );
}

function checkbox(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[type="checkbox"]');
}

function clickButton(name: string): void {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === name);
  if (button === undefined) throw new Error('No ' + name + ' button.');
  act(() => button.click());
}

describe('Export SVG dialog', () => {
  it('stays closed until the command opens it', () => {
    mount();
    expect(checkbox()).toBeNull();
    act(() => useExportSvgDialogStore.getState().show());
    expect(checkbox()?.checked).toBe(false);
    clickButton('Cancel');
    expect(checkbox()).toBeNull();
    expect(handleExportArtworkSvg).not.toHaveBeenCalled();
  });

  it('exports without grouping by default, inside the click', () => {
    mount();
    act(() => useExportSvgDialogStore.getState().show());
    clickButton('Choose File...');
    // Synchronous: the picker still runs inside the click's user activation.
    expect(handleExportArtworkSvg).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleExportArtworkSvg).mock.calls[0]?.[0]).not.toHaveProperty(
      'groupContours',
    );
    expect(checkbox()).toBeNull();
  });

  it('groups islands when checked and remembers the choice for the session', () => {
    mount();
    act(() => useExportSvgDialogStore.getState().show());
    const box = checkbox();
    if (box === null) throw new Error('No Group islands checkbox.');
    act(() => box.click());
    clickButton('Choose File...');
    expect(vi.mocked(handleExportArtworkSvg).mock.calls[0]?.[0]).toMatchObject({
      groupContours: true,
    });
    act(() => useExportSvgDialogStore.getState().show());
    expect(checkbox()?.checked).toBe(true);
  });
});
