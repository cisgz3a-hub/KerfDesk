import { describe, expect, it } from 'vitest';
import {
  ALONG_X_SCAN_FRAME,
  isAlongXScan,
  machineToScan,
  normalizedScanAngleDeg,
  rasterScanFrame,
  scanFrameBoundsOf,
  scanRectMachineCorners,
  scanToMachine,
} from './raster-scan-frame';

describe('raster scan frame (ADR-492)', () => {
  it.each([
    [undefined, 0],
    [Number.NaN, 0],
    [0, 0],
    [-0, 0],
    [180, 0],
    [-180, 0],
    [360, 0],
    [45, 45],
    [225, 45],
    [-45, 135],
    [179.5, 179.5],
  ])('folds %s degrees to %s', (input, expected) => {
    expect(Object.is(normalizedScanAngleDeg(input), expected)).toBe(true);
  });

  it('scans along X at 0 and 180 degrees with the identity frame', () => {
    expect(rasterScanFrame(0)).toBe(ALONG_X_SCAN_FRAME);
    expect(rasterScanFrame(180)).toBe(ALONG_X_SCAN_FRAME);
    expect(rasterScanFrame(undefined)).toBe(ALONG_X_SCAN_FRAME);
    const p = { x: 3, y: 4 };
    expect(scanToMachine(ALONG_X_SCAN_FRAME, p)).toBe(p);
    expect(machineToScan(ALONG_X_SCAN_FRAME, p)).toBe(p);
  });

  it('scans exactly along +Y at 90 degrees, counter-clockwise like the hatch angle', () => {
    const frame = rasterScanFrame(90);
    expect(isAlongXScan(frame)).toBe(false);
    expect(frame).toEqual({ angleDeg: 90, cos: 0, sin: 1 });
    expect(scanToMachine(frame, { x: 2, y: 0 })).toEqual({ x: 0, y: 2 });
    expect(scanToMachine(frame, { x: 0, y: 1 })).toEqual({ x: -1, y: 0 });
  });

  it('round-trips points through the frame at any angle', () => {
    for (const angle of [15, 45, 90, 120, 179]) {
      const frame = rasterScanFrame(angle);
      const p = { x: 12.5, y: -7.25 };
      const back = scanToMachine(frame, machineToScan(frame, p));
      expect(back.x).toBeCloseTo(p.x, 12);
      expect(back.y).toBeCloseTo(p.y, 12);
    }
  });

  it('bounds machine points in the scan frame and maps the rectangle back around them', () => {
    const frame = rasterScanFrame(45);
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const rect = scanFrameBoundsOf(frame, square);
    const diagonal = Math.SQRT2 * 10;
    expect(rect.maxX - rect.minX).toBeCloseTo(diagonal, 9);
    expect(rect.maxY - rect.minY).toBeCloseTo(diagonal, 9);
    const corners = scanRectMachineCorners(frame, rect);
    for (const p of square) {
      const s = machineToScan(frame, p);
      expect(s.x).toBeGreaterThanOrEqual(rect.minX - 1e-9);
      expect(s.x).toBeLessThanOrEqual(rect.maxX + 1e-9);
    }
    expect(Math.min(...corners.map((c) => c.x))).toBeCloseTo(-5, 9);
    expect(Math.max(...corners.map((c) => c.x))).toBeCloseTo(15, 9);
  });
});
