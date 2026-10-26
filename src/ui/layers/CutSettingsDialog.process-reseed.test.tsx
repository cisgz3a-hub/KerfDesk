// Audit 2026-10-21 06-P2-3. ADR-496 §6: an operation still exactly as its
// linked recipe left it takes the new mode's recipe when it is switched, "so a
// cut switched to Fill does not engrave at cutting power". The inspector's
// Line / Fill / Image switch did; the Process select inside Cut Settings sent
// the whole form, so the switch kept 90 % / 400 mm/min and the cut preset
// link. Both now run the same reseed, and the dialog shows the recipe's values
// as soon as Process changes, so Apply writes what the dialog showed.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe } from '../../core/material-library';
import {
  captureLayerOperationSettings,
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import {
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { openAdvanced } from './__fixtures__/selected-operation-inspector';
import { emittedBurn } from './__fixtures__/operation-gcode';
import { SelectedOperationInspector } from './SelectedOperationInspector';

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
  useStore.setState({ undoStack: [], redoStack: [] });
});
afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

const operation = (): Layer => useStore.getState().project.scene.layers[0]!;

function Inspector(): JSX.Element {
  const objects = useStore((state) => state.project.scene.objects);
  return <SelectedOperationInspector objects={objects} selectionActive />;
}

async function inCutSettings(steps: (dialog: Dialog) => Promise<void>): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Inspector />));
    await openAdvanced(host);
    await steps(new Dialog());
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

class Dialog {
  control<T extends HTMLInputElement | HTMLSelectElement>(label: string): T {
    const found = document.querySelector<T>(`[aria-label="Cut settings ${label}"]`);
    if (found === null) throw new Error(`Cut Settings ${label} missing`);
    return found;
  }
  async set(label: string, value: string): Promise<void> {
    const control = this.control(label);
    const prototype =
      control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    await act(async () => {
      // The prototype setter, as a browser does: React's tracker ignores a
      // value set on the element itself and would see no edit.
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value);
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  async apply(): Promise<void> {
    const form = this.control('mode').form;
    if (form === null) throw new Error('Cut Settings form missing');
    expect(form.checkValidity()).toBe(true);
    await act(async () => form.requestSubmit());
  }
}

function inspectorSwitchResult(): ReturnType<typeof captureLayerOperationSettings> {
  const before = useStore.getState().project;
  useStore.getState().setLayerParam(operation().id, { mode: 'fill' });
  const switched = captureLayerOperationSettings(operation());
  useStore.setState({ project: before, undoStack: [], redoStack: [] });
  return switched;
}

describe('Cut Settings Process switch on an untouched recipe operation', () => {
  it('shows and applies the Fill recipe, exactly as the inspector switch does', async () => {
    expect(operation()).toMatchObject({ power: 90, speed: 400 });
    const expected = inspectorSwitchResult();
    expect(expected).toMatchObject({ mode: 'fill', power: 35, speed: 3000 });

    await inCutSettings(async (dialog) => {
      await dialog.set('mode', 'fill');
      expect(dialog.control('power').value).toBe('35');
      expect(dialog.control('speed').value).toBe('3000');
      await dialog.apply();
    });

    expect(captureLayerOperationSettings(operation())).toEqual(expected);
    expect(operation().materialBinding?.presetId).toBe('birch-fill');
    expect(useStore.getState().undoStack).toHaveLength(1);
    const burn = emittedBurn(useStore.getState().project);
    expect(burn.powers).toEqual([350]);
    expect(burn.feeds).toEqual([3000]);
  });

  it('keeps an edit made after the switch on top of the new recipe, as one step', async () => {
    await inCutSettings(async (dialog) => {
      await dialog.set('mode', 'fill');
      await dialog.set('passes', '2');
      await dialog.apply();
    });

    expect(operation()).toMatchObject({ mode: 'fill', power: 35, speed: 3000, passes: 2 });
    expect(operation().materialBinding?.presetId).toBe('birch-fill');
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(emittedBurn(useStore.getState().project)).toMatchObject({
      powers: [350],
      feeds: [3000],
    });
  });

  it('applies the values it shows when other fields were edited before the switch', async () => {
    await inCutSettings(async (dialog) => {
      await dialog.set('passes', '2');
      await dialog.set('mode', 'fill');
      // Nothing typed is thrown away, so the shown values stay the operation's.
      expect(dialog.control('power').value).toBe('90');
      expect(dialog.control('passes').value).toBe('2');
      await dialog.apply();
    });

    expect(operation()).toMatchObject({ mode: 'fill', power: 90, speed: 400, passes: 2 });
    // The link names the preset for the operation's mode, marked as edited.
    expect(operation().materialBinding?.presetId).toBe('birch-fill');
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('returns to the stored values when Process is switched back before Apply', async () => {
    const before = captureLayerOperationSettings(operation());
    await inCutSettings(async (dialog) => {
      await dialog.set('mode', 'fill');
      await dialog.set('mode', 'line');
      expect(dialog.control('power').value).toBe('90');
      expect(dialog.control('speed').value).toBe('400');
      await dialog.apply();
    });
    expect(captureLayerOperationSettings(operation())).toEqual(before);
    expect(operation().materialBinding?.presetId).toBe('birch-cut');
  });
});
