// marlin-lit-drain-checker — finds the lines of a Marlin laser program at which
// Marlin drains its planner while the beam is lit (audit 2026-10-21, 03-P2-2
// and 03-P3-1; ADR-398 Amendment 1). The Marlin twin of grbl-lit-drain-checker.
//
// Beam rules (MarlinFirmware/Marlin 2.1.2.5, LASER_FEATURE):
//  - `M3 I` selects continuous inline power, `M4 I` dynamic, and `M5 I` leaves
//    inline mode; `M5` applies power 0 once its synchronize returns
//    (M3-M5.cpp).
//  - A G1/G2/G3 S word sets the inline power of its own block and G0 sets it to
//    0 (gcode.cpp:229-247). The power is applied when the block starts
//    (stepper.cpp:2574-2584), so a move that plans no block applies nothing.
//    Marlin drops a block with fewer than MIN_STEPS_PER_SEGMENT steps
//    (planner.cpp:2247-2248); the checker counts a move to the same written
//    position as one, since it does not know the machine's steps/mm.
//  - At an empty planner only dynamic mode switches the beam off
//    (stepper.cpp:2345-2349). Continuous power stays lit while stopped.
//  - Fan-mosfet wiring: `M106 S<n>` and `M107` set the PWM at once, without a
//    synchronize (M106_M107.cpp, LASER_SYNCHRONOUS_M106_M107 off by default).
// Drains: M7/M8/M9 synchronize on every call, even when the state does not
// change (M7-M9.cpp); M3/M4/M5 synchronize (M3-M5.cpp, with LASER_POWER_SYNC
// off by default); G4 synchronizes (G4.cpp), and so does M400.
// After the last burn, `M9` and `M5` are the job's own ending and are allowed,
// as in the GRBL checker.

import { isJobEndWord } from './grbl-lit-drain-checker';

type Word = { readonly letter: string; readonly value: number | null };

type MarlinBeam = {
  mode: 'standard' | 'continuous' | 'dynamic';
  motion: 0 | 1 | 2 | 3;
  /** Inline power the next planned block carries. */
  plannerPower: number;
  /** Inline power the last block that ran applied. */
  inline: number;
  /** Fan-mosfet PWM. */
  fan: number;
  x: number | null;
  y: number | null;
};

/** Every line that drains Marlin's planner with the beam lit, apart from the
 *  job's own M9/M5 after the last burn. */
export function findMarlinLitPlannerDrains(gcode: string): string[] {
  const lines = gcode.split('\n');
  const lastBurn = lastBurnIndex(lines);
  const beam = powerUpMarlin();
  const found: string[] = [];
  lines.forEach((line, index) => {
    const ws = words(line);
    const lit = litAtStop(beam);
    const jobEnd = index > lastBurn && isJobEndWord(line);
    if (lit > 0 && !jobEnd && drainsPlanner(ws)) {
      found.push(`line ${index + 1} "${line.trim()}" drains with the beam lit at ${lit}`);
    }
    executeMarlinLine(beam, ws);
  });
  return found;
}

function powerUpMarlin(): MarlinBeam {
  return {
    mode: 'standard',
    motion: 0,
    plannerPower: 0,
    inline: 0,
    fan: 0,
    x: null,
    y: null,
  };
}

function litAtStop(beam: MarlinBeam): number {
  return Math.max(beam.fan, beam.mode === 'continuous' ? beam.inline : 0);
}

function words(line: string): Word[] {
  const code = line
    .replace(/\([^)]*\)/g, '')
    .replace(/;.*$/, '')
    .toUpperCase();
  return [...code.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))?/g)].map((m) => ({
    letter: m[1] ?? '',
    value: m[2] === undefined ? null : Number(m[2]),
  }));
}

function code(ws: ReadonlyArray<Word>, letter: string): number | null {
  return ws.find((w) => w.letter === letter)?.value ?? null;
}

function drainsPlanner(ws: ReadonlyArray<Word>): boolean {
  return ws.some(
    (w) =>
      (w.letter === 'M' && [3, 4, 5, 7, 8, 9, 400].includes(w.value ?? -1)) ||
      (w.letter === 'G' && w.value === 4),
  );
}

/** Applies one line; returns whether it planned a burning move. */
function executeMarlinLine(beam: MarlinBeam, ws: ReadonlyArray<Word>): boolean {
  const m = code(ws, 'M');
  if (m === null) return executeMotion(beam, ws);
  executeMCode(beam, m, ws);
  return false;
}

function executeMCode(beam: MarlinBeam, m: number, ws: ReadonlyArray<Word>): void {
  const s = code(ws, 'S');
  const inlineFlag = ws.some((w) => w.letter === 'I');
  if (m === 3 || m === 4) armSpindle(beam, m, s, inlineFlag);
  else if (m === 5) stopSpindle(beam, inlineFlag);
  else if (m === 106) beam.fan = s ?? 255;
  else if (m === 107) beam.fan = 0;
}

function armSpindle(beam: MarlinBeam, m: 3 | 4, s: number | null, inlineFlag: boolean): void {
  if (inlineFlag) beam.mode = m === 3 ? 'continuous' : 'dynamic';
  if (beam.mode !== 'standard') beam.plannerPower = s ?? 0;
}

function stopSpindle(beam: MarlinBeam, inlineFlag: boolean): void {
  beam.inline = 0;
  if (!inlineFlag) return;
  beam.mode = 'standard';
  beam.plannerPower = 0;
}

function executeMotion(beam: MarlinBeam, ws: ReadonlyArray<Word>): boolean {
  const g = code(ws, 'G');
  if (g === 0 || g === 1 || g === 2 || g === 3) beam.motion = g;
  if (!ws.some((w) => 'XYZ'.includes(w.letter)) && !isArc(beam, ws)) return false;
  setPlannerPower(beam, code(ws, 'S'));
  if (!plansBlock(beam, ws)) return false;
  if (beam.mode !== 'standard') beam.inline = beam.plannerPower;
  else if (beam.motion === 0) beam.inline = 0;
  return beam.motion !== 0 && (beam.inline > 0 || beam.fan > 0);
}

function isArc(beam: MarlinBeam, ws: ReadonlyArray<Word>): boolean {
  return (beam.motion === 2 || beam.motion === 3) && ws.some((w) => 'IJR'.includes(w.letter));
}

function setPlannerPower(beam: MarlinBeam, s: number | null): void {
  if (beam.mode === 'standard') return;
  if (beam.motion === 0) beam.plannerPower = 0;
  else if (s !== null) beam.plannerPower = s;
}

/** Moves the head; whether Marlin plans a block for the move. */
function plansBlock(beam: MarlinBeam, ws: ReadonlyArray<Word>): boolean {
  const x = code(ws, 'X') ?? beam.x;
  const y = code(ws, 'Y') ?? beam.y;
  const planned = isArc(beam, ws) || x !== beam.x || y !== beam.y;
  beam.x = x;
  beam.y = y;
  return planned;
}

function lastBurnIndex(lines: ReadonlyArray<string>): number {
  const probe = powerUpMarlin();
  let lastBurn = -1;
  lines.forEach((line, index) => {
    if (executeMarlinLine(probe, words(line))) lastBurn = index;
  });
  return lastBurn;
}
