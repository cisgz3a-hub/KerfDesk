import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from './falcon-profiles';
import { controllerAcceptsLaserArcs, laserArcMovesEnabled } from './laser-arc-moves';

const grbl: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };

describe('laser arc capability (ADR-407)', () => {
  it('enables arcs on the named GRBL family only', () => {
    expect(laserArcMovesEnabled(grbl)).toBe(true);
    expect(laserArcMovesEnabled({ ...grbl, controllerKind: 'grblhal' })).toBe(true);
    expect(laserArcMovesEnabled({ ...grbl, controllerKind: 'fluidnc' })).toBe(true);
    for (const kind of ['marlin', 'smoothieware', 'ruida'] as const) {
      expect(laserArcMovesEnabled({ ...grbl, controllerKind: kind })).toBe(false);
    }
  });

  it('keeps arcs off for a profile that names no controller', () => {
    expect(DEFAULT_DEVICE_PROFILE.controllerKind).toBeUndefined();
    expect(laserArcMovesEnabled(DEFAULT_DEVICE_PROFILE)).toBe(false);
  });

  it('keeps arcs off for vendor command sets and the 4040-safe dialect', () => {
    expect(laserArcMovesEnabled(FALCON_A1_PRO_GRBLHAL_PROFILE)).toBe(false);
    const safe = { ...grbl, gcodeDialect: { dialectId: 'neotronics-4040-safe' as const } };
    expect(laserArcMovesEnabled(safe)).toBe(false);
    const unknown = { ...grbl, gcodeDialect: { dialectId: 'not-a-dialect' as never } };
    expect(laserArcMovesEnabled(unknown)).toBe(false);
  });

  it('honours the operator switch and an enabled rotary', () => {
    expect(laserArcMovesEnabled({ ...grbl, laserArcMoves: 'off' })).toBe(false);
    expect(controllerAcceptsLaserArcs({ ...grbl, laserArcMoves: 'off' })).toBe(true);
    const rotary = {
      ...grbl,
      rotary: { enabled: true, type: 'roller' as const, mmPerRotation: 100, objectDiameterMm: 40 },
    };
    expect(laserArcMovesEnabled(rotary)).toBe(false);
  });
});
