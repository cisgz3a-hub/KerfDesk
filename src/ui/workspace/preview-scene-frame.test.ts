import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildToolpath, USER_ORIGIN_JOB_PLACEMENT, type Toolpath } from '../../core/job';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { buildPreviewToolpath } from './draw-preview';
import { mapToolpathToScene } from './preview-scene-frame';

// An off-center, asymmetric polyline: the H3 acceptance fixture. On the
// default front-left origin its machine Y is bedH - sceneY, so any preview
// drawn straight from machine coordinates lands mirrored about the bed
// midline (y = 390 instead of y = 10 on a 400 mm bed).
function offCenterProject(): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 50, y: 10 },
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
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: '#000000', color: '#000000' })),
  };
}

function cutPolylines(toolpath: Toolpath): ReadonlyArray<ReadonlyArray<{ x: number; y: number }>> {
  return toolpath.steps
    .filter((s) => s.kind === 'cut')
    .map((s) => (s.kind === 'cut' ? s.polyline.map((p) => ({ x: p.x, y: p.y })) : []));
}

describe('mapToolpathToScene', () => {
  it('maps machine-frame steps back to scene coordinates and preserves lengths', () => {
    const dev = DEFAULT_DEVICE_PROFILE; // front-left
    const machineToolpath: Toolpath = {
      steps: [
        {
          kind: 'travel',
          from: { x: 0, y: dev.bedHeight },
          to: { x: 10, y: dev.bedHeight - 10 },
          length: 5,
        },
        {
          kind: 'cut',
          color: '#000000',
          polyline: [
            { x: 10, y: dev.bedHeight - 10 },
            { x: 50, y: dev.bedHeight - 10 },
          ],
          length: 40,
        },
      ],
      totalLength: 45,
    };

    const scene = mapToolpathToScene(machineToolpath, { x: 0, y: 0 }, dev);

    expect(scene.steps[0]).toEqual({
      kind: 'travel',
      from: { x: 0, y: 0 },
      to: { x: 10, y: 10 },
      length: 5,
    });
    expect(scene.steps[1]).toEqual({
      kind: 'cut',
      color: '#000000',
      polyline: [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
      ],
      length: 40,
    });
    expect(scene.totalLength).toBe(45);
  });

  it('undoes a job-origin translation before the machine-to-scene mapping', () => {
    const dev = DEFAULT_DEVICE_PROFILE;
    // A job translated by (-10, -290): e.g. user-origin anchoring. The
    // original machine point was (10, 390) = scene (10, 10).
    const translated: Toolpath = {
      steps: [
        {
          kind: 'cut',
          color: '#000000',
          polyline: [
            { x: 0, y: 100 },
            { x: 40, y: 100 },
          ],
          length: 40,
        },
      ],
      totalLength: 40,
    };

    const scene = mapToolpathToScene(translated, { x: -10, y: -290 }, dev);

    expect(cutPolylines(scene)).toEqual([
      [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
      ],
    ]);
  });
});

describe('buildPreviewToolpath frame registration (H3)', () => {
  it('returns the cut at its SCENE coordinates on the default front-left origin', () => {
    const project = offCenterProject();

    const toolpath = buildPreviewToolpath(project);

    expect(cutPolylines(toolpath)).toEqual([
      [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
      ],
    ]);
  });

  it('registers user-origin placements with the scene geometry too', () => {
    const project = offCenterProject();

    const absolute = buildPreviewToolpath(project);
    const userOrigin = buildPreviewToolpath(project, { jobOrigin: USER_ORIGIN_JOB_PLACEMENT });

    expect(cutPolylines(userOrigin)).toEqual(cutPolylines(absolute));
  });

  it('still mirrors the prepared (optimized) job content exactly', () => {
    const project = offCenterProject();
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(buildPreviewToolpath(project)).toEqual(expectedPreviewToolpath(project, prepared));
    }
  });
});

function expectedPreviewToolpath(
  project: Project,
  prepared: Extract<ReturnType<typeof prepareOutput>, { readonly ok: true }>,
) {
  return mapToolpathToScene(
    buildToolpath(prepared.job, {
      startPoint: { x: 0, y: 0 },
      parkPoint: { x: 0, y: 0 },
      scanningOffsets: project.device.scanningOffsets,
    }),
    prepared.jobOriginOffset,
    project.device,
  );
}
