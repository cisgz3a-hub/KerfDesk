import { describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { drawScene } from './draw-scene';

describe('drawScene multi-operation visibility', () => {
  it('draws with the first visible operation style after a hidden binding', () => {
    const { ctx, calls } = drawingContext();
    drawScene(ctx, 800, 600, project(false, true), drawOptions);

    expect(calls.lineTo).toBeGreaterThan(0);
    expect(calls.strokeStyles).toContain('#222222');
  });

  it('does not draw bound geometry when all operations are hidden', () => {
    const { ctx, calls } = drawingContext();
    drawScene(ctx, 800, 600, project(false, false), drawOptions);

    expect(calls.strokeStyles).not.toContain('#111111');
    expect(calls.strokeStyles).not.toContain('#222222');
  });
});

const drawOptions = {
  selectedId: null,
  preview: false,
  view: { zoomFactor: 1, panX: 0, panY: 0 },
} as const;

function project(firstVisible: boolean, secondVisible: boolean): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [
        { ...createLayer({ id: 'first', color: '#111111' }), visible: firstVisible },
        { ...createLayer({ id: 'second', color: '#222222' }), visible: secondVisible },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'multi-op',
          source: 'multi.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#111111',
              operationIds: ['first', 'second'],
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function drawingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: { lineTo: number; strokeStyles: string[] };
} {
  const calls = { lineTo: 0, strokeStyles: [] as string[] };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'lineTo') return (): number => (calls.lineTo += 1);
        if (prop === 'measureText') return () => ({ width: 280 });
        return () => undefined;
      },
      set(_target, prop, value) {
        if (prop === 'strokeStyle' && typeof value === 'string') calls.strokeStyles.push(value);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
}
