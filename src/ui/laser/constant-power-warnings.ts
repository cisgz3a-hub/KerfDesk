// Constant-power (M3) advice for GRBL-family output (ADR-257 Amendment 1;
// quality audit Q1-P2-1 and Q6-P2-1). Under M3 GRBL holds the programmed power
// whatever the head's speed (laser_mode.md), so wherever its planner slows the
// head the burn gets more energy per millimetre:
//   - Image rows that change power at nearly every pixel are one move per
//     pixel. GRBL plans only so many moves ahead and must be able to stop
//     inside them, so it holds such rows below the programmed feed, and those
//     areas burn darker than the Preview's tones.
//   - Line cuts slow at every corner (junction deviation) and, without a
//     runway, start and stop on the ink at each path end.
// LightBurn's GRBL guide puts GRBL 1.1f and newer on dynamic power (M4) and
// keeps 1.1e and older on constant power, its "GRBL-M3" device; its Shared
// Settings page says to "stick with the default of Variable Power mode". The
// advice names that route. An operation set to Constant (M3) by hand chose it
// and gets no advice; only a dialect's default is advised. Advisory only,
// never a Start gate (ADR-565).

import {
  resolveGrblDialect,
  type ControllerKind,
  type DeviceProfile,
  type GrblGcodeDialect,
} from '../../core/devices';
import { effectiveGcodeFeedMmPerMin } from '../../core/gcode/feed-word';
import type { CutGroup, Job, RasterGroup } from '../../core/job';
import { alongScanAccelMmPerSec2 } from '../../core/job/automatic-overscan';
import { contourEntriesSkipped } from '../../core/job/contour-entry';
import { DEFAULT_PLANNER_BLOCKS } from '../../core/motion-planner/controller-planner-blocks';
import { outputOperationLayers, type Project } from '../../core/scene';

const SAVED_MOTION_NOTE = 'This is a saved-motion estimate, not a measured machine limit.';
const STOCK_GRBL_PLANNER_BLOCKS = 15;

/** One advisory per operation whose dialect default burns it with M3. */
export function constantPowerWarnings(job: Job, project: Project): ReadonlyArray<string> {
  if (project.machine?.kind === 'cnc' || !streamsGrblOutput(project.device.controllerKind)) {
    return [];
  }
  const dialect = resolveGrblDialect(project.device);
  const names = new Map(
    project.scene.layers.flatMap(outputOperationLayers).map((layer) => [layer.id, layer.name]),
  );
  const runwaysSkipped = contourEntriesSkipped(job);
  const warnings = new Set<string>();
  for (const group of job.groups) {
    const name = names.get(group.layerId) ?? group.layerId;
    const warning =
      group.kind === 'raster'
        ? imageWarning(group, name, dialect, project.device)
        : group.kind === 'cut'
          ? lineWarning(group, name, dialect, project.device, runwaysSkipped)
          : null;
    if (warning !== null) warnings.add(warning);
  }
  return [...warnings];
}

// The GRBL strategy emits for these kinds (select-output-strategy.ts); Marlin,
// Smoothieware and Ruida spell power differently.
function streamsGrblOutput(kind: ControllerKind | undefined): boolean {
  return kind === undefined || kind === 'grbl-v1.1' || kind === 'grblhal' || kind === 'fluidnc';
}

function imageWarning(
  group: RasterGroup,
  name: string,
  dialect: GrblGcodeDialect,
  device: DeviceProfile,
): string | null {
  if (dialect.rasterPowerMode !== 'constant') return null;
  if (!(group.power > 0) || group.pixelWidth <= 0 || group.pixelHeight <= 0) return null;
  const feed = effectiveGcodeFeedMmPerMin(group.speed);
  const pitchMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const accel = alongScanAccelMmPerSec2(device.accelMmPerSec2, group.scanAngleDeg ?? 0);
  const blocks =
    DEFAULT_PLANNER_BLOCKS[device.controllerKind ?? 'grbl-v1.1'] ?? STOCK_GRBL_PLANNER_BLOCKS;
  const sustainedFeed = Math.floor(60 * lookAheadSpeedMmPerSec(accel, blocks, pitchMm));
  if (!Number.isFinite(sustainedFeed) || feed <= sustainedFeed) return null;
  return [
    `Image "${group.source ?? 'image'}" on "${name}" burns with constant power (M3), as the ${dialect.label} dialect does for images.`,
    `At ${feed} mm/min a row that changes power at every ${formatNumber(pitchMm, 4)} mm pixel is one move per pixel, and the controller's planner holds about ${blocks} moves, so with the saved acceleration (${formatNumber(accel, 1)} mm/s² along the scan) it holds such rows to about ${sustainedFeed} mm/min.`,
    'M3 keeps full power while the head runs slower, so dithered and shaded areas can burn darker than the Preview shows.',
    dialectRemedy(device.controllerKind, `lower the speed to about ${sustainedFeed} mm/min`),
    SAVED_MOTION_NOTE,
  ].join(' ');
}

/**
 * The speed GRBL can hold through moves of `moveMm` each: its newest planned
 * move ends at a stop (planner.c plans the last block to zero), so the head
 * may only run as fast as it can stop within the other `blocks - 1` moves,
 * v = sqrt(2 * a * (blocks - 1) * moveMm). The same planner-depth model as
 * the time estimate (ADR-525); 15 blocks at 500 mm/s² on 0.1 mm pixels gives
 * the audit's 37.4 mm/s.
 */
export function lookAheadSpeedMmPerSec(accel: number, blocks: number, moveMm: number): number {
  const ahead = Math.max(1, (blocks > 0 ? blocks : STOCK_GRBL_PLANNER_BLOCKS) - 1);
  return Math.sqrt(2 * accel * ahead * moveMm);
}

function lineWarning(
  group: CutGroup,
  name: string,
  dialect: GrblGcodeDialect,
  device: DeviceProfile,
  runwaysSkipped: boolean,
): string | null {
  if (group.powerMode !== undefined || dialect.cutPowerMode !== 'constant') return null;
  if (!(group.power > 0) || group.segments.length === 0) return null;
  const feed = effectiveGcodeFeedMmPerMin(group.speed);
  const startsCovered = group.entryRunwayMm !== undefined && !runwaysSkipped;
  const endsCovered = group.exitRunwayMm !== undefined && !runwaysSkipped;
  const corner = squareCornerSpeedMmPerSec(device.accelMmPerSec2, device.junctionDeviationMm);
  const ends = startsCovered && endsCovered ? '' : ' and starts or stops it at path ends';
  const fallback =
    startsCovered && endsCovered
      ? 'lower the speed, and test on scrap'
      : 'lower the speed or move the path ends off the part with Lead-in / Lead-out, and test on scrap';
  return [
    `Line operation "${name}" burns with constant power (M3), as the ${dialect.label} dialect does for cuts.`,
    `GRBL slows the head at corners (with the saved ${formatNumber(device.accelMmPerSec2, 1)} mm/s² and ${formatNumber(device.junctionDeviationMm, 3)} mm junction deviation it takes a square corner at about ${formatNumber(corner, 1)} mm/s, against ${formatNumber(feed / 60, 1)} mm/s along the line)${ends}, while M3 keeps full power, so ${overBurnSites(startsCovered, endsCovered)} burn darker than the rest of the line.`,
    runwayNote(group, runwaysSkipped),
    dialect.id === 'grbl-compatible'
      ? dialectRemedy(device.controllerKind, fallback)
      : `Set this operation's Power mode to Dynamic (M4), which lowers power with speed as LightBurn recommends, or ${fallback}.`,
    SAVED_MOTION_NOTE,
  ]
    .filter((sentence) => sentence !== '')
    .join(' ');
}

/**
 * GRBL's junction speed for a 90° corner of an axis-aligned square
 * (gnea/grbl planner.c: v² = a·δ·sin(θ/2)/(1 − sin(θ/2)), with the junction
 * vector on a diagonal so the axis-limited acceleration is a·√2):
 * v = sqrt(a·δ·(2 + √2)). 500 mm/s² and 0.01 mm give 4.13 mm/s.
 */
export function squareCornerSpeedMmPerSec(accel: number, junctionDeviationMm: number): number {
  return Math.sqrt(accel * junctionDeviationMm * (2 + Math.SQRT2));
}

function overBurnSites(startsCovered: boolean, endsCovered: boolean): string {
  if (startsCovered && endsCovered) return 'corners';
  if (startsCovered) return 'corners and path ends';
  if (endsCovered) return 'corners and path starts';
  return 'corners, path starts and path ends';
}

function runwayNote(group: CutGroup, runwaysSkipped: boolean): string {
  if (group.entryRunwayMm === undefined && group.exitRunwayMm === undefined) return '';
  return runwaysSkipped
    ? 'The laser-off runways at path starts and ends are skipped because the bed position is unknown; with homing turned on in Machine Setup, home the machine so KerfDesk knows where the bed is.'
    : 'Laser-off runways carry the head through path starts and ends at speed.';
}

function dialectRemedy(kind: ControllerKind | undefined, fallback: string): string {
  const choose =
    'choose GRBL Dynamic in Machine Setup, whose dynamic power (M4) lowers power with speed as LightBurn recommends';
  if (kind === 'grblhal') return `grblHAL supports dynamic power: ${choose}, or ${fallback}.`;
  if (kind === 'fluidnc') {
    return `With its spindle configured as Laser, FluidNC supports dynamic power: ${choose}, or ${fallback}.`;
  }
  return `If the controller runs GRBL 1.1f or newer, ${choose}. LightBurn keeps GRBL 1.1e and older on constant power; there, ${fallback}.`;
}

function formatNumber(value: number, digits: number): string {
  return Number(value.toFixed(digits)).toString();
}
