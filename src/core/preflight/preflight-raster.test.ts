// Mode-mismatch + raster-transform + overscan-hint preflight tests, split
// from preflight.test.ts when that file hit the 400-line cap.

import { describe, expect, it } from 'vitest';
import { compileJob } from '../job';
import { grblStrategy } from '../output';
import {
  createLayer,
  createLayerSubLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../scene';
import { runPreflight } from './preflight';

function emit(project: Project): string {
  return grblStrategy.emit(compileJob(project.scene, project.device), project.device);
}

const sampleObject: SceneObject = {
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

describe('runPreflight — F4: layer-mode-mismatch (silent compile drop)', () => {
  const blueVector: SceneObject = {
    kind: 'imported-svg',
    id: 'O-blue',
    source: 'b.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#0000ff',
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

  const grayRaster: SceneObject = {
    kind: 'raster-image',
    id: 'R1',
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };

  it('flags a vector object whose color maps to an Image-mode layer', () => {
    // The red vector on a Line layer emits fine; the blue vector lands on an
    // Image-mode layer, which compileJob only feeds raster images — so the
    // blue vector silently produces no G-code. The red cut keeps the job
    // non-empty, isolating this from the empty-output check.
    const lineLayer = createLayer({ id: 'L-red', color: '#ff0000' });
    const imageLayer = createLayer({ id: 'L-blue', color: '#0000ff', mode: 'image' });
    const project: Project = {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        objects: [sampleObject, blueVector],
        layers: [lineLayer, imageLayer],
      },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('layer-mode-mismatch');
    expect(codes).not.toContain('empty-output');
  });

  it('flags a raster image whose color maps to a Line/Fill-mode layer', () => {
    const lineLayer = createLayer({ id: 'L-gray', color: '#808080' });
    const project: Project = {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [grayRaster], layers: [lineLayer] },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('layer-mode-mismatch');
  });

  it('does not flag correctly-matched objects (vector on Line, raster on Image)', () => {
    const lineLayer = createLayer({ id: 'L-red', color: '#ff0000' });
    const imageLayer = createLayer({ id: 'L-gray', color: '#808080', mode: 'image' });
    const project: Project = {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        objects: [sampleObject, grayRaster],
        layers: [lineLayer, imageLayer],
      },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).not.toContain('layer-mode-mismatch');
  });

  it('treats an image sub-layer as compatible raster output for the base color', () => {
    const baseLayer = createLayer({ id: 'L-gray', color: '#808080' });
    const imageSubLayer = createLayerSubLayer(baseLayer, {
      id: 'image-op',
      label: 'Image op',
      settings: { ...baseLayer, mode: 'image' },
    });
    const project: Project = {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        objects: [
          {
            ...grayRaster,
            operationIds: [baseLayer.id],
            lumaBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
          },
        ],
        layers: [{ ...baseLayer, subLayers: [imageSubLayer] }],
      },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).not.toContain('layer-mode-mismatch');
  });

  it('checks unsupported raster transforms through image sub-layers', () => {
    const baseLayer = createLayer({ id: 'L-gray', color: '#808080' });
    const imageSubLayer = createLayerSubLayer(baseLayer, {
      id: 'image-op',
      label: 'Image op',
      settings: { ...baseLayer, mode: 'image' },
    });
    const project: Project = {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        objects: [
          {
            ...grayRaster,
            lumaBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
            transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
          },
        ],
        layers: [{ ...baseLayer, subLayers: [imageSubLayer] }],
      },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('unsupported-raster-transform');
  });

  it('flags a rotated raster image because raster emit is axis-aligned', () => {
    const imageLayer = createLayer({ id: 'L-gray', color: '#808080', mode: 'image' });
    const rotatedRaster: SceneObject = {
      ...grayRaster,
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
    };
    const project: Project = {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [rotatedRaster], layers: [imageLayer] },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).toContain('unsupported-raster-transform');
  });

  // M1 (AUDIT-2026-06-10): images within 5 mm of the bed's X edges always
  // fail preflight because the overscan runway rapids past the edge — but
  // the error said only "Line N: X out of bed: -4" with no hint that
  // overscan (not the artwork) was the cause and no in-app remedy.
  it('names overscan as the likely cause when an image job fails bounds near an edge', () => {
    const imageLayer = {
      ...createLayer({ id: 'L-gray', color: '#808080', mode: 'image' }),
      ditherAlgorithm: 'threshold' as const,
      linesPerMm: 1,
    };
    const nearEdgeRaster: SceneObject = {
      ...grayRaster,
      lumaBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
      bounds: { minX: 1, minY: 100, maxX: 11, maxY: 110 },
    };
    const project: Project = {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [nearEdgeRaster], layers: [imageLayer] },
    };
    const result = runPreflight(project, emit(project));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('overscan'))).toBe(true);
    expect(result.issues.some((i) => i.message.includes('5 mm'))).toBe(true);
  });

  // M35 (AUDIT-2026-06-10): compile-job's orientRasterLumaForMachine handles
  // mirror (XOR with the origin flip — pinned in compile-job.test.ts), but
  // this gate predates that support and still rejected ANY mirror, so the
  // H/V flip shortcuts made an image project un-emittable.
  it('accepts a mirrored raster image now that compile orients mirrored luma', () => {
    const imageLayer = createLayer({ id: 'L-gray', color: '#808080', mode: 'image' });
    const mirroredRaster: SceneObject = {
      ...grayRaster,
      transform: { ...IDENTITY_TRANSFORM, mirrorX: true, mirrorY: true },
    };
    const project: Project = {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [mirroredRaster], layers: [imageLayer] },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).not.toContain('unsupported-raster-transform');
  });

  it('does not block on rotated trace-source backing images', () => {
    const imageLayer = createLayer({ id: 'L-gray', color: '#808080', mode: 'image' });
    const traceSource: SceneObject = {
      ...grayRaster,
      role: 'trace-source',
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
    };
    const traceLayer = createLayer({ id: 'L-black', color: '#000000', mode: 'fill' });
    const traced: SceneObject = {
      kind: 'traced-image',
      id: 'T1',
      source: 'x.png',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 1, y: 1 },
                { x: 9, y: 1 },
                { x: 9, y: 9 },
                { x: 1, y: 9 },
              ],
            },
          ],
        },
      ],
    };
    const project: Project = {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [traceSource, traced], layers: [imageLayer, traceLayer] },
    };
    const codes = runPreflight(project, emit(project)).issues.map((i) => i.code);
    expect(codes).not.toContain('unsupported-raster-transform');
    expect(codes).not.toContain('layer-mode-mismatch');
  });
});
