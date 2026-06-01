import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fillHatching } from '../../core/job/fill-hatching';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TracedImage,
} from '../../core/scene';
import { drawScene } from './draw-scene';

vi.mock('../../core/job/fill-hatching', () => ({
  fillHatching: vi.fn(() => [
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      closed: false,
    },
  ]),
}));

function canvasContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly fillRules: string[];
} {
  const fillRules: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fill') {
          return (rule?: string) => {
            fillRules.push(rule ?? 'nonzero');
          };
        }
        if (prop === 'measureText') return () => ({ width: 0 });
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, fillRules };
}

function tracedFillProject(): Project {
  const traced: TracedImage = {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
              { x: 0, y: 0 },
            ],
          },
        ],
      },
    ],
  };
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [
        { ...createLayer({ id: '#000000', color: '#000000', mode: 'fill' }), hatchSpacingMm: 1 },
      ],
      objects: [traced],
    },
  };
}

describe('drawScene fill design rendering', () => {
  beforeEach(() => {
    vi.mocked(fillHatching).mockClear();
  });

  it('draws fill-mode traces as solid design geometry, not workspace hatches', () => {
    const { ctx, fillRules } = canvasContext();

    drawScene(ctx, 800, 600, tracedFillProject(), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(fillHatching).not.toHaveBeenCalled();
    expect(fillRules).toContain('evenodd');
  });
});
