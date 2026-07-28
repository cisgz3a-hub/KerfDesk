import { describe, expect, it } from 'vitest';
import { RGBA_CHANNELS } from '../../core/image-edit';
import { rectSelection } from '../../core/image-select';
import { createEditorTestBuffer } from './create-editor-test-buffer';
import { createSession, withSelection } from './editor-session';
import {
  addLayerAboveActive,
  compositeSession,
  setActiveLayer,
  undoScoped,
} from './editor-session-layers';
import {
  commitEditorTransform,
  startEditorTransform,
  type EditorTransformSession,
} from './editor-transform-session';

const DOCUMENT_SIZE = 4;
const MAX_BYTE = 255;
const ALPHA_CHANNEL = 3;
const PARTIAL_ALPHA = 64;
const HALF_ALPHA = 128;
const PATTERN_GREY = 90;
const BOUNDS = { minX: 0, minY: 0, maxX: DOCUMENT_SIZE, maxY: DOCUMENT_SIZE };

function pixelBase(x: number, y: number): number {
  return (y * DOCUMENT_SIZE + x) * RGBA_CHANNELS;
}

function setPixel(
  session: ReturnType<typeof createSession>,
  x: number,
  y: number,
  rgba: readonly [number, number, number, number],
): void {
  session.doc.data.set(rgba, pixelBase(x, y));
}

function alphaAt(session: ReturnType<typeof createSession>, x: number, y: number): number {
  return session.doc.data[pixelBase(x, y) + ALPHA_CHANNEL] ?? -1;
}

function textSession(): ReturnType<typeof createSession> {
  const background = createEditorTestBuffer(DOCUMENT_SIZE, DOCUMENT_SIZE);
  for (let offset = 0; offset < background.data.length; offset += RGBA_CHANNELS) {
    background.data[offset] = PATTERN_GREY;
    background.data[offset + 1] = PATTERN_GREY;
    background.data[offset + 2] = PATTERN_GREY;
  }
  const base = createSession('object', 'source.png', background, BOUNDS);
  const session = addLayerAboveActive(base, 'text');
  setPixel(session, 1, 1, [0, 0, 0, MAX_BYTE]);
  setPixel(session, 2, 1, [0, 0, 0, PARTIAL_ALPHA]);
  setPixel(session, 1, 2, [MAX_BYTE, MAX_BYTE, MAX_BYTE, HALF_ALPHA]);
  return session;
}

function translated(transform: EditorTransformSession): EditorTransformSession {
  return { ...transform, affine: { ...transform.affine, translateX: 1 } };
}

describe('editor transform session', () => {
  it('moves a transparent text layer without making its document rectangle opaque', () => {
    const session = textSession();
    const original = Uint8ClampedArray.from(session.doc.data);
    const transform = startEditorTransform(session);
    if (transform === null) throw new Error('expected transform');
    const committed = commitEditorTransform(session, translated(transform));

    expect(alphaAt(committed, 1, 1)).toBe(0);
    expect(alphaAt(committed, 2, 1)).toBe(MAX_BYTE);
    expect(alphaAt(committed, 3, 1)).toBe(PARTIAL_ALPHA);
    expect(alphaAt(committed, 2, 2)).toBe(HALF_ALPHA);
    expect(alphaAt(committed, 0, 0)).toBe(0);
    expect(committed.history.undoStack).toHaveLength(1);

    const composite = compositeSession(committed);
    expect(composite.data[pixelBase(0, 0)]).toBe(PATTERN_GREY);
    expect(composite.data[pixelBase(2, 2)]).toBeGreaterThan(PATTERN_GREY);
    expect(composite.data[pixelBase(2, 2)]).toBeLessThan(MAX_BYTE);

    const undone = undoScoped(committed);
    expect(Array.from(undone.doc.data)).toEqual(Array.from(original));
  });

  it('clears and moves only an explicit selection on an upper layer', () => {
    let session = textSession();
    session = withSelection(
      session,
      rectSelection(DOCUMENT_SIZE, DOCUMENT_SIZE, { x: 1, y: 1, width: 1, height: 1 }),
    );
    const transform = startEditorTransform(session);
    if (transform === null) throw new Error('expected transform');
    const committed = commitEditorTransform(session, translated(transform));
    expect(alphaAt(committed, 1, 1)).toBe(0);
    expect(alphaAt(committed, 2, 1)).toBe(MAX_BYTE);
    expect(alphaAt(committed, 3, 1)).toBe(0);
  });

  it('retains opaque-white source clearing for the Background layer', () => {
    let session = createSession(
      'object',
      'source.png',
      createEditorTestBuffer(DOCUMENT_SIZE, DOCUMENT_SIZE),
      BOUNDS,
    );
    setPixel(session, 1, 1, [0, 0, 0, MAX_BYTE]);
    session = withSelection(
      session,
      rectSelection(DOCUMENT_SIZE, DOCUMENT_SIZE, { x: 1, y: 1, width: 1, height: 1 }),
    );
    const transform = startEditorTransform(session);
    if (transform === null) throw new Error('expected transform');
    const committed = commitEditorTransform(session, translated(transform));
    expect(Array.from(committed.doc.data.slice(pixelBase(1, 1), pixelBase(1, 1) + 4))).toEqual([
      MAX_BYTE,
      MAX_BYTE,
      MAX_BYTE,
      MAX_BYTE,
    ]);
    expect(alphaAt(committed, 2, 1)).toBe(MAX_BYTE);
  });

  it('returns the same session for an identity transform', () => {
    const session = textSession();
    const transform = startEditorTransform(session);
    if (transform === null) throw new Error('expected transform');
    expect(commitEditorTransform(session, transform)).toBe(session);
  });

  it('rejects a transform after the active layer changes', () => {
    const session = textSession();
    const transform = startEditorTransform(session);
    if (transform === null) throw new Error('expected transform');
    const backgroundId = session.layers[0]?.id;
    if (backgroundId === undefined) throw new Error('expected Background');
    const switched = setActiveLayer(session, backgroundId);

    expect(commitEditorTransform(switched, translated(transform))).toBe(switched);
  });

  it('rejects a transform owned by another image session', () => {
    const source = textSession();
    const transform = startEditorTransform(source);
    if (transform === null) throw new Error('expected transform');
    const replacement = createSession(
      'replacement',
      'replacement.png',
      createEditorTestBuffer(DOCUMENT_SIZE, DOCUMENT_SIZE),
      BOUNDS,
    );

    expect(commitEditorTransform(replacement, translated(transform))).toBe(replacement);
  });

  it('rejects a transform after the source layer revision changes', () => {
    const session = textSession();
    const transform = startEditorTransform(session);
    if (transform === null) throw new Error('expected transform');
    const revised = { ...session, revision: session.revision + 1 };

    expect(commitEditorTransform(revised, translated(transform))).toBe(revised);
  });

  it('rejects a replacement document with the same ownership labels and revision', () => {
    const source = createSession(
      'object',
      'source.png',
      createEditorTestBuffer(DOCUMENT_SIZE, DOCUMENT_SIZE),
      BOUNDS,
    );
    setPixel(source, 1, 1, [0, 0, 0, MAX_BYTE]);
    const transform = startEditorTransform(source);
    if (transform === null) throw new Error('expected transform');
    const replacement = createSession(
      source.objectId,
      source.sourceName,
      createEditorTestBuffer(DOCUMENT_SIZE, DOCUMENT_SIZE),
      BOUNDS,
    );

    expect(replacement.activeLayerId).toBe(source.activeLayerId);
    expect(replacement.revision).toBe(source.revision);
    expect(commitEditorTransform(replacement, translated(transform))).toBe(replacement);
    expect(replacement.history.undoStack).toHaveLength(0);
  });
});
