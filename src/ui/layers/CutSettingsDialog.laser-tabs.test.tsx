import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { CutSettingsDialog } from './CutSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const COLOR = '#000000';
const ANCHOR = { layerColor: COLOR, pathIndex: 0, polylineIndex: 0, pathT: 0.25 };

const ARTWORK: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: COLOR,
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
    },
  ],
};

afterEach(() => {
  resetStore();
  useUiStore.getState().resetToolMode();
});

function installArtwork(artwork: ImportedSvg | null): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: artwork === null ? [] : [artwork],
        layers: [createLayer({ id: 'test', color: COLOR })],
        groups: [],
      },
    },
    selectedObjectId: artwork?.id ?? null,
    additionalSelectedIds: new Set(),
  });
}

async function renderDialog(patch: Partial<Layer>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onApply = vi.fn();
  const layer = { ...createLayer({ id: 'test', color: COLOR }), mode: 'line' as const, ...patch };
  await act(async () =>
    root.render(<CutSettingsDialog layer={layer} onApply={onApply} onCancel={vi.fn()} />),
  );
  const form = host.querySelector('form');
  if (!form) throw new Error('form missing');
  return {
    host,
    form,
    onApply,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function input(host: HTMLElement, label: string): HTMLInputElement | null {
  const element = host.querySelector(`input[aria-label="Cut settings ${label}"]`);
  return element instanceof HTMLInputElement ? element : null;
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!found) throw new Error(`missing ${text}`);
  return found;
}

async function change(element: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function apply(form: HTMLFormElement): Promise<void> {
  expect(form.checkValidity()).toBe(true);
  await act(async () => form.requestSubmit());
}

describe('Cut Settings laser tabs (ADR-494)', () => {
  it('shows Count, or Spacing and At most, by the Place by choice', async () => {
    installArtwork(null);
    const view = await renderDialog({ tabsEnabled: true });
    const placeBy = view.host.querySelector<HTMLSelectElement>('select[name="tabLayout"]')!;
    expect(placeBy.title).not.toBe('');
    expect(input(view.host, 'tabs per shape')).not.toBeNull();
    expect(input(view.host, 'tab spacing')).toBeNull();

    await change(placeBy, 'spacing');
    expect(input(view.host, 'tabs per shape')).toBeNull();
    await change(input(view.host, 'tab spacing')!, '35');
    await change(input(view.host, 'most tabs per shape')!, '6');
    await change(input(view.host, 'tab power')!, '20');
    await apply(view.form);
    expect(view.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        tabLayout: 'spacing',
        tabSpacingMm: 35,
        tabMaxPerShape: 6,
        tabCutPowerPercent: 20,
      }),
    );
    await view.close();
  });

  it('keeps the stored spacing when applied in count mode, and clamps typed values', async () => {
    installArtwork(null);
    const view = await renderDialog({ tabsEnabled: true, tabSpacingMm: 12, tabMaxPerShape: 3 });
    await change(input(view.host, 'tab power')!, '140');
    await act(async () => {
      input(view.host, 'tab power')!.removeAttribute('max');
    });
    await apply(view.form);
    const patch = view.onApply.mock.calls[0]?.[0] as Partial<Layer>;
    expect(patch).toMatchObject({ tabLayout: 'count', tabCutPowerPercent: 100 });
    expect(patch).not.toHaveProperty('tabSpacingMm');
    expect(patch).not.toHaveProperty('tabMaxPerShape');
    await view.close();
  });

  it('explains the tab power field and gives every tab control a title', async () => {
    installArtwork(ARTWORK);
    const view = await renderDialog({ tabsEnabled: true, tabLayout: 'spacing' });
    expect(input(view.host, 'tab power')!.title).toBe(
      'Burn the tabs at this share of the cut power so parts snap out cleanly. 0 leaves them uncut.',
    );
    const fieldset = [...view.host.querySelectorAll('fieldset')].find((element) =>
      element.textContent?.startsWith('Tabs / Bridges'),
    )!;
    for (const control of fieldset.querySelectorAll('input, select, button')) {
      expect((control as HTMLElement).title, control.outerHTML).not.toBe('');
    }
    await view.close();
  });

  it.each([
    [{ tabsEnabled: false }, ARTWORK, 'Turn on tabs to place them by hand.'],
    [{ tabsEnabled: true }, null, 'Select one artwork that uses this operation to place tabs.'],
    [
      { tabsEnabled: true },
      { ...ARTWORK, locked: true },
      'Unlock the selected artwork to place tabs on it.',
    ],
  ] as const)('disables Place tabs and says why (%o)', async (settings, artwork, reason) => {
    installArtwork(artwork);
    const view = await renderDialog(settings);
    const place = button(view.host, 'Place tabs');
    expect(place.disabled).toBe(true);
    expect(place.title).toBe(reason);
    await view.close();
  });

  it('enables Place tabs once tabs are ticked, then applies and starts the tab tool', async () => {
    installArtwork(ARTWORK);
    const view = await renderDialog({ tabsEnabled: false });
    expect(button(view.host, 'Place tabs').disabled).toBe(true);
    await act(async () => input(view.host, 'enable tabs')!.click());
    const place = button(view.host, 'Place tabs');
    expect(place.disabled).toBe(false);
    expect(place.type).toBe('button');
    // Enter still presses Apply: the only submit button is the dialog's.
    expect(view.form.querySelectorAll('button[type="submit"]')).toHaveLength(1);

    await act(async () => place.click());
    expect(useUiStore.getState().toolMode).toEqual({
      kind: 'laser-tabs',
      layerColor: COLOR,
      operationId: 'test',
    });
    expect(view.onApply).toHaveBeenCalledWith(expect.objectContaining({ tabsEnabled: true }));
    await view.close();
  });

  it('clears the tabs placed on the selected artwork', async () => {
    installArtwork({ ...ARTWORK, laserTabAnchors: [ANCHOR, { ...ANCHOR, pathT: 0.75 }] });
    const view = await renderDialog({ tabsEnabled: true });
    expect(view.host.textContent).toContain('2 placed');
    const clear = button(view.host, 'Clear placed tabs');
    expect(clear.disabled).toBe(false);
    await act(async () => clear.click());
    expect(useStore.getState().project.scene.objects[0]).not.toHaveProperty('laserTabAnchors');
    expect(button(view.host, 'Clear placed tabs').disabled).toBe(true);
    expect(view.onApply).not.toHaveBeenCalled();
    await view.close();
  });
});
