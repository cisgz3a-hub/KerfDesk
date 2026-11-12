import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../../core/scene';
import { createRegistrationBox } from '../../../core/shapes';
import { createRectangle } from '../../../core/shapes/primitives';
import { drawJigCanvasOverlay } from './jig-canvas-paint';

const VIEW = { scale: 2, offsetX: 10, offsetY: 20 };

// Records the drawing calls the overlay makes; every other context member is a no-op.
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args: unknown[]) => {
          calls.push([String(name), args]);
        },
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
}

function jig(): Project {
  const outline = createRegistrationBox({ widthMm: 80, heightMm: 40, x: 30, y: 60 });
  return {
    ...createProject(),
    scene: {
      layers: [createRegistrationLayer(), createLayer({ id: 'artwork', color: '#000000' })],
      objects: [
        { ...outline, id: 'outline' },
        createRectangle({
          id: 'art',
          color: '#000000',
          spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
          transform: { ...IDENTITY_TRANSFORM, x: 40, y: 70 },
        }),
      ],
    },
  };
}

function named(calls: Array<[string, unknown[]]>, name: string): unknown[][] {
  return calls.filter(([call]) => call === name).map(([, args]) => args);
}

describe('registration jig canvas overlay', () => {
  it('draws resize handles and a rotate handle, without the main canvas move handle', () => {
    const { ctx, calls } = recordingContext();
    const overlay = { selectedIds: new Set(['art']), marquee: null, dropOutlineId: null };
    drawJigCanvasOverlay(ctx, jig(), overlay, VIEW);
    // The artwork is 20 px across here: its sides are too short for middle
    // handles, so only the four corners are drawn (ADR-196 Amendment 1).
    expect(named(calls, 'fillRect')).toHaveLength(4);
    expect(named(calls, 'arc')).toHaveLength(1);
  });

  it('draws all eight resize handles on a selection with room for them', () => {
    const { ctx, calls } = recordingContext();
    const overlay = { selectedIds: new Set(['outline']), marquee: null, dropOutlineId: null };
    drawJigCanvasOverlay(ctx, jig(), overlay, VIEW);
    expect(named(calls, 'fillRect')).toHaveLength(8);
  });

  it('highlights the drop target outline across its bounds', () => {
    const { ctx, calls } = recordingContext();
    const overlay = { selectedIds: new Set<string>(), marquee: null, dropOutlineId: 'outline' };
    drawJigCanvasOverlay(ctx, jig(), overlay, VIEW);
    expect(named(calls, 'fillRect')).toEqual([[70, 140, 160, 80]]);
    expect(named(calls, 'strokeRect')).toEqual([[70, 140, 160, 80]]);
  });

  it('draws the box selection in progress', () => {
    const { ctx, calls } = recordingContext();
    const marquee = { start: { x: 0, y: 0 }, end: { x: 5, y: 10 } };
    drawJigCanvasOverlay(
      ctx,
      jig(),
      { selectedIds: new Set(), marquee, dropOutlineId: null },
      VIEW,
    );
    expect(named(calls, 'strokeRect')).toEqual([[10, 20, 10, 20]]);
  });
});
