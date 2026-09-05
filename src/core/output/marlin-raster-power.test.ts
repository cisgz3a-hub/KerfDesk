import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { Group, RasterGroup } from '../job';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { grblStrategy } from './grbl-strategy';
import { marlinStrategy } from './marlin-strategy';

function device(maxPowerS: number): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'marlin',
    maxPowerS,
    gcodeDialect: { dialectId: 'marlin-fan' },
  };
}

function raster(sValues: Float64Array): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'image',
    color: '#808080',
    power: 100,
    speed: 1500,
    passes: 1,
    airAssist: false,
    sValues,
    pixelWidth: 3,
    pixelHeight: 1,
    bounds: { minX: 10, minY: 10, maxX: 13, maxY: 11 },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
  };
}

describe('Marlin fan compiled raster scale', () => {
  it.each([255, 1000, 100])('public image output preserves 50 percent at S max %s', (maxPowerS) => {
    const base = createProject(device(maxPowerS));
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      power: 50,
      ditherAlgorithm: 'threshold' as const,
      linesPerMm: 1,
    };
    const result = emitGcode({
      ...base,
      scene: {
        ...base.scene,
        layers: [layer],
        objects: [
          {
            kind: 'raster-image',
            id: 'r',
            source: 'photo.png',
            dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            pixelWidth: 1,
            pixelHeight: 1,
            bounds: { minX: 10, minY: 10, maxX: 11, maxY: 11 },
            transform: IDENTITY_TRANSFORM,
            color: '#808080',
            dither: 'threshold',
            linesPerMm: 1,
            lumaBase64: 'AA==',
          },
        ],
      },
    });
    expect(result.preflight.issues).toEqual([]);
    expect(result.gcode.match(/M106 S\d+/g)).toEqual(['M106 S128']);
  });

  it.each([255, 1000, 100])(
    'preserves zero, partial and full raster power at S max %s',
    (maxPowerS) => {
      const values = new Float64Array([0, Math.round(maxPowerS / 4), maxPowerS]);
      const original = Array.from(values);
      const group = raster(values);
      const materialized = marlinStrategy.emit({ groups: [group] }, device(maxPowerS));
      const rowProvider = vi.fn(() => values);
      const streamed = marlinStrategy.emit(
        { groups: [{ ...group, sValues: new Float64Array(), rowProvider }] },
        device(maxPowerS),
      );
      expect(streamed).toBe(materialized);
      expect(rowProvider.mock.calls).toEqual([[0]]);
      expect(materialized.match(/M106 S\d+/g)).toEqual(['M106 S64', 'M106 S255']);
      expect(materialized).toContain('M107');
      expect(Array.from(values)).toEqual(original);
      const inline = {
        ...device(maxPowerS),
        gcodeDialect: { dialectId: 'marlin-inline' as const },
      };
      expect(marlinStrategy.emit({ groups: [group] }, inline)).toBe(
        grblStrategy.emit({ groups: [group] }, inline),
      );
    },
  );

  it.each([1, 255, 1000, 100])('keeps vector percent precision at S max %s', (maxPowerS) => {
    for (const kind of ['cut', 'fill'] as const) {
      for (const power of [0, 25, 100]) {
        const segments = [
          {
            polyline: [
              { x: 10, y: 10 },
              { x: 20, y: 10 },
            ],
            closed: false,
            reverse: false,
          },
        ];
        const group: Group = {
          ...(kind === 'cut' ? { kind } : { kind, overscanMm: 0 }),
          layerId: 'vector',
          color: '#ff0000',
          power,
          speed: 1500,
          passes: 1,
          airAssist: false,
          segments,
        };
        const output = marlinStrategy.emit({ groups: [group] }, device(maxPowerS));
        expect(output.match(/M106 S\d+/g) ?? []).toEqual(
          power === 0 ? [] : [`M106 S${Math.round((power * 255) / 100)}`],
        );
      }
    }
  });
});
