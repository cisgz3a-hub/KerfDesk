import { describe, expect, it } from 'vitest';

import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type Vec2,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes';
import type { Toolpath } from '../../core/job';
import { drawObjectsFaint, drawPreview } from './draw-preview';
import type { ViewTransform } from './view-transform';

function countingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: { lineTo: number; moveTo: number };
} {
  const calls = { lineTo: 0, moveTo: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'lineTo') {
          return () => {
            calls.lineTo += 1;
          };
        }
        if (prop === 'moveTo') {
          return () => {
            calls.moveTo += 1;
          };
        }
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
}

const view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

describe('drawPreview', () => {
  it('renders a precomputed toolpath without compiling the project in the draw loop', () => {
    const toolpath: Toolpath = {
      totalLength: 2,
      steps: [
        {
          kind: 'cut',
          color: '#000000',
          length: 2,
          polyline: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
          ],
        },
      ],
    };
    const { ctx, calls } = countingContext();

    drawPreview(ctx, toolpath, view, 1);

    expect(calls.moveTo).toBe(1);
    expect(calls.lineTo).toBe(2);
  });

  it('samples oversized preview cuts without visiting every point on each redraw', () => {
    const pointCount = 30_001;
    const readBudget = 22_000;
    let pointReads = 0;
    const toolpath: Toolpath = {
      totalLength: 1,
      steps: [
        {
          kind: 'cut',
          color: '#000000',
          length: 1,
          polyline: new Proxy(
            Array.from({ length: pointCount }, (_, x) => ({ x, y: 0 })),
            {
              get(target, prop, receiver) {
                if (typeof prop === 'string' && /^\d+$/.test(prop)) pointReads += 1;
                return Reflect.get(target, prop, receiver);
              },
            },
          ),
        },
      ],
    };
    const { ctx, calls } = countingContext();

    drawPreview(ctx, toolpath, view, 1);

    expect(calls.lineTo).toBeLessThan(12_000);
    expect(pointReads).toBeLessThan(readBudget);
  });

  it('samples many small preview cuts with a global operation budget', () => {
    const stepCount = 30_000;
    const readBudget = 22_000;
    let stepReads = 0;
    const steps = new Proxy(
      Array.from({ length: stepCount }, (_, x) => ({
        kind: 'cut' as const,
        color: '#000000',
        length: 1,
        polyline: [
          { x, y: 0 },
          { x: x + 1, y: 0 },
        ],
      })),
      {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && /^\d+$/.test(prop)) stepReads += 1;
          return Reflect.get(target, prop, receiver);
        },
      },
    );
    const toolpath: Toolpath = {
      totalLength: stepCount,
      steps,
    };
    const { ctx, calls } = countingContext();

    drawPreview(ctx, toolpath, view, 1);

    expect(calls.lineTo).toBeLessThan(12_000);
    expect(stepReads).toBeLessThan(readBudget);
  });

  it('samples faint source geometry in preview instead of redrawing every source point', () => {
    const pointCount = 30_001;
    const readBudget = 22_000;
    let pointReads = 0;
    const project = importedSvgLineProject(
      watchedPoints(pointCount, () => {
        pointReads += 1;
      }),
    );
    const { ctx, calls } = countingContext();

    drawObjectsFaint(ctx, project, view);

    expect(calls.lineTo).toBeLessThan(12_000);
    expect(pointReads).toBeLessThan(readBudget);
  });

  it('draws drawn-shape source geometry in the faint preview layer', () => {
    const project = shapeLineProject();
    const { ctx, calls } = countingContext();

    drawObjectsFaint(ctx, project, view);

    expect(calls.moveTo).toBeGreaterThan(0);
    expect(calls.lineTo).toBeGreaterThan(0);
  });
});

function importedSvgLineProject(points: ReadonlyArray<Vec2>): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'svg-1',
          source: 'large.svg',
          bounds: { minX: 0, minY: 0, maxX: points.length - 1, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
        },
      ],
    },
  };
}

function watchedPoints(length: number, onRead: () => void): ReadonlyArray<Vec2> {
  return new Proxy(
    Array.from({ length }, (_, x) => ({ x, y: 0 })),
    {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) onRead();
        return Reflect.get(target, prop, receiver);
      },
    },
  );
}

function shapeLineProject(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: '#00ff00', color: '#00ff00', mode: 'line' })],
      objects: [
        createRectangle({
          id: 'shape-1',
          color: '#00ff00',
          spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
        }),
      ],
    },
  };
}
