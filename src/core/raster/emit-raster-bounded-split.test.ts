import { describe, expect, it } from 'vitest';
import { emitRasterGroup } from './emit-raster';

const SPARSE_ROW = [500, 0, 0, 0, 0, 0, 0, 500];

function emittedXAtY(gcode: string, targetY: number): number[] {
  const xValues: number[] = [];
  let modalY: number | undefined;
  for (const line of gcode.split('\n')) {
    if (!/^G[01]\b/.test(line)) continue;
    const yMatch = /\bY(-?\d+(?:\.\d+)?)/.exec(line);
    if (yMatch?.[1] !== undefined) modalY = Number(yMatch[1]);
    const xMatch = /\bX(-?\d+(?:\.\d+)?)/.exec(line);
    if (xMatch?.[1] !== undefined && modalY === targetY) xValues.push(Number(xMatch[1]));
  }
  return xValues;
}

function sparseRaster(rows: number): string {
  return emitRasterGroup({
    sValues: new Uint16Array(Array.from({ length: rows }, () => SPARSE_ROW).flat()),
    width: SPARSE_ROW.length,
    height: rows,
    bounds: { minX: 0, minY: 0, maxX: SPARSE_ROW.length, maxY: rows },
    feedMmPerMin: 1500,
    overscanMm: 5,
    bidirectional: true,
    controlledLaserOffTravelFeedMmPerMin: 800,
  });
}

describe('emitRasterGroup bounded split runways', () => {
  it('never reverses inside a wide blank gap on a forward row', () => {
    const xValues = emittedXAtY(sparseRaster(1), 0.5);

    expect(xValues).toEqual([-5, 0, 1, 4, 4, 7, 8, 13]);
    expect(xValues).toEqual([...xValues].sort((a, b) => a - b));
  });

  it('mirrors the monotonic bounded-gap path on a reverse row', () => {
    const xValues = emittedXAtY(sparseRaster(2), 1.5);

    expect(xValues).toEqual([13, 8, 7, 4, 4, 1, 0, -5]);
    expect(xValues).toEqual([...xValues].sort((a, b) => b - a));
  });
});

// Under M3, GRBL drains its planner on a motion line whose target is the
// current position (grbl 1.1h motion_control.c:67-76, grblHAL
// motion_control.c:182-190), so the head stops there. Where two split runways
// meet, a coincident laser-off travel would stop the head between islands and
// force the braking that ADR-445 moved outside the burn back into it.
function coincidentMotionLines(gcode: string): string[] {
  const found: string[] = [];
  let x: number | null = null;
  let y: number | null = null;
  for (const line of gcode.split('\n')) {
    const code = line.replace(/;.*$/, '');
    const xMatch = /X(-?\d+(?:\.\d+)?)/.exec(code);
    const yMatch = /Y(-?\d+(?:\.\d+)?)/.exec(code);
    if (xMatch === null && yMatch === null) continue;
    const nextX: number | null = xMatch?.[1] === undefined ? x : Number(xMatch[1]);
    const nextY: number | null = yMatch?.[1] === undefined ? y : Number(yMatch[1]);
    if (nextX === x && nextY === y) found.push(line);
    x = nextX;
    y = nextY;
  }
  return found;
}

describe('emitRasterGroup shared split runways under constant power', () => {
  it.each([false, true])(
    'keeps moving through the shared runway point, bidirectional=%s',
    (bidirectional) => {
      const rows = 2;
      const gcode = emitRasterGroup({
        sValues: new Uint16Array(Array.from({ length: rows }, () => SPARSE_ROW).flat()),
        width: SPARSE_ROW.length,
        height: rows,
        bounds: { minX: 0, minY: 0, maxX: SPARSE_ROW.length, maxY: rows },
        feedMmPerMin: 1500,
        overscanMm: 5,
        bidirectional,
        laserModeCommand: 'M3',
      });

      expect(coincidentMotionLines(gcode)).toEqual([]);
      expect(emittedXAtY(gcode, 0.5)).toEqual([-5, 0, 1, 4, 7, 8, 13]);
      expect(emittedXAtY(gcode, 1.5)).toEqual(
        bidirectional ? [13, 8, 7, 4, 1, 0, -5] : [-5, 0, 1, 4, 7, 8, 13],
      );
    },
  );

  it('keeps the dynamic-power bytes, whose coincident travel does not stop GRBL', () => {
    expect(emittedXAtY(sparseRaster(1), 0.5)).toEqual([-5, 0, 1, 4, 4, 7, 8, 13]);
  });
});
