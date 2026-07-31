import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { DesignLibraryDialog } from './DesignLibraryDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderDialog(platformId?: PlatformAdapter['id']): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    const dialog = <DesignLibraryDialog />;
    root.render(
      platformId === undefined ? (
        dialog
      ) : (
        <PlatformProvider adapter={{ id: platformId } as PlatformAdapter}>
          {dialog}
        </PlatformProvider>
      ),
    );
  });
  return host;
}

async function setSearch(h: HTMLDivElement, value: string): Promise<void> {
  const search = h.querySelector('input[aria-label="Search design library"]');
  if (!(search instanceof HTMLInputElement)) throw new Error('Library search missing');
  await act(async () => {
    search.value = value;
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLButtonElement)) throw new Error('Library button missing');
  await act(async () => element.click());
}

beforeEach(() => {
  resetStore();
  useUiStore.setState({ modalDepth: 0, libraryDialogOpen: true });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  useUiStore.setState({ modalDepth: 0, libraryDialogOpen: false });
});

describe('DesignLibraryDialog', () => {
  it('uses the shared modal contract and derives only populated facets', async () => {
    const h = await renderDialog();
    const dialog = h.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog?.getAttribute('aria-labelledby') ?? '';
    expect(document.getElementById(labelledBy)?.textContent).toBe('Design Library');
    expect(useUiStore.getState().modalDepth).toBe(1);
    expect(h.querySelector('main')).toBeNull();
    expect(h.querySelector('section[aria-label="Design Library results"]')).not.toBeNull();
    expect(h.textContent).not.toContain('Laser Templates');

    await click(h.querySelector('button[aria-controls="library-filter-panel"]'));
    const operations = h.querySelector('select[aria-label="Suggested use filter"]');
    expect(operations?.textContent).not.toContain('Image');
    expect(
      h.querySelector('select[aria-label="Source filter"] option[value="public-domain"]'),
    ).toBe(null);
    expect(h.querySelector('button[aria-label="Import visible library entries"]')).toBeNull();
  });

  it('closes on Escape, unregisters the modal, and restores opener focus', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open design library';
    document.body.appendChild(opener);
    opener.focus();
    const h = await renderDialog();
    expect(h.contains(document.activeElement)).toBe(true);

    await act(async () => {
      h.querySelector('[role="dialog"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(useUiStore.getState().libraryDialogOpen).toBe(false);
    expect(useUiStore.getState().modalDepth).toBe(0);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('selects a card without inserting, then adds from exact provenance details', async () => {
    const h = await renderDialog();
    await setSearch(h, 'kerf');
    const before = useStore.getState().project.scene.objects.length;
    await click(h.querySelector('button[aria-label="View details for Kerf Comb"]'));
    expect(useStore.getState().project.scene.objects.length).toBe(before);
    expect(h.textContent).toContain('Suggested uses');
    expect(h.textContent).toContain('CurveDesk');
    expect(h.textContent).toContain('MIT');

    await click(
      [...h.querySelectorAll('button')].find((button) => button.textContent === 'Add to canvas') ??
        null,
    );
    const { objects, layers } = useStore.getState().project.scene;
    expect(objects.length).toBeGreaterThan(before);
    const inserted = objects.at(-1);
    expect(inserted?.kind).toBe('imported-svg');
    if (inserted?.kind === 'imported-svg') {
      expect(inserted.libraryProvenance).toMatchObject({
        schemaVersion: 1,
        assetId: 'laser-kerf-comb',
        sourceName: 'CurveDesk',
        licenseId: 'MIT',
      });
      expect(inserted).not.toHaveProperty('operationOverride');
      expect(inserted).not.toHaveProperty('powerScale');
    }
    expect(
      layers.every(
        (layer) =>
          layer.mode === 'line' &&
          layer.cnc === undefined &&
          layer.materialBinding === undefined &&
          layer.scanOffsetCalibrationMode === undefined,
      ),
    ).toBe(true);
    expect(useUiStore.getState().libraryDialogOpen).toBe(false);
  });

  it('adds the exact visible design from the separate quick action', async () => {
    const h = await renderDialog();
    await setSearch(h, 'kerf');
    const before = useStore.getState().project.scene.objects.length;
    expect(h.querySelector('button button')).toBeNull();
    await click(h.querySelector('button[aria-label="Add Kerf Comb to canvas"]'));
    const inserted = useStore.getState().project.scene.objects.at(-1);
    expect(useStore.getState().project.scene.objects.length).toBeGreaterThan(before);
    expect(
      inserted?.kind === 'imported-svg' ? inserted.libraryProvenance?.assetId : undefined,
    ).toBe('laser-kerf-comb');
  });

  it('searches creator and license provenance and exposes exact detail', async () => {
    const h = await renderDialog();
    await setSearch(h, 'Cole Bemis');
    expect(h.querySelectorAll('[data-library-card]').length).toBeGreaterThan(0);
    expect(h.textContent).toContain('Lucide contributors; Feather icon by Cole Bemis');
    expect(h.textContent).toContain('ISC and MIT (Feather-derived) (ISC AND MIT)');
    expect(h.querySelector('a[href="https://github.com/lucide-icons/lucide"]')).not.toBeNull();
  });

  it('keeps a filter fallback selected when results broaden again', async () => {
    const h = await renderDialog();
    await click(h.querySelector('button[aria-label="View details for Open Bin Box Preset"]'));
    await setSearch(h, 'kerf');
    expect(h.querySelector('.lf-library-detail h3')?.textContent).toBe('Kerf Comb');

    await setSearch(h, '');
    expect(h.querySelector('.lf-library-detail h3')?.textContent).toBe('Kerf Comb');
    expect(
      h.querySelector('.lf-library-card__select[aria-pressed="true"] .lf-library-card__title')
        ?.textContent,
    ).toBe('Kerf Comb');
  });

  it('disambiguates duplicate titles by source for sighted and screen-reader users', async () => {
    const h = await renderDialog();
    await setSearch(h, 'flower');
    expect(
      h.querySelector('button[aria-label="View details for Flower from Openclipart"]'),
    ).not.toBeNull();
    expect(
      h.querySelector('button[aria-label="View details for Flower from Lucide"]'),
    ).not.toBeNull();
    expect(h.textContent).toContain('Nature · Openclipart');
    expect(h.textContent).toContain('Nature · Lucide');
  });

  it('keeps exact provenance URLs readable when desktop security blocks external windows', async () => {
    const h = await renderDialog('electron');
    await setSearch(h, 'Cole Bemis');
    expect(h.textContent).toContain('https://github.com/lucide-icons/lucide');
    expect(h.textContent).toContain('https://lucide.dev/license');
    expect(h.querySelector('a[href="https://github.com/lucide-icons/lucide"]')).toBeNull();
  });

  it('keeps a zero-result query visible and recovers through Clear filters', async () => {
    const h = await renderDialog();
    await setSearch(h, 'no-such-curvedesk-design');
    const search = h.querySelector('input[aria-label="Search design library"]');
    expect(search instanceof HTMLInputElement ? search.value : '').toBe('no-such-curvedesk-design');
    expect(h.textContent).toContain('No designs found');
    expect(h.querySelectorAll('[data-library-card]')).toHaveLength(0);
    expect(h.querySelector('[role="status"]')?.textContent).toContain('0 of');

    await click(
      [...h.querySelectorAll('button')].find((button) => button.textContent === 'Clear filters') ??
        null,
    );
    expect(search instanceof HTMLInputElement ? search.value : 'missing').toBe('');
    expect(h.querySelectorAll('[data-library-card]').length).toBeGreaterThan(0);
  });

  it('isolates a failed add and keeps the Library usable', async () => {
    useStore.setState({
      importSvgObject: () => ({
        kind: 'replaced',
        source: 'unexpected.svg',
        kept: 1,
        added: 0,
        removed: 0,
      }),
    });
    const h = await renderDialog();
    await setSearch(h, 'kerf');
    const before = useStore.getState().project.scene.objects.length;
    await click(
      [...h.querySelectorAll('button')].find((button) => button.textContent === 'Add to canvas') ??
        null,
    );
    expect(useStore.getState().project.scene.objects.length).toBe(before);
    expect(useUiStore.getState().libraryDialogOpen).toBe(true);
    expect(h.querySelector('[role="alert"]')?.textContent).toContain('could not be added');
    expect(h.querySelectorAll('[data-library-card]')).toHaveLength(1);
  });

  it('shows an accessible fallback when a preview cannot load', async () => {
    const h = await renderDialog();
    const image = h.querySelector('.lf-library-card img');
    if (!(image instanceof HTMLImageElement)) throw new Error('Library preview missing');
    await act(async () => image.dispatchEvent(new Event('error')));
    expect(h.querySelector('[role="img"][aria-label="Preview unavailable"]')).not.toBeNull();
  });

  it('isolates a broken detail preview to the selected design', async () => {
    const h = await renderDialog();
    const detailImage = h.querySelector('.lf-library-preview--detail img');
    if (!(detailImage instanceof HTMLImageElement)) throw new Error('Detail preview missing');
    await act(async () => detailImage.dispatchEvent(new Event('error')));
    expect(
      h.querySelector('.lf-library-preview--detail [aria-label="Preview unavailable"]'),
    ).not.toBeNull();

    await click(h.querySelector('button[aria-label="View details for Open Bin Box Preset"]'));
    expect(h.querySelector('.lf-library-preview--detail img')).not.toBeNull();
    expect(h.querySelector('.lf-library-preview--detail [aria-label="Preview unavailable"]')).toBe(
      null,
    );
  });
});
