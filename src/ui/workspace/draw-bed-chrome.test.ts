import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { displayGridStepMm, drawGrid } from './draw-bed-chrome';

describe('canvas grid', () => {
  it('draws the snap grid spacing while its lines are far enough apart', () => {
    expect(displayGridStepMm(10, 2)).toBe(10);
    expect(displayGridStepMm(2.5, 4)).toBe(2.5);
  });

  it('thins to every 2nd, 5th, 10th line when zoomed out, staying on the snap grid', () => {
    expect(displayGridStepMm(10, 0.5)).toBe(20);
    expect(displayGridStepMm(10, 0.2)).toBe(50);
    expect(displayGridStepMm(1, 0.5)).toBe(20);
    expect(displayGridStepMm(1, 0.05)).toBe(200);
  });

  it('draws nothing for an unusable spacing or scale', () => {
    expect(displayGridStepMm(0, 2)).toBeNull();
    expect(displayGridStepMm(Number.NaN, 2)).toBeNull();
    expect(displayGridStepMm(10, 0)).toBeNull();
  });

  it('draws one line per grid step inside the bed', () => {
    const project = createProject();
    const moves: Array<readonly [number, number]> = [];
    const ctx = {
      strokeStyle: '',
      lineWidth: 0,
      beginPath: () => undefined,
      moveTo: (x: number, y: number) => void moves.push([x, y]),
      lineTo: () => undefined,
      stroke: () => undefined,
    } as unknown as CanvasRenderingContext2D;

    drawGrid(ctx, project, { scale: 2, offsetX: 0, offsetY: 0 }, 25);

    const { bedWidth, bedHeight } = project.device;
    expect(moves).toHaveLength(Math.ceil(bedWidth / 25) - 1 + Math.ceil(bedHeight / 25) - 1);
    expect(moves[0]).toEqual([50, 0]);
  });
});
