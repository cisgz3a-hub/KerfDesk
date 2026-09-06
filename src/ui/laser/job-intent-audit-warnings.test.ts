import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { offsetForEmittedFeed } from '../../core/job/scan-offset';
import { grblStrategy } from '../../core/output/grbl-strategy';
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

function projectWith(object: SceneObject, mode: 'line' | 'image' | 'fill'): Project {
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
  it.each(['fill', 'image'] as const)(
    'checks %s table coverage at the feed actually emitted near a fractional boundary',
    (mode) => {
      const base = projectWith(
        mode === 'fill'
          ? boxPanel
          : { ...raster, lumaBase64: Buffer.from(new Uint8Array(4)).toString('base64') },
        mode,
      );
      const project = {
        ...base,
        device: {
          ...base.device,
          scanningOffsets: [{ speedMmPerMin: 1000, offsetMm: 0.2 }],
        },
        scene: {
          ...base.scene,
          layers: base.scene.layers.map((layer) => ({ ...layer, speed: 1000.75 })),
        },
      };
      const output = grblStrategy.emit(compileJob(project.scene, project.device), project.device);
      expect(output).toMatch(/\bF1000\b/);
      expect(output).not.toMatch(/\bF1001\b/);
      expect(detectJobIntentWarnings(project).join('\n')).not.toContain(
        'outside the saved scan-offset table',
      );

      const uncovered = {
        ...project,
        device: {
          ...project.device,
          scanningOffsets: [
            { speedMmPerMin: 1000.5, offsetMm: 0.2 },
            { speedMmPerMin: 2000, offsetMm: 0.4 },
          ],
        },
      };
      expect(detectJobIntentWarnings(uncovered).join('\n')).toContain(
        '1000 mm/min is outside the saved scan-offset table (1000.5–2000 mm/min)',
      );
    },
  );

  it('describes below-range correction scaling from zero instead of endpoint clamping', () => {
    const base = projectWith(raster, 'image');
    const project = {
      ...base,
      device: {
        ...base.device,
        scanningOffsets: [{ speedMmPerMin: 3000, offsetMm: 0.2 }],
      },
    };
    expect(offsetForEmittedFeed(project.device.scanningOffsets, 1500)).toBe(0.1);
    expect(detectJobIntentWarnings(project).join('\n')).toContain(
      'Below the first sample, correction scales from zero',
    );
  });

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
      'Bidirectional scan output at 1500 mm/min is outside the saved scan-offset table (500–1000 mm/min). Below the first sample, correction scales from zero; above the last sample, it stays at the last offset. Add measured rows covering these emitted speeds or select one-way scanning.',
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
