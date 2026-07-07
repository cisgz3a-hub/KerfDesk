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
