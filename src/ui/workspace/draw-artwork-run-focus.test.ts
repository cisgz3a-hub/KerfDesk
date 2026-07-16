import { describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { createRectangle } from '../../core/shapes';
import { drawScene } from './draw-scene';

describe('artwork run focus canvas treatment', () => {
  it('dims only non-active artwork and draws the active run badge without mutating the project', () => {
    const project = focusProject();
    const before = JSON.stringify(project);
    const recording = recordingContext();

    drawScene(recording.ctx, 800, 600, project, {
      selectedId: null,
      preview: false,
      artworkRunFocus: { objectIds: ['A'], position: 1, color: '#2563eb' },
    });

    expect(recording.globalAlphaValues).toContain(0.24);
    expect(recording.labels).toContain('#1');
    expect(recording.strokeRects).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(project)).toBe(before);
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
  readonly strokeRects: number;
} {
  const globalAlphaValues: number[] = [];
  const labels: string[] = [];
  let strokeRects = 0;
  const ctx = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'fillText') return (label: string) => labels.push(label);
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
    get strokeRects() {
      return strokeRects;
    },
  };
}
