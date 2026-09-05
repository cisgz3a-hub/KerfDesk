import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncPass } from '../job';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  type CncLayerSettings,
  type Polyline,
} from '../scene';
import { cncGroupForLayer } from './compile-cnc-job';

const SETTINGS: CncLayerSettings = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  cutType: 'profile-outside',
  tabsEnabled: false,
  depthMm: 1,
  depthPerPassMm: 1,
  profileLead: { shape: 'line', radiusMm: 10 },
};

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function nestedShapes(isColliding: boolean, reverse: boolean, translation: number): Polyline[] {
  return [
    rectangle(20, 20, 120, 120),
    rectangle(50, 50, 60, 60),
    rectangle(isColliding ? 78.5005 : 90, 55.088, 3, 3),
  ].map((shape) => ({
    ...shape,
    points: (reverse ? [...shape.points].reverse() : shape.points).map((point) => ({
      x: point.x + translation,
      y: point.y + translation,
    })),
  }));
}

function compile(shapes: readonly Polyline[], settings: CncLayerSettings) {
  const layer = { ...createLayer({ id: 'cut', color: '#000000' }), cnc: settings };
  const group = cncGroupForLayer(
    layer,
    settings,
    shapes,
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  if (group === null) throw new Error('expected a CNC group');
  return group;
}

function firstPoint(pass: CncPass) {
  if (pass.kind === 'contour') return pass.polyline[0];
  if (pass.kind === 'path3d') return pass.points[0];
  throw new Error('expected a profile pass');
}

describe('profile leads beside retained nested islands', () => {
  it.each([false, true])('uses ordinary entry across every pass (deep tabs=%s)', (deep) => {
    const settings = deep
      ? { ...SETTINGS, depthMm: 8, depthPerPassMm: 2, tabsEnabled: true, tabHeightMm: 4 }
      : SETTINGS;
    const shapes = nestedShapes(true, false, 0);
    const led = compile(shapes, settings);
    const unled = compile(shapes, { ...settings, profileLead: { shape: 'none' } });
    const passesPerContour = deep ? 4 : 1;
    const holePasses = led.passes.slice(passesPerContour, 2 * passesPerContour);
    expect(holePasses).toEqual(unled.passes.slice(passesPerContour, 2 * passesPerContour));
    expect(led.passes.at(-1)?.kind).toBe('path3d');
    const gcode = cncGrblStrategy.emit({ groups: [led] }, DEFAULT_DEVICE_PROFILE);
    expect(gcode).not.toContain('G0 X80.001 Y61.588');
  });

  it.each([
    [false, 0],
    [true, 0],
    [false, 30],
    [true, 30],
  ] as const)('keeps clearance under reversed=%s translated=%s', (reverse, translation) => {
    const shapes = nestedShapes(true, reverse, translation);
    const led = compile(shapes, SETTINGS);
    const unled = compile(shapes, { ...SETTINGS, profileLead: { shape: 'none' } });
    expect(led.passes[1]).toEqual(unled.passes[1]);
  });

  it('preserves a clear hole lead beside a distant retained island', () => {
    const shapes = nestedShapes(false, false, 0);
    const withIsland = compile(shapes, SETTINGS);
    const withoutIsland = compile(shapes.slice(0, 2), SETTINGS);
    expect(withIsland.passes[1]).toEqual(withoutIsland.passes[0]);
    expect(firstPoint(withIsland.passes[1]!)).toEqual({ x: 80.0005, y: 61.588, z: -1 });
  });
});
