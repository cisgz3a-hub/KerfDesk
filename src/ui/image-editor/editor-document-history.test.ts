import { describe, expect, it } from 'vitest';
import { cloneRgbaBuffer, createEditHistory } from '../../core/image-edit';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { selectAllMask } from '../../core/image-select';
import {
  appliedBounds,
  BLACK,
  commitCrop,
  commitStroke,
  createSession,
  revertSession,
  withSelection,
  type EditorSession,
} from './editor-session';
import {
  addLayerAboveActive,
  redoScoped,
  removeActiveLayer,
  setActiveLayer,
  setActiveLayerProps,
  undoScoped,
} from './editor-session-layers';
import { commitCanvasSize, commitImageSize } from './editor-session-resize';

function session(): EditorSession {
  return createSession('photo', 'scan.png', createRgbaBuffer(4, 4), {
    minX: 10,
    minY: 20,
    maxX: 18,
    maxY: 28,
  });
}

function paint(current: EditorSession, x = 1, y = 1): EditorSession {
  return commitStroke(
    current,
    { kind: 'pencil' },
    { diameterPx: 1, hardness: 1, opacity: 1 },
    BLACK,
    [{ x, y }],
    'Pencil',
  );
}

function pixels(current: EditorSession) {
  return {
    layers: current.layers.map((layer) => ({
      id: layer.id,
      width: layer.buffer.width,
      height: layer.buffer.height,
      pixels: [...layer.buffer.data],
    })),
    base: {
      width: current.base.width,
      height: current.base.height,
      pixels: [...current.base.data],
    },
    cropOffset: current.cropOffset,
    pixelSizeMm: current.pixelSizeMm,
    bounds: appliedBounds(current),
    selection:
      current.selection === null
        ? null
        : { ...current.selection, alpha: [...current.selection.alpha] },
  };
}

describe('dimension-changing image history', () => {
  it('restores the layered Revert source across resizing and budgets its independent pixels', () => {
    let current = paint(addLayerAboveActive(session(), 'ink'));
    const baseLayers = current.layers.map((layer) => ({
      ...layer,
      buffer: cloneRgbaBuffer(layer.buffer),
    }));
    current = { ...current, baseLayers, baseActiveLayerId: 'ink', history: createEditHistory() };
    const original = pixels(current);
    current = commitImageSize(current, 8, 8);
    expect(current.history.undoStack[0]?.byteSize).toBe(4 * 4 * 4 * 5);
    expect(current.baseLayers?.every((layer) => layer.buffer.width === 8)).toBe(true);
    current = undoScoped(current);
    expect(pixels(current)).toEqual(original);
    expect(current.baseLayers?.every((layer) => layer.buffer.width === 4)).toBe(true);
    expect(current.baseLayers?.[1]?.buffer).not.toBe(baseLayers[1]?.buffer);
    current = removeActiveLayer(current);
    current = revertSession(current);
    expect(current.layers.map((layer) => layer.id)).toEqual(['background', 'ink']);
    expect(current.activeLayerId).toBe('ink');
    expect(pixels(current).layers).toEqual(original.layers);
  });

  it('undoes and redoes strokes across resize, crop and canvas size with exact physical geometry', () => {
    let current = session();
    const checkpoints = [pixels(current)];
    current = paint(current);
    checkpoints.push(pixels(current));
    current = commitImageSize(current, 8, 6);
    checkpoints.push(pixels(current));
    current = paint(current, 5, 4);
    checkpoints.push(pixels(current));
    current = commitCrop(current, { x: 1, y: 2, width: 5, height: 3 });
    checkpoints.push(pixels(current));
    current = commitCanvasSize(current, 7, 5, { x: 0.5, y: 0.5 });
    checkpoints.push(pixels(current));
    for (let index = checkpoints.length - 2; index >= 0; index -= 1) {
      current = undoScoped(current);
      expect(pixels(current)).toEqual(checkpoints[index]);
      expect(current.doc).toBe(
        current.layers.find((layer) => layer.id === current.activeLayerId)?.buffer,
      );
    }
    for (const expected of checkpoints.slice(1)) {
      current = redoScoped(current);
      expect(pixels(current)).toEqual(expected);
    }
  });

  it('restores layers, properties and selection as independent ordered steps', () => {
    let current = addLayerAboveActive(session(), 'ink');
    current = paint(current);
    const mask = selectAllMask(4, 4);
    current = withSelection(current, mask);
    const before = pixels(current);
    current = commitImageSize(current, 8, 8);
    mask.alpha.fill(0);
    current = setActiveLayerProps(current, { name: 'Renamed', opacity: 0.5 });
    current = setActiveLayer(current, current.layers[0]!.id);
    current = undoScoped(current);
    expect(current.doc.width).toBe(8);
    expect(current.layers.find((layer) => layer.id === 'ink')).toMatchObject({
      name: 'Layer 1',
      opacity: 1,
    });
    current = undoScoped(current);
    expect(pixels(current)).toEqual(before);
    expect(current.activeLayerId).toBe('ink');
    expect(current.layers.find((layer) => layer.id === 'ink')).toMatchObject({
      name: 'Layer 1',
      opacity: 1,
    });
    current = redoScoped(current);
    expect(current.layers.every((layer) => layer.buffer.width === 8)).toBe(true);
    expect(current.selection).toBeNull();
    current = redoScoped(current);
    expect(current.layers.find((layer) => layer.id === 'ink')).toMatchObject({
      name: 'Renamed',
      opacity: 0.5,
    });
  });

  it.each(['add', 'remove'] as const)(
    'restores layer topology and earlier strokes across resize after %s',
    (operation) => {
      let current = addLayerAboveActive(session(), 'ink');
      current = paint(current);
      current = commitImageSize(current, 8, 8);
      current = setActiveLayer(current, current.layers[0]!.id);
      current = paint(current, 6, 6);
      current = setActiveLayer(current, 'ink');
      current =
        operation === 'add' ? addLayerAboveActive(current, 'new') : removeActiveLayer(current);
      current = undoScoped(current);
      expect(current.layers.map((layer) => layer.id)).toEqual(['background', 'ink']);
      expect(current.layers.every((layer) => layer.buffer.width === 8)).toBe(true);
      current = undoScoped(current);
      expect(current.doc.data[(6 * 8 + 6) * 4]).toBe(255);
      current = undoScoped(current);
      expect(current.doc.width).toBe(4);
      current = undoScoped(current);
      expect(current.doc.data[(1 * 4 + 1) * 4 + 3]).toBe(0);
      current = undoScoped(current);
      expect(current.layers.map((layer) => layer.id)).toEqual(['background']);
    },
  );

  it('accounts for document snapshots when pushing and for a larger inverse when traversing', () => {
    let current = { ...session(), history: createEditHistory(300) };
    current = paint(current);
    current = commitImageSize(current, 16, 16);
    expect(current.history.undoStack.at(-1)?.byteSize).toBe(4 * 4 * 4 * 2);
    expect(current.history.undoStack).toHaveLength(2);
    current = undoScoped(current);
    expect(current.doc.width).toBe(4);
    expect(current.history.undoStack).toHaveLength(0);
    expect(current.history.redoStack).toHaveLength(1);
    expect(current.history.redoStack[0]?.byteSize).toBe(16 * 16 * 4 * 2);
    expect(current.history.trimmedCount).toBe(1);
    current = redoScoped(current);
    expect(current.doc.width).toBe(16);
    expect(current.history.undoStack[0]?.byteSize).toBe(128);
    expect(current.history.redoStack).toHaveLength(0);

    current = { ...session(), history: createEditHistory(150) };
    current = commitImageSize(paint(current), 2, 2);
    expect(current.history.undoStack.map((entry) => entry.label)).toEqual(['Image size']);
    expect(current.history.trimmedCount).toBe(1);
  });

  it('budgets the large inverse when redoing a reduction and counts selection bytes', () => {
    let current = commitImageSize(session(), 16, 16);
    current = { ...withSelection(current, selectAllMask(16, 16)), history: createEditHistory(300) };
    current = commitImageSize(current, 2, 2);
    expect(current.history.undoStack[0]?.byteSize).toBe(16 * 16 * 9);
    current = undoScoped(current);
    expect(current.history.redoStack[0]?.byteSize).toBe(2 * 2 * 8);
    current = redoScoped(current);
    expect(current.doc.width).toBe(2);
    expect(current.history.undoStack).toHaveLength(1);
    expect(current.history.undoStack[0]?.byteSize).toBe(16 * 16 * 9);
    expect(current.history.redoStack).toHaveLength(0);
  });

  it('forks a new stroke after undo without sharing mutable restored buffers with history', () => {
    let current = commitImageSize(paint(session()), 8, 8);
    const resized = pixels(current);
    current = undoScoped(current);
    current = redoScoped(current);
    expect(pixels(current)).toEqual(resized);
    current = undoScoped(current);
    current = paint(current, 3, 3);
    expect(current.history.redoStack).toHaveLength(0);
    current = undoScoped(current);
    current = undoScoped(current);
    expect(pixels(current)).toEqual(pixels(session()));
  });
});
