import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';

/** One black pixel at 25% for public compile/export/stream contract tests. */
export function nativeLaserProject(controllerKind: ControllerKind) {
  const base = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind,
    maxPowerS: controllerKind === 'smoothieware' ? 1 : 255,
  });
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
          power: 25,
          ditherAlgorithm: 'threshold' as const,
          linesPerMm: 1,
        },
      ],
      objects: [
        {
          kind: 'raster-image' as const,
          id: 'r',
          source: 'photo.png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          pixelWidth: 1,
          pixelHeight: 1,
          bounds: { minX: 10, minY: 10, maxX: 11, maxY: 11 },
          transform: IDENTITY_TRANSFORM,
          color: '#808080',
          dither: 'threshold' as const,
          linesPerMm: 1,
          lumaBase64: 'AA==',
        },
      ],
    },
  };
}
