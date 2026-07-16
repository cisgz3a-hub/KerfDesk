// Non-cutting transitions between CNC passes: spindle start with its safe-Z
// discipline, tool-change holds, and park-target resolution. Extracted from
// cnc-grbl-strategy.ts when it hit the ADR-015 size cap; the strategy file
// keeps job assembly and the cutting-pass emitters, and coolant lives in
// cnc-grbl-coolant.ts.

import type { CncGroup } from '../job';
import type { Vec2 } from '../scene';
import { appendRetract, fmt, type Head } from './cnc-grbl-emit-head';
import { TOOL_CHANGE_LOAD_PREFIX } from './tool-change-labels';

/** Per-job emit context threaded through group transitions. */
export type EmitState = {
  isMultiTool: boolean;
  currentRpm: number;
  currentToolKey: string;
  maxSafeZ: number;
  readonly finish: Vec2 | undefined;
};

// H.9 parking parity: the configured park position wins; without one, a
// current-position job parks back at its own start (the finish position the
// emit seam resolved), and everything else keeps the machine-origin default.
// Work zero on a no-homing machine is just the power-on point, so parking a
// head-relative job at X0 Y0 rapids blindly back across the bed — operators
// read that as an uncommanded homing move.
export function parkTarget(group: CncGroup | undefined, finish: Vec2 | undefined): Vec2 {
  return {
    x: group?.parkXMm ?? finish?.x ?? 0,
    y: group?.parkYMm ?? finish?.y ?? 0,
  };
}

// Between-group transitions: an M0 tool-change block when the bit changes
// (multi-tool jobs only), else a spindle re-start when only the RPM does.
export function appendGroupTransition(
  lines: string[],
  head: Head,
  group: CncGroup,
  state: EmitState,
): void {
  state.maxSafeZ = Math.max(state.maxSafeZ, group.safeZMm);
  if (state.isMultiTool && (group.toolId ?? '') !== state.currentToolKey) {
    appendToolChange(lines, head, group, state);
    state.currentToolKey = group.toolId ?? '';
    state.currentRpm = group.spindleRpm;
    return;
  }
  if (group.spindleRpm !== state.currentRpm) {
    appendSpindleStart(lines, head, group.safeZMm, group.spindleRpm, group.spindleSpinupSec);
    state.currentRpm = group.spindleRpm;
  }
}

// The manual GRBL tool-change flow (F-CNC14/15): retract, spindle off,
// park at the front for bit access, M0 pause. The operator swaps the bit,
// re-zeros Z on the stock top (the new bit's length differs), and
// continues. Touch-off leaves the new bit at Z0 on the stock, so the first
// resumed command lifts to safe Z with the spindle off; only then may M3 run.
function appendToolChange(lines: string[], head: Head, group: CncGroup, state: EmitState): void {
  appendRetract(lines, head, state.maxSafeZ);
  lines.push('M5');
  const park = parkTarget(group, state.finish);
  lines.push(`G0 X${fmt(park.x)} Y${fmt(park.y)}`);
  head.x = fmt(park.x);
  head.y = fmt(park.y);
  lines.push(`${TOOL_CHANGE_LOAD_PREFIX}${group.toolName ?? 'next tool'}`);
  lines.push('; re-zero Z on the stock top, then cycle-start to resume');
  lines.push('M0');
  // The operator physically moves the head during the pause: jogging XY over the
  // stock to touch off the new bit, and Z down onto the stock top. None of those
  // positions are the emitter's tracked park/height any more, so void all three.
  // Voiding X/Y forces the next pass to emit its repositioning G0 X Y even when
  // that pass happens to start at the park XY — otherwise the alreadyAtStartXy
  // shortcut would skip it and the spinning bit would plunge at the touch-off
  // location and drag to the start (F23).
  head.x = head.y = head.z = null;
  appendSpindleStart(lines, head, state.maxSafeZ, group.spindleRpm, group.spindleSpinupSec);
}

// Central spindle-start invariant: every native CNC M3 is preceded by a known
// safe-Z retract. This is especially important after a manual tool touch-off,
// where the new cutter is resting on the stock when Continue is pressed.
export function appendSpindleStart(
  lines: string[],
  head: Head,
  safeZMm: number,
  rpm: number,
  spinupSec: number,
): void {
  appendRetract(lines, head, safeZMm);
  lines.push(`M3 S${Math.max(0, Math.round(rpm))}`);
  // This is deliberately time-based. Stock GRBL's FS value reflects its
  // commanded/limited spindle output, not tachometer-backed physical RPM.
  // CNC preflight rejects non-positive durations before output can be written.
  if (spinupSec > 0) lines.push(`G4 P${fmt(spinupSec)}`);
}
