import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { createEllipse } from '../shapes/primitives';
import { weldVectorObjects } from '../geometry';
import { collectLayerContours } from './collect-cnc-contours';
import { compileCncJob } from './compile-cnc-job';

describe('V-carve shape compilation', () => {
  // The production-size compile exceeded 30 s under the normal four-worker local load.
  it('compiles the reported 66.6 mm circle with the starter V-bit', () => {
    const color = '#000000';
    const scene: Scene = {
      objects: [
        createEllipse({
          id: 'reported-circle',
          color,
          spec: { widthMm: 66.6, heightMm: 66.6 },
        }),
      ],
      layers: [
        {
          ...createLayer({ id: 'reported-circle-vcarve', color }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'v-carve',
            vCarveFlatDepthEnabled: false,
            depthMm: 1,
            depthPerPassMm: 1.5,
            vResolutionMm: 0,
          },
        },
      ],
    };

    const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [
        {
          id: 'vb-30',
          name: '30 degree V-bit - 3.175 mm cut',
          kind: 'v-bit',
          diameterMm: 3.175,
          tipAngleDeg: 30,
        },
      ],
      toolId: 'vb-30',
    });

    const passes = job.groups.flatMap((group) =>
      group.kind === 'cnc' && group.cutType === 'v-carve' ? group.passes : [],
    );
    expect(passes.length).toBeGreaterThan(0);
  }, 60_000);

  it('does not transfer source tab indices onto merged stroke-outline contours', () => {
    const color = '#000000';
    const object: ImportedSvg = {
      kind: 'imported-svg',
      id: 'outlined-stroke-with-tab',
      source: 'outlined-stroke.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color,
          strokeWidthMm: 2,
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 5 },
                { x: 10, y: 5 },
              ],
            },
            {
              closed: false,
              points: [
                { x: 5, y: 0 },
                { x: 5, y: 10 },
              ],
            },
          ],
        },
      ],
      cncTabAnchors: [{ layerColor: color, pathIndex: 0, polylineIndex: 0, pathT: 0.5 }],
    };
    const layer = {
      ...createLayer({ id: 'outlined-stroke-vcarve', color }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' as const },
    };

    const contours = collectLayerContours([object], layer, DEFAULT_DEVICE_PROFILE);

    expect(contours.length).toBeGreaterThan(0);
    expect(contours.every((contour) => contour.manualTabPoints === undefined)).toBe(true);
  });

  it('preserves reflected uniform stroke outlines through Weld materialization', () => {
    const color = '#000000';
    const source: ImportedSvg = {
      kind: 'imported-svg',
      id: 'reflected-stroke',
      source: 'reflected-stroke.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: -2, scaleY: 2 },
      paths: [
        {
          color,
          strokeWidthMm: 0.5,
          polylines: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
                { x: 0, y: 0 },
              ],
            },
          ],
        },
      ],
    };
    const layer = {
      ...createLayer({ id: 'vcarve', color }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' as const },
    };
    const welded = weldVectorObjects([source], 'welded');
    if (welded.kind === 'error') throw new Error(welded.error.message);

    const before = contourBounds(collectLayerContours([source], layer, DEFAULT_DEVICE_PROFILE));
    const after = contourBounds(
      collectLayerContours([welded.value], layer, DEFAULT_DEVICE_PROFILE),
    );
    expect(welded.value.paths[0]?.strokeWidthMm).toBe(1);
    expect(after).toEqual(before);
  });
});

function contourBounds(contours: ReturnType<typeof collectLayerContours>) {
  return contours
    .map((contour) => {
      const xs = contour.polyline.points.map((point) => point.x);
      const ys = contour.polyline.points.map((point) => point.y);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    })
    .sort((left, right) => left.minX - right.minX || left.minY - right.minY);
}
