import { describe, expect, it } from 'vitest';
import { gaussianBlurInPlace } from '../../core/image-adjust';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { commitAdjustment } from './editor-adjust-session';
import { createSession, redoSession, undoSession } from './editor-session';

describe('Image Studio bounded working-image stress', () => {
  it('restores all channels through adjustment undo and redo on a megapixel image', () => {
    const doc = createRgbaBuffer(1024, 1024);
    for (let offset = 0; offset < doc.data.length; offset += 4) {
      doc.data[offset] = (offset / 4) % 251;
      doc.data[offset + 1] = 80;
      doc.data[offset + 2] = 160;
      doc.data[offset + 3] = (offset / 4) % 256;
    }
    const original = new Uint8ClampedArray(doc.data);
    let session = createSession('stress-image', 'stress.png', doc, {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
    session = commitAdjustment(session, 'invert', {});
    const inverted = new Uint8ClampedArray(session.doc.data);
    expect(inverted[0]).toBe(255);
    expect(inverted[3]).toBe(original[3]);
    session = undoSession(session);
    expect(Buffer.compare(Buffer.from(session.doc.data), Buffer.from(original))).toBe(0);
    session = redoSession(session);
    expect(Buffer.compare(Buffer.from(session.doc.data), Buffer.from(inverted))).toBe(0);
  });

  it('keeps flat-image colour and alpha invariant at a large Gaussian radius', () => {
    const doc = createRgbaBuffer(512, 512);
    gaussianBlurInPlace(doc, 50, null, null);
    expect(doc.data.every((value) => value === 255)).toBe(true);
  });
});
