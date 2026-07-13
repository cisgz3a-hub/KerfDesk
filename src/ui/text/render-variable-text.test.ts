import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreText from '../../core/text';
import { IDENTITY_TRANSFORM, type EmbeddedFont, type TextObject } from '../../core/scene';

const mocks = vi.hoisted(() => ({
  loadFont: vi.fn(async () => new ArrayBuffer(8)),
  textToPolylines: vi.fn(async () => ({
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    paths: [{ color: '#000000', polylines: [] }],
  })),
  bendTextRender: vi.fn((rendered: unknown) => rendered),
}));

vi.mock('./font-loader', () => ({ loadFont: mocks.loadFont }));
vi.mock('../../core/text', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreText>()),
  textToPolylines: mocks.textToPolylines,
  bendTextRender: mocks.bendTextRender,
}));

import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { renderVariableText } from './render-variable-text';

const FONT: EmbeddedFont = {
  key: 'embedded:variable',
  fileName: 'Variable.otf',
  dataBase64: 'T1RUTwABAgM=',
};

const TEXT: TextObject = {
  kind: 'text',
  id: 'variable-text',
  content: '{serial}',
  fontKey: FONT.key,
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  bendDeg: -45,
  color: '#000000',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
};

describe('renderVariableText', () => {
  beforeEach(() => {
    resetStore();
    mocks.loadFont.mockClear();
    mocks.textToPolylines.mockClear();
    mocks.bendTextRender.mockClear();
  });

  it('uses embedded project fonts and reapplies bend to evaluated content', async () => {
    useStore.setState((state) => ({ project: { ...state.project, embeddedFonts: [FONT] } }));

    await renderVariableText({ text: TEXT, content: '0042', project: useStore.getState().project });

    expect(mocks.loadFont).toHaveBeenCalledWith(FONT.key, [FONT]);
    expect(mocks.textToPolylines).toHaveBeenCalledWith(
      expect.objectContaining({ content: '0042' }),
    );
    expect(mocks.bendTextRender).toHaveBeenCalledWith(expect.anything(), -45);
  });
});
