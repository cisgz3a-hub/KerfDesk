import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select/marquee';
import { commitAdjustment, computeAdjustPreview } from './editor-adjust-session';
import { createSession, undoSession, withSelection } from './editor-session';
import { compositeSession, setActiveLayerProps } from './editor-session-layers';

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
  it.each([
    { name: 'half opacity', props: { opacity: 0.5 }, expected: 128 },
    { name: 'hidden', props: { isVisible: false }, expected: 255 },
    { name: 'multiply', props: { blend: 'multiply' as const, opacity: 0.5 }, expected: 128 },
  ])('previews the committed composite for a single $name layer', ({ props, expected }) => {
    const session = setActiveLayerProps(newSession(), props);
    const preview = computeAdjustPreview(session, 'invert', {});
    expect(preview.data[0]).toBe(expected);
    expect(session.doc.data[0]).toBe(255);
    const committed = commitAdjustment(session, 'invert', {});
    expect(preview).toEqual(compositeSession(committed));
  });

  it('never mutates the session document', () => {
    const session = newSession();
    const preview = computeAdjustPreview(session, 'invert', {});
    expect(preview.data[0]).toBe(0);
    expect(session.doc.data[0]).toBe(255);
  });

  it('routes curve points through the curve LUT', () => {
    const session = newSession();
    const preview = computeAdjustPreview(session, 'curves', {}, [
      { x: 0, y: 40 },
      { x: 255, y: 40 },
    ]);
    expect(preview.data[0]).toBe(40); // flat curve maps everything to 40
    expect(session.doc.data[0]).toBe(255);
  });
});
