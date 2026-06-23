import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { drawScene } from './draw-scene';

describe('drawScene open Fill contour diagnostics', () => {
  it('highlights selected open contours that are assigned to an output Fill layer', () => {
    const { ctx, strokeStyles, lineDashes } = recordingContext();

    drawScene(ctx, 800, 600, openFillProject(), {
      selectedId: 'open-fill',
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(strokeStyles).toContain(canvasTheme.openFillContour);
    expect(lineDashes).toContainEqual([6, 3]);
  });
});

function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly strokeStyles: string[];
  readonly lineDashes: number[][];
} {
  let strokeStyle = '';
  const strokeStyles: string[] = [];
  const lineDashes: number[][] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'stroke') {
          return () => {
            strokeStyles.push(strokeStyle);
          };
        }
        if (prop === 'setLineDash') {
          return (dash: number[]) => lineDashes.push([...dash]);
        }
        if (prop === 'measureText') return () => ({ width: 0 });
        return () => undefined;
      },
      set(_target, prop, value) {
        if (prop === 'strokeStyle') strokeStyle = String(value);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, strokeStyles, lineDashes };
}

function openFillProject(): Project {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'open-fill',
    source: 'open-fill.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...createProject(),
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'fill' })],
      objects: [object],
      groups: [],
    },
  };
}
