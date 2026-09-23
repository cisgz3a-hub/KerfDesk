/* eslint-disable no-restricted-syntax -- Authored SVG fixture colours, not application chrome. */
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type RasterImage,
} from '../../core/scene';
import { exportSceneSvg } from '../../io/svg/export-scene-svg';
import { realPng } from '../import/svg-image-hydration.test-support';

export function roundTripSource() {
  const back: ImportedSvg = {
    kind: 'imported-svg',
    id: 'back',
    source: 'back.svg',
    bounds: { minX: -600, minY: -50, maxX: 500, maxY: 200 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        fillRule: 'evenodd',
        polylines: [
          {
            closed: true,
            points: [
              { x: -600, y: -50 },
              { x: 500, y: -50 },
              { x: 500, y: 200 },
              { x: -600, y: 200 },
            ],
          },
        ],
      },
    ],
  };
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'image',
    source: 'real.png',
    dataUrl: 'data:image/png;base64,' + Buffer.from(realPng()).toString('base64'),
    pixelWidth: 20000,
    pixelHeight: 1,
    bounds: { minX: -2, minY: 4, maxX: 18, maxY: 14 },
    transform: {
      ...IDENTITY_TRANSFORM,
      x: -80,
      y: 35,
      scaleX: 2,
      scaleY: 0.75,
      rotationDeg: 31,
      mirrorX: true,
      mirrorY: true,
    },
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
  const front: ImportedSvg = {
    ...back,
    id: 'front',
    source: 'front.svg',
    paths: [
      {
        color: '#0000ff',
        polylines: [
          {
            closed: false,
            points: [
              { x: 80, y: 40 },
              { x: 90, y: 60 },
            ],
          },
        ],
      },
    ],
  };
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [back, image, front],
      layers: [createLayer({ id: '#ff0000', color: '#ff0000', mode: 'fill' })],
    },
  };
}

export function roundTripFile(source = roundTripSource()): File {
  const result = exportSceneSvg(source);
  if (result.kind === 'error') throw new Error(result.error);
  return new File([result.value.svg], 'composed.svg', { type: 'image/svg+xml' });
}
