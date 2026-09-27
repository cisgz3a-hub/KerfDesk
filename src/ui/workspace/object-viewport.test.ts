import { describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { drawObjectsFaint } from './draw-preview';
import { objectIntersectsCanvas } from './object-viewport';

const VIEW = { scale: 1, offsetX: 0, offsetY: 0 };
const CANVAS = { width: 100, height: 100 };

describe('conservative artwork viewport rejection', () => {
  it('rejects offscreen geometry and reveals it again after panning', () => {
    const object = vector(250);
    expect(objectIntersectsCanvas(object, VIEW, CANVAS)).toBe(false);
    expect(objectIntersectsCanvas(object, { ...VIEW, offsetX: -200 }, CANVAS)).toBe(true);
  });

  it('uses full rotation, mirrors and non-uniform transforms', () => {
    const object = {
      ...vector(10),
      transform: { ...IDENTITY_TRANSFORM, scaleX: -2, scaleY: 3, rotationDeg: 90, x: 200, y: 75 },
    };
    expect(objectIntersectsCanvas(object, VIEW, CANVAS)).toBe(true);
    expect(
      objectIntersectsCanvas(
        { ...object, transform: { ...object.transform, x: 400 } },
        VIEW,
        CANVAS,
      ),
    ).toBe(false);
  });

  it('preserves stroke fringe and never trusts stale import bounds over actual paths', () => {
    expect(objectIntersectsCanvas(vector(-7), VIEW, CANVAS)).toBe(true);
    expect(objectIntersectsCanvas(vector(-9), VIEW, CANVAS)).toBe(false);
    expect(
      objectIntersectsCanvas(
        { ...vector(50), bounds: { minX: 500, minY: 500, maxX: 600, maxY: 600 } },
        VIEW,
        CANVAS,
      ),
    ).toBe(true);
  });

  it('keeps native curves whose interior enters the canvas although their endpoints are outside', () => {
    const object = vector(500);
    const curveObject: ImportedSvg = {
      ...object,
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: false,
              points: [
                { x: -20, y: -10 },
                { x: 120, y: -10 },
              ],
            },
          ],
          curves: [
            {
              start: { x: -20, y: -10 },
              closed: false,
              segments: [
                {
                  kind: 'cubic',
                  control1: { x: 20, y: 150 },
                  control2: { x: 80, y: 150 },
                  to: { x: 120, y: -10 },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(objectIntersectsCanvas(curveObject, VIEW, CANVAS)).toBe(true);
  });

  it('reuses immutable geometry bounds through transforms and invalidates on path replacement', () => {
    const readX = vi.fn(() => 250);
    const object = vector(250);
    const point = object.paths[0]?.polylines[0]?.points[0];
    if (point === undefined) throw new Error('fixture point missing');
    Object.defineProperty(point, 'x', { get: readX });
    expect(objectIntersectsCanvas(object, VIEW, CANVAS)).toBe(false);
    const reads = readX.mock.calls.length;
    expect(
      objectIntersectsCanvas(
        { ...object, transform: { ...object.transform, x: -200 } },
        VIEW,
        CANVAS,
      ),
    ).toBe(true);
    expect(readX).toHaveBeenCalledTimes(reads);
    expect(objectIntersectsCanvas({ ...object, paths: vector(50).paths }, VIEW, CANVAS)).toBe(true);
  });

  it('falls back to drawing when dimensions or geometry cannot prove rejection', () => {
    expect(objectIntersectsCanvas(vector(250), VIEW, undefined)).toBe(true);
    expect(objectIntersectsCanvas(vector(Number.NaN), VIEW, CANVAS)).toBe(true);
  });

  it('skips offscreen faint artwork without altering its exact source geometry', () => {
    const project = createProject();
    const object = vector(250);
    const lineTo = vi.fn();
    const context = new Proxy(
      { canvas: CANVAS, lineTo },
      {
        get: (target, key) =>
          key in target ? (Reflect.get(target, key) as unknown) : () => undefined,
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    drawObjectsFaint(
      context,
      {
        ...project,
        scene: { objects: [object], layers: [createLayer({ id: 'line', color: '#000000' })] },
      },
      VIEW,
    );
    expect(lineTo).not.toHaveBeenCalled();
    expect(object.paths[0]?.polylines[0]?.points).toEqual([
      { x: 250, y: 40 },
      { x: 250, y: 60 },
    ]);
  });
});

function vector(x: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'vector',
    source: 'viewport.svg',
    bounds: { minX: x, minY: 40, maxX: x, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x, y: 40 },
              { x, y: 60 },
            ],
          },
        ],
      },
    ],
  };
}
