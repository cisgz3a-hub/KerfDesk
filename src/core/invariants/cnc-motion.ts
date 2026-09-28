// CNC motion invariant — "Z up on travel", the router analog of the laser's
// "laser off on travel" (PROJECT non-negotiable #3).
//
// Scans emitted G-code with a modal-Z tracker and flags:
//   * any G0 carrying X or Y while modal Z is below the safe height (or
//     before any Z has been established) — an XY rapid with the bit buried;
//   * any G0 whose Z target is below the safe height — a rapid plunge —
//     except an air descent (ADR-489): Z-only, from safe Z, no deeper than
//     the program has already fed plus CNC_AIR_RAPID_CLEARANCE_MM, and
//     followed at once by a Z-only G1 plunge below it. Whether the air above
//     that pass really is clear is proven where its floor is computed; the
//     text alone cannot see the stock.
//
// Plunges must be G1 at plunge feed; the emitter guarantees it, and this check
// reports any final-text regression. Consumers surface this finding in Job
// Review; only the canonical compile-integrity set can refuse output.

import { CNC_AIR_RAPID_CLEARANCE_MM } from '../cnc/cnc-air-floor';
import { scanModalMotionLine, type GcodeMotionMode } from '../gcode/modal-motion-line';
import { iterateGcodeLines, parseGcodeWord } from './gcode-words';

export type CncMotionIssue = {
  readonly lineNumber: number; // 1-based
  readonly reason: string;
};

const Z_EPS = 1e-6;

export function findPlungedTravelIssues(
  gcode: string | Iterable<string>,
  options: { readonly safeZMm: number; readonly maxIssues?: number },
): ReadonlyArray<CncMotionIssue> {
  const safeZ = Math.max(0, options.safeZMm);
  const maxIssues = options.maxIssues ?? Infinity;
  const issues: CncMotionIssue[] = [];
  const scan: TravelScan = { modalZ: null, deepestFedZ: null, airDescent: null };
  let motion: GcodeMotionMode | null = 0;
  let lineNumber = 0;
  for (const line of iterateGcodeLines(gcode)) {
    lineNumber += 1;
    const stripped = stripComment(line);
    if (stripped.length === 0) continue;
    const scanned = scanModalMotionLine(stripped, motion);
    motion = scanned.motion;
    if (!scanned.isMotion) continue;
    scanTravelLine(issues, scan, { line: stripped, lineNumber, motion }, safeZ);
    if (issues.length >= maxIssues) return issues.slice(0, maxIssues);
  }
  settleAirDescent(issues, scan, null);
  return issues.slice(0, maxIssues);
}

function scanTravelLine(
  issues: CncMotionIssue[],
  scan: TravelScan,
  motionLine: {
    readonly line: string;
    readonly lineNumber: number;
    readonly motion: GcodeMotionMode | null;
  },
  safeZ: number,
): void {
  const { line, lineNumber, motion } = motionLine;
  const z = parseGcodeWord(line, 'Z');
  const hasXy = parseGcodeWord(line, 'X') !== null || parseGcodeWord(line, 'Y') !== null;
  settleAirDescent(issues, scan, motion === 1 && !hasXy ? z : null);
  if (motion === 0) appendRapidIssues(issues, lineNumber, hasXy, z, scan, safeZ);
  else if (motion !== null && z !== null) scan.deepestFedZ = Math.min(scan.deepestFedZ ?? z, z);
  if (z !== null) scan.modalZ = z;
}

type TravelScan = {
  modalZ: number | null;
  // The deepest Z any feed move has reached so far.
  deepestFedZ: number | null;
  // A below-safe Z-only rapid awaiting the plunge that must follow it.
  airDescent: { readonly lineNumber: number; readonly z: number } | null;
};

// An air descent stands only when the very next motion is a Z-only G1 going
// lower (`plungeZ`); anything else leaves a rapid that ends in the work.
function settleAirDescent(
  issues: CncMotionIssue[],
  scan: TravelScan,
  plungeZ: number | null,
): void {
  const descent = scan.airDescent;
  if (descent === null) return;
  scan.airDescent = null;
  if (plungeZ !== null && plungeZ < descent.z - Z_EPS) return;
  issues.push({
    lineNumber: descent.lineNumber,
    reason: `G0 rapid descends to Z${descent.z.toFixed(3)} below safe height without a plunge following it.`,
  });
}

// A spindle start is only safe after emitted motion has established clearance.
// This catches standalone generators that start M3 while the cutter is still at
// the operator's Z0 touch-off position, even if their later cutting travels are
// otherwise valid.
export function findSpindleStartClearanceIssues(
  gcode: string | Iterable<string>,
  options: { readonly safeZMm: number; readonly maxIssues?: number },
): ReadonlyArray<CncMotionIssue> {
  const safeZ = Math.max(0, options.safeZMm);
  const issues: CncMotionIssue[] = [];
  let modalZ: number | null = null;
  let motion: GcodeMotionMode | null = 0;
  let lineNumber = 0;
  for (const line of iterateGcodeLines(gcode)) {
    lineNumber += 1;
    const stripped = stripComment(line);
    const scanned = scanModalMotionLine(stripped, motion);
    motion = scanned.motion;
    if (scanned.isMotion) {
      const z = parseGcodeWord(stripped, 'Z');
      if (z !== null) modalZ = z;
      continue;
    }
    if (!/^M3\b/i.test(stripped)) continue;
    if (modalZ === null) {
      issues.push({
        lineNumber,
        reason: 'M3 spindle start occurs before any Z clearance was established.',
      });
    } else if (modalZ < safeZ - Z_EPS) {
      issues.push({
        lineNumber,
        reason: `M3 spindle start occurs at Z${modalZ.toFixed(3)}, below safe height ${safeZ.toFixed(3)} mm.`,
      });
    }
    if (issues.length >= (options.maxIssues ?? Infinity)) return issues.slice(0, options.maxIssues);
  }
  return issues;
}

function appendRapidIssues(
  issues: CncMotionIssue[],
  lineNumber: number,
  hasXy: boolean,
  targetZ: number | null,
  scan: TravelScan,
  safeZ: number,
): void {
  const modalZ = scan.modalZ;
  if (targetZ !== null && targetZ < safeZ - Z_EPS) {
    if (!hasXy && isAirDescent(targetZ, scan, safeZ)) {
      scan.airDescent = { lineNumber, z: targetZ };
    } else {
      issues.push({
        lineNumber,
        reason: `G0 rapid targets Z${targetZ.toFixed(3)} below safe height ${safeZ.toFixed(3)} mm.`,
      });
    }
  }
  if (!hasXy) return;
  const effectiveZ = targetZ ?? modalZ;
  if (effectiveZ === null) {
    issues.push({
      lineNumber,
      reason: 'G0 XY rapid before any Z retract was established.',
    });
    return;
  }
  if (effectiveZ < safeZ - Z_EPS) {
    issues.push({
      lineNumber,
      reason: `G0 XY rapid with Z at ${effectiveZ.toFixed(3)} mm, below safe height ${safeZ.toFixed(3)} mm.`,
    });
  }
}

// ADR-489: a Z-only rapid down from safe Z that stays the clearance above the
// deepest Z the program has already fed to. It cannot be deeper than the job
// has cut; whether that pass's air is clear is its producer's proof.
function isAirDescent(targetZ: number, scan: TravelScan, safeZ: number): boolean {
  if (scan.modalZ === null || scan.modalZ < safeZ - Z_EPS || targetZ >= scan.modalZ) return false;
  return (
    scan.deepestFedZ !== null && targetZ >= scan.deepestFedZ + CNC_AIR_RAPID_CLEARANCE_MM - Z_EPS
  );
}

function stripComment(line: string): string {
  const semicolon = line.indexOf(';');
  const noSemi = semicolon === -1 ? line : line.slice(0, semicolon);
  return noSemi.replace(/\([^)]*\)/g, '').trim();
}
