// Marlin's M114 prints one label per configured axis and the logical position,
// with the G92 shift applied (Marlin 2.1.2.8 motion.cpp:192-212
// report_logical_position, `rpos.asLogical()`). A build without Z prints X and
// Y only; KerfDesk treated that board as never answering (controller audit
// 2026-09-25 MA-6). The position is the work position; KerfDesk keeps the
// shift itself (host-recorded-origin.ts, MA-2).
import { describe, expect, it } from 'vitest';
import { classifyMarlinResponse } from './response';

describe('Marlin M114 position report', () => {
  it.each(['X:10.00 Y:5.00 Count X:800 Y:400', 'X:10.00 Y:5.00 E:0.00 Count X:800 Y:400'])(
    'parses %s from a build without Z as a work position with Z 0',
    (line) => {
      expect(classifyMarlinResponse(line)).toMatchObject({
        kind: 'status',
        report: { mPos: null, wPos: { x: 10, y: 5, z: 0 }, wco: null },
      });
    },
  );

  it('parses X, Y and Z as the work position', () => {
    expect(
      classifyMarlinResponse('X:10.00 Y:5.00 Z:1.50 E:0.00 Count X:800 Y:400 Z:600'),
    ).toMatchObject({ kind: 'status', report: { mPos: null, wPos: { x: 10, y: 5, z: 1.5 } } });
  });
});
