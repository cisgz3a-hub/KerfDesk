import { describe, expect, it } from 'vitest';
import { canonicalArtworkOrder } from './artwork-order';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createRegistrationLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type LayerMode,
  type Scene,
  type SceneObject,
} from './scene';
import { cutsLastOperationOrder, lineOperationStrength, sortCutsLast } from './sort-cuts-last';

describe('sort cuts last: operation order', () => {
  it('keeps engraving operations first and sorts Line operations weakest to strongest', () => {
    const layers = [
      operation('strong', 'line', { power: 90 }),
      operation('fill', 'fill'),
      operation('weak', 'line', { power: 10 }),
      operation('image', 'image'),
      operation('mid', 'line', { power: 50 }),
    ];

    expect(cutsLastOperationOrder(layers).map((layer) => layer.id)).toEqual([
      'fill',
      'image',
      'weak',
      'mid',
      'strong',
    ]);
  });

  it('measures strength as power × passes ÷ speed', () => {
    const slowSingle = operation('slow', 'line', { power: 50, passes: 1, speed: 1000 });
    const fastTriple = operation('triple', 'line', { power: 20, passes: 3, speed: 1000 });
    const quick = operation('quick', 'line', { power: 100, passes: 1, speed: 5000 });

    expect(lineOperationStrength(slowSingle)).toBeCloseTo(0.05);
    expect(lineOperationStrength(fastTriple)).toBeCloseTo(0.06);
    expect(
      cutsLastOperationOrder([fastTriple, slowSingle, quick]).map((layer) => layer.id),
    ).toEqual(['quick', 'slow', 'triple']);
  });

  it('keeps the current order for equally strong cuts', () => {
    const layers = [
      operation('b', 'line', { power: 40, speed: 2000 }),
      operation('a', 'line', { power: 20, speed: 1000 }),
      operation('c', 'line', { power: 40, speed: 2000 }),
    ];

    expect(cutsLastOperationOrder(layers).map((layer) => layer.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('sort cuts last: artwork order', () => {
  it('runs engrave-only artwork, then engrave-and-cut artwork, then cut-only artwork', () => {
    const scene = fixture(
      [object('Cut', ['cut']), object('Mixed', ['engrave', 'cut']), object('Engrave', ['engrave'])],
      [operation('cut', 'line'), operation('engrave', 'fill')],
    );

    const result = sortCutsLast(scene);

    expect(canonicalArtworkOrder(result.scene)).toEqual(['Engrave', 'Mixed', 'Cut']);
    expect(result.scene.layers.map((layer) => layer.id)).toEqual(['engrave', 'cut']);
    expect(result).toMatchObject({
      movedCutOperations: 1,
      artworkMovedLater: 1,
      engraveAndCutArtwork: 1,
    });
  });

  it('orders cut-only artwork by its strongest Line operation, weakest first', () => {
    const scene = fixture(
      [
        object('Heavy', ['light', 'heavy']),
        object('Light', ['light']),
        object('Medium', ['medium']),
        object('Tie', ['medium-copy']),
      ],
      [
        operation('light', 'line', { power: 10 }),
        operation('medium', 'line', { power: 50 }),
        operation('medium-copy', 'line', { power: 50 }),
        operation('heavy', 'line', { power: 90 }),
      ],
    );

    expect(canonicalArtworkOrder(sortCutsLast(scene).scene)).toEqual([
      'Light',
      'Medium',
      'Tie',
      'Heavy',
    ]);
  });

  it('keeps run units whole, like the Run order panel', () => {
    const scene = fixture(
      [object('A', ['cut']), object('B', ['engrave']), object('C', ['cut'])],
      [operation('engrave', 'fill'), operation('cut', 'line')],
    );

    expect(sortCutsLast(scene).scene.artworkOrder).toEqual(['B', 'A', 'C']);
  });

  it('leaves artwork without output in its run position', () => {
    const scene = fixture(
      [object('Cut', ['cut']), object('Off', ['off']), object('Engrave', ['engrave'])],
      [operation('engrave', 'fill'), operation('cut', 'line'), operation('off', 'fill', {}, false)],
    );

    expect(sortCutsLast(scene).scene.artworkOrder).toEqual(['Engrave', 'Off', 'Cut']);
  });

  it('classifies artwork by its effective output operations', () => {
    const lineWithFill = operation('line-with-fill', 'line');
    const scene = fixture(
      [
        object('Muted fill', ['muted', 'cut']),
        object('Override', ['cut'], { operationOverride: { mode: 'fill' } }),
        object('Sub-layer', ['line-with-fill']),
      ],
      [
        operation('muted', 'fill', {}, false),
        operation('cut', 'line'),
        {
          ...lineWithFill,
          subLayers: [
            createLayerSubLayer(lineWithFill, {
              id: 'engrave',
              label: 'Engrave',
              settings: { ...captureLayerOperationSettings(lineWithFill), mode: 'fill' },
            }),
          ],
        },
      ],
    );

    const result = sortCutsLast(scene);

    // Override engraves only; the sub-layer artwork both engraves and cuts;
    // the muted Fill does not run, so that artwork only cuts.
    expect(canonicalArtworkOrder(result.scene)).toEqual(['Override', 'Sub-layer', 'Muted fill']);
    expect(result.engraveAndCutArtwork).toBe(1);
    // Operation order uses each operation's own mode; sub-layers move with it.
    expect(result.scene.layers.map((layer) => layer.id)).toEqual([
      'muted',
      'cut',
      'line-with-fill',
    ]);
  });

  it('returns the same scene when cuts already run last, and a second run is a no-op', () => {
    const scene = fixture(
      [object('Cut', ['cut']), object('Engrave', ['engrave'])],
      [operation('cut', 'line'), operation('engrave', 'fill')],
    );

    const first = sortCutsLast(scene);
    const second = sortCutsLast(first.scene);

    expect(first.scene).not.toBe(scene);
    expect(second.scene).toBe(first.scene);
    expect(second).toMatchObject({ movedCutOperations: 0, artworkMovedLater: 0 });
  });

  it('leaves the registration jig in place: it burns in its own run first', () => {
    const jig = createRegistrationLayer();
    const scene = fixture(
      [object('Cut', ['cut']), object('Jig', [jig.id]), object('Engrave', ['engrave'])],
      [operation('cut', 'line', { power: 90 }), jig, operation('engrave', 'fill')],
    );

    const result = sortCutsLast(scene);

    expect(result.scene.layers.map((layer) => layer.id)).toEqual([jig.id, 'engrave', 'cut']);
    expect(result.movedCutOperations).toBe(1);
    // The jig box has no artwork output of its own to sort; it keeps its slot.
    expect(canonicalArtworkOrder(result.scene)).toEqual(['Engrave', 'Jig', 'Cut']);
  });

  it('does not rewrite a legacy artwork order when no run unit moves', () => {
    const scene: Scene = {
      ...fixture(
        [object('A', ['cut']), object('B', ['other']), object('C', ['cut'])],
        [operation('cut', 'line', { power: 10 }), operation('other', 'line', { power: 20 })],
      ),
      artworkOrder: ['A', 'B', 'C'],
    };

    expect(sortCutsLast(scene).scene).toBe(scene);
  });
});

function operation(
  id: string,
  mode: LayerMode,
  settings: Partial<Pick<Layer, 'power' | 'passes' | 'speed'>> = {},
  output = true,
): Layer {
  return { ...createLayer({ id, name: id, color: '#000000', mode }), ...settings, output };
}

function object(
  id: string,
  operationIds: ReadonlyArray<string>,
  extra: Partial<Pick<SceneObject, 'operationOverride'>> = {},
): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    operationIds,
    ...extra,
  };
}

function fixture(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Scene {
  return { objects, layers };
}
