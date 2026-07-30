import { describe, expect, it } from 'vitest';
import { EMPTY_SKETCH, type Sketch, type SketchLine } from '../../core/design';
import {
  canRedo,
  canUndo,
  commitSketch,
  createDesignHistory,
  DESIGN_HISTORY_DEPTH,
  redoSketch,
  undoSketch,
} from './design-history';

const sketchWith = (count: number): Sketch => ({
  entities: Array.from({ length: count }, (_unused, index): SketchLine => {
    return {
      kind: 'line',
      id: `l${index}`,
      start: { x: index, y: 0 },
      end: { x: index + 5, y: 0 },
    };
  }),
});

describe('createDesignHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const history = createDesignHistory(EMPTY_SKETCH);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(history.trimmedCount).toBe(0);
  });
});

describe('commitSketch', () => {
  it('records the previous state as undoable', () => {
    const history = commitSketch(createDesignHistory(EMPTY_SKETCH), sketchWith(1));
    expect(canUndo(history)).toBe(true);
    expect(history.present.entities).toHaveLength(1);
  });

  it('ignores a commit that does not change the sketch', () => {
    const start = createDesignHistory(EMPTY_SKETCH);
    expect(commitSketch(start, EMPTY_SKETCH)).toBe(start);
  });

  it('clears the redo branch', () => {
    const first = commitSketch(createDesignHistory(EMPTY_SKETCH), sketchWith(1));
    const undone = undoSketch(first);
    expect(canRedo(undone)).toBe(true);
    expect(canRedo(commitSketch(undone, sketchWith(2)))).toBe(false);
  });

  it('evicts oldest steps past the depth cap and counts them', () => {
    let history = createDesignHistory(EMPTY_SKETCH);
    for (let i = 1; i <= DESIGN_HISTORY_DEPTH + 5; i += 1) {
      history = commitSketch(history, sketchWith(i));
    }
    expect(history.past).toHaveLength(DESIGN_HISTORY_DEPTH);
    expect(history.trimmedCount).toBe(5);
  });
});

describe('undo and redo', () => {
  it('round-trips exactly', () => {
    const drawn = commitSketch(createDesignHistory(EMPTY_SKETCH), sketchWith(3));
    const back = undoSketch(drawn);
    expect(back.present).toBe(EMPTY_SKETCH);
    expect(redoSketch(back).present).toBe(drawn.present);
  });

  it('is inert at the ends rather than throwing', () => {
    const start = createDesignHistory(EMPTY_SKETCH);
    expect(undoSketch(start)).toBe(start);
    expect(redoSketch(start)).toBe(start);
  });

  it('walks back through several steps in order', () => {
    let history = createDesignHistory(EMPTY_SKETCH);
    history = commitSketch(history, sketchWith(1));
    history = commitSketch(history, sketchWith(2));
    history = commitSketch(history, sketchWith(3));
    expect(undoSketch(history).present.entities).toHaveLength(2);
    expect(undoSketch(undoSketch(history)).present.entities).toHaveLength(1);
  });
});
