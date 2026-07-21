import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { commitCrop, createSession, appliedBounds } from './editor-session';
import { commitCanvasSize, commitImageSize } from './editor-session-resize';

const BOUNDS = { minX: 0, minY: 0, maxX: 8, maxY: 8 };

function greySession(size = 8) {
  const doc = createRgbaBuffer(size, size);
  // Left half black so scaling is observable.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size / 2; x += 1) {
      const b = (y * size + x) * 4;
      doc.data[b] = 0;
      doc.data[b + 1] = 0;
      doc.data[b + 2] = 0;
    }
  }
  return createSession('obj-1', 'test.png', doc, BOUNDS);
}

function grey(doc: { width: number; data: Uint8ClampedArray }, x: number, y: number): number {
  return doc.data[(y * doc.width + x) * 4] ?? 0;
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function expectSameBounds(a: Bounds | null, b: Bounds | null): void {
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  if (a === null || b === null) return;
  expect(b.minX).toBeCloseTo(a.minX, 5);
  expect(b.maxX).toBeCloseTo(a.maxX, 5);
  expect(b.minY).toBeCloseTo(a.minY, 5);
  expect(b.maxY).toBeCloseTo(a.maxY, 5);
}

describe('commitImageSize', () => {
  it('resamples the document and keeps the physical mapping unchanged', () => {
    const session = greySession();
    const resized = commitImageSize(session, 16, 16);
    expect(resized.doc.width).toBe(16);
    expect(resized.base.width).toBe(16);
    expect(grey(resized.doc, 2, 8)).toBe(0);
    expect(grey(resized.doc, 14, 8)).toBe(255);
    // Same pixel-vs-base shape as before => uncropped => bounds unchanged.
    expect(appliedBounds(resized)).toBeNull();
    expect(resized.history.undoStack.length).toBe(0);
    expect(resized.selection).toBeNull();
    expect(resized.dirtySinceApply).toBe(true);
  });

  it('preserves the mm mapping of an earlier crop through a resample', () => {
    const session = greySession();
    const cropped = commitCrop(session, { x: 2, y: 2, width: 4, height: 4 });
    const resized = commitImageSize(cropped, 8, 8); // 2× the cropped doc
    expectSameBounds(appliedBounds(cropped), appliedBounds(resized));
  });

  it('is a no-op at the current size', () => {
    const session = greySession();
    expect(commitImageSize(session, 8, 8)).toBe(session);
  });
});

describe('commitCanvasSize', () => {
  it('centred growth pads white and expands the mm bounds symmetrically', () => {
    const session = greySession();
    const grown = commitCanvasSize(session, 12, 12, { x: 0.5, y: 0.5 });
    expect(grown.doc.width).toBe(12);
    expect(grey(grown.doc, 0, 0)).toBe(255); // padding
    expect(grey(grown.doc, 2, 6)).toBe(0); // shifted content (was x=0)
    const bounds = appliedBounds(grown);
    expect(bounds?.minX).toBeCloseTo(-2, 5);
    expect(bounds?.maxX).toBeCloseTo(10, 5);
  });

  it('top-left anchor keeps origin content in place', () => {
    const session = greySession();
    const grown = commitCanvasSize(session, 12, 10, { x: 0, y: 0 });
    expect(grey(grown.doc, 0, 0)).toBe(0);
    expect(grey(grown.doc, 11, 9)).toBe(255);
    const bounds = appliedBounds(grown);
    expect(bounds?.minX).toBeCloseTo(0, 5);
    expect(bounds?.maxX).toBeCloseTo(12, 5);
  });

  it('shrinking crops against the anchor', () => {
    const session = greySession();
    const shrunk = commitCanvasSize(session, 4, 8, { x: 0, y: 0 });
    expect(shrunk.doc.width).toBe(4);
    expect(grey(shrunk.doc, 3, 4)).toBe(0); // left-half black survives
  });
});
