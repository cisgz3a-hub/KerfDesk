import { beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { createSession } from './editor-session';
import { addLayerAboveActive } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

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
  useImageEditorStore.setState({ session: null, transform: null });
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
