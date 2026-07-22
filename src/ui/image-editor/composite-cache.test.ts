import { describe, expect, it } from 'vitest';
import { createRgbaBuffer, rgbaBuffersEqual } from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select/marquee';
import { commitAdjustment } from './editor-adjust-session';
import { commitFillSelection, createSession, withSelection, BLACK } from './editor-session';
import {
  addLayerAboveActive,
  compositeSession,
  setActiveLayerProps,
} from './editor-session-layers';
import { nextComposite, type CompositeCache } from './composite-cache';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function freshComposite(session: ReturnType<typeof createSession>) {
  // compositeSession's fast path can return the doc itself; clone-compare
  // is unnecessary because rgbaBuffersEqual is byte-based either way.
  return compositeSession(session);
}

describe('nextComposite', () => {
  it('single plain layer takes the identity fast path with no cache', () => {
    const session = createSession('obj-1', 't.png', createRgbaBuffer(32, 32), BOUNDS);
    const result = nextComposite(null, session);
    expect(result.doc).toBe(session.doc);
    expect(result.cache).toBeNull();
  });

  it('stays byte-identical to a fresh composite across a real op sequence', () => {
    let session = addLayerAboveActive(
      createSession('obj-1', 't.png', createRgbaBuffer(64, 48), BOUNDS),
      'l1',
    );
    let cache: CompositeCache | null = null;

    const steps: ((s: typeof session) => typeof session)[] = [
      // Fill a selected rect on the upper layer (precise dirty rect).
      (s) =>
        commitFillSelection(
          withSelection(s, rectSelection(64, 48, { x: 5, y: 5, width: 20, height: 12 })),
          BLACK,
          'Fill selection',
        ),
      // Selection-only change (EMPTY dirty — cache must survive untouched).
      (s) => withSelection(s, rectSelection(64, 48, { x: 30, y: 8, width: 8, height: 8 })),
      // Adjustment clamped to the new selection (rect dirty).
      (s) => commitAdjustment(s, 'invert', {}),
      // Structure change: opacity (full invalidation).
      (s) => setActiveLayerProps(s, { opacity: 0.5 }),
      // Another selected fill after the structure change.
      (s) =>
        commitFillSelection(
          withSelection(s, rectSelection(64, 48, { x: 50, y: 30, width: 10, height: 10 })),
          BLACK,
          'Fill selection',
        ),
    ];

    for (const step of steps) {
      session = step(session);
      const result = nextComposite(cache, session);
      cache = result.cache;
      expect(rgbaBuffersEqual(result.doc, freshComposite(session))).toBe(true);
    }
  });

  it('rebuilds fully when more than one revision passed between reads', () => {
    let session = addLayerAboveActive(
      createSession('obj-1', 't.png', createRgbaBuffer(40, 40), BOUNDS),
      'l1',
    );
    const first = nextComposite(null, session);
    // Two commits without consulting the cache in between.
    session = commitFillSelection(
      withSelection(session, rectSelection(40, 40, { x: 0, y: 0, width: 10, height: 10 })),
      BLACK,
      'Fill selection',
    );
    session = commitAdjustment(session, 'invert', {});
    const result = nextComposite(first.cache, session);
    expect(rgbaBuffersEqual(result.doc, freshComposite(session))).toBe(true);
  });

  it('same revision returns the cached buffer identity', () => {
    const session = addLayerAboveActive(
      createSession('obj-1', 't.png', createRgbaBuffer(16, 16), BOUNDS),
      'l1',
    );
    const first = nextComposite(null, session);
    const second = nextComposite(first.cache, session);
    expect(second.doc).toBe(first.doc);
  });

  it('a different object or dimensions drops the cache', () => {
    const a = addLayerAboveActive(
      createSession('obj-a', 't.png', createRgbaBuffer(16, 16), BOUNDS),
      'l1',
    );
    const b = addLayerAboveActive(
      createSession('obj-b', 't.png', createRgbaBuffer(16, 16), BOUNDS),
      'l1',
    );
    const cacheA = nextComposite(null, a).cache;
    const result = nextComposite(cacheA, b);
    expect(rgbaBuffersEqual(result.doc, freshComposite(b))).toBe(true);
    expect(result.cache?.objectId).toBe('obj-b');
  });
});
