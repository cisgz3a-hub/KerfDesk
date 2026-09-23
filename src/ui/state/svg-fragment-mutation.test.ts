import { beforeEach, describe, expect, it } from 'vitest';
import { ownedClipImage } from '../../__fixtures__/owned-image-clip';
import { IDENTITY_TRANSFORM, pathUsesOperation, type SceneObject } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';
import { sourceFragmentObjects, type SvgArtworkFragment } from './svg-fragment-mutation';

function fragment(objects: readonly SceneObject[]): SvgArtworkFragment {
  return { source: 'composition.svg', bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 }, objects };
}

function image(id: string, x: number): SceneObject {
  const { svgImport: _owner, operationIds: _bindings, ...original } = ownedClipImage();
  return { ...original, id, transform: { ...IDENTITY_TRANSFORM, x } };
}

describe('atomic SVG fragment mutations', () => {
  beforeEach(resetStore);

  it('keeps structural Image/Fill modes and image density despite saved Line defaults', () => {
    useStore
      .getState()
      .setLayerDefaults({ allColors: { mode: 'line', linesPerMm: 2, speed: 987 }, byColor: {} });
    const vector = { ...svgObj('fill', ['#ff0000']), operationOverride: { mode: 'fill' as const } };
    useStore.getState().importSvgFragment(fragment([vector, image('image', 0)]));
    const layers = useStore.getState().project.scene.layers;
    expect(layers.map((layer) => layer.mode)).toEqual(['fill', 'image']);
    expect(layers.map((layer) => layer.speed)).toEqual([987, 987]);
    expect(layers[1]?.linesPerMm).not.toBe(2);
  });

  it('preserves each colour binding and an explicit middle run-order placement on replacement', () => {
    useStore.getState().importSvgObject(svgObj('before', ['#000000']));
    const incoming = fragment([svgObj('multi', ['#ff0000', '#0000ff']), image('image', 0)]);
    useStore.getState().importSvgFragment(incoming);
    useStore.getState().importSvgObject(svgObj('after', ['#00ff00']));
    const previous = useStore.getState().project;
    const order = previous.scene.objects.map((object) => object.id);
    useStore.setState({
      project: { ...previous, scene: { ...previous.scene, artworkOrder: order } },
    });
    const before = useStore.getState().project;
    const next = fragment(
      incoming.objects.map((object) => ({ ...object, id: object.id + '-new' })),
    );
    const outcome = useStore.getState().reimportSvgFragment('multi', next);
    expect(outcome).toMatchObject({ kept: 2, added: 0, removed: 0 });
    const scene = useStore.getState().project.scene;
    expect(scene.artworkOrder).toEqual(order);
    expect(scene.objects.map((object) => object.id)).toEqual(order);
    expect(scene.groups).toEqual(before.scene.groups);
    const multi = scene.objects.find((object) => object.id === 'multi');
    if (multi?.kind !== 'imported-svg') throw Error('Missing vector');
    expect(
      multi.paths.map((path) =>
        scene.layers
          .filter((layer) => pathUsesOperation(multi, path, layer))
          .map((layer) => layer.id),
      ),
    ).toEqual([['operation-multi'], ['operation-multi-2']]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('matches source content across inserted and reordered images instead of ordinal positions', () => {
    const a = image('a', 10),
      b = image('b', 20);
    useStore.getState().importSvgFragment(fragment([a, b]));
    const previous = useStore.getState().project.scene.objects;
    const outcome = useStore
      .getState()
      .reimportSvgFragment(
        'a',
        fragment([image('new', 30), { ...b, id: 'b-next' }, { ...a, id: 'a-next' }]),
      );
    expect(outcome).toMatchObject({ kept: 2, added: 1, removed: 0 });
    const scene = useStore.getState().project.scene;
    expect(scene.objects.map((object) => object.id)).toEqual(['new', 'b', 'a']);
    expect(scene.objects[1]?.operationIds).toEqual(previous[1]?.operationIds);
    expect(scene.objects[2]?.operationIds).toEqual(previous[0]?.operationIds);
    expect(scene.objects[0]?.operationIds).not.toEqual(previous[0]?.operationIds);
    const target = scene.objects[0];
    if (target === undefined) throw Error('Missing source');
    expect(sourceFragmentObjects(scene, target)).toHaveLength(3);
  });

  it('does not transfer identity/settings when a source bitmap changes', () => {
    const first = image('first', 10);
    useStore.getState().importSvgFragment(fragment([first]));
    if (first.kind !== 'raster-image') throw Error('Missing image');
    const changed = { ...first, id: 'changed', dataUrl: first.dataUrl + 'AA' };
    const outcome = useStore.getState().reimportSvgFragment('first', fragment([changed]));
    expect(outcome).toMatchObject({ kept: 0, added: 1, removed: 1 });
    expect(useStore.getState().project.scene.objects[0]?.id).toBe('changed');
  });

  it('validates replacement capacity after orphan operations are removed', () => {
    const objects = Array.from({ length: 256 }, (_, index) =>
      svgObj('old-' + index, ['#' + index.toString(16).padStart(6, '0')]),
    );
    useStore.getState().importSvgFragment(fragment(objects));
    const revised = objects.map((object) => ({
      ...object,
      id: object.id + '-revision',
      transform: { ...object.transform, x: 5 },
    }));
    expect(useStore.getState().reimportSvgFragment('old-0', fragment(revised))).toMatchObject({
      kept: 0,
      added: 256,
      removed: 256,
    });
    expect(useStore.getState().project.scene.layers).toHaveLength(256);
    expect(useStore.getState().project.scene.objects).toHaveLength(256);
  });
});
