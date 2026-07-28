import { describe, expect, it } from 'vitest';
import { aabbHandlePoints, hitAabbHandle, selectionResizeEditFromDrag } from './selection-handles';

const bbox = { minX: 0, minY: 0, maxX: 40, maxY: 10 };

describe('selection handles (audit C5)', () => {
  it('places 8 handles on the combined box', () => {
    const points = aabbHandlePoints(bbox);
    expect(points.map((h) => h.kind)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    expect(points.find((h) => h.kind === 'se')?.position).toEqual({ x: 40, y: 10 });
  });

  it('hit-tests a corner within pixel tolerance and misses the interior', () => {
    expect(hitAabbHandle(bbox, { x: 40, y: 10 }, 1)).toBe('se');
    expect(hitAabbHandle(bbox, { x: 20, y: 5 }, 1)).toBeNull();
  });

  it('corner drag resizes both axes about the opposite corner (aspect-locked)', () => {
    const edit = selectionResizeEditFromDrag({
      handle: 'se',
      bbox,
      point: { x: 80, y: 20 },
      lockAspect: true,
    });
    expect(edit).toEqual({
      kind: 'resize',
      anchor: 'nw',
      width: 80,
      height: 20,
      preserveAspect: true,
    });
  });

  it('edge drag resizes a single axis and never aspect-locks', () => {
    const edit = selectionResizeEditFromDrag({
      handle: 'e',
      bbox,
      point: { x: 80, y: 999 },
      lockAspect: true,
    });
    expect(edit).toEqual({ kind: 'resize', anchor: 'w', width: 80, preserveAspect: false });
  });

  // Regression: the west edge handle pins the EAST edge, so widening leftward
  // must measure maxX - pointer. It previously measured pointer - minX (the
  // east-handle formula), which collapsed the selection to the clamp floor
  // instead of widening it. The nw/sw corners share the west anchor and were
  // always correct, which is why the drift survived: only se/e were covered.
  it('west edge drag widens the selection about the pinned east edge', () => {
    const edit = selectionResizeEditFromDrag({
      handle: 'w',
      bbox,
      point: { x: -20, y: 999 },
      lockAspect: true,
    });
    expect(edit).toEqual({ kind: 'resize', anchor: 'e', width: 60, preserveAspect: false });
  });

  it('resizes each handle about its pinned opposite edge', () => {
    const cases = [
      { handle: 'nw', point: { x: -20, y: -5 }, anchor: 'se', width: 60, height: 15 },
      { handle: 'n', point: { x: 999, y: -5 }, anchor: 's', height: 15 },
      { handle: 'ne', point: { x: 80, y: -5 }, anchor: 'sw', width: 80, height: 15 },
      { handle: 'e', point: { x: 80, y: 999 }, anchor: 'w', width: 80 },
      { handle: 'se', point: { x: 80, y: 20 }, anchor: 'nw', width: 80, height: 20 },
      { handle: 's', point: { x: 999, y: 20 }, anchor: 'n', height: 20 },
      { handle: 'sw', point: { x: -20, y: 20 }, anchor: 'ne', width: 60, height: 20 },
      { handle: 'w', point: { x: -20, y: 999 }, anchor: 'e', width: 60 },
    ] as const;
    for (const c of cases) {
      const edit = selectionResizeEditFromDrag({
        handle: c.handle,
        bbox,
        point: c.point,
        lockAspect: false,
      });
      expect({ handle: c.handle, ...edit }).toEqual({
        handle: c.handle,
        kind: 'resize',
        anchor: c.anchor,
        ...('width' in c ? { width: c.width } : {}),
        ...('height' in c ? { height: c.height } : {}),
        preserveAspect: false,
      });
    }
  });

  it('clamps a drag past the pivot to a positive dimension', () => {
    const edit = selectionResizeEditFromDrag({
      handle: 'se',
      bbox,
      point: { x: -50, y: -50 },
      lockAspect: false,
    });
    expect(edit.width ?? 0).toBeGreaterThan(0);
    expect(edit.height ?? 0).toBeGreaterThan(0);
  });
});
