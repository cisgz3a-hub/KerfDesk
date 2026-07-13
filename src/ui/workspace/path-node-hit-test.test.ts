import { describe, expect, it } from 'vitest';
import {
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  addObject,
  createLayer,
  type ColoredPath,
  type ImportedSvg,
  type RasterImage,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { hitPathNode } from './path-node-hit-test';

describe('hitPathNode', () => {
  it('returns the nearest transformed vector node inside the screen threshold', () => {
    const scene = withObjects(
      importedSvg('logo', [
        path([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ]),
      ]),
    );

    expect(hitPathNode(scene, { x: 15.2, y: 3.1 }, 0.5)).toEqual({
      objectId: 'logo',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 1,
    });
  });

  it('prefers the topmost editable node and skips locked or non-vector objects', () => {
    const underneath = importedSvg('under', [path([{ x: 0, y: 0 }])]);
    const locked = { ...importedSvg('locked', [path([{ x: 0, y: 0 }])]), locked: true };
    const raster = rasterImage('raster');
    const top = createPolyline({
      id: 'pen',
      color: '#000000',
      spec: {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    });
    const scene = withObjects(underneath, locked, raster, top);

    expect(hitPathNode(scene, { x: 0.1, y: 0.1 }, 1)).toEqual({
      objectId: 'pen',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 0,
      geometry: 'curve',
    });
  });

  it('returns null outside the node threshold', () => {
    const scene = withObjects(importedSvg('logo', [path([{ x: 0, y: 0 }])]));

    expect(hitPathNode(scene, { x: 20, y: 20 }, 0.25)).toBeNull();
  });

  it('hits canonical anchors and selected cubic controls instead of sampled points', () => {
    const curved: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 4 },
            { x: 10, y: 0 },
          ],
        },
      ],
      curves: [
        {
          start: { x: 0, y: 0 },
          segments: [
            {
              kind: 'cubic',
              control1: { x: 2, y: 5 },
              control2: { x: 8, y: 5 },
              to: { x: 10, y: 0 },
            },
          ],
          closed: false,
        },
      ],
    };
    const scene = withObjects(importedSvg('curve', [curved]));
    expect(hitPathNode(scene, { x: 15, y: 3 }, 0.2)).toEqual({
      objectId: 'curve',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 1,
      geometry: 'curve',
    });
    const selected = [
      {
        objectId: 'curve',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 0,
        geometry: 'curve' as const,
      },
    ];
    expect(hitPathNode(scene, { x: 7, y: 8 }, 0.2, selected)).toEqual({
      ...selected[0],
      handle: 'outgoing',
    });
  });

  it('ignores editable nodes on hidden layers', () => {
    const scene = {
      ...withObjects(
        importedSvg('logo', [path([{ x: 0, y: 0 }], '#ff0000'), path([{ x: 100, y: 100 }])]),
      ),
      layers: [
        { ...createLayer({ id: '#ff0000', color: '#ff0000' }), visible: false },
        createLayer({ id: '#000000', color: '#000000' }),
      ],
    };

    expect(hitPathNode(scene, { x: 5, y: 3 }, 1)).toBeNull();
  });
});

function withObjects(...objects: ReadonlyArray<SceneObject>): Scene {
  return objects.reduce<Scene>((scene, object) => addObject(scene, object), EMPTY_SCENE);
}

function importedSvg(id: string, paths: ReadonlyArray<ColoredPath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x: 5, y: 3 },
    paths,
  };
}

function path(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  color = '#000000',
): ColoredPath {
  return { color, polylines: [{ closed: false, points }] };
}

function rasterImage(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: 'gA==',
  };
}
