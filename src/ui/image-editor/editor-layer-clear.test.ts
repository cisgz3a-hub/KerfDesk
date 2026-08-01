import { describe, expect, it } from 'vitest';
import { RGBA_CHANNELS } from '../../core/image-edit';
import { rectSelection } from '../../core/image-select';
import { createEditorTestBuffer } from './create-editor-test-buffer';
import { BACKGROUND_LAYER_ID, clearEditorLayerInPlace } from './editor-layer-clear';

const MAX_BYTE = 255;
const PARTIAL_ALPHA = 200;
const HALF_MASK_ALPHA = 128;
const UPPER_LAYER_ID = 'text';

describe('clearEditorLayerInPlace', () => {
  it('clears upper-layer alpha without replacing straight RGB', () => {
    const buffer = createEditorTestBuffer(2, 1);
    buffer.data.set([10, 20, 30, PARTIAL_ALPHA], 0);
    const mask = rectSelection(2, 1, { x: 0, y: 0, width: 1, height: 1 });

    clearEditorLayerInPlace(buffer, UPPER_LAYER_ID, mask);

    expect(Array.from(buffer.data.slice(0, RGBA_CHANNELS))).toEqual([10, 20, 30, 0]);
  });

  it('applies feathered upper-layer selection alpha as destination-out', () => {
    const buffer = createEditorTestBuffer(1, 1);
    buffer.data.set([10, 20, 30, PARTIAL_ALPHA], 0);
    const mask = rectSelection(1, 1, { x: 0, y: 0, width: 1, height: 1 });
    mask.alpha[0] = HALF_MASK_ALPHA;

    clearEditorLayerInPlace(buffer, UPPER_LAYER_ID, mask);

    expect(buffer.data[RGBA_CHANNELS - 1]).toBe(100);
  });

  it('retains the opaque-white Background clear contract', () => {
    const buffer = createEditorTestBuffer(1, 1);
    buffer.data.set([10, 20, 30, PARTIAL_ALPHA], 0);
    const mask = rectSelection(1, 1, { x: 0, y: 0, width: 1, height: 1 });

    clearEditorLayerInPlace(buffer, BACKGROUND_LAYER_ID, mask);

    expect(Array.from(buffer.data)).toEqual([MAX_BYTE, MAX_BYTE, MAX_BYTE, MAX_BYTE]);
  });
});
