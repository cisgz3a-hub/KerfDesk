import type { CncGroup } from '../job';
import type { DeviceProfile } from '../devices';
import type { CncMachineConfig, Vec2 } from '../scene';
import { cncMaxFeedMmPerMin } from './cnc-head-feeds';
import type { CncTile } from './cnc-tile';
import type { EffectiveCncTileGrid } from './effective-cnc-tile-grid';
import { cncCuttingRates } from './cnc-cutting-rates';
import { coolantFields } from './coolant-fields';
import { parkFields } from './motion-polish';
import type { ResolvedTileRegistration } from './tile-registration-plan';
import { tileRegistrationPasses } from './tile-registration-passes';
import { TILE_REGISTRATION_LAYER_ID } from './tile-registration-placement';

/** @deprecated Legacy nominal depth; emitted holes use the saved registration plan. */
export const REGISTRATION_HOLE_DEPTH_MM = 3;

// At most two bores per seam (tile-registration-placement.ts).
const REGISTRATION_HOLES_PER_SEAM = 2;

/** Exact maximum over this regular grid, before any bore passes are allocated. */
export function maximumRegistrationHolesPerTile(grid: EffectiveCncTileGrid): number {
  const horizontalSeams = Math.min(2, grid.work.columns - 1);
  const verticalSeams = Math.min(2, grid.work.rows - 1);
  return REGISTRATION_HOLES_PER_SEAM * (horizontalSeams + verticalSeams);
}

/**
 * Build the registration drill group for one tile from the bores its seams
 * share (stock coordinates, placed by placeTileRegistrationHoles so they miss
 * every part, every cut and the board edge).
 */
export function registrationGroupForTile(
  tile: CncTile,
  centers: ReadonlyArray<Vec2>,
  registration: ResolvedTileRegistration,
  machine: CncMachineConfig,
  device: DeviceProfile,
): CncGroup | null {
  if (centers.length === 0) return null;
  const { tool, settings } = registration;
  const isPeck = settings.holeDiameterMm === tool.diameterMm;
  const maxFeed = cncMaxFeedMmPerMin(device, machine.params);
  return {
    kind: 'cnc',
    layerId: TILE_REGISTRATION_LAYER_ID,
    color: '#7c3aed',
    cutType: isPeck ? 'drill' : 'pocket',
    toolId: tool.id,
    toolName: tool.name,
    toolKind: tool.kind,
    toolDiameterMm: tool.diameterMm,
    layerPrimaryToolId: tool.id,
    ...(tool.fluteCount === undefined ? {} : { toolFluteCount: tool.fluteCount }),
    requestedDepthMm: settings.depthMm,
    registrationHoleDiameterMm: settings.holeDiameterMm,
    depthPerPassMm: settings.depthPerPassMm,
    // ADR-233 Amd 1: a capped spindle scales the feeds so the chip load holds.
    ...cncCuttingRates(
      {
        feedMmPerMin: isPeck
          ? Math.min(settings.feedMmPerMin, settings.plungeMmPerMin)
          : settings.feedMmPerMin,
        plungeMmPerMin: settings.plungeMmPerMin,
        spindleRpm: settings.spindleRpm,
      },
      maxFeed,
      machine.params.spindleMaxRpm,
    ),
    spindleSpinupSec: Math.max(0, machine.params.spindleSpinupSec),
    safeZMm: Math.max(0, machine.params.safeZMm),
    ...coolantFields(machine),
    ...parkFields(machine),
    passes: centers.flatMap((center) =>
      tileRegistrationPasses(
        { x: center.x - tile.rect.minX, y: center.y - tile.rect.minY },
        settings,
        tool.diameterMm,
      ),
    ),
  };
}
