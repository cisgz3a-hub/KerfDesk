import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { materialRecipePatch, type MaterialRecipe } from '../../../core/material-library';
import { createLayer } from '../../../core/scene';
import type { MaterialPreset } from '../../../io/material-library';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { MaterialPresetWizard } from './MaterialPresetWizard';
import { buildPreset, defaultRecipe } from './wizard-recipe';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  resetStore();
  useStore.getState().createLibrary('Shop');
});
afterEach(() => resetStore());

function preset(mode: MaterialRecipe['mode'], airAssist = true): MaterialPreset {
  return buildPreset({
    identity: {
      materialName: 'Birch',
      thicknessMode: 'thickness',
      thicknessMm: '3',
      title: '',
      description: 'Known recipe',
    },
    recipe: {
      ...defaultRecipe(),
      mode,
      powerMode: 'constant',
      power: 70,
      minPower: 15,
      airAssist,
      tabsEnabled: true,
      tabSkipInnerShapes: true,
      tabSizeMm: 1.25,
      tabsPerShape: 7,
      kerfOffsetMm: 0.15,
      fillStyle: 'offset',
      fillBidirectional: true,
      fillCrossHatch: true,
      hatchSpacingMm: 0.12,
      hatchAngleDeg: 45,
      fillOverscanMm: 3,
      ditherAlgorithm: 'grayscale',
      imageBidirectional: true,
      negativeImage: true,
      passThrough: true,
      allowUncalibratedBidirectionalScan: true,
      bidirectionalScanOffsetMm: 0.17,
    },
    existing: null,
    id: 'birch',
    revision: 'original',
  });
}

async function renderWizard(existingPreset: MaterialPreset) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<MaterialPresetWizard existingPreset={existingPreset} onClose={vi.fn()} />),
  );
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

async function next(host: HTMLElement): Promise<void> {
  const form = host.querySelector('form');
  if (!form) throw new Error('missing form');
  expect(form.checkValidity()).toBe(true);
  await act(async () => form.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
}

describe('existing material recipe roundtrips', () => {
  it.each(['line', 'fill', 'image'] as const)(
    'preserves every %s recipe setting through native Next/Save',
    async (mode) => {
      const existing = preset(mode);
      useStore.getState().upsertMaterialPreset(existing);
      const view = await renderWizard(existing);
      try {
        for (let step = 0; step < 4; step++) await next(view.host);
        expect(useStore.getState().materialLibrary?.entries[0]?.recipe).toEqual(
          materialRecipePatch(existing.recipe),
        );
      } finally {
        await view.close();
      }
    },
  );

  it.each([true, false])(
    'saves toggled air from %s, reopens it, and applies it to a layer',
    async (originalAir) => {
      const existing = preset('line', originalAir);
      useStore.getState().upsertMaterialPreset(existing);
      const view = await renderWizard(existing);
      try {
        await next(view.host);
        const air = view.host.querySelector<HTMLInputElement>('input[name="airAssist"]');
        if (!air) throw new Error('missing air');
        await act(async () => air.click());
        await next(view.host);
        await next(view.host);
        await next(view.host);
        const saved = useStore.getState().materialLibrary?.entries[0];
        if (!saved) throw new Error('missing saved preset');
        expect(saved.recipe).toEqual({
          ...materialRecipePatch(existing.recipe),
          airAssist: !originalAir,
        });
        const reopened = await renderWizard(saved);
        try {
          await next(reopened.host);
          expect(
            reopened.host.querySelector<HTMLInputElement>('input[name="airAssist"]')?.checked,
          ).toBe(!originalAir);
        } finally {
          await reopened.close();
        }
        const layer = { ...createLayer({ id: 'layer', color: '#000000' }), airAssist: originalAir };
        useStore.setState((state) => ({
          project: { ...state.project, scene: { ...state.project.scene, layers: [layer] } },
        }));
        expect(useStore.getState().assignMaterialPresetToLayer('layer', saved.id)).toBe(true);
        expect(useStore.getState().project.scene.layers[0]?.airAssist).toBe(!originalAir);
      } finally {
        await view.close();
      }
    },
  );
});
