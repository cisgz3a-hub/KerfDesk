import { describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { drawArtworkRunFocus } from './draw-artwork-run-focus';
import { drawScene } from './draw-scene';

describe('artwork run focus canvas treatment', () => {
  it('dims only non-active artwork without mutating the project', () => {
    const project = focusProject();
    const before = JSON.stringify(project);
    const recording = recordingContext();

    drawScene(recording.ctx, 800, 600, project, {
      selectedId: null,
      preview: false,
      artworkRunFocus: { objectIds: ['A'], position: 1, color: '#2563eb' },
    });

    expect(recording.globalAlphaValues).toContain(0.24);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('draws an open callout beside the run badge instead of outlining the artwork', () => {
    const project = focusProject();
    const recording = recordingContext();

    drawArtworkRunFocus(
      recording.ctx,
      project.scene.objects,
      { objectIds: ['A'], position: 1, color: '#2563eb' },
      { scale: 2, offsetX: 10, offsetY: 20 },
    );

    expect(recording.labels).toEqual(['#1']);
    expect(recording.strokeRects).toBe(0);
    expect(recording.strokeCalls).toBe(2);
    expect(recording.lineSegments).toHaveLength(2);
    expect(recording.lineSegments.every(({ from, to }) => from.y === to.y && to.x > from.x)).toBe(
      true,
    );
  });
});

function focusProject(): Project {
  const layerA = createLayer({ id: 'operation-a', name: 'A', color: '#2563eb' });
  const layerB = createLayer({ id: 'operation-b', name: 'B', color: '#dc2626' });
  const rectangle = (id: string, operationId: string, x: number) => ({
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x, y: 20 },
    }),
    operationIds: [operationId],
  });
  return {
    ...createProject(),
    scene: {
      objects: [rectangle('A', layerA.id, 20), rectangle('B', layerB.id, 80)],
      layers: [layerA, layerB],
    },
  };
}

function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly globalAlphaValues: number[];
  readonly labels: string[];
  readonly lineSegments: Array<{
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
  }>;
  readonly strokeCalls: number;
  readonly strokeRects: number;
} {
  const globalAlphaValues: number[] = [];
  const labels: string[] = [];
  const lineSegments: Array<{
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
  }> = [];
  let currentPoint: { readonly x: number; readonly y: number } | null = null;
  let strokeCalls = 0;
  let strokeRects = 0;
  const ctx = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'fillText') return (label: string) => labels.push(label);
        if (property === 'moveTo')
          return (x: number, y: number) => {
            currentPoint = { x, y };
          };
        if (property === 'lineTo')
          return (x: number, y: number) => {
            if (currentPoint !== null) lineSegments.push({ from: currentPoint, to: { x, y } });
            currentPoint = { x, y };
          };
        if (property === 'stroke')
          return () => {
            strokeCalls += 1;
          };
        if (property === 'strokeRect')
          return () => {
            strokeRects += 1;
          };
        if (property === 'measureText') return () => ({ width: 20 });
        return () => undefined;
      },
      set(_target, property, value) {
        if (property === 'globalAlpha' && typeof value === 'number') globalAlphaValues.push(value);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return {
    ctx,
    globalAlphaValues,
    labels,
    lineSegments,
    get strokeCalls() {
      return strokeCalls;
    },
    get strokeRects() {
      return strokeRects;
    },
  };
}
