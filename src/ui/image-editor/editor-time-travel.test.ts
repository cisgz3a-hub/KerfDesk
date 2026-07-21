import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { commitAdjustment } from './editor-adjust-session';
import { createSession } from './editor-session';
import { jumpToHistoryState } from './editor-time-travel';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

// Three inversions: white -> black -> white -> black, one history entry each.
function sessionWithThreeSteps() {
  let session = createSession('obj-1', 'test.png', createRgbaBuffer(4, 4), BOUNDS);
  for (let i = 0; i < 3; i += 1) session = commitAdjustment(session, 'invert', {});
  return session;
}

function firstByte(session: ReturnType<typeof sessionWithThreeSteps>): number {
  return session.doc.data[0] ?? -1;
}

describe('jumpToHistoryState', () => {
  it('jumps back to any past state', () => {
    const session = sessionWithThreeSteps();
    expect(firstByte(session)).toBe(0); // after 3 inversions
    const afterFirst = jumpToHistoryState(session, { kind: 'past', index: 0 });
    expect(firstByte(afterFirst)).toBe(0); // after 1 inversion
    expect(afterFirst.history.undoStack.length).toBe(1);
    expect(afterFirst.history.redoStack.length).toBe(2);
  });

  it('open jumps before the first op and future steps replay forward', () => {
    const session = sessionWithThreeSteps();
    const opened = jumpToHistoryState(session, { kind: 'open' });
    expect(firstByte(opened)).toBe(255);
    expect(opened.history.undoStack.length).toBe(0);
    // Nearest future (index 0) = the first inversion again.
    const forward = jumpToHistoryState(opened, { kind: 'future', index: 0 });
    expect(firstByte(forward)).toBe(0);
    expect(forward.history.undoStack.length).toBe(1);
  });

  it('jumping to the current state is a no-op', () => {
    const session = sessionWithThreeSteps();
    const same = jumpToHistoryState(session, { kind: 'past', index: 2 });
    expect(firstByte(same)).toBe(0);
    expect(same.history.undoStack.length).toBe(3);
    expect(same.history.redoStack.length).toBe(0);
  });

  it('a full round trip restores the newest state byte-for-byte', () => {
    const session = sessionWithThreeSteps();
    const opened = jumpToHistoryState(session, { kind: 'open' });
    const restored = jumpToHistoryState(opened, { kind: 'future', index: 2 });
    expect(firstByte(restored)).toBe(0);
    expect(restored.history.undoStack.length).toBe(3);
    expect(restored.history.redoStack.length).toBe(0);
  });
});
