import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { drawNoGoZones } from './draw-no-go-zones';
import type { ViewTransform } from './view-transform';

function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: Array<{ readonly name: string; readonly args: ReadonlyArray<number> }>;
} {
  const calls: Array<{ readonly name: string; readonly args: ReadonlyArray<number> }> = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillRect' || prop === 'strokeRect') {
          return (...args: ReadonlyArray<number>) => {
            calls.push({ name: String(prop), args });
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

describe('drawNoGoZones', () => {
  it('renders enabled machine-coordinate zones in scene coordinates', () => {
    const project = createProject({
      ...createProject().device,
      noGoZones: [
        {
          id: 'clamp',
          name: 'Clamp',
          enabled: true,
          x: 10,
          y: 392,
          width: 20,
          height: 4,
        },
      ],
    });
    const { ctx, calls } = recordingContext();

    drawNoGoZones(ctx, project, view);

    expect(calls).toContainEqual({ name: 'fillRect', args: [10, 4, 20, 4] });
    expect(calls).toContainEqual({ name: 'strokeRect', args: [10, 4, 20, 4] });
  });

  it('skips disabled zones', () => {
    const project = createProject({
      ...createProject().device,
      noGoZones: [
        {
          id: 'clamp',
          name: 'Clamp',
          enabled: false,
          x: 10,
          y: 392,
          width: 20,
          height: 4,
        },
      ],
    });
    const { ctx, calls } = recordingContext();

    drawNoGoZones(ctx, project, view);

    expect(calls).toEqual([]);
  });
});
