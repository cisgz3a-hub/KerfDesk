import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type Project,
  type RasterImage,
} from '../core/scene';
import { makePng } from '../ui/import/png-incremental-decoder.test-support';

/** Real 4x4 black pixels with a three-column clip and one-pixel hole. */
export function ownedClipImage(): RasterImage {
  const rows = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const png = makePng({ width: 4, height: 4, colorType: 0, rows });
  return {
    kind: 'raster-image',
    id: 'owned-image',
    source: 'clipped.png',
    pixelWidth: 4,
    pixelHeight: 4,
    dataUrl: 'data:image/png;base64,' + Buffer.from(png).toString('base64'),
    lumaBase64: Buffer.from(rows.flat()).toString('base64'),
    bounds: { minX: 10, minY: 20, maxX: 14, maxY: 24 },
    transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 },
    color: '#808080',
    operationIds: ['image-operation'],
    dither: 'threshold',
    linesPerMm: 1,
    imageClip: [clipRectangle(10, 20, 13, 24), clipRectangle(11, 21, 12, 22)],
    svgImport: { id: 'source-fragment', source: 'clipped.svg', transform: IDENTITY_TRANSFORM },
  };
}

export function ownedClipProject(image: RasterImage = ownedClipImage()): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, origin: 'rear-left' },
    scene: {
      objects: [image],
      layers: [
        {
          ...createLayer({ id: 'image-operation', color: image.color, mode: 'image' }),
          passThrough: true,
          ditherAlgorithm: 'threshold',
          power: 30,
          minPower: 0,
        },
      ],
      groups: [],
    },
  };
}

export function clipRectangle(minX: number, minY: number, maxX: number, maxY: number): ColoredPath {
  const polyline = {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
  return { color: '#000000', polylines: [polyline], curves: [polylineToCurveSubpath(polyline)] };
}
