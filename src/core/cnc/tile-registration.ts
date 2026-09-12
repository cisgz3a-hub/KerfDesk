import type { CncGroup } from '../job';
import type { DeviceProfile } from '../devices';
import type { CncMachineConfig, Vec2 } from '../scene';
import type { CncTile } from './cnc-tile';
import type { EffectiveCncTileGrid } from './effective-cnc-tile-grid';
import { capFeed, capSpindle } from './compile-cnc-helpers';
import { coolantFields } from './coolant-fields';
import { parkFields } from './motion-polish';
import type { ResolvedTileRegistration } from './tile-registration-plan';
import { tileRegistrationPasses } from './tile-registration-passes';

/** @deprecated Legacy nominal depth; emitted holes use the saved registration plan. */
export const REGISTRATION_HOLE_DEPTH_MM = 3;

const REGISTRATION_HOLE_EDGE_FRACTIONS = [0.25, 0.75];

/** Exact maximum over this regular grid, before any bore passes are allocated. */
export function maximumRegistrationHolesPerTile(grid: EffectiveCncTileGrid): number {
  const horizontalSeams = Math.min(2, grid.work.columns - 1);
  const verticalSeams = Math.min(2, grid.work.rows - 1);
  return REGISTRATION_HOLE_EDGE_FRACTIONS.length * (horizontalSeams + verticalSeams);
}

/**
 * Build the registration drill group for one tile from the same effective
 * grid that placed its clipping rectangle.
 */
export function registrationGroupForTile(
  tile: CncTile,
  grid: EffectiveCncTileGrid,
  registration: ResolvedTileRegistration,
  machine: CncMachineConfig,
  device: DeviceProfile,
): CncGroup | null {
  const centers = seamHoleCenters(tile, grid);
  if (centers.length === 0) return null;
  const { tool, settings } = registration;
  const isPeck = settings.holeDiameterMm === tool.diameterMm;
  return {
    kind: 'cnc',
    layerId: 'tile-registration',
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
    feedMmPerMin: capFeed(
      isPeck ? Math.min(settings.feedMmPerMin, settings.plungeMmPerMin) : settings.feedMmPerMin,
      device.maxFeed,
    ),
    plungeMmPerMin: capFeed(settings.plungeMmPerMin, device.maxFeed),
    spindleRpm: capSpindle(settings.spindleRpm, machine.params.spindleMaxRpm),
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

function seamHoleCenters(tile: CncTile, grid: EffectiveCncTileGrid): ReadonlyArray<Vec2> {
  const { rect } = tile;
  const halfOverlapMm = grid.geometry.overlapMm / 2;
  const centers: Vec2[] = [];
  for (const fraction of REGISTRATION_HOLE_EDGE_FRACTIONS) {
    const y = rect.minY + (rect.maxY - rect.minY) * fraction;
    if (tile.col < grid.work.columns - 1) {
      centers.push({ x: rect.maxX - halfOverlapMm, y });
    }
    if (tile.col > 0) centers.push({ x: rect.minX + halfOverlapMm, y });
    const x = rect.minX + (rect.maxX - rect.minX) * fraction;
    if (tile.row < grid.work.rows - 1) {
      centers.push({ x, y: rect.maxY - halfOverlapMm });
    }
    if (tile.row > 0) centers.push({ x, y: rect.minY + halfOverlapMm });
  }
  return centers;
}
