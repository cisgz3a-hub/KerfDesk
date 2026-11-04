// Shared by the output-preparation suites: a streamed photo above the 4 MP
// row-provider threshold, and a Fill job dense enough to pack its manifest.
import {
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
} from '../../core/scene';

export function streamedProject(): Project {
  const base = createProject();
  // eslint-disable-next-line no-restricted-syntax -- scene-data layer colour, not UI chrome
  const color = '#111111';
  return {
    ...base,
    scene: addLayer(
      addObject(base.scene, {
        kind: 'raster-image',
        id: 'large-image',
        color,
        source: 'large.png',
        dataUrl: 'data:image/png;base64,source',
        lumaBase64: 'AA==',
        pixelWidth: 1,
        pixelHeight: 1,
        dither: 'threshold',
        linesPerMm: 10,
        bounds: { minX: 0, minY: 0, maxX: 201, maxY: 201 },
        transform: IDENTITY_TRANSFORM,
      }),
      {
        ...createLayer({ id: 'image', color, mode: 'image' }),
        linesPerMm: 10,
        ditherAlgorithm: 'threshold',
        fillOverscanMm: 0,
      },
    ),
  };
}

export function fillProject(): Project {
  const base = createProject();
  // eslint-disable-next-line no-restricted-syntax -- scene-data layer colour, not UI chrome
  const color = '#2255ff';
  const square = (size: number) => ({
    points: [
      { x: 5, y: 5 },
      { x: 5 + size, y: 5 },
      { x: 5 + size, y: 5 + size },
      { x: 5, y: 5 + size },
    ],
    closed: true,
  });
  return {
    ...base,
    scene: addLayer(
      addObject(base.scene, {
        kind: 'imported-svg',
        id: 'fill',
        source: 'fill.svg',
        bounds: { minX: 5, minY: 5, maxX: 255, maxY: 255 },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color, polylines: [square(250)] }],
      }),
      { ...createLayer({ id: 'fill', color, mode: 'fill' }), linesPerMm: 10 },
    ),
  };
}
