import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureMaterialRecipe } from '../../core/material-library';
import { createLayer, IDENTITY_TRANSFORM, type Layer } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import {
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { CutSettingsDialog } from './CutSettingsDialog';
import type { LayerPatch } from './cut-settings-draft';
import { effective, load, mount, openAdvanced } from './__fixtures__/selected-operation-inspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const library: MaterialLibraryDocument = {
  format: 'laserforge-material-library',
  librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
  libraryId: 'shop',
  name: 'Shop',
  entries: [
    {
      id: 'birch-cut',
      materialName: 'Birch',
      thicknessMm: 3,
      description: 'Cut',
      revision: 'r1',
      operation: 'cut',
      recipe: captureMaterialRecipe({
        ...createLayer({ id: 'c', color: '#000000' }),
        power: 90,
        speed: 400,
      }),
    },
    {
      id: 'birch-fill',
      materialName: 'Birch',
      thicknessMm: 3,
      description: 'Fill',
      revision: 'r1',
      operation: 'engrave',
      recipe: captureMaterialRecipe({
        ...createLayer({ id: 'f', color: '#000000', mode: 'fill' }),
        power: 35,
        speed: 3000,
      }),
    },
  ],
};

beforeEach(() => {
  resetStore();
  useStore.getState().setMaterialLibrary(library);
  useStore
    .getState()
    .setJobLaserMaterial({ name: 'Birch', thicknessMm: 3, autoApplyRecipes: true });
  useStore.getState().drawShape(
    createRectangle({
      id: 'rect',
      color: '#000000',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: IDENTITY_TRANSFORM,
    }),
  );
});
afterEach(resetStore);

const operation = (): Layer => useStore.getState().project.scene.layers[0]!;
const field = <T extends HTMLElement>(host: HTMLElement, label: string): T => {
  const result = host.querySelector<T>(`[aria-label="Cut settings ${label}"]`);
  if (result === null) throw new Error(`Missing ${label}`);
  return result;
};
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}
async function editOperation(edit: (host: HTMLElement) => Promise<void>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const layer = operation();
  const onApply = vi.fn((patch: LayerPatch) => useStore.getState().setLayerParam(layer.id, patch));
  try {
    await act(async () =>
      root.render(<CutSettingsDialog layer={layer} onApply={onApply} onCancel={vi.fn()} />),
    );
    await edit(host);
    const form = host.querySelector('form')!;
    expect(form.checkValidity()).toBe(true);
    await act(async () => form.requestSubmit());
    return onApply.mock.calls[0]![0];
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}
async function toggleLeads(editExtra = false) {
  await editOperation(async (host) => {
    await act(async () => field<HTMLInputElement>(host, 'enable lead-in').click());
    await change(field<HTMLSelectElement>(host, 'lead style'), 'line');
    if (editExtra) await change(field<HTMLInputElement>(host, 'overcut'), '1');
  });
  await editOperation(async (host) => {
    await act(async () => field<HTMLInputElement>(host, 'enable lead-in').click());
  });
}
function switchToFill() {
  useStore.getState().setLayerParam(operation().id, { mode: 'fill' });
}

describe('Cut Settings preserves automatic recipe eligibility', () => {
  it('does not turn a no-op Apply into an optional-settings edit', async () => {
    await editOperation(async () => undefined);
    switchToFill();
    expect(operation()).toMatchObject({
      power: 35,
      speed: 3000,
      materialBinding: { presetId: 'birch-fill' },
    });
  });

  it('reseeds after the actual dialog enables line leads and applies, then disables and applies', async () => {
    expect(operation().materialBinding?.presetId).toBe('birch-cut');
    await toggleLeads();
    expect(operation().leadInEnabled).toBe(false);
    switchToFill();
    expect(operation()).toMatchObject({
      mode: 'fill',
      power: 35,
      speed: 3000,
      materialBinding: { presetId: 'birch-fill' },
    });
  });

  it('retains a deliberate extra-setting edit instead of reseeding', async () => {
    await toggleLeads(true);
    switchToFill();
    expect(operation()).toMatchObject({ mode: 'fill', power: 90, speed: 400, overcutMm: 1 });
  });

  it('prunes defaults independently when the linked snapshot includes another stored option', async () => {
    useStore.getState().setLayerParam(operation().id, { overcutMm: 1, tabLayout: 'count' });
    useStore.getState().applyBestRecipesToOperations();
    expect(operation()).toMatchObject({ overcutMm: 1, tabLayout: 'count' });
    expect(operation().materialBinding?.lastResolved).toMatchObject({
      overcutMm: 1,
      tabLayout: 'count',
    });
    const patch = await editOperation(async () => undefined);
    expect(patch).toMatchObject({ overcutMm: 1, tabLayout: 'count' });
    expect(patch).not.toHaveProperty('perforationEnabled');
    expect(patch).not.toHaveProperty('perforationCutMm');
    expect(patch).not.toHaveProperty('tabCutPowerPercent');
    switchToFill();
    expect(operation()).toMatchObject({
      power: 35,
      speed: 3000,
      materialBinding: { presetId: 'birch-fill' },
    });
  });

  it('retains an explicitly entered default even when it was previously absent', async () => {
    const patch = await editOperation(async (host) => {
      const overcut = field<HTMLInputElement>(host, 'overcut');
      await change(overcut, '1');
      await change(overcut, '0');
    });
    expect(patch).toHaveProperty('overcutMm', 0);
    switchToFill();
    expect(operation()).toMatchObject({ power: 90, speed: 400, overcutMm: 0 });
  });

  it.each([
    ['overcut', { overcutMm: 2 }, '0', 'overcutMm', 0],
    ['enable perforation', { perforationEnabled: true }, null, 'perforationEnabled', false],
  ] as const)(
    'keeps explicit default edits on mixed artwork: %s',
    async (label, second, value, key, expected) => {
      load({ mode: 'line' }, { mode: 'line', ...second });
      const view = await mount();
      try {
        await openAdvanced(view.host);
        const control = field<HTMLInputElement>(document.body, label);
        if (value === null) {
          await act(async () => {
            control.click();
            control.click();
          });
        } else {
          await change(control, '1');
          await change(control, value);
        }
        await act(async () => control.form!.requestSubmit());
        expect(effective().map((settings) => settings[key])).toEqual([expected, expected]);
      } finally {
        await view.unmount();
        view.host.remove();
      }
    },
  );
});
