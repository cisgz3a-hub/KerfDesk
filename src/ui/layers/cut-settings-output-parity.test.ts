import { describe, expect, it } from 'vitest';
import { buildToolpath } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { emitGcode, prepareOutput } from '../../io/gcode';
import { estimateLiveJob } from '../laser/live-job-estimate';
import { buildPreviewToolpath } from '../workspace/draw-preview';
import { mapToolpathToScene } from '../workspace/preview-scene-frame';
import { readCutSettingsPatch } from './cut-settings-draft';

describe('cut settings editor output parity', () => {
  it('routes a fill dialog patch through prepared output, preview, G-code, and estimate', () => {
    const base = fillProject();
    const patch = readCutSettingsPatch(
      formData({
        mode: 'fill',
        power: '44',
        speed: '1234',
        passes: '1',
        hatchAngleDeg: '45',
        hatchSpacingMm: '1',
        fillOverscanMm: '1',
        fillBidirectional: 'on',
        visible: 'on',
        output: 'on',
      }),
      base.scene.layers[0]!,
    );
    const project = patchFirstLayer(base, patch);
    const prepared = prepareOutput(project);

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('expected prepared fill output');
    expect(prepared.job.groups[0]).toMatchObject({
      kind: 'fill',
      power: 44,
      speed: 1234,
      overscanMm: 1,
    });
    expect(buildPreviewToolpath(project)).toEqual(
      mapToolpathToScene(buildToolpath(prepared.job), prepared.jobOriginOffset, project.device),
    );
    expect(emitGcode(project).gcode).not.toBe(emitGcode(base).gcode);
    expect(estimateLiveJob(project).kind).toBe('estimated');
  });

  it('routes an image dialog patch through prepared output, G-code, and estimate', () => {
    const base = imageProject();
    const patch = readCutSettingsPatch(
      formData({
        mode: 'image',
        power: '40',
        speed: '900',
        passes: '1',
        ditherAlgorithm: 'grayscale',
        minPower: '10',
        imageDpi: '25.4',
        dotWidthCorrectionMm: '0.05',
        negativeImage: 'on',
        visible: 'on',
        output: 'on',
      }),
      base.scene.layers[0]!,
    );
    const project = patchFirstLayer(base, patch);
    const prepared = prepareOutput(project);

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('expected prepared image output');
    expect(prepared.job.groups[0]).toMatchObject({
      kind: 'raster',
      power: 40,
      speed: 900,
      dotWidthCorrectionMm: 0.05,
    });
    expect(emitGcode(project).gcode).not.toBe(emitGcode(base).gcode);
    expect(estimateLiveJob(project).kind).toBe('estimated');
  });
});

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function patchFirstLayer(project: Project, patch: Partial<Layer>): Project {
  const [first, ...rest] = project.scene.layers;
  if (first === undefined) throw new Error('expected at least one layer');
  return {
    ...project,
    scene: { ...project.scene, layers: [{ ...first, ...patch }, ...rest] },
  };
}

function fillProject(): Project {
  const color = '#000000';
  return {
    ...createProject(),
    scene: {
      layers: [{ ...createLayer({ id: color, color, mode: 'fill' }), hatchSpacingMm: 2 }],
      objects: [squareObject(color)],
    },
  };
}

function squareObject(color: string): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}

function imageProject(): Project {
  const color = '#808080';
  return {
    ...createProject(),
    scene: {
      layers: [{ ...createLayer({ id: color, color, mode: 'image' }), linesPerMm: 1 }],
      objects: [rasterObject(color)],
    },
  };
}

function rasterObject(color: string): RasterImage {
  return {
    kind: 'raster-image',
    id: 'image',
    source: 'image.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AP8=',
  };
}
