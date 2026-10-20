// ADR-486 Amendment 3: how many part edges hold a kerf contour, judged among
// the scene's Line contours. Preparation-level cases are in
// io/gcode/kerf-scene-sides.test.ts.

import { describe, expect, it } from 'vitest';
import { createLayer, createRegistrationLayer, type Layer, type Vec2 } from '../scene';
import { kerfSceneSides } from './kerf-scene-sides';
import type { SceneLineContour } from './laser-lead-sides';

function square(min: number, max: number): Vec2[] {
  return [
    { x: min, y: min },
    { x: max, y: min },
    { x: max, y: max },
    { x: min, y: max },
  ];
}

function operation(id: string, settings: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, color: '#ff0000', name: id }), ...settings };
}

const CUT = operation('cut', { kerfOffsetMm: 0.5 });
const INNER = operation('inner', { kerfOffsetMm: 0.5 });
const SCORE = operation('score', { power: 10 });

function contour(
  key: string,
  points: ReadonlyArray<Vec2>,
  on: Layer,
  path = key.split(':')[0] ?? key,
): SceneLineContour {
  return { key, points, decides: false, operationName: on.name, operation: on, path };
}

describe('kerfSceneSides', () => {
  it('counts a plate on another operation with a kerf offset as a part edge', () => {
    const sides = kerfSceneSides([
      contour('plate#0:0', square(20, 60), CUT),
      contour('hole#0:0', square(35, 45), INNER),
    ]);
    expect(sides('hole#0:0', 'inner')).toEqual({ outside: 1 });
    expect(sides('plate#0:0', 'cut')).toEqual({ outside: 0 });
  });

  it('counts any closed shape on the contour’s own operation, its kerf zero or not', () => {
    const plain = operation('cut');
    const sides = kerfSceneSides([
      contour('plate#0:0', square(20, 60), plain),
      contour('hole#0:0', square(35, 45), plain),
    ]);
    expect(sides('hole#0:0', 'cut')).toEqual({ outside: 1 });
  });

  it('counts tabs and leads as cutting parts out', () => {
    for (const settings of [{ tabsEnabled: true }, { leadInEnabled: true }]) {
      const sides = kerfSceneSides([
        contour('plate#0:0', square(20, 60), operation('outer', settings)),
        contour('hole#0:0', square(35, 45), INNER),
      ]);
      expect(sides('hole#0:0', 'inner')).toEqual({ outside: 1 });
    }
  });

  it('names a shape on an operation without kerf, leads or tabs instead of counting it', () => {
    const sides = kerfSceneSides([
      contour('plate#0:0', square(20, 60), CUT),
      contour('ring#0:0', square(30, 50), SCORE),
      contour('hole#0:0', square(35, 45), CUT),
    ]);
    expect(sides('hole#0:0', 'cut')).toEqual({ outside: 1, assumedAround: 'score' });
    expect(sides('plate#0:0', 'cut')).toEqual({ outside: 0 });
  });

  it('leaves the contour’s own path to compile', () => {
    const sides = kerfSceneSides([
      contour('plate#0:0', square(20, 60), CUT, 'plate#0'),
      contour('plate#0:1', square(35, 45), CUT, 'plate#0'),
    ]);
    expect(sides('plate#0:1', 'cut')).toEqual({ outside: 0 });
  });

  it('counts a plate once when two operations cut it or it is drawn twice', () => {
    const sides = kerfSceneSides([
      contour('plate#0:0', square(20, 60), CUT),
      contour('plate#0:0', square(20, 60), operation('again', { kerfOffsetMm: 0.1 })),
      contour('copy#0:0', [...square(20, 60)].reverse(), CUT),
      contour('hole#0:0', square(35, 45), INNER),
    ]);
    expect(sides('hole#0:0', 'inner')).toEqual({ outside: 1 });
  });

  it('does not read a registration jig’s box as anything round the artwork', () => {
    const sides = kerfSceneSides([
      contour('box#0:0', square(10, 70), createRegistrationLayer()),
      contour('plate#0:0', square(20, 60), CUT),
    ]);
    expect(sides('plate#0:0', 'cut')).toEqual({ outside: 0 });
  });

  it('does not know a contour the scene does not have', () => {
    expect(kerfSceneSides([])('hole#0:0', 'cut')).toBeUndefined();
  });
});
