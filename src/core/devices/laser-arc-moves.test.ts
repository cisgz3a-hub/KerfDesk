import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';
import { XTOOL_D1_PRO_PROFILES } from './brand-laser-profiles';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from './device-profile';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';
import {
  controllerAcceptsLaserArcs,
  laserArcMovesDefaultOn,
  laserArcMovesEnabled,
} from './laser-arc-moves';
import { GRBL_MACHINE_PROFILE_CATALOG } from './profile-catalog';

const grbl: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };

describe('laser arc capability (ADR-407)', () => {
  it('enables arcs on generic profiles of the named GRBL family only', () => {
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

  it('defaults arcs off for brand machine profiles and the grbl-compatible dialect', () => {
    for (const profile of [
      ...XTOOL_D1_PRO_PROFILES,
      FALCON_COMPATIBLE_PROFILE,
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    ]) {
      expect(laserArcMovesEnabled(profile)).toBe(false);
    }
    const brand = { ...grbl, vendor: 'Sculpfun' };
    expect(laserArcMovesDefaultOn(brand)).toBe(false);
    expect(laserArcMovesEnabled({ ...brand, laserArcMoves: 'on' })).toBe(true);
    const compatible = { ...grbl, gcodeDialect: { dialectId: 'grbl-compatible' as const } };
    expect(laserArcMovesEnabled(compatible)).toBe(false);
    expect(laserArcMovesEnabled({ ...compatible, laserArcMoves: 'on' })).toBe(true);
    for (const profile of GRBL_MACHINE_PROFILE_CATALOG.map((entry) => entry.profile)) {
      const generic = profile.vendor === undefined || profile.vendor === 'Generic';
      if (laserArcMovesEnabled(profile)) expect(generic).toBe(true);
    }
  });

  it('never turns arcs on where the controller family does not take them', () => {
    expect(laserArcMovesEnabled({ ...DEFAULT_DEVICE_PROFILE, laserArcMoves: 'on' })).toBe(false);
    expect(laserArcMovesEnabled({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, laserArcMoves: 'on' })).toBe(
      false,
    );
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
