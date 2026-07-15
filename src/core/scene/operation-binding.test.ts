import { describe, expect, it } from 'vitest';
import { createLayer } from './layer';
import { createArtworkOperation, nextOperationColor } from './artwork-operation';
import {
  bindSceneObjectToOperations,
  appendSceneObjectOperationBinding,
  operationArtworkCount,
  pathUsesOperation,
  sceneObjectUsesOperation,
  removeSceneObjectOperationBinding,
  replaceSceneObjectOperationBinding,
} from './operation-binding';
import { EMPTY_SCENE } from './scene';
import { IDENTITY_TRANSFORM, type ImportedSvg } from './scene-object';

const black = createLayer({ id: 'black', name: 'Legacy black', color: '#000000' });
const johann = createLayer({ id: 'johann', name: 'Johann', color: '#2563eb' });

function artwork(id: string): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [] }],
  };
}

describe('explicit operation binding', () => {
  it('separates same-colored artwork by stable operation id', () => {
    const first = bindSceneObjectToOperations(artwork('first'), ['johann']);
    const second = bindSceneObjectToOperations(artwork('second'), ['box']);
    expect(sceneObjectUsesOperation(first, johann)).toBe(true);
    expect(sceneObjectUsesOperation(second, johann)).toBe(false);
    expect(operationArtworkCount([first, second], johann)).toBe(1);
  });

  it('keeps color matching as the schema-v2 fallback', () => {
    const legacy = artwork('legacy');
    expect(sceneObjectUsesOperation(legacy, black)).toBe(true);
  });

  it('lets a path binding override a whole-artwork binding', () => {
    const object = bindSceneObjectToOperations(artwork('mixed'), ['johann']) as ImportedSvg;
    const path = { ...object.paths[0]!, operationIds: ['detail'] };
    expect(pathUsesOperation(object, path, johann)).toBe(false);
  });

  it('adds, replaces, and removes operations without collapsing path-specific bindings', () => {
    const detail = createLayer({ id: 'detail', name: 'Detail', color: '#dc2626' });
    const added = createLayer({ id: 'added', name: 'Added', color: '#16a34a' });
    const object: ImportedSvg = {
      ...artwork('mixed'),
      paths: [
        { color: '#000000', operationIds: [johann.id], polylines: [] },
        { color: '#000000', operationIds: [detail.id], polylines: [] },
      ],
    };
    const operations = [johann, detail, added];

    const withAdded = appendSceneObjectOperationBinding(
      object,
      added.id,
      operations,
    ) as ImportedSvg;
    const replaced = replaceSceneObjectOperationBinding(
      withAdded,
      johann.id,
      'johann-copy',
      operations,
    ) as ImportedSvg;
    const removed = removeSceneObjectOperationBinding(replaced, added.id, operations);

    expect(withAdded.paths.map((path) => path.operationIds)).toEqual([
      [johann.id, added.id],
      [detail.id, added.id],
    ]);
    expect(replaced.paths.map((path) => path.operationIds)).toEqual([
      ['johann-copy', added.id],
      [detail.id, added.id],
    ]);
    expect(
      removed !== null && 'paths' in removed ? removed.paths.map((path) => path.operationIds) : [],
    ).toEqual([['johann-copy'], [detail.id]]);
  });
});

describe('automatic artwork operations', () => {
  it('uses deterministic distinct palette colors and an artwork name', () => {
    expect(nextOperationColor([])).toBe('#2563eb');
    expect(nextOperationColor([{ color: '#2563eb' }])).toBe('#dc2626');
    const result = createArtworkOperation(EMPTY_SCENE, artwork('Johann'));
    expect(result.operation).toMatchObject({
      id: 'operation-Johann',
      name: 'Johann',
      color: '#2563eb',
    });
    expect(result.object.operationIds).toEqual(['operation-Johann']);
  });
});
