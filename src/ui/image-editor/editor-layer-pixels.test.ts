import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select/marquee';
import {
  BLACK,
  commitFillSelection,
  commitStroke,
  createSession,
  redoSession,
  undoSession,
  withSelection,
} from './editor-session';
import {
  addLayerAboveActive,
  compositeSession,
  removeActiveLayer,
  setActiveLayer,
} from './editor-session-layers';
import { commitBucketFill, commitGradient } from './editor-session-fill';
import { commitCloneStroke } from './editor-session-retouch';
import { nextComposite } from './composite-cache';

const RED = { r: 255, g: 0, b: 0 };
const BRUSH = { diameterPx: 1, hardness: 1, opacity: 0.5 };
const POINTS = [{ x: 0.5, y: 0.5 }];

function session(width = 1) {
  return createSession('image', 'fixture', createRgbaBuffer(width, 1), {
    minX: 0,
    minY: 0,
    maxX: width,
    maxY: 1,
  });
}

function reds(doc: ReturnType<typeof createRgbaBuffer>) {
  return Array.from({ length: doc.width }, (_, x) => doc.data[x * 4]);
}

describe('transparent layer editing', () => {
  it('keeps paint RGB straight and opacity in alpha, including undo/redo', () => {
    const painted = commitStroke(
      addLayerAboveActive(session(), 'upper'),
      { kind: 'pencil' },
      BRUSH,
      RED,
      POINTS,
      'Paint',
    );
    expect([...painted.doc.data]).toEqual([255, 0, 0, 128]);
    expect([...compositeSession(painted).data]).toEqual([255, 127, 127, 255]);
    const undone = undoSession(painted);
    expect(undone.doc.data[3]).toBe(0);
    expect([...redoSession(undone).doc.data]).toEqual([255, 0, 0, 128]);
  });

  it('fills feathered selections with source-over alpha, including gradients', () => {
    for (const gradient of [false, true]) {
      const selected = withSelection(addLayerAboveActive(session(), 'upper'), {
        width: 1,
        height: 1,
        alpha: new Uint8Array([128]),
      });
      const filled = gradient
        ? commitGradient(
            selected,
            { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, shape: 'linear' },
            RED,
            RED,
          )
        : commitFillSelection(selected, RED, 'Fill');
      expect([...filled.doc.data]).toEqual([255, 0, 0, 128]);
    }
  });

  it('erases upper pixels proportionally while Background honors its chosen color', () => {
    const upper = addLayerAboveActive(session(), 'upper');
    upper.doc.data.set([255, 0, 0, 128]);
    const erased = commitStroke(upper, { kind: 'eraser' }, BRUSH, BLACK, POINTS, 'Erase');
    expect([...erased.doc.data]).toEqual([255, 0, 0, 64]);
    const fully = commitStroke(
      erased,
      { kind: 'eraser' },
      { ...BRUSH, opacity: 1 },
      BLACK,
      POINTS,
      'Erase',
    );
    expect([...compositeSession(fully).data]).toEqual([255, 255, 255, 255]);
    const background = commitStroke(
      session(),
      { kind: 'eraser' },
      { ...BRUSH, opacity: 1 },
      { r: 17, g: 34, b: 51 },
      POINTS,
      'Erase',
    );
    expect([...background.doc.data]).toEqual([17, 34, 51, 255]);
  });

  it('composites a sole transparent layer over white after Background deletion', () => {
    const upper = addLayerAboveActive(session(), 'upper');
    upper.doc.data.set([255, 0, 0, 128]);
    const only = removeActiveLayer(setActiveLayer(upper, 'background'));
    expect([...compositeSession(only).data]).toEqual([255, 127, 127, 255]);
    expect([...nextComposite(null, only).doc.data]).toEqual([255, 127, 127, 255]);
  });
});

describe('selection and immutable sampling', () => {
  it('clones fractional-opacity color onto a transparent upper layer', () => {
    const original = session(2);
    original.doc.data.set([255, 0, 0, 255]);
    const upper = addLayerAboveActive(original, 'upper');
    const cloned = commitCloneStroke(
      upper,
      { x: -1, y: 0 },
      {
        points: [{ x: 1.5, y: 0.5 }],
        diameterPx: 1,
        hardness: 1,
        opacity: 0.5,
      },
    );
    expect([...cloned.doc.data].slice(4, 8)).toEqual([255, 0, 0, 128]);
  });
  it('bucket intersects its region with a feathered active selection', () => {
    const selected = withSelection(session(8), {
      width: 8,
      height: 1,
      alpha: new Uint8Array([255, 128, 0, 0, 0, 0, 0, 0]),
    });
    const filled = commitBucketFill(selected, 0, 0, BLACK, { tolerance: 0, contiguous: true });
    expect(reds(filled.doc)).toEqual([0, 127, 255, 255, 255, 255, 255, 255]);
    expect(filled.lastDirtyRect).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    const undone = undoSession(filled);
    expect(reds(undone.doc)).toEqual(Array.from({ length: 8 }, () => 255));
  });

  it('bucket outside the selection is a no-op when the flood region cannot intersect', () => {
    const original = session(4);
    original.doc.data.set([0, 0, 0, 255], 0);
    const selected = withSelection(
      original,
      rectSelection(4, 1, { x: 2, y: 0, width: 2, height: 1 }),
    );
    expect(commitBucketFill(selected, 0, 0, RED, { tolerance: 0, contiguous: true })).toBe(
      selected,
    );
  });

  it('clones overlapping pixels from the pre-stroke image, with scoped undo', () => {
    const original = session(8);
    for (let x = 0; x < 8; x += 1)
      original.doc.data.set([(x + 1) * 20, (x + 1) * 20, (x + 1) * 20, 255], x * 4);
    const cloned = commitCloneStroke(
      original,
      { x: -1, y: 0 },
      {
        points: [
          { x: 1.5, y: 0.5 },
          { x: 7.5, y: 0.5 },
        ],
        diameterPx: 2,
        hardness: 1,
        opacity: 1,
      },
    );
    expect(reds(cloned.doc)).toEqual([20, 20, 40, 60, 80, 100, 120, 140]);
    expect(reds(undoSession(cloned).doc)).toEqual([20, 40, 60, 80, 100, 120, 140, 160]);
  });
});
