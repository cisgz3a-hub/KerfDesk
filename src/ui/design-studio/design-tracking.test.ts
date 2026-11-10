import { describe, expect, it } from 'vitest';
import type { SketchLine, SketchRectangle } from '../../core/design';
import { createDesignHistory } from './design-history';
import { NO_MODIFIERS } from './design-draft';
import { createDesignSession, type DesignSession } from './design-session';
import { snapPointMm, type TrackingQuery } from './design-snap';
import { alignMovePointer, gestureAnchorMm, trackingReferences } from './design-tracking';
import { beginPathSequence } from './design-point-sequence';

const line: SketchLine = { kind: 'line', id: 'l', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };

function tracking(references: TrackingQuery['references'] = []): TrackingQuery {
  return { enabled: true, polar: true, polarStepDeg: 15, toleranceMm: 1, references };
}

describe('snap resolution order', () => {
  const base = {
    sketch: { entities: [line] },
    pxPerMm: 10,
    snapEnabled: true,
    gridMm: 10,
  };

  it('lets a real point beat a polar ray through it', () => {
    const resolved = snapPointMm({
      ...base,
      rawMm: { x: 100.3, y: 0 },
      fromMm: { x: 50, y: 0 },
      tracking: tracking(),
    });
    expect(resolved.target?.kind).toBe('endpoint');
    expect(resolved.tracking).toBeUndefined();
  });

  it('tracks a polar ray before falling back to the grid', () => {
    const resolved = snapPointMm({
      ...base,
      rawMm: { x: 33, y: 33.4 },
      fromMm: { x: 0, y: 50 },
      tracking: tracking(),
    });
    expect(resolved.target).toBeNull();
    expect(resolved.tracking).toBeUndefined();
    const along = snapPointMm({
      ...base,
      rawMm: { x: 30.2, y: 79.8 },
      fromMm: { x: 0, y: 50 },
      tracking: tracking(),
    });
    expect(along.tracking?.polarDeg).toBe(45);
    expect(along.pointMm.x).toBeCloseTo(30, 9);
    expect(along.pointMm.y).toBeCloseTo(80, 9);
  });

  it('offers a perpendicular foot from the gesture start', () => {
    const resolved = snapPointMm({ ...base, rawMm: { x: 40, y: 0.6 }, fromMm: { x: 40, y: 30 } });
    expect(resolved.target?.kind).toBe('perpendicular');
  });

  it('leaves the pointer alone with Snap off, tracking included', () => {
    const resolved = snapPointMm({
      ...base,
      snapEnabled: false,
      rawMm: { x: 61.3, y: 77.7 },
      tracking: tracking([{ x: 61, y: -20 }]),
    });
    expect(resolved.pointMm).toEqual({ x: 61.3, y: 77.7 });
    expect(resolved.tracking).toBeUndefined();
  });

  it('lines up with a reference before the grid', () => {
    const resolved = snapPointMm({
      ...base,
      rawMm: { x: 61.3, y: 77.7 },
      tracking: tracking([{ x: 61, y: -20 }]),
    });
    expect(resolved.pointMm).toEqual({ x: 61, y: 77.7 });
    expect(resolved.tracking?.guides).toHaveLength(1);
  });
});

describe('gesture tracking context', () => {
  it('tracks from the drag anchor or the last polyline corner', () => {
    const session = createDesignSession();
    expect(gestureAnchorMm(session)).toBeNull();
    const drafting: DesignSession = {
      ...session,
      draft: {
        tool: 'line',
        anchorMm: { x: 1, y: 2 },
        pointerMm: { x: 1, y: 2 },
        modifiers: NO_MODIFIERS,
      },
    };
    expect(gestureAnchorMm(drafting)).toEqual({ x: 1, y: 2 });
    const path = beginPathSequence({ x: 5, y: 5 });
    const sequencing: DesignSession = {
      ...session,
      pointSequence: { ...path, points: [...path.points, { x: 9, y: 5 }] },
    };
    expect(gestureAnchorMm(sequencing)).toEqual({ x: 9, y: 5 });
    expect(trackingReferences(sequencing)).toContainEqual({ x: 5, y: 5 });
  });

  it('lines a dragged box up with its neighbour', () => {
    const moving: SketchRectangle = {
      kind: 'rect',
      id: 'moving',
      origin: { x: 0, y: 0 },
      widthMm: 10,
      heightMm: 10,
      cornerRadiusMm: 0,
    };
    const neighbour: SketchRectangle = { ...moving, id: 'other', origin: { x: 40, y: 20 } };
    const sketch = { entities: [moving, neighbour] };
    const session: DesignSession = {
      ...createDesignSession(),
      history: createDesignHistory(sketch),
      move: { lastMm: { x: 5, y: 5 }, beforeSketch: sketch, ids: new Set(['moving']) },
    };
    // Dragging 19.6 mm down leaves the box 0.4 mm short of the neighbour's top.
    const aligned = alignMovePointer(session, { x: 5, y: 24.6 }, 1);
    expect(aligned?.pointMm.x).toBe(5);
    expect(aligned?.pointMm.y).toBeCloseTo(25, 9);
    expect(aligned?.tracking.guides).toHaveLength(1);
  });
});
