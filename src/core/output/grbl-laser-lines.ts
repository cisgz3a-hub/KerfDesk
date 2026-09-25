// Line formatters and layer comments shared by the GRBL laser group emitters
// (grbl-strategy.ts for cut and offset-fill groups, grbl-fill-emission.ts for
// scanline fill). Pure string builders: no emission state lives here.

import type { DeviceProfile, GrblGcodeDialect } from '../devices';
import type { CutGroup, FillGroup } from '../job';
import { formatGcodeCoordinateMm } from '../gcode';
import { effectiveGcodeFeedMmPerMin, formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import { INTENTIONAL_LASER_OFF_MOTION_COMMENT } from '../gcode-comments';
import { operationProvenanceComment } from './operation-provenance-comment';

export const LINE_END = '\n';

export function scaleS(powerPercent: number, maxPowerS: number): number {
  return Math.round((powerPercent / 100) * maxPowerS);
}

export function roundedPositiveFeed(speed: number, context: string): number {
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`${context}: speed must be finite and > 0`);
  }
  return effectiveGcodeFeedMmPerMin(speed);
}

export function laserOffSeekLine(
  x: number,
  y: number,
  device: DeviceProfile,
  dialect: GrblGcodeDialect,
): string {
  if (device.controlledLaserOffTravelFeedMmPerMin !== undefined) {
    const feed = roundedPositiveFeed(
      device.controlledLaserOffTravelFeedMmPerMin,
      'Controlled laser-off travel',
    );
    return `G1 X${formatGcodeCoordinateMm(x)} Y${formatGcodeCoordinateMm(y)} F${formatGcodeFeedMmPerMin(feed)} S0 ; ${INTENTIONAL_LASER_OFF_MOTION_COMMENT}`;
  }
  const base = `G0 X${formatGcodeCoordinateMm(x)} Y${formatGcodeCoordinateMm(y)}`;
  return dialect.requiresS0OnRapid ? `${base} S0` : base;
}

export function laserOffRunwayLine(x: number, y: number, feed: number): string {
  return `G1 X${formatGcodeCoordinateMm(x)} Y${formatGcodeCoordinateMm(y)} F${formatGcodeFeedMmPerMin(feed)} S0 ; ${INTENTIONAL_LASER_OFF_MOTION_COMMENT}`;
}

export function feedComment(group: CutGroup | FillGroup, effectiveFeed: number): string {
  return group.requestedSpeed === undefined
    ? `speed ${effectiveFeed} mm/min`
    : `speed ${effectiveFeed} mm/min effective (requested ${group.requestedSpeed} mm/min)`;
}

export function contourEntryComment(entryRunwayMm: number | undefined): string {
  return entryRunwayMm === undefined
    ? ''
    : ` contour-entry ${formatGcodeCoordinateMm(entryRunwayMm)} mm effective laser-off feed`;
}

export function pushOperationProvenanceComment(
  chunks: string[],
  group: CutGroup | FillGroup,
): void {
  const comment = operationProvenanceComment(group);
  if (comment !== undefined) chunks.push(`; ${comment}`);
}

/** Lines written one per row, each ending in LINE_END. */
export function joinedLines(lines: ReadonlyArray<string>): string {
  return lines.map((line) => `${line}${LINE_END}`).join('');
}
