import { describe, expect, it } from 'vitest';
import { addEntity, EMPTY_SKETCH, type SketchLine } from '../../core/design';
import {
  createDesignSession,
  redoSession,
  sessionSketch,
  undoSession,
  withSketch,
} from './design-session';

const line = (id: string): SketchLine => ({
  kind: 'line',
  id,
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
});

describe('createDesignSession', () => {
  it('opens on Select with snapping on and nothing dirty', () => {
    const session = createDesignSession();
    expect(session.tool).toBe('select');
    expect(session.snapEnabled).toBe(true);
    expect(session.dirtySinceApply).toBe(false);
    expect(session.view).toBeNull();
  });
});

describe('withSketch', () => {
  it('marks the session dirty and records history', () => {
    const session = withSketch(createDesignSession(), addEntity(EMPTY_SKETCH, line('a')));
    expect(session.dirtySinceApply).toBe(true);
    expect(sessionSketch(session).entities).toHaveLength(1);
  });

  it('ignores a no-op change', () => {
    const start = createDesignSession();
    expect(withSketch(start, EMPTY_SKETCH)).toBe(start);
  });

  it('drops selected ids whose entity no longer exists', () => {
    const drawn = withSketch(createDesignSession(), addEntity(EMPTY_SKETCH, line('a')));
    const selected = { ...drawn, selectedIds: new Set(['a', 'ghost']) };
    const cleared = withSketch(selected, EMPTY_SKETCH);
    expect([...cleared.selectedIds]).toEqual([]);
  });
});

describe('undoSession and redoSession', () => {
  it('round-trips the sketch', () => {
    const drawn = withSketch(createDesignSession(), addEntity(EMPTY_SKETCH, line('a')));
    const undone = undoSession(drawn);
    expect(sessionSketch(undone).entities).toHaveLength(0);
    expect(sessionSketch(redoSession(undone)).entities).toHaveLength(1);
  });

  it('prunes a selection that undo removed', () => {
    const drawn = withSketch(createDesignSession(), addEntity(EMPTY_SKETCH, line('a')));
    const selected = { ...drawn, selectedIds: new Set(['a']) };
    expect([...undoSession(selected).selectedIds]).toEqual([]);
  });

  it('is inert with no history rather than throwing', () => {
    const start = createDesignSession();
    expect(undoSession(start)).toBe(start);
    expect(redoSession(start)).toBe(start);
  });
});
