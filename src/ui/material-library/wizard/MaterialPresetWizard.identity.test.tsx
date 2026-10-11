import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bestRecipeForOperation } from '../../../core/material-library/auto-recipe';
import type { LayerMode } from '../../../core/scene';
import {
  deserializeMaterialLibrary,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialPreset,
} from '../../../io/material-library';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { MaterialPresetWizard } from './MaterialPresetWizard';
import { defaultRecipe } from './wizard-recipe';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => resetStore());
afterEach(() => resetStore());

function importPreset(overrides: Partial<MaterialPreset> = {}): MaterialPreset {
  const parsed = deserializeMaterialLibrary(
    JSON.stringify({
      format: MATERIAL_LIBRARY_FORMAT,
      librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
      libraryId: 'imported',
      name: 'Imported library',
      entries: [
        {
          id: 'birch',
          materialName: 'Birch plywood premium',
          material: 'Birch',
          thicknessMm: 3,
          operation: 'cut',
          description: 'Known recipe',
          revision: 'original',
          recipe: defaultRecipe(),
          ...overrides,
        },
      ],
    }),
  );
  expect(parsed.kind).toBe('ok');
  if (parsed.kind !== 'ok') throw new Error('valid library rejected');
  useStore.getState().importMaterialLibrary(parsed.library);
  const preset = parsed.library.entries[0];
  if (preset === undefined) throw new Error('missing imported preset');
  return preset;
}

async function renderWizard(preset: MaterialPreset) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<MaterialPresetWizard existingPreset={preset} onClose={vi.fn()} />),
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
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!form || !button) throw new Error('missing wizard form');
  expect(form.checkValidity()).toBe(true);
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}

async function changeInput(host: HTMLElement, label: string, value: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`missing input: ${label}`);
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}

function savedPreset(): MaterialPreset {
  const saved = useStore.getState().materialLibrary?.entries[0];
  if (!saved) throw new Error('missing saved preset');
  return saved;
}

function matchedId(preset: MaterialPreset, mode: LayerMode, name = 'Birch'): string | undefined {
  return bestRecipeForOperation(
    useStore.getState().project.device,
    [preset],
    {
      name,
      ...(preset.thicknessMm === undefined ? {} : { thicknessMm: preset.thicknessMm }),
    },
    mode,
  )?.candidate.id;
}

describe('material preset identity through native Next/Save', () => {
  it.each([3.175, 0.025, 0.004])('keeps imported thickness %s mm exactly', async (thicknessMm) => {
    const preset = importPreset({ thicknessMm });
    const view = await renderWizard(preset);
    try {
      expect(
        view.host.querySelector<HTMLInputElement>(
          'input[aria-label="Material thickness millimeters"]',
        )?.value,
      ).toBe(String(thicknessMm));
      for (let step = 0; step < 4; step++) await next(view.host);
      expect(savedPreset().thicknessMm).toBe(thicknessMm);
      expect(matchedId(savedPreset(), 'line')).toBe(preset.id);
    } finally {
      await view.close();
    }
  });

  it('accepts a new positive thickness without rounding it to the input step', async () => {
    const view = await renderWizard(importPreset());
    try {
      await changeInput(view.host, 'Material thickness millimeters', '1.234567');
      for (let step = 0; step < 4; step++) await next(view.host);
      expect(savedPreset().thicknessMm).toBe(1.234567);
    } finally {
      await view.close();
    }
  });

  it.each(['unchanged', 'description', 'display name'] as const)(
    'preserves a distinct canonical material on a %s edit',
    async (edit) => {
      const preset = importPreset();
      const view = await renderWizard(preset);
      try {
        if (edit === 'description') {
          await changeInput(view.host, 'Preset description', 'New notes');
        } else if (edit === 'display name') {
          await changeInput(view.host, 'Material name', 'Premium Birch');
        }
        for (let step = 0; step < 4; step++) await next(view.host);
        const saved = savedPreset();
        expect(saved.material).toBe('Birch');
        expect(saved.materialName).toBe(
          edit === 'display name' ? 'Premium Birch' : preset.materialName,
        );
        expect(saved.description).toBe(edit === 'description' ? 'New notes' : preset.description);
        expect(matchedId(saved, 'line')).toBe(preset.id);
      } finally {
        await view.close();
      }
    },
  );

  it.each(['Birch', 'birch'])(
    'renames an ordinary material whose canonical key %s follows its name',
    async (material) => {
      const preset = importPreset({ materialName: 'Birch', material });
      const view = await renderWizard(preset);
      try {
        await changeInput(view.host, 'Material name', 'Maple');
        for (let step = 0; step < 4; step++) await next(view.host);
        const saved = savedPreset();
        expect(saved.materialName).toBe('Maple');
        expect(saved.material).toBe('Maple');
        expect(matchedId(saved, 'line', 'Maple')).toBe(preset.id);
        expect(matchedId(saved, 'line', 'Birch')).toBeUndefined();
      } finally {
        await view.close();
      }
    },
  );
});

describe('material preset operation metadata after editing the mode', () => {
  const cases = [
    ['line', 'cut', 'fill', 'engrave'],
    ['line', 'score', 'fill', 'engrave'],
    ['line', 'cut', 'image', 'engrave'],
    ['fill', 'engrave', 'line', 'cut'],
    ['image', 'image', 'line', 'cut'],
    ['image', 'image', 'fill', 'engrave'],
    ['line', 'score', 'line', 'score'],
    ['fill', 'engrave', 'image', 'engrave'],
    ['image', 'image', 'image', 'image'],
  ] as const;

  it.each(cases)(
    'edits %s/%s to %s with compatible %s metadata',
    async (initialMode, operation, mode, expectedOperation) => {
      const preset = importPreset({ recipe: { ...defaultRecipe(), mode: initialMode }, operation });
      const view = await renderWizard(preset);
      try {
        await next(view.host);
        const select = view.host.querySelector<HTMLSelectElement>('select[name="mode"]');
        if (!select) throw new Error('missing mode');
        select.value = mode;
        for (let step = 0; step < 3; step++) await next(view.host);
        const saved = savedPreset();
        expect(saved.recipe.mode).toBe(mode);
        expect(saved.operation).toBe(expectedOperation);
        expect(matchedId(saved, mode)).toBe(preset.id);
      } finally {
        await view.close();
      }
    },
  );

  it.each(['material-test', 'interval-test'] as const)(
    'keeps an imported %s recipe diagnostic instead of promoting it into automatic selection',
    async (operation) => {
      const preset = importPreset({ operation });
      const view = await renderWizard(preset);
      try {
        for (let step = 0; step < 4; step++) await next(view.host);
        expect(savedPreset().operation).toBe(operation);
        expect(matchedId(savedPreset(), 'line')).toBeUndefined();
      } finally {
        await view.close();
      }
    },
  );
});
