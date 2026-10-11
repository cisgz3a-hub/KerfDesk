import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select/marquee';
import { commitAdjustment } from './editor-adjust-session';
import {
  commitCrop,
  commitFillSelection,
  commitStroke,
  createSession,
  withSelection,
  BLACK,
  type EditorSession,
} from './editor-session';
import {
  addLayerAboveActive,
  addTextLayer,
  compositeSession,
  duplicateActiveLayer,
  mergeActiveLayerDown,
  moveActiveLayer,
  moveLayerToIndex,
  redoScoped,
  removeActiveLayer,
  setActiveLayer,
  setActiveLayerProps,
  undoScoped,
} from './editor-session-layers';
import { commitImageSize } from './editor-session-resize';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function newSession() {
  return createSession('obj-1', 'test.png', createRgbaBuffer(8, 8), BOUNDS);
}

describe('layer session ops', () => {
  it('createSession seeds one Background layer whose buffer IS the doc', () => {
    const session = newSession();
    expect(session.layers.length).toBe(1);
    expect(session.layers[0]?.buffer).toBe(session.doc);
    expect(session.activeLayerId).toBe('background');
  });

  it('adding a layer activates it and repoints the doc', () => {
    const session = addLayerAboveActive(newSession(), 'l1');
    expect(session.layers.map((l) => l.id)).toEqual(['background', 'l1']);
    expect(session.activeLayerId).toBe('l1');
    expect(session.doc).toBe(session.layers[1]?.buffer);
    expect(session.doc.data[3]).toBe(0); // transparent
  });

  it('ops target the active layer through the shared doc pointer', () => {
    const session = commitAdjustment(addLayerAboveActive(newSession(), 'l1'), 'invert', {});
    // Invert of transparent black is white ink at alpha 0... the background
    // stays untouched either way — the invariant under test.
    expect(session.layers[0]?.buffer.data[0]).toBe(255);
    expect(session.layers[0]?.buffer.data[3]).toBe(255);
    expect(session.doc).toBe(session.layers[1]?.buffer);
  });

  it('switching layers swaps the pointer and KEEPS editor undo (A2)', () => {
    let session = commitAdjustment(newSession(), 'invert', {});
    expect(session.history.undoStack.length).toBe(1);
    session = addLayerAboveActive(session, 'l1');
    session = setActiveLayer(session, 'background');
    expect(session.doc).toBe(session.layers[0]?.buffer);
    expect(session.history.undoStack.length).toBe(2);
    expect(session.history.undoStack[0]?.scope).toBe('background');
  });

  it('remove falls back to the layer below; the last layer is immovable', () => {
    let session = addLayerAboveActive(newSession(), 'l1');
    session = removeActiveLayer(session);
    expect(session.layers.map((l) => l.id)).toEqual(['background']);
    expect(session.doc).toBe(session.layers[0]?.buffer);
    expect(removeActiveLayer(session).layers.length).toBe(1);
  });

  it('compositeSession is the doc itself for a plain single layer', () => {
    const session = newSession();
    expect(compositeSession(session)).toBe(session.doc);
  });

  it('composite shows upper-layer ink over the background', () => {
    let session = addLayerAboveActive(newSession(), 'l1');
    session.doc.data[0] = 0;
    session.doc.data[1] = 0;
    session.doc.data[2] = 0;
    session.doc.data[3] = 255;
    const composite = compositeSession(session);
    expect(composite).not.toBe(session.doc);
    expect(composite.data[0]).toBe(0); // ink from l1
    expect(composite.data[4]).toBe(255); // background elsewhere
    // Hiding the upper layer removes its ink from the composite.
    session = setActiveLayerProps(session, { isVisible: false });
    expect(compositeSession(session).data[0]).toBe(255);
  });

  it('mergeDown lands ink in the lower layer which becomes active', () => {
    let session = addLayerAboveActive(newSession(), 'l1');
    session.doc.data[0] = 0;
    session.doc.data[1] = 0;
    session.doc.data[2] = 0;
    session.doc.data[3] = 255;
    session = mergeActiveLayerDown(session);
    expect(session.layers.length).toBe(1);
    expect(session.activeLayerId).toBe('background');
    expect(session.doc.data[0]).toBe(0);
  });

  it('duplicate copies bytes into the new active layer', () => {
    let session = addLayerAboveActive(newSession(), 'l1');
    session.doc.data[0] = 9;
    session = duplicateActiveLayer(session, 'l1-copy');
    expect(session.activeLayerId).toBe('l1-copy');
    expect(session.doc.data[0]).toBe(9);
    expect(session.doc).not.toBe(session.layers[1]?.buffer);
  });

  it('undo follows strokes across layer switches and redo walks back (A2)', () => {
    // Ink on the Background, then on a new upper layer.
    let session = commitFillSelection(
      withSelection(newSession(), rectSelection(8, 8, { x: 0, y: 0, width: 2, height: 2 })),
      BLACK,
      'Fill selection',
    );
    session = addLayerAboveActive(session, 'l1');
    session = commitFillSelection(
      withSelection(session, rectSelection(8, 8, { x: 4, y: 4, width: 2, height: 2 })),
      BLACK,
      'Fill selection',
    );
    expect(session.history.undoStack.length).toBe(3);

    // First undo reverts the upper-layer fill (active already l1).
    session = undoScoped(session);
    expect(session.activeLayerId).toBe('l1');
    expect(session.doc.data[(4 * 8 + 4) * 4 + 3]).toBe(0); // transparent again

    // Undo the layer creation, then the earlier background fill.
    session = undoScoped(session);
    expect(session.layers.map((layer) => layer.id)).toEqual(['background']);
    session = undoScoped(session);
    expect(session.activeLayerId).toBe('background');
    expect(session.doc.data[0]).toBe(255); // background fill reverted

    // Redo replays forward, following layers again.
    session = redoScoped(session);
    expect(session.activeLayerId).toBe('background');
    expect(session.doc.data[0]).toBe(0);
    session = redoScoped(session);
    expect(session.doc.data[(4 * 8 + 4) * 4 + 3]).toBe(0);
    session = redoScoped(session);
    expect(session.activeLayerId).toBe('l1');
    expect(session.doc.data[(4 * 8 + 4) * 4 + 3]).toBe(255);
  });

  it('undoes removal before following retained strokes on the restored layer', () => {
    let session = commitFillSelection(
      withSelection(newSession(), rectSelection(8, 8, { x: 0, y: 0, width: 2, height: 2 })),
      BLACK,
      'Fill selection',
    );
    session = addLayerAboveActive(session, 'l1');
    session = commitFillSelection(
      withSelection(session, rectSelection(8, 8, { x: 4, y: 4, width: 2, height: 2 })),
      BLACK,
      'Fill selection',
    );
    session = removeActiveLayer(session);
    expect(session.history.undoStack.length).toBe(4);
    expect(session.history.undoStack[0]?.scope).toBe('background');
    session = undoScoped(session);
    expect(session.activeLayerId).toBe('l1');
    expect(session.doc.data[(4 * 8 + 4) * 4 + 3]).toBe(255);
    session = undoScoped(session);
    expect(session.doc.data[(4 * 8 + 4) * 4 + 3]).toBe(0);
    session = undoScoped(session);
    session = undoScoped(session);
    expect(session.doc.data[0]).toBe(255);
  });

  it('undoes merging without dropping earlier history', () => {
    let session = commitFillSelection(
      withSelection(newSession(), rectSelection(8, 8, { x: 0, y: 0, width: 2, height: 2 })),
      BLACK,
      'Fill selection',
    );
    session = addLayerAboveActive(session, 'l1');
    session = mergeActiveLayerDown(session);
    expect(session.history.undoStack.length).toBe(3);
    session = undoScoped(session);
    expect(session.layers.map((layer) => layer.id)).toEqual(['background', 'l1']);
    session = undoScoped(session);
    session = undoScoped(session);
    expect(session.doc.data[0]).toBe(255);
  });

  it('addTextLayer inserts a doc-sized buffer as the new active layer', () => {
    const session = newSession(); // 8×8 Background
    const textBuffer = createRgbaBuffer(8, 8);
    // Fake "ink" pixel so we can prove the buffer became the layer.
    textBuffer.data[(4 * 8 + 4) * 4] = 0;
    textBuffer.data[(4 * 8 + 4) * 4 + 3] = 255;
    const next = addTextLayer(session, 'text-1', 'Hello', textBuffer);
    expect(next.layers.map((l) => l.id)).toEqual(['background', 'text-1']);
    expect(next.activeLayerId).toBe('text-1');
    expect(next.layers[1]?.name).toBe('Hello');
    expect(next.doc).toBe(textBuffer);
    expect(next.doc.data[(4 * 8 + 4) * 4 + 3]).toBe(255);
    // Composite shows the text ink over the white Background.
    expect(compositeSession(next).data[(4 * 8 + 4) * 4]).toBe(0);
  });

  it('addTextLayer rejects a mismatched buffer (dimension invariant)', () => {
    const session = newSession();
    const wrong = createRgbaBuffer(4, 4);
    expect(addTextLayer(session, 'text-1', 'x', wrong)).toBe(session);
  });

  it('crop and image size keep every layer at uniform dimensions', () => {
    let session = addLayerAboveActive(newSession(), 'l1');
    session = commitCrop(session, { x: 2, y: 2, width: 4, height: 4 });
    expect(session.layers.every((l) => l.buffer.width === 4)).toBe(true);
    expect(session.doc).toBe(session.layers[1]?.buffer);
    session = commitImageSize(session, 8, 8);
    expect(session.layers.every((l) => l.buffer.width === 8)).toBe(true);
    expect(session.doc).toBe(session.layers[1]?.buffer);
  });

  it('round trips an interleaved editing workflow through every layer and dimension change', () => {
    const snapshot = (session: EditorSession) => ({
      layers: session.layers.map((layer) => ({
        ...layer,
        buffer: { ...layer.buffer, data: [...layer.buffer.data] },
      })),
      active: session.activeLayerId,
      cropOffset: session.cropOffset,
      pixelSizeMm: session.pixelSizeMm,
      base: { ...session.base, data: [...session.base.data] },
    });
    const paint = (session: EditorSession) =>
      commitStroke(
        session,
        { kind: 'pencil' },
        { diameterPx: 1, hardness: 1, opacity: 1 },
        BLACK,
        [{ x: 3, y: 3 }],
        'Pencil',
      );
    const steps: ((session: EditorSession) => EditorSession)[] = [
      paint,
      (session) => addLayerAboveActive(session, 'ink'),
      paint,
      (session) => setActiveLayerProps(session, { name: 'My ink' }),
      (session) => setActiveLayerProps(session, { opacity: 0.5 }),
      (session) => setActiveLayerProps(session, { blend: 'multiply' }),
      (session) => setActiveLayerProps(session, { isVisible: false }),
      (session) => duplicateActiveLayer(session, 'copy'),
      (session) => moveActiveLayer(session, -1),
      (session) => moveLayerToIndex(session, 'copy', 2),
      (session) => commitCrop(session, { x: 1, y: 1, width: 6, height: 6 }),
      (session) => commitImageSize(session, 10, 10),
      (session) => addTextLayer(session, 'text', 'Text', createRgbaBuffer(10, 10)),
      paint,
      mergeActiveLayerDown,
      removeActiveLayer,
    ];
    let current = newSession();
    const checkpoints = [snapshot(current)];
    for (const step of steps) {
      current = step(current);
      checkpoints.push(snapshot(current));
    }
    expect(current.history.undoStack).toHaveLength(steps.length);
    for (const expected of checkpoints.slice(0, -1).reverse()) {
      current = undoScoped(current);
      expect(snapshot(current)).toEqual(expected);
      expect(current.doc).toBe(
        current.layers.find((layer) => layer.id === current.activeLayerId)?.buffer,
      );
    }
    for (const expected of checkpoints.slice(1)) {
      current = redoScoped(current);
      expect(snapshot(current)).toEqual(expected);
    }
  });

  it('does not record selection changes or no-ops and forks structural redo after a new edit', () => {
    let session = addLayerAboveActive(newSession(), 'ink');
    const history = session.history;
    session = setActiveLayer(session, 'background');
    expect(session.history).toBe(history);
    expect(setActiveLayer(session, 'missing')).toBe(session);
    expect(setActiveLayerProps(session, { name: 'Background', opacity: 1 })).toBe(session);
    expect(moveActiveLayer(session, -1)).toBe(session);
    expect(addLayerAboveActive(session, 'ink')).toBe(session);
    expect(duplicateActiveLayer(session, 'ink')).toBe(session);
    session = undoScoped(session);
    expect(session.history.redoStack).toHaveLength(1);
    session = addLayerAboveActive(session, 'replacement');
    expect(session.history.redoStack).toHaveLength(0);
    expect(redoScoped(session)).toBe(session);
    expect(undoScoped(session).layers.map((layer) => layer.id)).toEqual(['background']);
  });
});
