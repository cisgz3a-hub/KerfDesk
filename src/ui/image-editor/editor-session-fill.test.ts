import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select/marquee';
import { commitBucketFill, commitGradient } from './editor-session-fill';
import { createSession, withSelection, BLACK } from './editor-session';
import { addLayerAboveActive } from './editor-session-layers';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const RED = { r: 200, g: 10, b: 10 };

// White doc with a grey 4×4 island at (2,2).
function islandSession() {
  const doc = createRgbaBuffer(12, 12);
  for (let y = 2; y < 6; y += 1) {
    for (let x = 2; x < 6; x += 1) {
      const base = (y * 12 + x) * 4;
      doc.data[base] = 80;
      doc.data[base + 1] = 80;
      doc.data[base + 2] = 80;
    }
  }
  return createSession('obj-1', 'test.png', doc, BOUNDS);
}

describe('commitBucketFill', () => {
  it('fills the clicked visible region with one scoped history entry', () => {
    const session = commitBucketFill(islandSession(), 3, 3, RED, {
      tolerance: 16,
      contiguous: true,
    });
    expect(session.doc.data[(3 * 12 + 3) * 4]).toBe(200); // inside island
    expect(session.doc.data[0]).toBe(255); // outside untouched
    expect(session.history.undoStack.length).toBe(1);
    expect(session.history.undoStack[0]?.scope).toBe('background');
    expect(session.lastDirtyRect).toEqual({ x: 2, y: 2, width: 4, height: 4 });
  });

  it('samples the COMPOSITE but paints the transparent active layer', () => {
    const session = commitBucketFill(addLayerAboveActive(islandSession(), 'l1'), 3, 3, RED, {
      tolerance: 16,
      contiguous: true,
    });
    const idx = (3 * 12 + 3) * 4;
    // Ink landed on the active (upper) layer, opaque…
    expect(session.doc.data[idx]).toBe(200);
    expect(session.doc.data[idx + 3]).toBe(255);
    // …and the Background island is untouched underneath.
    expect(session.layers[0]?.buffer.data[idx]).toBe(80);
  });
});

describe('commitGradient', () => {
  it('fills fg→bg with one scoped entry, clamped to the selection', () => {
    const selected = withSelection(
      islandSession(),
      rectSelection(12, 12, { x: 0, y: 0, width: 6, height: 12 }),
    );
    const session = commitGradient(
      selected,
      { from: { x: 0, y: 0 }, to: { x: 11, y: 0 }, shape: 'linear' },
      BLACK,
      BLACK,
    );
    expect(session.doc.data[(8 * 12 + 2) * 4]).toBe(0); // inside selection
    expect(session.doc.data[(8 * 12 + 9) * 4]).toBe(255); // outside untouched
    expect(session.history.undoStack.length).toBe(1);
  });
});
