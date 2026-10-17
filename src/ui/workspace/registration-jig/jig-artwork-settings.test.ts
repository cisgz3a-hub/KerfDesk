import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Layer,
  operationIdsForObject,
  REGISTRATION_LAYER_ID,
  type SceneObject,
  type TextObject,
} from '../../../core/scene';
import { applyRegistrationOutput } from '../../state/registration-output-actions';
import { resetStore, svgObj } from '../../state/test-helpers';
import { useStore } from '../../state/store';
import { applyJigArtworkSettings, jigArtworkOperations } from './jig-artwork-settings';
import { createJigEditorSession, type JigDraft } from './jig-editor-session';

function fixture(objects: ReadonlyArray<SceneObject> = [svgObj('one', ['#000000'])]): JigDraft {
  const base = createJigEditorSession(useStore.getState()).draft;
  return {
    ...base,
    project: {
      ...base.project,
      scene: {
        ...base.project.scene,
        objects: [...base.project.scene.objects, ...objects],
        layers: [...base.project.scene.layers, createLayer({ id: 'art', color: '#000000' })],
      },
    },
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(),
    registrationArtworkOutputSnapshot: null,
  };
}

describe('jig artwork burn settings', () => {
  beforeEach(() => {
    resetStore();
    useStore.setState({ registrationArtworkOutputSnapshot: null });
  });

  it('edits line/fill and burn settings without changing geometry or jig output', () => {
    const draft = fixture();
    const next = applyJigArtworkSettings(draft, 'art', {
      mode: 'fill',
      speed: 800,
      power: 22,
      passes: 2,
      hatchSpacingMm: 0.15,
      hatchAngleDeg: 45,
      fillStyle: 'offset',
      fillCrossHatch: true,
    });
    expect(jigArtworkOperations(next)[0]).toMatchObject({
      mode: 'fill',
      speed: 800,
      power: 22,
      passes: 2,
      hatchSpacingMm: 0.15,
      hatchAngleDeg: 45,
      fillStyle: 'offset',
      fillCrossHatch: true,
    });
    expect(next.project.scene.objects).toBe(draft.project.scene.objects);
    expect(next.project.scene.layers.find((layer) => layer.id === REGISTRATION_LAYER_ID)).toBe(
      draft.project.scene.layers.find((layer) => layer.id === REGISTRATION_LAYER_ID),
    );
    expect(
      jigArtworkOperations(applyJigArtworkSettings(next, 'art', { mode: 'line' }))[0],
    ).toMatchObject({ mode: 'line', hatchSpacingMm: 0.15, power: 22 });
  });

  it('isolates shared operations from unselected artwork and retains other path bindings', () => {
    const draft = fixture([svgObj('one', ['#000000', '#123456']), svgObj('two', ['#000000'])]);
    const extra = createLayer({ id: 'secondary', color: '#123456', mode: 'fill' });
    const input = {
      ...draft,
      project: {
        ...draft.project,
        scene: {
          ...draft.project.scene,
          layers: [...draft.project.scene.layers, extra],
        },
      },
    };
    const next = applyJigArtworkSettings(input, 'art', { power: 12 });
    const objects = next.project.scene.objects;
    expect(next.project.scene.layers.find((layer) => layer.id === 'art')?.power).toBe(30);
    expect(
      operationIdsForObject(objects.find((item) => item.id === 'two')!, next.project.scene.layers),
    ).toEqual(['art']);
    const selectedIds = operationIdsForObject(
      objects.find((item) => item.id === 'one')!,
      next.project.scene.layers,
    );
    expect(selectedIds).toContain('secondary');
    expect(selectedIds).not.toContain('art');
    expect(
      next.project.scene.layers.find(
        (layer) => selectedIds.includes(layer.id) && layer.id !== 'secondary',
      )?.power,
    ).toBe(12);
  });

  it('keeps shared settings together when every artwork using them is selected', () => {
    const draft = fixture([svgObj('one', ['#000000']), svgObj('two', ['#000000'])]);
    const next = applyJigArtworkSettings(
      { ...draft, additionalSelectedIds: new Set(['two']) },
      'art',
      { passes: 3 },
    );
    expect(next.project.scene.layers).toHaveLength(draft.project.scene.layers.length);
    expect(jigArtworkOperations(next)[0]?.passes).toBe(3);
  });

  it.each([true, false])(
    'restores split operation output intent %s after Outline only',
    (output) => {
      const draft = fixture([svgObj('one', ['#000000']), svgObj('two', ['#000000'])]);
      const configured = {
        ...draft,
        project: {
          ...draft.project,
          scene: {
            ...draft.project.scene,
            layers: draft.project.scene.layers.map((layer) =>
              layer.id === 'art' ? { ...layer, output } : layer,
            ),
          },
        },
      };
      const outlined = {
        ...configured,
        ...applyRegistrationOutput({ ...configured, undoStack: [] }, 'box'),
      };
      const next = applyJigArtworkSettings(outlined, 'art', { mode: 'fill' });
      const operation = jigArtworkOperations(next)[0]!;
      expect(operation.output).toBe(false);
      expect(next.project.registrationArtworkOutputSnapshot?.[operation.id]).toBe(output);
      const restored = applyRegistrationOutput({ ...next, undoStack: [] }, 'artwork');
      expect(
        restored.project.scene.layers.find((layer) => layer.id === operation.id),
      ).toMatchObject({ mode: 'fill', output });
    },
  );

  it('uses effective legacy text overrides and isolates secondary operations when editing one', () => {
    const svg = svgObj('text', ['#000000', '#123456']);
    const text: TextObject = {
      ...svg,
      kind: 'text',
      content: 'Johann',
      fontKey: 'dancing-script',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: '#000000',
      operationOverride: { mode: 'fill', power: 19 },
    };
    const draft = fixture([text]);
    const input = {
      ...draft,
      project: {
        ...draft.project,
        scene: {
          ...draft.project.scene,
          layers: [...draft.project.scene.layers, createLayer({ id: 'second', color: '#123456' })],
        },
      },
    };
    const operations = jigArtworkOperations(input);
    expect(operations).toHaveLength(2);
    expect(
      operations.every((operation) => operation.mode === 'fill' && operation.power === 19),
    ).toBe(true);
    const next = applyJigArtworkSettings(input, operations[0]!.id, { power: 8 });
    expect(jigArtworkOperations(next).map((operation) => operation.power)).toEqual([8, 19]);
    expect(
      next.project.scene.objects.find((item) => item.id === 'text')?.operationOverride,
    ).toBeUndefined();
  });

  it('preserves explicit artwork Auto when promoting overrides to operations and sublayers', () => {
    const draft = fixture([
      { ...svgObj('one', ['#000000']), operationOverride: { powerMode: 'auto' } },
    ]);
    const source: Layer = {
      ...createLayer({ id: 'art', color: '#000000' }),
      powerMode: 'constant',
    };
    const configured = {
      ...draft,
      project: {
        ...draft.project,
        scene: {
          ...draft.project.scene,
          layers: draft.project.scene.layers.map((layer) =>
            layer.id === 'art'
              ? {
                  ...source,
                  subLayers: [createLayerSubLayer(source, { id: 'second', label: 'Second pass' })],
                }
              : layer,
          ),
        },
      },
    };
    const promoted = jigArtworkOperations(configured)[0]!;
    expect(promoted.powerMode).toBeUndefined();
    expect(promoted.subLayers[0]?.settings.powerMode).toBeUndefined();
    const next = applyJigArtworkSettings(configured, promoted.id, { power: 11 });
    expect(jigArtworkOperations(next)[0]?.powerMode).toBeUndefined();
    expect(
      next.project.scene.objects.find((object) => object.id === 'one')?.operationOverride,
    ).toBeUndefined();
  });

  it('includes shape and trace operations while excluding jig, raster, locked and hidden artwork', () => {
    const trace = { ...svgObj('trace', ['#000000']), kind: 'traced-image' as const };
    const draft = fixture([trace]);
    expect(jigArtworkOperations(draft).map((layer) => layer.id)).toEqual(['art']);
    const shape: SceneObject = {
      kind: 'shape',
      id: 'shape',
      spec: { kind: 'rect', widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      color: '#000000',
      bounds: trace.bounds,
      transform: IDENTITY_TRANSFORM,
      paths: trace.paths,
    };
    expect(jigArtworkOperations(fixture([shape]))).toHaveLength(1);
    expect(jigArtworkOperations(fixture([{ ...trace, locked: true }]))).toHaveLength(0);
    const raster: SceneObject = {
      kind: 'raster-image',
      id: 'photo',
      source: 'photo.png',
      color: '#000000',
      pixelWidth: 10,
      pixelHeight: 10,
      bounds: trace.bounds,
      transform: IDENTITY_TRANSFORM,
      dither: 'threshold',
      linesPerMm: 10,
    };
    expect(jigArtworkOperations(fixture([raster]))).toHaveLength(0);
    const hidden = {
      ...draft,
      project: {
        ...draft.project,
        scene: {
          ...draft.project.scene,
          layers: draft.project.scene.layers.map((layer) => ({ ...layer, visible: false })),
        },
      },
    };
    expect(jigArtworkOperations(hidden)).toHaveLength(0);
    const cnc = {
      ...draft,
      project: { ...draft.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    };
    expect(jigArtworkOperations(cnc)).toHaveLength(0);
  });

  it('bounds numeric settings, clamps minimum power, and ignores non-finite or unchanged input', () => {
    const draft = fixture();
    const next = applyJigArtworkSettings(draft, 'art', {
      speed: 1e9,
      power: -10,
      passes: 2.8,
      hatchSpacingMm: -1,
      hatchAngleDeg: 999,
    });
    expect(jigArtworkOperations(next)[0]).toMatchObject({
      speed: draft.project.device.maxFeed,
      power: 0,
      minPower: 0,
      passes: 2,
      hatchSpacingMm: 0.05,
      hatchAngleDeg: 180,
    });
    expect(applyJigArtworkSettings(draft, 'art', { power: Number.NaN, speed: Infinity })).toBe(
      draft,
    );
    expect(applyJigArtworkSettings(draft, 'art', { power: 30 })).toBe(draft);
    expect(applyJigArtworkSettings(draft, REGISTRATION_LAYER_ID, { mode: 'fill' })).toBe(draft);
  });
});
