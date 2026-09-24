// A laser project that exercises every power mode and air change the output
// strategies write, for resume oracle tests: a dynamic-power fill with air, a
// constant-power line without air and a dynamic-power grayscale photo with air.

import type { DeviceProfile } from '../../devices';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../scene';
import { createEllipse, createRectangle } from '../../shapes/primitives';

const COLORS = { fill: '#000000', line: '#ff0000', image: '#808080' } as const;

function artwork(): SceneObject[] {
  return [
    createRectangle({
      id: 'fill',
      color: COLORS.fill,
      transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
      spec: { widthMm: 8, heightMm: 5, cornerRadiusMm: 0 },
    }),
    createEllipse({
      id: 'line',
      color: COLORS.line,
      transform: { ...IDENTITY_TRANSFORM, x: 35, y: 22 },
      spec: { widthMm: 5, heightMm: 4 },
    }),
    {
      kind: 'raster-image',
      id: 'photo',
      color: COLORS.image,
      source: 'photo.png',
      dataUrl: 'data:image/png;base64,archived-preview-is-not-the-machining-source',
      lumaBase64: Buffer.from([
        0, 64, 128, 255, 255, 128, 64, 0, 32, 96, 160, 223, 223, 160, 96, 32,
      ]).toString('base64'),
      pixelWidth: 4,
      pixelHeight: 4,
      bounds: { minX: 50, minY: 30, maxX: 54, maxY: 34 },
      transform: IDENTITY_TRANSFORM,
      dither: 'grayscale',
      linesPerMm: 2,
    },
  ];
}

export function mixedLaserProject(device: DeviceProfile): Project {
  const base = createProject(device);
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: artwork(),
      layers: [
        {
          ...createLayer({ id: 'fill', color: COLORS.fill, mode: 'fill' }),
          hatchSpacingMm: 0.5,
          power: 40,
          passes: 2,
          airAssist: true,
        },
        {
          ...createLayer({ id: 'line', color: COLORS.line, mode: 'line' }),
          powerMode: 'constant',
          speed: 600,
          power: 60,
          airAssist: false,
        },
        {
          ...createLayer({ id: 'image', color: COLORS.image, mode: 'image' }),
          ditherAlgorithm: 'grayscale',
          linesPerMm: 2,
          imageBidirectional: true,
          power: 80,
          speed: 1200,
          airAssist: true,
        },
      ],
    },
  };
}
