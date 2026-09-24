// Non-cutting transitions between CNC passes: spindle start with its safe-Z
// discipline, tool-change holds, and park-target resolution. Extracted from
// cnc-grbl-strategy.ts when it hit the ADR-015 size cap; the strategy file
// keeps job assembly and the cutting-pass emitters, and coolant lives in
// cnc-grbl-coolant.ts.

import type { CncGroup } from '../job';
import { sanitizeGcodeCommentValue } from '../gcode-comments';
import type { CncCoolantMode, Vec2 } from '../scene';
import { appendCoolantStart, appendCoolantStop } from './cnc-grbl-coolant';
import { appendRetract, fmt, type Head } from './cnc-grbl-emit-head';
import { TOOL_CHANGE_LOAD_PREFIX } from './tool-change-labels';
import { cncSpindleTransition, type CncSpindleState } from '../cnc/spindle-transition';

/** Per-job emit context threaded through group transitions. */
export type EmitState = CncSpindleState & {
  maxSafeZ: number;
  readonly finish: Vec2 | undefined;
  // Coolant is machine-wide for the job, but the tool-change hold has to close
  // and reopen it, so the mode has to reach this module rather than staying a
  // local of the preamble.
  readonly coolant: CncCoolantMode | undefined;
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

// The modal state every KerfDesk CNC program runs in, stated in the preamble
// and again after each tool-change hold, since a Console command or `$N`
// startup block may have changed any of it.
export function appendModalState(lines: string[]): void {
  lines.push('G21');
  lines.push('G90');
  // G54 is KerfDesk's canonical WCS. GRBL's active G54-G59 selection is
  // modal, so never let a stale G55-G59 redirect an otherwise valid program.
  lines.push('G54');
  lines.push('G94');
  // Helical entry and adaptive clearing emit real G2/G3 with I/J offsets, which
  // are read in the active plane. On G18/G19 an XY I/J pair is an invalid
  // offset (error:33) and Z becomes the circular axis.
  lines.push('G17');
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
  const transition = cncSpindleTransition(group, state);
  if (transition === 'tool-change') {
    appendToolChange(lines, head, group, state);
    state.currentToolKey = group.toolId ?? '';
    state.currentRpm = group.spindleRpm;
    return;
  }
  if (transition === 'rpm-change') {
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
  appendCoolantStop(lines, state.coolant);
  const park = parkTarget(group, state.finish);
  lines.push(`G0 X${fmt(park.x)} Y${fmt(park.y)}`);
  head.x = fmt(park.x);
  head.y = fmt(park.y);
  const toolName = sanitizeGcodeCommentValue(group.toolName ?? 'next tool', 40) || 'next tool';
  lines.push(`${TOOL_CHANGE_LOAD_PREFIX}${toolName}`);
  lines.push('; re-zero Z on the stock top, then cycle-start to resume');
  lines.push('M0');
  // The hold hands the machine to the operator: a Console command, a macro or a
  // touch-off probe that stopped on its alarm (its closing G90 never runs) can
  // leave G91, inches or another WCS behind, and `$X` does not reset them. The
  // next line is an absolute G0 Z lift, so restate the preamble's modal state
  // before it (controller audit streaming-3).
  appendModalState(lines);
  // The operator physically moves the head during the pause: jogging XY over the
  // stock to touch off the new bit, and Z down onto the stock top. None of those
  // positions are the emitter's tracked park/height any more, so void all three.
  // Voiding X/Y forces the next pass to emit its repositioning G0 X Y even when
  // that pass happens to start at the park XY — otherwise the alreadyAtStartXy
  // shortcut would skip it and the spinning bit would plunge at the touch-off
  // location and drag to the start (F23).
  head.x = head.y = head.z = null;
  appendSpindleStart(lines, head, state.maxSafeZ, group.spindleRpm, group.spindleSpinupSec);
  // Mirror of the preamble ordering: coolant reopens only after the spindle is
  // up to speed, never while the new bit is still resting on the stock.
  appendCoolantStart(lines, state.coolant);
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
