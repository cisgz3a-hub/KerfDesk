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

describe('drawScene path node handles', () => {
  it('renders vector node handles and marks the selected node distinctly', () => {
    const { ctx, fillRectStyles, strokeRectStyles } = recordingContext();

    drawScene(ctx, 800, 600, vectorProject(), {
      selectedId: 'logo',
      showPathNodeHandles: true,
      selectedPathNode: {
        objectId: 'logo',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 1,
      },
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(fillRectStyles).toContain(canvasTheme.pathNodeHandleFill);
    expect(fillRectStyles).toContain(canvasTheme.pathNodeHandleActiveFill);
    expect(strokeRectStyles).toContain(canvasTheme.pathNodeHandleStroke);
  });

  it('does not render vector node handles until node edit mode requests them', () => {
    const { ctx, fillRectStyles, strokeRectStyles } = recordingContext();

    drawScene(ctx, 800, 600, vectorProject(), {
      selectedId: 'logo',
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(fillRectStyles).not.toContain(canvasTheme.pathNodeHandleActiveFill);
    expect(strokeRectStyles).not.toContain(canvasTheme.pathNodeHandleStroke);
  });
});

function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly fillRectStyles: string[];
  readonly strokeRectStyles: string[];
} {
  let fillStyle = '';
  let strokeStyle = '';
  const fillRectStyles: string[] = [];
  const strokeRectStyles: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillRect') return () => fillRectStyles.push(fillStyle);
        if (prop === 'strokeRect') return () => strokeRectStyles.push(strokeStyle);
        if (prop === 'measureText') return () => ({ width: 0 });
        return () => undefined;
      },
      set(_target, prop, value) {
        if (prop === 'fillStyle') fillStyle = String(value);
        if (prop === 'strokeStyle') strokeStyle = String(value);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, fillRectStyles, strokeRectStyles };
}

function vectorProject(): Project {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'logo',
    source: 'logo.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...createProject(),
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      objects: [object],
      groups: [],
    },
  };
}
