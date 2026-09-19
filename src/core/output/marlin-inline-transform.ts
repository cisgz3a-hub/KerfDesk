/** Marlin 2.1.2.6 LASER_FEATURE contract (M3-M5.cpp and gcode.cpp):
 * M3 I selects S-controlled continuous inline power. M4 I derives power from
 * feedrate, so it cannot implement GRBL's requested S-scaled dynamic mode.
 * LASER_POWER_TRAP is a firmware build choice, not a per-layer M3/M4 choice.
 * M5 I drains the planner, disables inline power and returns to standard mode.
 * Teardown before repeated entry makes that boundary explicit with either
 * LASER_POWER_SYNC build. Do not insert a bare M400 before re-entry: continuous
 * inline mode has no general idle blanking in stepper.cpp, and inline_power(0)
 * only updates planner state. M5 applies PWM zero before its acknowledgement.
 */
export function toMarlinInlineGcode(body: string): string {
  const out = ['M5 I'];
  let inlineActive = false;
  for (const line of body.split('\n')) {
    if (/^M[34]\b/.test(line)) {
      if (inlineActive) out.push('M5 I');
      out.push('M3 I S0');
      inlineActive = true;
    } else if (/^M5\b/.test(line)) {
      out.push('M5 I');
      inlineActive = false;
    } else out.push(line);
  }
  return out.join('\n');
}

/** G94 is not a Marlin command. G54 requires CNC_COORDINATE_SYSTEMS and would
 * change the active origin; generic output retains the reviewed workspace. */
export function withoutGrblWorkspacePreamble(body: string): string {
  return body.replace(/^G(?:54|94)\r?\n/gm, '');
}
