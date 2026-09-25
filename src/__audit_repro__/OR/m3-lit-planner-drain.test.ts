// Audit track OR, finding OR-1 (repro; expected to FAIL on current code).
//
// Correct behaviour: in GRBL M3 constant-power laser output, no line that makes
// GRBL drain its planner may follow a powered (S>0) G1 while the beam is still
// lit. A drain stops the head, and in M3 the beam stays at the last programmed
// power while stopped, so the head burns a dot at the stop point.
//
// Upstream proof (gnea/grbl 1.1h, bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e):
//  - gcode.c:916-926 [4. Set spindle speed]: an S change on a line without axis
//    motion calls spindle_sync(); gcode.c:946 [7] spindle state change and
//    gcode.c:955 [8] coolant change (coolant_sync) sync too.
//  - coolant_control.c:121-126 and spindle_control.c:277-282 call
//    protocol_buffer_synchronize() (protocol.c:169-177), which waits until the
//    planner is empty and the cycle has stopped.
//  - stepper.c:392-398: when the segment buffer empties, only a rate-adjusted
//    (M4) block switches the PWM off; an M3 block leaves it on. st_go_idle()
//    then holds for $1 ms (stepper.c:259-262; defaults.h:49 = 25 ms).
//  - GRBL wiki "Grbl v1.1 Laser Mode": "Constant laser power mode simply keeps
//    the laser power as programmed, regardless if the machine is moving,
//    accelerating, or stopped." and, for CAM developers, "When using M3
//    constant laser power mode, try to avoid force-sync conditions during a job
//    whenever possible."
//
// The oracle is the repository's independent port of gcode.c laser power
// (src/__fixtures__/controllers/grbl-laser-power-model.ts); the sync
// predicate below follows gcode.c [4]/[7]/[8]/[10].

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../../core/devices';
import type { CutGroup, Job } from '../../core/job';
import { grblStrategy } from '../../core/output/grbl-strategy';
import {
  executeGrblLine,
  powerUpGrbl,
  type GrblLaserPowerModel,
} from '../../__fixtures__/controllers/grbl-laser-power-model';

type Coolant = { mist: boolean; flood: boolean };

function words(line: string): Array<{ letter: string; value: number }> {
  const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').toUpperCase();
  return [...code.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)].map((m) => ({
    letter: m[1] ?? '',
    value: Number(m[2]),
  }));
}

/** True when GRBL 1.1h drains its planner while executing this line
 * (gcode.c [4] S change without axis motion, [7] spindle change,
 * [8] coolant change, [10] dwell). */
function drainsPlanner(model: GrblLaserPowerModel, coolant: Coolant, line: string): boolean {
  const ws = words(line);
  const hasAxis = ws.some((w) => 'XYZ'.includes(w.letter));
  const s = ws.find((w) => w.letter === 'S')?.value;
  const spindleWord = ws.find((w) => w.letter === 'M' && [3, 4, 5].includes(w.value))?.value;
  const spindle = spindleWord === 3 ? 'cw' : spindleWord === 4 ? 'ccw' : spindleWord === 5 ? 'off' : model.spindle;
  if (spindle !== model.spindle) return true;
  if (s !== undefined && s !== model.speed && !hasAxis && model.spindle !== 'off') return true;
  for (const w of ws) {
    if (w.letter === 'G' && w.value === 4) return true;
    if (w.letter !== 'M') continue;
    if (w.value === 7 && !coolant.mist) return true;
    if (w.value === 8 && !coolant.flood) return true;
    if (w.value === 9 && (coolant.mist || coolant.flood)) return true;
  }
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

/** Lines where GRBL stops with an M3 beam lit while more burning follows
 * (the job's own ending M9/M5 has the same $1 ms lit stop, but GRBL's guidance
 * is about force-syncs "during a job", so the ending is left out). */
function litDrains(gcode: string): string[] {
  const lines = gcode.split('\n');
  const probe = powerUpGrbl(true);
  let lastBurn = -1;
  lines.forEach((line, index) => {
    executeGrblLine(probe, line);
    if (probe.beam > 0 && words(line).some((w) => 'XY'.includes(w.letter))) lastBurn = index;
  });
  const model = powerUpGrbl(true);
  const coolant: Coolant = { mist: false, flood: false };
  const found: string[] = [];
  lines.forEach((line, index) => {
    const midJob = index < lastBurn;
    if (midJob && drainsPlanner(model, coolant, line) && model.spindle === 'cw' && model.beam > 0) {
      found.push(`line ${index + 1} "${line.trim()}" drains with M3 S${model.beam} lit`);
    }
    executeGrblLine(model, line);
    applyCoolant(coolant, line);
  });
  return found;
}

function square(id: string, passes: number, airAssist: boolean): CutGroup {
  return {
    kind: 'cut',
    layerId: id,
    color: '#ff0000',
    power: 80,
    speed: 1200,
    passes,
    airAssist,
    powerMode: 'constant',
    segments: [
      {
        polyline: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 20, y: 20 },
          { x: 10, y: 10 },
        ],
        closed: true,
      },
    ],
  };
}

describe('OR-1: M3 constant-power output never drains the planner with the beam lit', () => {
  it('Neotronics 4040 profile (constant-power cut dialect), two-pass cut', () => {
    const { powerMode: _unused, ...dialectDefault } = square('A', 2, false);
    void _unused;
    const gcode = grblStrategy.emit({ groups: [dialectDefault] }, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    expect(litDrains(gcode)).toEqual([]);
  });

  it('M8 air profile, two constant-power layers that differ in air assist', () => {
    const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' };
    const job: Job = { groups: [square('A', 1, true), square('B', 1, false)] };
    expect(litDrains(grblStrategy.emit(job, device))).toEqual([]);
  });
});
