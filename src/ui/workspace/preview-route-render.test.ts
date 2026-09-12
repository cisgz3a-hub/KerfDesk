import { describe, expect, it } from 'vitest';
import { canvasTheme } from '../theme/canvas-theme';
import type { PreparedPreviewFrame } from './preview-route-frame';
import { renderPreviewFrame } from './preview-route-render';

describe('ordered Preview frame painting', () => {
  it('keeps overlapping strokes separate, resets travel dashes and preserves marker ordering', () => {
    const cut = {
      kind: 'cut' as const,
      polyline: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    };
    const frame: PreparedPreviewFrame = {
      futureSteps: [cut],
      wholeSteps: [
        cut,
        { kind: 'travel', from: { x: 3, y: 4 }, to: { x: 1, y: 2 }, motion: 'feed' },
        cut,
      ],
      partial: { kind: 'travel', from: { x: 3, y: 4 }, to: { x: 4, y: 4 } },
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 },
      head: { x: 4, y: 4 },
    };
    const recorded = recordingContext();
    renderPreviewFrame(recorded.ctx, frame, { scale: 2, offsetX: -5, offsetY: 7 });
    expect(
      recorded.paints
        .slice(0, 5)
        .map((paint) => [paint.alpha, paint.style, paint.width, paint.dash]),
    ).toEqual([
      [0.18, canvasTheme.previewCut, 1, []],
      [0.72, canvasTheme.previewCut, 1, []],
      [0.72, canvasTheme.previewFeedTravel, 0.75, [5, 2]],
      [0.72, canvasTheme.previewCut, 1, []],
      [0.72, canvasTheme.previewTravel, 0.5, [2, 3]],
    ]);
    expect(recorded.paints[0]?.path).toEqual([
      ['moveTo', -3, 11],
      ['lineTo', 1, 15],
    ]);
    expect(recorded.paints[1]?.path).toEqual(recorded.paints[3]?.path);
    expect(recorded.paints.slice(5).map((paint) => [paint.kind, paint.style, paint.alpha])).toEqual(
      [
        ['fill', canvasTheme.previewHeadStroke, 0.4],
        ['stroke', canvasTheme.previewTravel, 0.4],
        ['fill', canvasTheme.previewTravel, 0.4],
        ['stroke', canvasTheme.previewHeadStroke, 0.4],
        ['fill', canvasTheme.previewHeadFill, 0.4],
        ['stroke', canvasTheme.previewHeadStroke, 0.4],
      ],
    );
  });
});

type State = {
  globalAlpha: number;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  dash: number[];
};
function recordingContext() {
  let state: State = { globalAlpha: 0.4, strokeStyle: '', fillStyle: '', lineWidth: 1, dash: [] };
  const stack: State[] = [];
  let path: unknown[][] = [];
  const paints: Array<{
    kind: string;
    alpha: number;
    style: string;
    width: number;
    dash: number[];
    path: unknown[][];
  }> = [];
  const paint = (kind: string) =>
    paints.push({
      kind,
      alpha: state.globalAlpha,
      style: kind === 'fill' ? state.fillStyle : state.strokeStyle,
      width: state.lineWidth,
      dash: [...state.dash],
      path: [...path],
    });
  const methods = {
    save: () => stack.push({ ...state, dash: [...state.dash] }),
    restore: () => {
      state = stack.pop() ?? state;
    },
    beginPath: () => {
      path = [];
    },
    moveTo: (...args: number[]) => path.push(['moveTo', ...args]),
    lineTo: (...args: number[]) => path.push(['lineTo', ...args]),
    arc: (...args: number[]) => path.push(['arc', ...args]),
    setLineDash: (dash: number[]) => {
      state.dash = [...dash];
    },
    stroke: () => paint('stroke'),
    fill: () => paint('fill'),
  };
  const ctx = new Proxy(methods, {
    get(target, key) {
      return key in target ? target[key as keyof typeof target] : state[key as keyof State];
    },
    set(_target, key, value) {
      Reflect.set(state, key, value);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, paints };
}
