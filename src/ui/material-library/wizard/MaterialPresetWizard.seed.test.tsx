// Prefilled presets (ADR-381): a tuned operation, a duplicated preset and a
// burned Material Test cell each start the ADR-093 wizard with every setting
// captured, and the saved preset holds exactly those settings.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { captureMaterialRecipe, materialRecipePatch } from '../../../core/material-library';
import {
  captureLayerOperationSettings,
  createLayer,
  type Layer,
  type LayerOperationSettings,
} from '../../../core/scene';
import type { MaterialPreset } from '../../../io/material-library';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { MaterialPresetWizard } from './MaterialPresetWizard';
import { MaterialPresetWizardLauncher } from './MaterialPresetWizardLauncher';
import { buildPreset, defaultRecipe } from './wizard-recipe';
import { seedFromOperation, seedFromTestCell } from './wizard-seed';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => resetStore());
afterEach(() => resetStore());

function tunedOperation(mode: Layer['mode']): Layer {
  return {
    ...createLayer({ id: 'op-1', color: '#123456', name: 'Deep engrave', mode }),
    powerMode: 'constant',
    power: 62,
    minPower: 12,
    speed: 2345,
    passes: 3,
    airAssist: true,
    tabsEnabled: true,
    tabSkipInnerShapes: false,
    tabSizeMm: 1.25,
    tabsPerShape: 7,
    kerfOffsetMm: 0.15,
    fillStyle: 'offset',
    fillBidirectional: false,
    fillCrossHatch: true,
    hatchSpacingMm: 0.12,
    hatchAngleDeg: 45,
    fillOverscanMm: 3,
    ditherAlgorithm: 'grayscale',
    linesPerMm: 12.5,
    imageBidirectional: false,
    negativeImage: true,
    passThrough: true,
    dotWidthCorrectionMm: 0.05,
    allowUncalibratedBidirectionalScan: true,
    bidirectionalScanOffsetMm: 0.17,
  };
}

async function render(element: JSX.Element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`missing input: ${label}`);
  return element;
}

async function type(host: HTMLElement, label: string, value: string): Promise<void> {
  const element = input(host, label);
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function next(host: HTMLElement): Promise<void> {
  const form = host.querySelector('form');
  if (!form) throw new Error('missing form');
  expect(form.checkValidity()).toBe(true);
  await act(async () => form.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
}

async function walkAndSave(host: HTMLElement): Promise<void> {
  for (let step = 0; step < 4; step++) await next(host);
}

describe('prefilled material presets', () => {
  it.each(['line', 'fill', 'image'] as const)(
    'saves every captured %s operation setting and names the preset from the operation',
    async (mode) => {
      const operation = tunedOperation(mode);
      const view = await render(
        <MaterialPresetWizard seed={seedFromOperation(operation)} onClose={vi.fn()} />,
      );
      try {
        expect(view.host.textContent).toContain('Settings copied from Deep engrave.');
        expect(input(view.host, 'Preset description').value).toBe('Deep engrave');
        expect(input(view.host, 'Material name').value).toBe('');
        await type(view.host, 'Material name', 'Birch ply');
        await type(view.host, 'Material thickness millimeters', '3');
        await walkAndSave(view.host);
        const library = useStore.getState().materialLibrary;
        // A canvas-started preset creates the library it lands in.
        expect(library?.name).toBe(`${DEFAULT_DEVICE_PROFILE.name} Library`);
        expect(library?.entries).toHaveLength(1);
        expect(library?.entries[0]).toMatchObject({
          materialName: 'Birch ply',
          thicknessMm: 3,
          description: 'Deep engrave',
        });
        expect(library?.entries[0]?.recipe).toEqual(
          materialRecipePatch(captureMaterialRecipe(operation)),
        );
      } finally {
        await view.close();
      }
    },
  );

  it('says when an operation has sub-layers the preset cannot hold', () => {
    const plain = tunedOperation('line');
    const withSubLayer: Layer = {
      ...plain,
      subLayers: [
        {
          id: 'score',
          label: 'Score',
          enabled: true,
          settings: captureLayerOperationSettings(plain),
        },
      ],
    };
    expect(seedFromOperation(withSubLayer).source).toContain(
      'Sub-layers are not part of a material preset.',
    );
    expect(seedFromOperation(plain).source).not.toContain('Sub-layers');
  });

  it('saves nothing when the prefilled wizard is cancelled', async () => {
    const onClose = vi.fn();
    const view = await render(
      <MaterialPresetWizard seed={seedFromOperation(tunedOperation('fill'))} onClose={onClose} />,
    );
    try {
      const cancel = [...view.host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Cancel',
      );
      await act(async () => cancel?.click());
      expect(onClose).toHaveBeenCalledOnce();
      expect(useStore.getState().materialLibrary).toBeNull();
    } finally {
      await view.close();
    }
  });

  it('duplicates a preset as a new entry and leaves the original alone', async () => {
    useStore.getState().createLibrary('Shop');
    const original: MaterialPreset = {
      ...buildPreset({
        identity: {
          materialName: 'Birch',
          thicknessMode: 'thickness',
          thicknessMm: '3',
          title: '',
          description: 'Known recipe',
        },
        recipe: { ...defaultRecipe(), mode: 'fill', power: 44, speed: 3100, hatchSpacingMm: 0.09 },
        existing: null,
        id: 'birch-3mm',
        revision: 'original',
      }),
      confidence: 'calibrated',
      calibrationProvenance: 'Material test on the shop laser',
    };
    useStore.getState().upsertMaterialPreset(original);
    const view = await render(
      <MaterialPresetWizardLauncher selectedPreset={original} onSaved={vi.fn()} />,
    );
    try {
      const duplicate = view.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Duplicate selected material preset"]',
      );
      await act(async () => duplicate?.click());
      expect(input(view.host, 'Preset description').value).toBe('Known recipe (copy)');
      await type(view.host, 'Material thickness millimeters', '6');
      await walkAndSave(view.host);
      const entries = useStore.getState().materialLibrary?.entries ?? [];
      expect(entries).toHaveLength(2);
      expect(entries.find((entry) => entry.id === 'birch-3mm')).toEqual(original);
      const copy = entries.find((entry) => entry.id !== 'birch-3mm');
      expect(copy).toMatchObject({
        materialName: 'Birch',
        thicknessMm: 6,
        description: 'Known recipe (copy)',
        operation: original.operation,
        confidence: 'calibrated',
        calibrationProvenance: 'Material test on the shop laser',
        recipe: original.recipe,
      });
    } finally {
      await view.close();
    }
  });

  it('records where a Material Test cell was calibrated', async () => {
    const settings: LayerOperationSettings = {
      ...captureLayerOperationSettings(createLayer({ id: 'cell', color: '#100000', mode: 'fill' })),
      power: 25,
      speed: 1800,
      passes: 2,
      hatchSpacingMm: 0.08,
      airAssist: true,
    };
    const seed = seedFromTestCell({
      settings,
      cellLabel: 'Material test, row 3, column 5',
      device: DEFAULT_DEVICE_PROFILE,
      date: '2026-09-24',
    });
    const view = await render(<MaterialPresetWizard seed={seed} onClose={vi.fn()} />);
    try {
      expect(view.host.textContent).toContain('Settings from Material test, row 3, column 5.');
      await type(view.host, 'Material name', 'Cork');
      await type(view.host, 'Material thickness millimeters', '2');
      await walkAndSave(view.host);
      const saved = useStore.getState().materialLibrary?.entries[0];
      expect(saved?.recipe).toMatchObject({ power: 25, speed: 1800, passes: 2 });
      expect(saved?.confidence).toBe('calibrated');
      expect(saved?.calibrationProvenance).toContain('Material test, row 3, column 5');
      expect(saved?.calibrationProvenance).toContain('2026-09-24');
    } finally {
      await view.close();
    }
  });
});
