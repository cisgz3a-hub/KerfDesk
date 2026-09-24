// Scene fixtures for the cut-order tests: rectangles bound to named
// operations, so a test reads as "a cut around an engraving".

import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type LayerMode,
  type RasterImage,
  type SceneObject,
  type Vec2,
} from './scene';

/** [x, y, width, height] in millimetres. */
export type Rect = readonly [number, number, number, number];

export type Part = {
  readonly operationId: string;
  readonly rect: Rect;
  /** Closed by default; an open rectangle is three sides. */
  readonly closed?: boolean;
};

export function operation(id: string, mode: LayerMode = 'line'): Layer {
  return { ...createLayer({ id, name: id, color: '#000000', mode }), hatchSpacingMm: 2 };
}

/** One artwork whose rectangles each run on their own operation. */
export function artwork(id: string, parts: ReadonlyArray<Part>): SceneObject {
  const xs = parts.flatMap(({ rect }) => [rect[0], rect[0] + rect[2]]);
  const ys = parts.flatMap(({ rect }) => [rect[1], rect[1] + rect[3]]);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    operationIds: [...new Set(parts.map((part) => part.operationId))],
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: parts.map((part) => ({
      color: '#000000',
      operationIds: [part.operationId],
      polylines: [{ points: rectPoints(part.rect), closed: part.closed !== false }],
    })),
  };
}

export function raster(id: string, operationId: string, rect: Rect): RasterImage {
  const [x, y, width, height] = rect;
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: 'AP//AA==',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height },
    transform: IDENTITY_TRANSFORM,
    color: '#000000',
    dither: 'threshold',
    linesPerMm: 1,
    operationIds: [operationId],
  };
}

function rectPoints([x, y, width, height]: Rect): ReadonlyArray<Vec2> {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}
