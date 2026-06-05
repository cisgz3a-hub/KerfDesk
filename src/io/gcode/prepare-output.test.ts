import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from './prepare-output';

function vectorProject(): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 1, y: 1 },
              { x: 9, y: 9 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

function hugeRasterProject(): Project {
  const color = '#808080';
  const raster: SceneObject = {
    kind: 'raster-image',
    id: 'R1',
    color,
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    dither: 'floyd-steinberg',
    linesPerMm: 25,
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    transform: IDENTITY_TRANSFORM,
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, raster), {
      ...createLayer({ id: color, color, mode: 'image' }),
      linesPerMm: 25,
    }),
  };
}

describe('prepareOutput', () => {
  it('returns an optimized job for a well-formed project', () => {
    const prepared = prepareOutput(vectorProject());
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.job.groups.length).toBeGreaterThan(0);
  });

  it('refuses an over-budget raster (ok:false) without producing a job', () => {
    const prepared = prepareOutput(hugeRasterProject());
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.preflight.issues.some((i) => i.code === 'raster-too-large')).toBe(true);
    }
  });

  it('is deterministic — the same project yields the same job', () => {
    const project = vectorProject();
    expect(prepareOutput(project)).toEqual(prepareOutput(project));
  });
});
