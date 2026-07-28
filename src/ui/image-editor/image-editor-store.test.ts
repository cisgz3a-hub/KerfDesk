import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_AFFINE } from '../../core/image-edit';
import { createRgbaBuffer, RGBA_CHANNELS } from '../../core/image-edit/rgba-buffer';
import { createSession } from './editor-session';
import { addLayerAboveActive } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';
import type * as ImageEditorDecode from './image-editor-decode';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const ALPHA_CHANNEL = 3;
const PARTIAL_ALPHA = 64;
const CANCEL_ROTATION_DEG = 45;
const EXPECTED_PARTIAL_BLACK_OVER_WHITE = 191;

interface AppliedCompositeCapture {
  data: Uint8ClampedArray | null;
}

const appliedComposite = vi.hoisted<AppliedCompositeCapture>(() => ({ data: null }));

vi.mock('./image-editor-decode', async (importOriginal) => {
  const original = await importOriginal<typeof ImageEditorDecode>();
  return {
    ...original,
    bakeBufferToBitmapFields: vi.fn(async (doc: { readonly data: Uint8ClampedArray }) => {
      appliedComposite.data = Uint8ClampedArray.from(doc.data);
      return {
        dataUrl: 'data:image/png;base64,alpha-test',
        lumaBase64: 'AAAA',
      };
    }),
  };
});

// White doc with a grey 4×4 rect at (2,2) on the Background.
function seedSession(): void {
  const doc = createRgbaBuffer(10, 10);
  for (let y = 2; y < 6; y += 1) {
    for (let x = 2; x < 6; x += 1) {
      const base = (y * 10 + x) * 4;
      doc.data[base] = 80;
      doc.data[base + 1] = 80;
      doc.data[base + 2] = 80;
    }
  }
  useImageEditorStore.setState({
    session: createSession('obj-1', 'test.png', doc, BOUNDS),
    transform: null,
    selectionMode: 'replace',
    selectionFeather: 0,
    wandTolerance: 32,
    wandContiguous: true,
  });
}

function selectedCount(): number {
  const selection = useImageEditorStore.getState().session?.selection ?? null;
  if (selection === null) return 0;
  let count = 0;
  for (const alpha of selection.alpha) if (alpha > 0) count += 1;
  return count;
}

beforeEach(() => {
  appliedComposite.data = null;
  useImageEditorStore.setState({ session: null, transform: null, stash: {} });
});

describe('wandAt', () => {
  it('selects the visible region on a single-layer session', () => {
    seedSession();
    useImageEditorStore.getState().wandAt(3, 3);
    expect(selectedCount()).toBe(16);
  });

  it('samples the COMPOSITE when a transparent layer is active (ADR-245)', () => {
    seedSession();
    const { session } = useImageEditorStore.getState();
    if (session === null) throw new Error('seed failed');
    useImageEditorStore.setState({ session: addLayerAboveActive(session, 'l1') });
    // The click lands on the VISIBLE grey rect; sampling the transparent
    // active layer instead would select the entire document.
    useImageEditorStore.getState().wandAt(3, 3);
    expect(selectedCount()).toBe(16);
  });
});

describe('free transform', () => {
  it('preserves upper-layer alpha through the store start and commit seam', () => {
    seedSession();
    const seeded = useImageEditorStore.getState().session;
    if (seeded === null) throw new Error('seed failed');
    const session = addLayerAboveActive(seeded, 'text');
    const source = (2 * session.doc.width + 2) * RGBA_CHANNELS;
    session.doc.data.set([10, 20, 240, PARTIAL_ALPHA], source);
    useImageEditorStore.setState({ session, transform: null });

    useImageEditorStore.getState().startTransform();
    useImageEditorStore.getState().updateTransformAffine({
      ...IDENTITY_AFFINE,
      translateX: 1,
    });
    useImageEditorStore.getState().commitTransform();

    const committed = useImageEditorStore.getState();
    if (committed.session === null) throw new Error('commit lost session');
    const destination = (2 * committed.session.doc.width + 3) * RGBA_CHANNELS;
    expect(committed.transform).toBeNull();
    expect(committed.session.doc.data[source + ALPHA_CHANNEL]).toBe(0);
    expect(
      Array.from(committed.session.doc.data.slice(destination, destination + RGBA_CHANNELS)),
    ).toEqual([10, 20, 240, PARTIAL_ALPHA]);
    expect(committed.session.history.undoStack).toHaveLength(1);
  });

  it('cancels without mutating pixels or history', () => {
    seedSession();
    const session = useImageEditorStore.getState().session;
    if (session === null) throw new Error('seed failed');
    const original = Uint8ClampedArray.from(session.doc.data);

    useImageEditorStore.getState().startTransform();
    useImageEditorStore.getState().updateTransformAffine({
      ...IDENTITY_AFFINE,
      rotateDeg: CANCEL_ROTATION_DEG,
    });
    useImageEditorStore.getState().cancelTransform();

    const cancelled = useImageEditorStore.getState();
    expect(cancelled.transform).toBeNull();
    expect(Array.from(cancelled.session?.doc.data ?? [])).toEqual(Array.from(original));
    expect(cancelled.session?.history.undoStack).toHaveLength(0);
  });

  it('clears a transform draft when the editor closes', () => {
    seedSession();
    useImageEditorStore.getState().startTransform();
    expect(useImageEditorStore.getState().transform).not.toBeNull();

    useImageEditorStore.getState().closeEditor();

    expect(useImageEditorStore.getState().session).toBeNull();
    expect(useImageEditorStore.getState().transform).toBeNull();
  });

  it('bakes the transformed layer composite rather than the active layer alone', async () => {
    const documentSize = 4;
    const sourceX = 1;
    const sourceY = 1;
    const destinationX = 2;
    const background = createRgbaBuffer(documentSize, documentSize);
    const session = addLayerAboveActive(
      createSession('object', 'source.png', background, {
        minX: 0,
        minY: 0,
        maxX: documentSize,
        maxY: documentSize,
      }),
      'text',
    );
    const source = (sourceY * session.doc.width + sourceX) * RGBA_CHANNELS;
    session.doc.data.set([0, 0, 0, PARTIAL_ALPHA], source);
    useImageEditorStore.setState({ session, transform: null });

    useImageEditorStore.getState().startTransform();
    useImageEditorStore.getState().updateTransformAffine({
      ...IDENTITY_AFFINE,
      translateX: 1,
    });
    useImageEditorStore.getState().commitTransform();
    useImageEditorStore.getState().apply();

    await vi.waitFor(() => expect(appliedComposite.data).not.toBeNull());
    const baked = appliedComposite.data;
    if (baked === null) throw new Error('Apply did not receive a composite');
    const destination = (sourceY * documentSize + destinationX) * RGBA_CHANNELS;
    expect(Array.from(baked.slice(source, source + RGBA_CHANNELS))).toEqual([255, 255, 255, 255]);
    expect(Array.from(baked.slice(destination, destination + RGBA_CHANNELS))).toEqual([
      EXPECTED_PARTIAL_BLACK_OVER_WHITE,
      EXPECTED_PARTIAL_BLACK_OVER_WHITE,
      EXPECTED_PARTIAL_BLACK_OVER_WHITE,
      255,
    ]);
  });
});
