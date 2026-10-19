// ADR-636: the positioning light's offset in machine axes on every origin
// corner, and the Laser-mode-only rule for aiming with it.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import type { Origin } from '../../../core/devices/device-profile';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import { boardPointerConfigured, boardPointerOffsetMm } from './board-sight';

// The light sits 7 mm to the operator's right of the beam and 4 mm further
// from the operator (Machine Setup offsets are canvas bed axes, Y down).
const WITH_LIGHT: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  positioningLight: { onCommand: 'M7', offCommand: 'M9', offsetXmm: 7, offsetYmm: -4 },
};

describe('boardPointerOffsetMm', () => {
  // Machine +X runs to the operator's left on right origins; machine +Y runs
  // toward the operator on rear origins. Centre keeps front-left directions.
  it.each<[Origin, { x: number; y: number }]>([
    ['front-left', { x: 7, y: 4 }],
    ['front-right', { x: -7, y: 4 }],
    ['rear-left', { x: 7, y: -4 }],
    ['rear-right', { x: -7, y: -4 }],
    ['center', { x: 7, y: 4 }],
  ])('points the offset the physical way on a %s origin', (origin, expected) => {
    const offset = boardPointerOffsetMm({ ...WITH_LIGHT, origin });
    expect(offset.x).toBeCloseTo(expected.x, 9);
    expect(offset.y).toBeCloseTo(expected.y, 9);
  });

  it('is zero without a light', () => {
    const { positioningLight: _light, ...device } = WITH_LIGHT;
    expect(boardPointerOffsetMm(device)).toEqual({ x: 0, y: 0 });
  });
});

describe('boardPointerConfigured', () => {
  it('uses a configured light in Laser mode only', () => {
    expect(boardPointerConfigured(WITH_LIGHT, undefined)).toBe(true);
    // In CNC mode M7/M8 can be coolant, and the offset is from the beam.
    expect(boardPointerConfigured(WITH_LIGHT, DEFAULT_CNC_MACHINE_CONFIG)).toBe(false);
  });

  it('ignores file-only controllers and fan-mosfet profiles', () => {
    expect(boardPointerConfigured({ ...WITH_LIGHT, controllerKind: 'ruida' }, undefined)).toBe(
      false,
    );
    expect(
      boardPointerConfigured(
        { ...WITH_LIGHT, gcodeDialect: { dialectId: 'marlin-fan' } },
        undefined,
      ),
    ).toBe(false);
  });
});
