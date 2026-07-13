// Final-text preflight for CNC programs generated outside the scene compiler,
// such as the spoilboard surfacing wizard. It intentionally has no layer or
// scene checks; it proves the machine-facing properties that still apply to a
// standalone work-origin program before the UI writes a file.

import { machineBoundsForDevice, type DeviceProfile } from '../devices';
import {
  findNonFiniteCoords,
  findOutOfBoundsCoords,
  findOverdeepCutIssues,
  findPlungedTravelIssues,
  isGcodeCommand,
  parseGcodeWord,
  stripGcodeComment,
} from '../invariants';
import { findSpindleStartClearanceIssues } from '../invariants/cnc-motion';
import type { CncMachineConfig } from '../scene';
import type { PreflightIssue, PreflightResult } from './preflight';

const MAX_REPORTED_ISSUES = 5;

export function runStandaloneCncPreflight(
  device: DeviceProfile,
  machine: CncMachineConfig,
  gcode: string,
): PreflightResult {
  const issues: PreflightIssue[] = [];
  appendCommandLimitIssues(gcode, device.maxFeed, machine.params.spindleMaxRpm, issues);
  appendWorkOriginBoundsIssues(gcode, device, issues);
  appendNoGoZoneUncertainty(device, issues);
  appendTextInvariantIssues(gcode, machine, issues);
  if (!/\bG1\b/.test(gcode)) {
    issues.push({ code: 'empty-output', message: 'No CNC cutting moves were generated.' });
  }
  return { ok: issues.length === 0, issues };
}

function appendCommandLimitIssues(
  gcode: string,
  maxFeed: number,
  spindleMaxRpm: number,
  issues: PreflightIssue[],
): void {
  const lines = gcode.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const stripped = stripGcodeComment(lines[i] ?? '');
    if (stripped.length === 0) continue;
    const feed = parseGcodeWord(stripped, 'F');
    if (feed !== null && (feed <= 0 || feed > maxFeed)) {
      issues.push({
        code: 'cnc-settings-invalid',
        message: `Line ${i + 1}: feed ${feed} mm/min is outside (0, ${maxFeed}].`,
      });
    }
    if (!isGcodeCommand(stripped, 'M3')) continue;
    const rpm = parseGcodeWord(stripped, 'S');
    if (rpm === null || rpm <= 0 || rpm > spindleMaxRpm) {
      issues.push({
        code: 'cnc-settings-invalid',
        message: `Line ${i + 1}: spindle RPM must be present and inside (0, ${spindleMaxRpm}].`,
      });
    }
  }
}

// Standalone surfacing is authored in work coordinates with X/Y zero at the
// area's front-left corner. Check that entire commanded envelope fits a bed of
// the configured size regardless of the machine profile's absolute-origin mode.
function appendWorkOriginBoundsIssues(
  gcode: string,
  device: DeviceProfile,
  issues: PreflightIssue[],
): void {
  const bounds = machineBoundsForDevice(device);
  const workBounds = { width: bounds.width, height: bounds.height, minX: 0, minY: 0 };
  for (const issue of findOutOfBoundsCoords(gcode, workBounds).slice(0, MAX_REPORTED_ISSUES)) {
    issues.push({ code: 'out-of-bed', message: `Line ${issue.lineNumber}: ${issue.reason}` });
  }
}

function appendNoGoZoneUncertainty(device: DeviceProfile, issues: PreflightIssue[]): void {
  if (!device.noGoZones.some((zone) => zone.enabled)) return;
  // No machine-coordinate WCO is available to a downloaded standalone file.
  // Passing zero to the collision scanner would falsely claim the chosen work
  // origin is machine zero, so fail closed instead.
  issues.push({
    code: 'no-go-zone-collision',
    message:
      'Standalone surfacing cannot prove clearance from enabled machine no-go zones because its work origin is chosen later. Disable the zones only after checking the setup, or use a normal positioned job.',
  });
}

function appendTextInvariantIssues(
  gcode: string,
  machine: CncMachineConfig,
  issues: PreflightIssue[],
): void {
  for (const issue of findNonFiniteCoords(gcode).slice(0, MAX_REPORTED_ISSUES)) {
    issues.push({
      code: 'non-finite-coordinate',
      message: `Line ${issue.lineNumber}: ${issue.reason}. Regenerate the output.`,
    });
  }
  for (const issue of findPlungedTravelIssues(gcode, { safeZMm: machine.params.safeZMm }).slice(
    0,
    MAX_REPORTED_ISSUES,
  )) {
    issues.push({ code: 'plunged-travel', message: `Line ${issue.lineNumber}: ${issue.reason}` });
  }
  for (const issue of findSpindleStartClearanceIssues(gcode, {
    safeZMm: machine.params.safeZMm,
  }).slice(0, MAX_REPORTED_ISSUES)) {
    issues.push({
      code: 'spindle-start-before-clearance',
      message: `Line ${issue.lineNumber}: ${issue.reason}`,
    });
  }
  for (const issue of findOverdeepCutIssues(gcode, {
    stockThicknessMm: machine.stock.thicknessMm,
  }).slice(0, MAX_REPORTED_ISSUES)) {
    issues.push({ code: 'cnc-overdeep-cut', message: `Line ${issue.lineNumber}: ${issue.reason}` });
  }
}
