// grbl-lit-drain-checker — finds the lines of a laser program at which GRBL
// drains its planner while an M3 (constant-power) beam is still lit mid-job
// (2026-09-25 controller audit, OR-1).
//
// A drain stops the head, and under M3 the beam stays at the last programmed
// power while stopped ("Constant laser power mode simply keeps the laser power
// as programmed, regardless if the machine is moving, accelerating, or
// stopped", GRBL wiki "Grbl v1.1 Laser Mode"), so the head burns a dot there.
//
// Drain rules (gnea/grbl 1.1h, bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e):
//  - gcode.c:917-923 [4]: an S change on a line without axis motion syncs;
//    gcode.c:940-947 [7] a spindle state change and gcode.c:951-957 [8] a
//    coolant change sync too; [10] a dwell syncs;
//  - motion_control.c:67-76: in laser mode, a motion line whose target is the
//    current position (PLAN_EMPTY_BLOCK, planner.c:381) syncs under M3.
// grblHAL core d7aaee3d applies the same rules (gcode.c:4121-4128,
// coolant_control.c:57-67, motion_control.c:182-190). FluidNC v4.0.3 drops a
// zero-length block without a sync (Planner.cpp:342-345), so there only the
// S-change, spindle and coolant rules apply.
//
// The beam and spindle state come from the independent port of gcode.c laser
// power (grbl-laser-power-model.ts). The job's own ending (M9/M5 after the last
// burn) has the same lit stop, but GRBL's guidance is about force-syncs "during
// a job", and no laser-off move exists there, so the ending is left out.

import { executeGrblLine, powerUpGrbl, type GrblLaserPowerModel } from './grbl-laser-power-model';

type Word = { readonly letter: string; readonly value: number };
type Coolant = { mist: boolean; flood: boolean };
type Head = { x: number | null; y: number | null };

/** Every mid-job line that drains GRBL's planner with an M3 beam lit. */
export function findM3LitPlannerDrains(gcode: string): string[] {
  const lines = gcode.split('\n');
  const lastBurn = lastBurnIndex(lines);
  const model = powerUpGrbl(true);
  const coolant: Coolant = { mist: false, flood: false };
  const head: Head = { x: null, y: null };
  const found: string[] = [];
  lines.forEach((line, index) => {
    const lit = model.spindle === 'cw' && model.beam > 0;
    if (index < lastBurn && lit && drainsPlanner(model, coolant, head, line)) {
      found.push(`line ${index + 1} "${line.trim()}" drains with M3 S${model.beam} lit`);
    }
    executeGrblLine(model, line);
    applyCoolant(coolant, line);
    for (const w of words(line)) {
      if (w.letter === 'X') head.x = w.value;
      if (w.letter === 'Y') head.y = w.value;
    }
  });
  return found;
}

function words(line: string): Word[] {
  const code = line
    .replace(/\([^)]*\)/g, '')
    .replace(/;.*$/, '')
    .toUpperCase();
  return [...code.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)].map((m) => ({
    letter: m[1] ?? '',
    value: Number(m[2]),
  }));
}

// A burn is a G1/G2/G3 XY move with positive S under M3 or M4. (The model
// reports M4 power as 0 because it does not model feed scaling, so its beam
// alone would not count M4 burns.)
function lastBurnIndex(lines: ReadonlyArray<string>): number {
  const probe = powerUpGrbl(true);
  let lastBurn = -1;
  lines.forEach((line, index) => {
    executeGrblLine(probe, line);
    const burning =
      probe.spindle !== 'off' && probe.speed > 0 && ['G1', 'G2', 'G3'].includes(probe.motion);
    if (burning && words(line).some((w) => 'XY'.includes(w.letter))) lastBurn = index;
  });
  return lastBurn;
}

function drainsPlanner(
  model: GrblLaserPowerModel,
  coolant: Coolant,
  head: Head,
  line: string,
): boolean {
  const ws = words(line);
  const hasAxis = ws.some((w) => 'XYZ'.includes(w.letter));
  return (
    coincidentUnderM3(model, head, ws, hasAxis) ||
    spindleSync(model, ws, hasAxis) ||
    ws.some((w) => dwellOrCoolantSync(w, coolant))
  );
}

// motion_control.c:67-76: a coincident motion target under M3 syncs.
function coincidentUnderM3(
  model: GrblLaserPowerModel,
  head: Head,
  ws: ReadonlyArray<Word>,
  hasAxis: boolean,
): boolean {
  if (!hasAxis || model.spindle !== 'cw') return false;
  const x = ws.find((w) => w.letter === 'X')?.value ?? head.x;
  const y = ws.find((w) => w.letter === 'Y')?.value ?? head.y;
  return x === head.x && y === head.y;
}

// gcode.c [7] spindle state change, [4] S change on a line without axis motion.
function spindleSync(model: GrblLaserPowerModel, ws: ReadonlyArray<Word>, hasAxis: boolean) {
  const spindleWord = ws.find((w) => w.letter === 'M' && [3, 4, 5].includes(w.value))?.value;
  const spindle =
    spindleWord === undefined
      ? model.spindle
      : ({ 3: 'cw', 4: 'ccw', 5: 'off' } as const)[spindleWord as 3 | 4 | 5];
  if (spindle !== model.spindle) return true;
  const s = ws.find((w) => w.letter === 'S')?.value;
  return s !== undefined && s !== model.speed && !hasAxis && model.spindle !== 'off';
}

// gcode.c [10] dwell, [8] coolant change.
function dwellOrCoolantSync(w: Word, coolant: Coolant): boolean {
  if (w.letter === 'G') return w.value === 4;
  if (w.letter !== 'M') return false;
  if (w.value === 7) return !coolant.mist;
  if (w.value === 8) return !coolant.flood;
  if (w.value === 9) return coolant.mist || coolant.flood;
  return false;
}

function applyCoolant(coolant: Coolant, line: string): void {
  for (const w of words(line)) {
    if (w.letter !== 'M') continue;
    if (w.value === 7) coolant.mist = true;
    if (w.value === 8) coolant.flood = true;
    if (w.value === 9) {
      coolant.mist = false;
      coolant.flood = false;
    }
  }
}
