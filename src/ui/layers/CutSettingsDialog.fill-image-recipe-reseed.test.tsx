// ADR-496 §6 for Fill and Image. Cut Settings shows an option the operation
// does not store at the value it compiles as (Automatic overscan off, 0° per
// pass, Image overscan 5 mm, scan angle 0°, no cross-hatch), and Apply used to
// write those shown defaults. The program was the same, but the operation no
// longer matched its linked recipe, so a later Process switch kept the Fill's
// or Image's power and speed instead of taking the new mode's recipe. Line
// options were already trimmed (CutSettingsDialog.recipe-reseed.audit.test.tsx).

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe } from '../../core/material-library';
import {
  captureLayerOperationSettings,
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type LayerMode,
  type RasterImage,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { emitGcode } from '../../io/gcode/emit-gcode';
import {
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { openAdvanced } from './__fixtures__/selected-operation-inspector';
import { SelectedOperationInspector } from './SelectedOperationInspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ARTWORK_COLOR = '#000000';

function entry(id: string, mode: LayerMode, power: number, speed: number) {
  return {
    id,
    materialName: 'Birch',
    thicknessMm: 3,
    description: id,
    revision: 'r1',
    operation: mode === 'line' ? ('cut' as const) : ('engrave' as const),
    recipe: captureMaterialRecipe({
      ...createLayer({ id: 'recipe', color: ARTWORK_COLOR, mode }),
      power,
      speed,
    }),
  };
}

const library: MaterialLibraryDocument = {
  format: 'laserforge-material-library',
  librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
  libraryId: 'shop',
  name: 'Shop',
  entries: [
    entry('birch-cut', 'line', 90, 400),
    entry('birch-fill', 'fill', 35, 3000),
    entry('birch-image', 'image', 20, 6000),
  ],
};

const RECIPES = {
  fill: { presetId: 'birch-fill', power: 35, speed: 3000 },
  image: { presetId: 'birch-image', power: 20, speed: 6000 },
} as const;

beforeEach(() => {
  resetStore();
  useStore.getState().setMaterialLibrary(library);
  useStore
    .getState()
    .setJobLaserMaterial({ name: 'Birch', thicknessMm: 3, autoApplyRecipes: true });
  useStore.getState().drawShape(
    createRectangle({
      id: 'rect',
      color: ARTWORK_COLOR,
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: IDENTITY_TRANSFORM,
    }),
  );
});
afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

const operation = (): Layer => useStore.getState().project.scene.layers[0]!;
const program = (): string => emitGcode(useStore.getState().project).gcode;

/** The inspector's own Process switch, which runs the ADR-496 §6 reseed. */
function switchProcess(mode: LayerMode): void {
  useStore.getState().setLayerParam(operation().id, { mode });
}

/** A 2 x 2 photo with two dark pixels, so an Image emits a real raster. */
function photoOnTheOperation(): void {
  const { project } = useStore.getState();
  const { color, id } = operation();
  const photo: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: 'AP//AA==',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 15 },
    transform: IDENTITY_TRANSFORM,
    color,
    operationIds: [id],
    dither: 'threshold',
    linesPerMm: 10,
  };
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [photo] } },
    selectedObjectId: photo.id,
  });
}

/** A recipe-linked operation in `mode`, still exactly as the recipe left it,
 * with artwork that burns in that mode. */
function linkedOperation(mode: 'fill' | 'image'): void {
  if (mode === 'image') photoOnTheOperation();
  switchProcess(mode);
  const { presetId, power, speed } = RECIPES[mode];
  expect(operation()).toMatchObject({ mode, power, speed, materialBinding: { presetId } });
  // Raster rows continue a modal G1, so look for any powered S word.
  expect(program()).toMatch(new RegExp(`S${power * 10}(?![0-9])`));
  useStore.setState({ undoStack: [], redoStack: [] });
}

/** A project saved before the operation stored this option. */
function storedWithout(key: 'allowUncalibratedBidirectionalScan'): void {
  const { project } = useStore.getState();
  const { [key]: _dropped, ...layer } = operation();
  const binding = layer.materialBinding;
  const lastResolved = binding?.lastResolved;
  const relinked: Layer =
    binding === undefined || lastResolved === undefined
      ? layer
      : {
          ...layer,
          materialBinding: {
            ...binding,
            lastResolved: Object.fromEntries(
              Object.entries(lastResolved).filter(([name]) => name !== key),
            ) as typeof lastResolved,
          },
        };
  useStore.setState({ project: { ...project, scene: { ...project.scene, layers: [relinked] } } });
}

function Inspector(): JSX.Element {
  const objects = useStore((state) => state.project.scene.objects);
  return <SelectedOperationInspector objects={objects} selectionActive />;
}

/** Opens the inspector's Cut Settings, runs `steps` (none: a no-op), applies. */
async function applyCutSettings(steps?: (dialog: Dialog) => Promise<void>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Inspector />));
    await openAdvanced(host);
    const dialog = new Dialog();
    await steps?.(dialog);
    await dialog.apply();
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
  async type(label: string, value: string): Promise<void> {
    const control = this.control<HTMLInputElement>(label);
    await act(async () => {
      // The prototype setter, as a browser does: React's tracker ignores a
      // value set on the element itself and would see no edit.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        control,
        value,
      );
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  async click(label: string): Promise<void> {
    const control = this.control<HTMLInputElement>(label);
    await act(async () => control.click());
  }
  async apply(): Promise<void> {
    const form = this.control('mode').form;
    if (form === null) throw new Error('Cut Settings form missing');
    expect(form.checkValidity()).toBe(true);
    await act(async () => form.requestSubmit());
  }
}

const SHOWN_DEFAULTS = {
  fill: ['autoOverscan', 'passAngleStepDeg', 'allowUncalibratedBidirectionalScan'],
  image: [
    'autoOverscan',
    'passAngleStepDeg',
    'allowUncalibratedBidirectionalScan',
    'imageOverscanMm',
    'imageScanAngleDeg',
    'imageCrossHatch',
  ],
} as const;

describe('an unchanged Cut Settings Apply on a recipe-linked Fill or Image', () => {
  it.each(['fill', 'image'] as const)(
    '%s: stores nothing new, emits the same program and still reseeds on a Process switch',
    async (mode) => {
      linkedOperation(mode);
      storedWithout('allowUncalibratedBidirectionalScan');
      const stored = captureLayerOperationSettings(operation());
      const gcode = program();
      for (const key of SHOWN_DEFAULTS[mode]) expect(operation()[key]).toBeUndefined();

      await applyCutSettings();

      expect(captureLayerOperationSettings(operation())).toEqual(stored);
      for (const key of SHOWN_DEFAULTS[mode]) expect(operation()[key]).toBeUndefined();
      expect(program()).toBe(gcode);
      expect(operation().materialBinding?.lastResolved).toEqual(stored);

      switchProcess('line');
      expect(operation()).toMatchObject({
        mode: 'line',
        power: 90,
        speed: 400,
        materialBinding: { presetId: 'birch-cut' },
      });
    },
  );
});

describe('deliberate Fill and Image edits stay edits', () => {
  it('keeps an explicitly typed default angle per pass on a Fill', async () => {
    linkedOperation('fill');
    await applyCutSettings(async (dialog) => {
      await dialog.type('angle change per pass', '15');
      await dialog.type('angle change per pass', '0');
    });
    expect(operation().passAngleStepDeg).toBe(0);
    switchProcess('line');
    expect(operation()).toMatchObject({ mode: 'line', power: 35, speed: 3000 });
  });

  it('keeps Automatic overscan switched on and back off on a Fill', async () => {
    linkedOperation('fill');
    await applyCutSettings(async (dialog) => {
      await dialog.click('automatic overscan');
      await dialog.click('automatic overscan');
    });
    expect(operation().autoOverscan).toBe(false);
    switchProcess('line');
    expect(operation()).toMatchObject({ mode: 'line', power: 35, speed: 3000 });
  });

  it.each([
    ['image overscan', 'imageOverscanMm', '2', '5', 5],
    ['image scan angle', 'imageScanAngleDeg', '45', '0', 0],
  ] as const)(
    'keeps an explicitly typed Image default: %s',
    async (label, key, first, typed, stored) => {
      linkedOperation('image');
      await applyCutSettings(async (dialog) => {
        await dialog.type(label, first);
        await dialog.type(label, typed);
      });
      expect(operation()[key]).toBe(stored);
      switchProcess('line');
      expect(operation()).toMatchObject({ mode: 'line', power: 20, speed: 6000 });
    },
  );

  it('keeps Image cross-hatch ticked and unticked', async () => {
    linkedOperation('image');
    await applyCutSettings(async (dialog) => {
      await dialog.click('image cross-hatch');
      await dialog.click('image cross-hatch');
    });
    expect(operation().imageCrossHatch).toBe(false);
  });

  it('writes a changed Image option and changes the program', async () => {
    linkedOperation('image');
    const gcode = program();
    await applyCutSettings(async (dialog) => {
      await dialog.type('image scan angle', '90');
    });
    expect(operation()).toMatchObject({ imageScanAngleDeg: 90 });
    expect(operation()).not.toHaveProperty('imageCrossHatch', false);
    expect(program()).not.toBe(gcode);
  });
});
