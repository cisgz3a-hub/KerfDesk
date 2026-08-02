import { describe, expect, it } from 'vitest';
import { scanModalMotionLine } from './modal-motion-line';

describe('scanModalMotionLine', () => {
  it('reads compact explicit motion without whitespace', () => {
    expect(scanModalMotionLine('G1X1.000Y2.000Z-0.500', 0)).toEqual({
      motion: 1,
      hasTarget: true,
      isMotionContext: true,
      isMotion: true,
    });
  });

  it('inherits motion on a coordinate-only block', () => {
    expect(scanModalMotionLine('X2.000Y3.000Z-0.250', 1)).toEqual({
      motion: 1,
      hasTarget: true,
      isMotionContext: true,
      isMotion: true,
    });
  });

  it('cancels inherited motion after G80', () => {
    expect(scanModalMotionLine('G80X2.000', 1)).toEqual({
      motion: null,
      hasTarget: true,
      isMotionContext: false,
      isMotion: false,
    });
  });

  it('does not reinterpret coordinate-setting axes as inherited motion', () => {
    expect(scanModalMotionLine('G10L20P1X2.000Y3.000', 1)).toEqual({
      motion: 1,
      hasTarget: true,
      isMotionContext: false,
      isMotion: false,
    });
    expect(scanModalMotionLine('G92X0Y0', 0)).toEqual({
      motion: 0,
      hasTarget: true,
      isMotionContext: false,
      isMotion: false,
    });
    expect(scanModalMotionLine('G43.1Z12.000', 1)).toEqual({
      motion: 1,
      hasTarget: true,
      isMotionContext: false,
      isMotion: false,
    });
  });

  it('does not inherit an earlier move after an unsupported probe mode', () => {
    expect(scanModalMotionLine('G38.2Z-10F100', 1)).toEqual({
      motion: null,
      hasTarget: true,
      isMotionContext: false,
      isMotion: false,
    });
  });
});
