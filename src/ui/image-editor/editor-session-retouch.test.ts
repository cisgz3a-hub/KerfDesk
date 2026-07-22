import { beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { createSession } from './editor-session';
import { addLayerAboveActive } from './editor-session-layers';
import { applyCloneStroke, commitHealDab } from './editor-session-retouch';
import { useImageEditorStore } from './image-editor-store';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

// Background with a grey-40 block at (10..13, 10..13).
function blockSession() {
  const doc = createRgbaBuffer(32, 32);
  for (let y = 10; y < 14; y += 1) {
    for (let x = 10; x < 14; x += 1) {
      const base = (y * 32 + x) * 4;
      doc.data[base] = 40;
      doc.data[base + 1] = 40;
      doc.data[base + 2] = 40;
    }
  }
  return createSession('obj-1', 'test.png', doc, BOUNDS);
}

beforeEach(() => {
  useImageEditorStore.setState({
    session: null,
    transform: null,
    brush: { diameterPx: 8, hardness: 1, opacity: 1 },
  });
});

describe('applyCloneStroke (aligned offset)', () => {
  it('first stroke fixes source − firstPoint and clones the composite', () => {
    useImageEditorStore.setState({
      session: blockSession(),
      tool: { kind: 'clone', source: { x: 12, y: 12 }, offset: null },
    });
    applyCloneStroke([{ x: 24, y: 24 }]);
    const state = useImageEditorStore.getState();
    // Offset persisted on the tool: (12−24, 12−24) = (−12, −12).
    expect(state.tool).toEqual({
      kind: 'clone',
      source: { x: 12, y: 12 },
      offset: { x: -12, y: -12 },
    });
    expect(state.session?.doc.data[(24 * 32 + 24) * 4]).toBe(40);
    expect(state.session?.history.undoStack.length).toBe(1);
    expect(state.session?.history.undoStack[0]?.label).toBe('Clone stamp');
  });

  it('later strokes reuse the aligned offset', () => {
    useImageEditorStore.setState({
      session: blockSession(),
      tool: { kind: 'clone', source: { x: 12, y: 12 }, offset: { x: -12, y: -12 } },
    });
    // Painting at (25, 24) with the SAME offset reads source (13, 12).
    applyCloneStroke([{ x: 25, y: 24 }]);
    const state = useImageEditorStore.getState();
    expect(state.session?.doc.data[(24 * 32 + 25) * 4]).toBe(40);
    expect(state.tool).toEqual({
      kind: 'clone',
      source: { x: 12, y: 12 },
      offset: { x: -12, y: -12 },
    });
  });

  it('clone samples the composite: an upper layer sees the Background block', () => {
    useImageEditorStore.setState({
      session: addLayerAboveActive(blockSession(), 'l1'),
      tool: { kind: 'clone', source: { x: 12, y: 12 }, offset: null },
    });
    applyCloneStroke([{ x: 24, y: 24 }]);
    const session = useImageEditorStore.getState().session;
    // Ink landed on the transparent ACTIVE layer, copied from the composite.
    expect(session?.doc.data[(24 * 32 + 24) * 4]).toBe(40);
    expect(session?.doc.data[(24 * 32 + 24) * 4 + 3]).toBe(255);
    expect(session?.layers[0]?.buffer.data[(24 * 32 + 24) * 4]).toBe(255);
  });
});

describe('commitHealDab', () => {
  it('heals a speck into the surround as one scoped entry', () => {
    const doc = createRgbaBuffer(40, 40);
    for (let i = 0; i < doc.data.length; i += 4) {
      doc.data[i] = 180;
      doc.data[i + 1] = 180;
      doc.data[i + 2] = 180;
    }
    const base = (20 * 40 + 20) * 4;
    doc.data[base] = 0;
    doc.data[base + 1] = 0;
    doc.data[base + 2] = 0;
    const session = commitHealDab(
      createSession('obj-1', 'test.png', doc, BOUNDS),
      { x: 20, y: 20 },
      4,
    );
    expect(session.doc.data[base]).toBe(180);
    expect(session.history.undoStack.length).toBe(1);
    expect(session.history.undoStack[0]?.label).toBe('Spot heal');
  });
});
