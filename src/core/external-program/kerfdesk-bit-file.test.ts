import { describe, expect, it } from 'vitest';
import { tileBitHeader } from '../cnc/tile-bit-files';
import { kerfDeskBitFile } from './kerfdesk-bit-file';

const MOTION = 'G21 G90 G54\nG0 X5 Y5\n';

describe('kerfDeskBitFile', () => {
  it('reads a setup package per-bit header', () => {
    const text =
      '; bit 2 of 3: 6.35 mm (1/4") end mill\n' +
      '; keep the same X/Y zero; change to this bit and re-zero Z on the stock top before running this file\n' +
      '; KerfDesk\n' +
      MOTION;
    expect(kerfDeskBitFile(text)).toEqual({
      order: 2,
      count: 3,
      bitName: '6.35 mm (1/4") end mill',
    });
  });

  it('reads a multi-bit tile header, with CRLF line ends', () => {
    const header = tileBitHeader({ toolName: 'V-bit 60°', step: 1, steps: 2 });
    expect(kerfDeskBitFile((header + MOTION).replace(/\n/g, '\r\n'))).toEqual({
      order: 1,
      count: 2,
      bitName: 'V-bit 60°',
    });
  });

  it.each([
    ['a one-bit tile', tileBitHeader({ toolName: 'End mill', step: 1, steps: 1 }) + MOTION],
    ['a one-section file', '; bit 1 of 1: End mill\n' + MOTION],
    ['no header', MOTION],
    ['a header after the first command', 'G21\n; bit 1 of 2: End mill\n' + MOTION],
    ['an order past the count', '; bit 3 of 2: End mill\n' + MOTION],
  ])('is null for %s', (_, text) => {
    expect(kerfDeskBitFile(text)).toBeNull();
  });
});
