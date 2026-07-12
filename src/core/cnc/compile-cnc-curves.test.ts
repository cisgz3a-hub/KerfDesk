import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type ImportedSvg,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

describe('compileCncJob curve boundary', () => {
  it('flattens canonical cubics at machine tolerance', () => {
    const color = '#ff0000';
    const object: ImportedSvg = {
      kind: 'imported-svg',
      id: 'curve',
      source: 'curve.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color,
          polylines: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
              closed: false,
            },
          ],
          curves: [
            {
              start: { x: 0, y: 0 },
              segments: [
                {
                  kind: 'cubic',
                  control1: { x: 0, y: 10 },
                  control2: { x: 10, y: 10 },
                  to: { x: 10, y: 0 },
                },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const layer = {
      ...createLayer({ id: 'curve-layer', color }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' as const },
    };
    const group = compileCncJob(
      { objects: [object], layers: [layer] },
      DEFAULT_DEVICE_PROFILE,
      DEFAULT_CNC_MACHINE_CONFIG,
    ).groups[0];
    expect(group?.kind).toBe('cnc');
    if (group?.kind === 'cnc') {
      const pass = group.passes[0];
      expect(pass?.kind).toBe('contour');
      if (pass?.kind === 'contour') expect(pass.polyline.length).toBeGreaterThan(2);
    }
  });
});
