import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select/marquee';
import { commitAdjustment, computeAdjustPreview } from './editor-adjust-session';
import { createSession, undoSession, withSelection } from './editor-session';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function newSession() {
  return createSession('obj-1', 'test.png', createRgbaBuffer(8, 8), BOUNDS);
}

describe('commitAdjustment', () => {
  it('applies as exactly one undoable history entry', () => {
    const session = newSession();
    const committed = commitAdjustment(session, 'invert', {});
    expect(committed.doc.data[0]).toBe(0);
    expect(committed.history.undoStack.length).toBe(1);
    expect(committed.dirtySinceApply).toBe(true);
    const undone = undoSession(committed);
    expect(undone.doc.data[0]).toBe(255);
  });

  it('clamps to the selection', () => {
    const base = newSession();
    const session = withSelection(base, rectSelection(8, 8, { x: 0, y: 0, width: 4, height: 8 }));
    const committed = commitAdjustment(session, 'invert', {});
    expect(committed.doc.data[0]).toBe(0); // inside selection
    const outside = (0 * 8 + 6) * 4;
    expect(committed.doc.data[outside]).toBe(255); // outside untouched
  });
});

describe('computeAdjustPreview', () => {
  it('never mutates the session document', () => {
    const session = newSession();
    const preview = computeAdjustPreview(session, 'invert', {});
    expect(preview.data[0]).toBe(0);
    expect(session.doc.data[0]).toBe(255);
  });
});
