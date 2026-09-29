// Surfacing starter values stay at or below the long-standing conservative
// surfacing defaults even when the generic material calculator proposes a
// slotting-grade stepdown for a large facing cutter (ADR-457 Amd 1).

import { describe, expect, it } from 'vitest';
import { cncMaxFeedMmPerMin } from '../../core/cnc/cnc-head-feeds';
import {
  SURFACING_DEFAULT_DEPTH_PER_PASS_MM,
  SURFACING_DEFAULT_FEED_MM_PER_MIN,
  SURFACING_DEFAULT_PLUNGE_MM_PER_MIN,
  surfacingStarterValues,
} from '../../core/cnc/surfacing';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices/device-profile';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncMachineConfig, type CncTool } from '../../core/scene';
import { materialFeedsPatch } from '../state/cnc-project-material';
import { surfacingSeed } from './surfacing-seed';

const SURFACING_BIT: CncTool = {
  id: 'surfacing-25',
  name: '25.4 mm surfacing bit',
  kind: 'end-mill',
  diameterMm: 25.4,
};

function calculated(materialKey: string) {
  return materialFeedsPatch({
    materialKey,
    tool: SURFACING_BIT,
    spindleRpm: DEFAULT_CNC_MACHINE_CONFIG.params.spindleMaxRpm,
    profile: DEFAULT_DEVICE_PROFILE,
    machineParams: DEFAULT_CNC_MACHINE_CONFIG.params,
  });
}

describe('surfacingStarterValues', () => {
  it('keeps the previous defaults when no material is set', () => {
    expect(surfacingStarterValues(null, 10_000)).toEqual({
      feedMmPerMin: SURFACING_DEFAULT_FEED_MM_PER_MIN,
      plungeMmPerMin: SURFACING_DEFAULT_PLUNGE_MM_PER_MIN,
      depthPerPassMm: SURFACING_DEFAULT_DEPTH_PER_PASS_MM,
    });
  });

  it('caps a 25.4 mm softwood calculator result at the conservative surfacing values', () => {
    const raw = calculated('softwood');
    // The regression: the generic calculator proposes a half-diameter pass.
    expect(raw?.depthPerPassMm ?? 0).toBeGreaterThan(SURFACING_DEFAULT_DEPTH_PER_PASS_MM);
    const maxFeed = cncMaxFeedMmPerMin(DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG.params);
    const seed = surfacingStarterValues(raw, maxFeed);
    expect(seed.depthPerPassMm).toBeLessThanOrEqual(SURFACING_DEFAULT_DEPTH_PER_PASS_MM);
    expect(seed.feedMmPerMin).toBeLessThanOrEqual(SURFACING_DEFAULT_FEED_MM_PER_MIN);
    expect(seed.plungeMmPerMin).toBeLessThanOrEqual(SURFACING_DEFAULT_PLUNGE_MM_PER_MIN);
  });

  it('lets the calculator lower a value but never raise one', () => {
    expect(
      surfacingStarterValues(
        { feedMmPerMin: 900, plungeMmPerMin: 5000, depthPerPassMm: 0.2 },
        10_000,
      ),
    ).toEqual({ feedMmPerMin: 900, plungeMmPerMin: 600, depthPerPassMm: 0.2 });
  });

  it('never exceeds the machine max feed', () => {
    const seed = surfacingStarterValues(null, 400);
    expect(seed.feedMmPerMin).toBe(400);
    expect(seed.plungeMmPerMin).toBe(400);
  });
});

describe('surfacingSeed', () => {
  const machine: CncMachineConfig = {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, SURFACING_BIT],
    toolId: SURFACING_BIT.id,
    stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, materialKey: 'plywood-mdf' },
  };
  const device = NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE;

  it('keeps the 4040 starter, a recipe for a 3.175 mm cutter, out of a facing pass', () => {
    // Layers still take the starter's 300 mm/min ceiling (ADR-256).
    const layerValues = materialFeedsPatch({
      materialKey: 'plywood-mdf',
      tool: SURFACING_BIT,
      spindleRpm: machine.params.spindleMaxRpm,
      profile: device,
      machineParams: machine.params,
    });
    expect(layerValues?.feedMmPerMin).toBe(300);

    expect(surfacingSeed(machine, { device }, null).seed).toEqual({
      feedMmPerMin: SURFACING_DEFAULT_FEED_MM_PER_MIN,
      plungeMmPerMin: SURFACING_DEFAULT_PLUNGE_MM_PER_MIN,
      depthPerPassMm: SURFACING_DEFAULT_DEPTH_PER_PASS_MM,
    });
  });

  it('still honours the live machine limits', () => {
    const liveCaps = { xMaxFeedMmPerMin: 1800, yMaxFeedMmPerMin: 1800, zMaxFeedMmPerMin: 400 };
    const { seed } = surfacingSeed(machine, { device }, liveCaps);
    expect(seed.feedMmPerMin).toBe(1800);
    expect(seed.plungeMmPerMin).toBe(400);
  });
});
