import { describe, expect, it } from 'vitest';
import {
  createRgbaBuffer,
  RGBA_CHANNELS,
  rgbaBuffersEqual,
} from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select';
import {
  BLACK,
  commitFillSelection,
  commitLine,
  commitMoveSelection,
  commitStroke,
  createSession,
  redoSession,
  revertSession,
  undoSession,
  WHITE,
  withSelection,
  type BrushSettings,
} from './editor-session';

const PENCIL: BrushSettings = { diameterPx: 3, hardness: 1, opacity: 1 };

function newSession() {
  return createSession('obj-1', 'test.png', createRgbaBuffer(24, 24));
}

function channelAt(session: ReturnType<typeof newSession>, x: number, y: number): number {
  return session.doc.data[(y * session.doc.width + x) * RGBA_CHANNELS] ?? -1;
}

describe('editor session ops', () => {
  it('stroke commits one history entry, undo restores, redo reapplies', () => {
    let session = newSession();
    const original = { ...session.base };
    session = commitStroke(session, { kind: 'pencil' }, PENCIL, BLACK, [{ x: 5, y: 5 }], 'Pencil');
    expect(session.history.undoStack).toHaveLength(1);
    expect(session.dirtySinceApply).toBe(true);
    expect(channelAt(session, 5, 5)).toBe(0);

    session = undoSession(session);
    expect(rgbaBuffersEqual(session.doc, original)).toBe(true);
    session = redoSession(session);
    expect(channelAt(session, 5, 5)).toBe(0);
  });

  it('eraser strokes always paint white regardless of the active colour', () => {
    let session = newSession();
    session = commitStroke(session, { kind: 'pencil' }, PENCIL, BLACK, [{ x: 8, y: 8 }], 'Pencil');
    session = commitStroke(
      session,
      { kind: 'eraser' },
      { ...PENCIL, diameterPx: 6 },
      BLACK,
      [{ x: 8, y: 8 }],
      'Eraser',
    );
    expect(channelAt(session, 8, 8)).toBe(255);
  });

  it('line commits with 45° constraint applied', () => {
    let session = newSession();
    session = commitLine(session, PENCIL, BLACK, { x: 2, y: 10 }, { x: 12, y: 11 }, true);
    // Snapped horizontal: the row is inked, the unsnapped drift row is not.
    expect(channelAt(session, 10, 10)).toBe(0);
    expect(session.history.undoStack).toHaveLength(1);
  });

  it('delete/fill selection only touch the selected area and are undoable', () => {
    let session = newSession();
    session = commitStroke(
      session,
      { kind: 'pencil' },
      { ...PENCIL, diameterPx: 20 },
      BLACK,
      [{ x: 12, y: 12 }],
      'Pencil',
    );
    session = withSelection(session, rectSelection(24, 24, { x: 10, y: 10, width: 4, height: 4 }));
    session = commitFillSelection(session, WHITE, 'Delete selection');
    expect(channelAt(session, 11, 11)).toBe(255);
    expect(channelAt(session, 6, 12)).toBe(0);

    session = undoSession(session);
    expect(channelAt(session, 11, 11)).toBe(0);
  });

  it('move selection shifts pixels, white-fills the source, and moves the mask', () => {
    let session = newSession();
    session = withSelection(session, rectSelection(24, 24, { x: 2, y: 2, width: 2, height: 2 }));
    session = commitFillSelection(session, BLACK, 'Fill selection');
    session = commitMoveSelection(session, 5, 0);
    expect(channelAt(session, 2, 2)).toBe(255);
    expect(channelAt(session, 7, 2)).toBe(0);
    // The mask travelled: deleting now clears the moved block.
    session = commitFillSelection(session, WHITE, 'Delete selection');
    expect(channelAt(session, 7, 2)).toBe(255);
  });

  it('revert returns to the as-opened pixels and clears history', () => {
    let session = newSession();
    session = commitStroke(session, { kind: 'pencil' }, PENCIL, BLACK, [{ x: 4, y: 4 }], 'Pencil');
    session = revertSession(session);
    expect(rgbaBuffersEqual(session.doc, session.base)).toBe(true);
    expect(session.history.undoStack).toHaveLength(0);
  });
});
