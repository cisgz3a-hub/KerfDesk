// CNC motion invariant — "Z up on travel", the router analog of the laser's
// "laser off on travel" (PROJECT non-negotiable #3).
//
// Scans emitted G-code with a modal-Z tracker and flags:
//   * any G0 carrying X or Y while modal Z is below the safe height (or
//     before any Z has been established) — an XY rapid with the bit buried;
//   * any G0 whose Z target is below the safe height — a rapid plunge.
//
// Plunges must be G1 at plunge feed; the emitter guarantees it, this check
// proves it on the final text so a regression anywhere upstream still blocks
// the file write.

import { scanModalMotionLine, type GcodeMotionMode } from '../gcode/modal-motion-line';
import { parseGcodeWord } from './gcode-words';

export type CncMotionIssue = {
  readonly lineNumber: number; // 1-based
  readonly reason: string;
};

const Z_EPS = 1e-6;

export function findPlungedTravelIssues(
  gcode: string,
  options: { readonly safeZMm: number },
): ReadonlyArray<CncMotionIssue> {
  const safeZ = Math.max(0, options.safeZMm);
  const issues: CncMotionIssue[] = [];
  let modalZ: number | null = null;
  let motion: GcodeMotionMode | null = 0;
  const lines = gcode.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const stripped = stripComment(lines[i] ?? '');
    if (stripped.length === 0) continue;
    const scanned = scanModalMotionLine(stripped, motion);
    motion = scanned.motion;
    if (!scanned.isMotion || (motion !== 0 && motion !== 1)) continue;
    const z = parseGcodeWord(stripped, 'Z');
    const hasXy = parseGcodeWord(stripped, 'X') !== null || parseGcodeWord(stripped, 'Y') !== null;
    if (motion === 0) {
      appendRapidIssues(issues, i + 1, hasXy, z, modalZ, safeZ);
    }
    if (z !== null) modalZ = z;
  }
  return issues;
}

// A spindle start is only safe after emitted motion has established clearance.
// This catches standalone generators that start M3 while the cutter is still at
// the operator's Z0 touch-off position, even if their later cutting travels are
// otherwise valid.
export function findSpindleStartClearanceIssues(
  gcode: string,
  options: { readonly safeZMm: number },
): ReadonlyArray<CncMotionIssue> {
  const safeZ = Math.max(0, options.safeZMm);
  const issues: CncMotionIssue[] = [];
  let modalZ: number | null = null;
  let motion: GcodeMotionMode | null = 0;
  const lines = gcode.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const stripped = stripComment(lines[i] ?? '');
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
        lineNumber: i + 1,
        reason: 'M3 spindle start occurs before any Z clearance was established.',
      });
    } else if (modalZ < safeZ - Z_EPS) {
      issues.push({
        lineNumber: i + 1,
        reason: `M3 spindle start occurs at Z${modalZ.toFixed(3)}, below safe height ${safeZ.toFixed(3)} mm.`,
      });
    }
  }
  return issues;
}

function appendRapidIssues(
  issues: CncMotionIssue[],
  lineNumber: number,
  hasXy: boolean,
  targetZ: number | null,
  modalZ: number | null,
  safeZ: number,
): void {
  if (targetZ !== null && targetZ < safeZ - Z_EPS) {
    issues.push({
      lineNumber,
      reason: `G0 rapid targets Z${targetZ.toFixed(3)} below safe height ${safeZ.toFixed(3)} mm.`,
    });
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

function stripComment(line: string): string {
  const semicolon = line.indexOf(';');
  const noSemi = semicolon === -1 ? line : line.slice(0, semicolon);
  return noSemi.replace(/\([^)]*\)/g, '').trim();
}
