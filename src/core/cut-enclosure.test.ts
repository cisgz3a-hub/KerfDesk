import { describe, expect, it } from 'vitest';
import { analyzeCutEnclosure } from './cut-enclosure';
import { artwork, operation, raster } from './cut-order.test-support';
import { REGISTRATION_LAYER_ID, type Layer, type Scene, type SceneObject } from './scene';

function scene(layers: ReadonlyArray<Layer>, objects: ReadonlyArray<SceneObject>): Scene {
  return { layers, objects };
}

describe('analyzeCutEnclosure', () => {
  it('treats a closed Line contour around another operation’s work as a cut', () => {
    const result = analyzeCutEnclosure(
      scene(
        [operation('cut'), operation('engrave', 'fill')],
        [
          artwork('panel', [
            { operationId: 'cut', rect: [0, 0, 50, 50] },
            { operationId: 'engrave', rect: [10, 10, 10, 10] },
          ]),
        ],
      ),
    );

    expect([...result.cutOperationIds]).toEqual(['cut']);
    expect(result.operationDepths.get('engrave')).toBe(1);
    // One artwork holds both, so no artwork surrounds another.
    expect(result.objectDepths.size).toBe(0);
  });

  it('records which artwork a separate cut outline surrounds', () => {
    const result = analyzeCutEnclosure(
      scene(
        [operation('cut'), operation('engrave', 'fill')],
        [
          artwork('outline', [{ operationId: 'cut', rect: [0, 0, 50, 50] }]),
          artwork('logo', [{ operationId: 'engrave', rect: [10, 10, 10, 10] }]),
          artwork('elsewhere', [{ operationId: 'engrave', rect: [80, 0, 10, 10] }]),
        ],
      ),
    );

    expect(result.objectDepths.get('logo')).toBe(1);
    expect(result.objectDepths.has('elsewhere')).toBe(false);
  });

  it('leaves Line work that surrounds nothing, or only its own operation, alone', () => {
    const result = analyzeCutEnclosure(
      scene(
        [operation('score'), operation('engrave', 'fill')],
        [
          artwork('nested-score', [
            { operationId: 'score', rect: [0, 0, 50, 50] },
            { operationId: 'score', rect: [10, 10, 10, 10] },
          ]),
          artwork('logo', [{ operationId: 'engrave', rect: [80, 0, 10, 10] }]),
        ],
      ),
    );

    expect(result.cutOperationIds.size).toBe(0);
  });

  it('never counts open paths or Fill outlines as cuts', () => {
    const result = analyzeCutEnclosure(
      scene(
        [operation('open-line'), operation('fill', 'fill'), operation('engrave')],
        [
          artwork('open', [{ operationId: 'open-line', rect: [0, 0, 50, 50], closed: false }]),
          artwork('filled', [{ operationId: 'fill', rect: [0, 0, 50, 50] }]),
          artwork('inside', [{ operationId: 'engrave', rect: [10, 10, 10, 10], closed: false }]),
        ],
      ),
    );

    expect(result.cutOperationIds.size).toBe(0);
  });

  it('ignores operations with output off and the registration jig', () => {
    const inside = artwork('inside', [{ operationId: 'engrave', rect: [10, 10, 10, 10] }]);
    const offCut = analyzeCutEnclosure(
      scene(
        [{ ...operation('cut'), output: false }, operation('engrave', 'fill')],
        [artwork('outline', [{ operationId: 'cut', rect: [0, 0, 50, 50] }]), inside],
      ),
    );
    const jig = analyzeCutEnclosure(
      scene(
        [operation(REGISTRATION_LAYER_ID), operation('engrave', 'fill')],
        [artwork('jig', [{ operationId: REGISTRATION_LAYER_ID, rect: [0, 0, 50, 50] }]), inside],
      ),
    );

    expect(offCut.cutOperationIds.size).toBe(0);
    expect(jig.cutOperationIds.size).toBe(0);
  });

  it('counts an image engraving inside the cut', () => {
    const result = analyzeCutEnclosure(
      scene(
        [operation('cut'), operation('photo', 'image')],
        [
          artwork('outline', [{ operationId: 'cut', rect: [0, 0, 50, 50] }]),
          raster('picture', 'photo', [10, 10, 20, 20]),
        ],
      ),
    );

    expect([...result.cutOperationIds]).toEqual(['cut']);
    expect(result.objectDepths.get('picture')).toBe(1);
  });

  it('measures nesting: an inner cut is surrounded by the outer one', () => {
    const result = analyzeCutEnclosure(
      scene(
        [operation('outer'), operation('inner'), operation('engrave', 'fill')],
        [
          artwork('frame', [{ operationId: 'outer', rect: [0, 0, 100, 100] }]),
          artwork('window', [{ operationId: 'inner', rect: [10, 10, 50, 50] }]),
          artwork('logo', [{ operationId: 'engrave', rect: [20, 20, 10, 10] }]),
        ],
      ),
    );

    expect([...result.cutOperationIds].sort()).toEqual(['inner', 'outer']);
    expect(result.operationDepths.get('inner')).toBe(1);
    expect(result.operationDepths.get('engrave')).toBe(2);
    expect(result.objectDepths.get('window')).toBe(1);
    expect(result.objectDepths.get('logo')).toBe(2);
  });
});
