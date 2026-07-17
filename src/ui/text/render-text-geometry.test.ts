import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadFont: vi.fn(async () => new ArrayBuffer(8)),
}));

vi.mock('./font-loader', () => ({
  loadFont: mocks.loadFont,
}));

import { renderTextGeometry } from './render-text-geometry';

describe('renderTextGeometry CNC stroke-font routing', () => {
  beforeEach(() => mocks.loadFont.mockClear());

  it('renders bundled single-line geometry without loading an outline font file', async () => {
    const rendered = await renderTextGeometry({
      fontKey: 'ems-decorous-script',
      embeddedFonts: undefined,
      content: 'Maker',
      sizeMm: 12,
      alignment: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      color: '#101010',
    });

    expect(mocks.loadFont).not.toHaveBeenCalled();
    expect(rendered.paths[0]?.polylines.length).toBeGreaterThan(0);
    expect(rendered.paths[0]?.polylines.every((polyline) => !polyline.closed)).toBe(true);
  });
});
