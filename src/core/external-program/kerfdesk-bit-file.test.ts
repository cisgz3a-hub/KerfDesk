import { describe, expect, it } from 'vitest';
import { tileBitHeader } from '../cnc/tile-bit-files';
import { kerfDeskBitFile } from './kerfdesk-bit-file';

const MOTION = 'G21 G90 G54\nG0 X5 Y5\n';
// A tile file's lines above its bit header: the metadata header, the machine
// profile, its assumptions and the tile line (tile-emission.ts). The real
// writers are pinned in tiled-bit-files.test.ts and cnc-tool-programs.test.ts.
const TILE_METADATA =
  [
    '; KerfDesk',
    '; version: 1.0.27',
    '; commit: adf300522',
    '; built: 2026-10-27T00:00:00Z',
    '; emitter: cnc-v34',
    '; profile-name: Generic GRBL router',
    '; profile-id: generic-grbl-router',
    '; profile-source: builtin',
    '; profile-catalog: 7',
    '; assumes: GRBL $30=24000 (S maps 1:1 to spindle RPM), $32=0 (router mode)',
    '; safety: retract to safe Z before travels; spindle spin-up dwell before first plunge',
    '; tile: row 1, column 2',
  ].join('\n') + '\n';

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

  // Rolling audit v5 J1-P2-1: a four-line read missed every tile's bit line.
  it('reads a multi-bit tile header below the metadata block, with CRLF line ends', () => {
    const header = tileBitHeader({ toolName: 'V-bit 60°', step: 1, steps: 2 });
    const text = TILE_METADATA + header + MOTION;
    expect(text.split('\n').indexOf(header.split('\n')[0]!)).toBe(12);
    expect(kerfDeskBitFile(text.replace(/\n/g, '\r\n'))).toEqual({
      order: 1,
      count: 2,
      bitName: 'V-bit 60°',
    });
  });

  it.each([
    [
      'a one-bit tile',
      TILE_METADATA + tileBitHeader({ toolName: 'End mill', step: 1, steps: 1 }) + MOTION,
    ],
    ['a one-section file', '; bit 1 of 1: End mill\n' + MOTION],
    ['no header', MOTION],
    ['a header after the first command', 'G21\n; bit 1 of 2: End mill\n' + MOTION],
    ['a header past the comment cap', '; note\n'.repeat(64) + '; bit 1 of 2: End mill\n' + MOTION],
    ['an order past the count', '; bit 3 of 2: End mill\n' + MOTION],
  ])('is null for %s', (_, text) => {
    expect(kerfDeskBitFile(text)).toBeNull();
  });
});
