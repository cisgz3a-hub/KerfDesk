/* eslint-disable no-restricted-syntax -- stable operation colours are required by these fixtures. */
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { artworkProject } from '../library/personal-artwork-test-fixtures';

export function proProject(settings: Partial<CncLayerSettings> = { cutType: 'v-carve' }): Project {
  const project = artworkProject();
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: [
        ...project.scene.layers,
        {
          ...createLayer({ id: 'pro-operation', color: '#2468ac' }),
          output: false,
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...settings },
        },
      ],
    },
  };
}

export function reliefProject(): Project {
  const project = artworkProject();
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'relief',
    source: 'triangle.stl',
    targetWidthMm: 10,
    reliefDepthMm: 1,
    color: '#123456',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: new Float32Array([0, 0, 0, 10, 0, 1, 0, 10, 0]),
      emptyCells: 'floor',
    },
  };
  return { ...project, scene: { ...project.scene, objects: [...project.scene.objects, relief] } };
}
