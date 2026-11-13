// Tools audit T1, T13: point adjustments on the Background act on its colour
// over white (ADR-245 §4), so Invert of a transparent-background logo is the
// logo's negative, not a blank image (T13-P2-1), and Black & white after
// "Clean up white paper" still gives two-level line art (T13R-P2-1).
import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { commitAdjustment, computeAdjustPreview } from './editor-adjust-session';
import { createSession, type EditorSession } from './editor-session';
import { addLayerAboveActive, compositeSession } from './editor-session-layers';

const BOUNDS = { minX: 0, minY: 0, maxX: 4, maxY: 1 };

function rowSession(pixels: ReadonlyArray<readonly [number, number, number, number]>) {
  const session = createSession('obj', 'logo.png', createRgbaBuffer(pixels.length, 1), BOUNDS);
  session.doc.data.set(pixels.flat());
  return session;
}

const red = (session: EditorSession): number[] =>
  [...compositeSession(session).data].filter((_, index) => index % 4 === 0);

describe('point adjustments on the Background (T13)', () => {
  it('inverts a transparent-background logo to its negative, in preview and Apply', () => {
    // Transparent, black, half-transparent black, transparent.
    const session = rowSession([
      [255, 255, 255, 0],
      [0, 0, 0, 255],
      [0, 0, 0, 128],
      [255, 255, 255, 0],
    ]);
    expect(red(session)).toEqual([255, 0, 127, 255]);

    const preview = computeAdjustPreview(session, 'invert', {});
    const committed = commitAdjustment(session, 'invert', {});

    expect(red(committed)).toEqual([0, 255, 128, 0]);
    expect(compositeSession(committed)).toEqual(preview);
  });

  it('gives two-level line art for Black & white after Clean up white paper', () => {
    const scan: ReadonlyArray<readonly [number, number, number, number]> = [
      [245, 245, 245, 255],
      [20, 20, 20, 255],
      [200, 200, 200, 255],
      [60, 60, 60, 255],
    ];
    const direct = commitAdjustment(rowSession(scan), 'threshold', { level: 128 });
    const cleaned = commitAdjustment(rowSession(scan), 'remove-white-background', { cleanup: 0 });
    const thresholded = commitAdjustment(cleaned, 'threshold', { level: 128 });

    expect(red(thresholded)).toEqual(red(direct));
    expect(new Set(red(thresholded))).toEqual(new Set([0, 255]));
  });

  it('does not blank the image when Invert follows Clean up white paper', () => {
    const cleaned = commitAdjustment(
      rowSession([
        [245, 245, 245, 255],
        [20, 20, 20, 255],
      ]),
      'remove-white-background',
      { cleanup: 0 },
    );
    expect(red(commitAdjustment(cleaned, 'invert', {}))).not.toEqual([255, 255]);
  });

  it('keeps an upper layer’s transparency on Invert', () => {
    const upper = addLayerAboveActive(rowSession([[255, 255, 255, 255]]), 'ink');
    upper.doc.data.set([0, 0, 0, 128]);
    const committed = commitAdjustment(upper, 'invert', {});
    expect([...committed.doc.data]).toEqual([255, 255, 255, 128]);
  });
});
