import { describe, expect, it } from 'vitest';
import { artwork, operation } from './cut-order.test-support';
import { cutsLastOrder } from './cuts-last-order';
import type { Layer, Scene, SceneObject } from './scene';

function scene(
  layers: ReadonlyArray<Layer>,
  objects: ReadonlyArray<SceneObject>,
  artworkOrder?: ReadonlyArray<string>,
): Scene {
  return { layers, objects, ...(artworkOrder === undefined ? {} : { artworkOrder }) };
}

const ids = (layers: ReadonlyArray<Layer> | undefined): ReadonlyArray<string> | undefined =>
  layers?.map((layer) => layer.id);

// A panel with its cut outline and engraving in one artwork (one SVG).
function panelScene(layers: ReadonlyArray<Layer>): Scene {
  return scene(layers, [
    artwork('panel', [
      { operationId: 'cut', rect: [0, 0, 50, 50] },
      { operationId: 'engrave', rect: [10, 10, 10, 10] },
    ]),
    artwork('tag', [{ operationId: 'mark', rect: [80, 0, 10, 10] }]),
  ]);
}

describe('cutsLastOrder', () => {
  it('moves the cut operations after every other operation, keeping their order', () => {
    const order = cutsLastOrder(
      panelScene([operation('cut'), operation('mark', 'fill'), operation('engrave', 'fill')]),
      'project-order',
    );

    expect(order.cutOperationCount).toBe(1);
    expect(ids(order.sorted?.layers)).toEqual(['mark', 'engrave', 'cut']);
  });

  it('keeps Line work that surrounds nothing where the operator put it', () => {
    const layers = [operation('score'), operation('cut'), operation('engrave', 'fill')];
    const order = cutsLastOrder(
      scene(layers, [
        artwork('panel', [
          { operationId: 'cut', rect: [0, 0, 50, 50] },
          { operationId: 'engrave', rect: [10, 10, 10, 10] },
        ]),
        artwork('score-line', [{ operationId: 'score', rect: [80, 0, 10, 10] }]),
      ]),
      'project-order',
    );

    expect(ids(order.sorted?.layers)).toEqual(['score', 'engrave', 'cut']);
  });

  it('runs nested cuts innermost first', () => {
    const order = cutsLastOrder(
      scene(
        [operation('outer'), operation('inner'), operation('engrave', 'fill')],
        [
          artwork('frame', [{ operationId: 'outer', rect: [0, 0, 100, 100] }]),
          artwork('window', [{ operationId: 'inner', rect: [10, 10, 50, 50] }]),
          artwork('logo', [{ operationId: 'engrave', rect: [20, 20, 10, 10] }]),
        ],
        ['frame', 'window', 'logo'],
      ),
      'project-order',
    );

    expect(ids(order.sorted?.layers)).toEqual(['engrave', 'inner', 'outer']);
    expect(order.sorted?.artworkOrder).toEqual(['logo', 'window', 'frame']);
  });

  it('moves cut runs after the other runs and keeps the rest in their order', () => {
    const order = cutsLastOrder(
      scene(
        [operation('cut'), operation('engrave', 'fill')],
        [
          artwork('outline', [{ operationId: 'cut', rect: [0, 0, 50, 50] }]),
          artwork('b', [{ operationId: 'engrave', rect: [60, 0, 10, 10] }]),
          artwork('logo', [{ operationId: 'engrave', rect: [10, 10, 10, 10] }]),
        ],
        ['outline', 'logo', 'b'],
      ),
      'project-order',
    );

    // "logo" and "b" share one operation, so they are one run unit.
    expect(order.sorted?.artworkOrder).toEqual(['logo', 'b', 'outline']);
    expect(ids(order.sorted?.layers)).toEqual(['engrave', 'cut']);
  });

  it('puts the cuts on top when operations run bottom-up', () => {
    const order = cutsLastOrder(
      panelScene([operation('mark', 'fill'), operation('engrave', 'fill'), operation('cut')]),
      'reverse-project-order',
    );

    expect(ids(order.sorted?.layers)).toEqual(['cut', 'mark', 'engrave']);
  });

  it('changes nothing when the cuts already run last, so a second sort is a no-op', () => {
    const first = cutsLastOrder(
      panelScene([operation('cut'), operation('mark', 'fill'), operation('engrave', 'fill')]),
      'project-order',
    );
    const sorted = first.sorted;
    if (sorted === null) throw new Error('expected a reorder');
    const again = cutsLastOrder(
      { ...panelScene(sorted.layers), artworkOrder: sorted.artworkOrder },
      'project-order',
    );

    expect(again).toEqual({ cutOperationCount: 1, sorted: null });
  });

  it('reports no cuts when no Line contour surrounds other work', () => {
    const order = cutsLastOrder(
      scene(
        [operation('score'), operation('engrave', 'fill')],
        [
          artwork('score-line', [{ operationId: 'score', rect: [0, 0, 10, 10] }]),
          artwork('logo', [{ operationId: 'engrave', rect: [20, 0, 10, 10] }]),
        ],
      ),
      'project-order',
    );

    expect(order).toEqual({ cutOperationCount: 0, sorted: null });
  });
});
