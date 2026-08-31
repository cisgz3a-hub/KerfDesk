import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { detectJobIntentWarnings } from './job-intent-warnings';

const COLOR = '#ff0000';
const raster: SceneObject = {
  kind: 'raster-image',
  id: 'scan',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  lumaBase64: Buffer.from(new Uint8Array(4).fill(255)).toString('base64'),
  pixelWidth: 2,
  pixelHeight: 2,
  bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
  transform: IDENTITY_TRANSFORM,
  color: COLOR,
  dither: 'threshold',
  linesPerMm: 10,
};
const boxPanel: SceneObject = {
  kind: 'imported-svg',
  id: 'box-front',
  source: 'Box panel: Front',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: COLOR,
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

function projectWith(object: SceneObject, mode: 'line' | 'image'): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [{ ...createLayer({ id: 'operation', color: COLOR }), mode }],
    },
  };
}

describe('audit Job Review intent disclosures', () => {
  it('warns when bidirectional scans have no saved offset table', () => {
    expect(detectJobIntentWarnings(projectWith(raster, 'image'))).toContain(
      'Bidirectional scan output at 1500 mm/min has no saved scan-offset table. KerfDesk will emit 0 mm scan correction; calibrate these speeds or select one-way scanning if alignment is not verified.',
    );
  });

  it('warns when a bidirectional scan feed falls outside table coverage', () => {
    const project = projectWith(raster, 'image');
    const warnings = detectJobIntentWarnings({
      ...project,
      device: {
        ...project.device,
        scanningOffsets: [
          { speedMmPerMin: 500, offsetMm: 0.05 },
          { speedMmPerMin: 1000, offsetMm: 0.1 },
        ],
      },
    });
    expect(warnings).toContain(
      'Bidirectional scan output at 1500 mm/min is outside the saved scan-offset table (500–1000 mm/min). KerfDesk clamps to the nearest endpoint offset; add measured rows covering these emitted speeds or select one-way scanning.',
    );
  });

  it('warns until generated laser box panels have kerf compensation', () => {
    const project = projectWith(boxPanel, 'line');
    expect(detectJobIntentWarnings(project).join('\n')).toContain(
      'Generated box panels are assigned to a laser Line operation with 0 mm kerf compensation.',
    );
    const layer = project.scene.layers[0];
    if (layer === undefined) throw new Error('missing box operation');
    const compensated = {
      ...project,
      scene: { ...project.scene, layers: [{ ...layer, kerfOffsetMm: 0.15 }] },
    };
    expect(detectJobIntentWarnings(compensated).join('\n')).not.toContain('Generated box panels');
  });
});
