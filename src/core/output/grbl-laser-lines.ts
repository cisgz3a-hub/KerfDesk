// Line formatters and layer comments shared by the GRBL laser group emitters
// (grbl-strategy.ts for cut and offset-fill groups, grbl-fill-emission.ts for
// scanline fill). Pure string builders: no emission state lives here.

import type { DeviceProfile, GrblGcodeDialect } from '../devices';
import type { CutGroup, FillGroup } from '../job';
import { formatGcodeCoordinateMm } from '../gcode';
import { effectiveGcodeFeedMmPerMin, formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import { INTENTIONAL_LASER_OFF_MOTION_COMMENT } from '../gcode-comments';
import { operationProvenanceComment } from './operation-provenance-comment';
import {
  CURRENT_LASER_POWER_SCALE_VERSION,
  usesVirtualPowerRange,
  type LaserPowerScaleVersion,
} from './laser-power-scale-version';

export const LINE_END = '\n';

export function scaleS(
  powerPercent: number,
  maxPowerS: number,
  version: LaserPowerScaleVersion = CURRENT_LASER_POWER_SCALE_VERSION,
): number {
  // Keep established whole-number output byte-for-byte. A fractional or small
  // whole-number $30 needs a virtual PWM range so 100% reaches that exact
  // maximum and smaller percentages cannot round straight to S0 or full power.
  return !usesVirtualPowerRange(maxPowerS, version)
    ? Math.round((powerPercent / 100) * maxPowerS)
    : powerPercent === 100
      ? maxPowerS
      : Number(((Math.round(powerPercent * 10) / 1000) * maxPowerS).toPrecision(12));
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

// ADR-415: absent overcut adds nothing, so groups without one keep their bytes.
export function overcutComment(overcutMm: number | undefined): string {
  return overcutMm === undefined
    ? ''
    : ` overcut ${formatGcodeCoordinateMm(overcutMm)} mm on final pass`;
}

// ADR-626: only a group whose operation asks for leads says so.
export function leadComment(leads: CutGroup['laserLeads']): string {
  if (leads === undefined) return '';
  const which = leads.leadIn && leads.leadOut ? 'in+out' : leads.leadIn ? 'in' : 'out';
  return ` leads ${which} ${leads.style} ${formatGcodeCoordinateMm(leads.lengthMm)} mm at ${leads.angleDeg} deg`;
}

// ADR-494: only the group burning an operation's tab spans says so.
export function tabSpanComment(percent: number | undefined): string {
  return percent === undefined ? '' : ` tab spans at ${percent}% of cut power`;
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
