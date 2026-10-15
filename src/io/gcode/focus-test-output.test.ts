import { describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { generateFocusTest } from '../../core/job/focus-test';
import { emitGcode } from './emit-gcode';

const scene = generateFocusTest({
  steps: 5,
  minOffsetMm: -1,
  maxOffsetMm: 1,
  speed: 1200,
  power: 10,
  lineLengthMm: 20,
  spacingMm: 3,
  travelFeedMmPerMin: 300,
});

describe('Focus Test ordinary output preparation', () => {
  it('retains every relative Z pair through placement and optimisation', () => {
    const project = { ...createProject(), scene };
    const result = emitGcode(project);
    expect(result.gcode).toContain('G91\nG1 Z-1.000 F300 S0\nG90');
    expect((result.gcode.match(/; Focus Test Z offset/g) ?? []).length).toBe(5);
    const placed = emitGcode(project, {
      jobOrigin: {
        startFrom: 'current-position',
        anchor: 'front-left',
        currentPosition: { x: 30, y: 40 },
      },
    });
    expect((placed.gcode.match(/; Focus Test Z offset/g) ?? []).length).toBe(5);
  });
  it('does not drop Z intent on bitmap artwork assigned to a focus operation', () => {
    const image: RasterImage = {
      kind: 'raster-image',
      id: 'focus-bitmap',
      source: 'fixture.png',
      pixelWidth: 2,
      pixelHeight: 2,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      dither: 'threshold',
      linesPerMm: 1,
      lumaBase64: 'AAAAAA==',
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
      operationIds: [scene.layers[0]?.id ?? ''],
      color: scene.layers[0]?.color ?? '#000000',
      operationOverride: { mode: 'image' },
    };
    expect(() => emitGcode({ ...createProject(), scene: { ...scene, objects: [image] } })).toThrow(
      'raster',
    );
  });
});
