import { describe, expect, it } from 'vitest';
import {
  createRgbaBuffer,
  RGBA_CHANNELS,
  rgbaBuffersEqual,
} from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select';
import {
  appliedBounds,
  BLACK,
  commitCrop,
  commitFillSelection,
  commitLine,
  commitMoveSelection,
  commitStroke,
  createSession,
  nudgeOutline,
  redoSession,
  revertSession,
  undoSession,
  WHITE,
  withSelection,
  type BrushSettings,
} from './editor-session';

const PENCIL: BrushSettings = { diameterPx: 3, hardness: 1, opacity: 1 };

function newSession() {
  return createSession('obj-1', 'test.png', createRgbaBuffer(24, 24), {
    minX: 0,
    minY: 0,
    maxX: 24,
    maxY: 24,
  });
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

  it('nudgeOutline moves only the selection, never the pixels', () => {
    let session = newSession();
    session = commitStroke(session, { kind: 'pencil' }, PENCIL, BLACK, [{ x: 3, y: 3 }], 'Pencil');
    session = withSelection(session, rectSelection(24, 24, { x: 2, y: 2, width: 3, height: 3 }));
    const before = channelAt(session, 3, 3);
    session = nudgeOutline(session, 4, 0);
    expect(channelAt(session, 3, 3)).toBe(before);
    expect(session.selection?.alpha[3 * 24 + 7]).toBeGreaterThan(0);
    expect(session.selection?.alpha[3 * 24 + 3]).toBe(0);
  });

  it('revert returns to the as-opened pixels and clears history', () => {
    let session = newSession();
    session = commitStroke(session, { kind: 'pencil' }, PENCIL, BLACK, [{ x: 4, y: 4 }], 'Pencil');
    session = revertSession(session);
    expect(rgbaBuffersEqual(session.doc, session.base)).toBe(true);
    expect(session.history.undoStack).toHaveLength(0);
  });

  it('crop shrinks the doc, maps mm bounds at the same DPI, and revert un-crops', () => {
    let session = newSession();
    session = commitStroke(session, { kind: 'pencil' }, PENCIL, BLACK, [{ x: 7, y: 7 }], 'Pencil');
    session = commitCrop(session, { x: 6, y: 6, width: 12, height: 6 });
    expect(session.doc.width).toBe(12);
    expect(session.doc.height).toBe(6);
    // The painted pixel travelled into crop space.
    expect(channelAt(session, 1, 1)).toBe(0);
    expect(session.history.undoStack).toHaveLength(0);
    // 24 px ↔ 24 mm source: 1 px = 1 mm (cropLocalBounds convention).
    expect(appliedBounds(session)).toEqual({ minX: 6, minY: 6, maxX: 18, maxY: 12 });

    session = revertSession(session);
    expect(session.doc.width).toBe(24);
    expect(appliedBounds(session)).toBeNull();
  });
});
