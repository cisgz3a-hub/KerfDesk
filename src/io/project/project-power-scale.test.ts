import { describe, expect, it } from 'vitest';
import { PROJECT_SCHEMA_VERSION } from '../../core/scene';
import { deserializeProject } from './deserialize-project';

function rawProject(objects: readonly Record<string, unknown>[]): string {
  return JSON.stringify({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    device: {
      name: 'Default',
      bedWidth: 300,
      bedHeight: 300,
      maxFeed: 3000,
      maxPowerS: 1000,
      origin: 'front-left',
      homing: { enabled: false, direction: 'front-left' },
      autofocusCommand: '',
    },
    workspace: { width: 300, height: 300, units: 'mm' },
    scene: {
      objects,
      layers: [
        {
          id: 'L1',
          color: '#ff0000',
          mode: 'line',
          minPower: 0,
          power: 30,
          speed: 1500,
          passes: 1,
          visible: true,
          output: true,
          hatchAngleDeg: 0,
          hatchSpacingMm: 0.1,
          fillOverscanMm: 5,
          fillBidirectional: true,
          fillCrossHatch: false,
          ditherAlgorithm: 'floyd-steinberg',
          linesPerMm: 10,
          negativeImage: false,
          passThrough: false,
          dotWidthCorrectionMm: 0,
        },
      ],
    },
  });
}

function vectorObject(powerScale: unknown): Record<string, unknown> {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    powerScale,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      mirrorX: false,
      mirrorY: false,
    },
    paths: [{ color: '#ff0000', polylines: [{ closed: false, points: [{ x: 0, y: 0 }] }] }],
  };
}

function rasterObject(powerScale: unknown): Record<string, unknown> {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      mirrorX: false,
      mirrorY: false,
    },
    color: '#ff0000',
    dither: 'threshold',
    linesPerMm: 10,
    powerScale,
  };
}

describe('project object power scale validation', () => {
  it('accepts percent powerScale values on vector and raster objects', () => {
    const result = deserializeProject(rawProject([vectorObject(50), rasterObject(75)]));

    expect(result.kind).toBe('ok');
  });

  it('rejects non-percent powerScale values before a project loads', () => {
    const result = deserializeProject(rawProject([vectorObject('50')]));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.objects\[0\]\.powerScale/);
    }
  });
});
