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
//  - motion_control.c:67-73: in laser mode, a motion line whose target is the
//    current position (PLAN_EMPTY_BLOCK, planner.c:381) calls spindle_sync()
//    under M3 ("Forces a buffer sync while in M3 laser mode only").
//  - coolant_control.c:121-126 and spindle_control.c:277-282 call
//    protocol_buffer_synchronize() (protocol.c:169-177), which waits until the
//    planner is empty and the cycle has stopped.
//  - stepper.c:392-398: when the segment buffer empties, st_go_idle() runs
//    first and, unless $1=255, blocks in the stepper ISR for $1 ms
//    (stepper.c:259-262; defaults.h:49 = 25 ms); only then is the PWM switched
//    off, and only for a rate-adjusted (M4) block. An M3 block stays lit until
//    the parser's spindle_set_state() or the next motion segment changes it.
//    (grblHAL defers the de-energize to a task, stepper.c:267-275, and FluidNC
//    polls it, Protocol.cpp:290-293, so neither adds the $1 dwell.)
//  - grblHAL core d7aaee3d: gcode.c:4121-4126 syncs the same S change, gcode.c:4411
//    and coolant_control.c:57-67 sync coolant, coolant_control.c:45-53 then
//    dwells `$673` (settings.h:457; 0 or 0.5-20 s) after turning coolant on, and
//    stepper.c:566-573 switches the PWM off at an empty buffer only for
//    rate-adjusted (M4) laser blocks. FluidNC v4.0.3 Stepper.cpp:234-240 is the same,
//    and GCode.cpp:1716-1733 + CoolantControl.cpp:72-79 dwell `coolant/delay_ms`
//    (0-10000 ms, CoolantControl.cpp:90) after turning coolant on.
//  - GRBL wiki "Grbl v1.1 Laser Mode": "Constant laser power mode simply keeps
//    the laser power as programmed, regardless if the machine is moving,
//    accelerating, or stopped." and, for CAM developers, "When using M3
//    constant laser power mode, try to avoid force-sync conditions during a job
//    whenever possible."
//
// The oracle is the repository's independent port of gcode.c laser power
// (src/__fixtures__/controllers/grbl-laser-power-model.ts); the sync
// predicate below follows gcode.c [4]/[7]/[8]/[10] and motion_control.c:67-73.
// The coincident-target rule holds for GRBL 1.1h and grblHAL
// (motion_control.c:182-190); FluidNC v4.0.3 drops a zero-length block without
// a sync (Planner.cpp:342-345), so on FluidNC only the S-change, spindle and
// coolant drains apply.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../../core/devices';
import type { CutGroup, Job, RasterGroup } from '../../core/job';
import { grblStrategy } from '../../core/output/grbl-strategy';
import {
  executeGrblLine,
  powerUpGrbl,
  type GrblLaserPowerModel,
} from '../../__fixtures__/controllers/grbl-laser-power-model';

type Coolant = { mist: boolean; flood: boolean };

function words(line: string): Array<{ letter: string; value: number }> {
  const code = line
    .replace(/\([^)]*\)/g, '')
    .replace(/;.*$/, '')
    .toUpperCase();
  return [...code.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)].map((m) => ({
    letter: m[1] ?? '',
    value: Number(m[2]),
  }));
}

type Head = { x: number | null; y: number | null };

/** True when GRBL 1.1h drains its planner while executing this line
 * (gcode.c [4] S change without axis motion, [7] spindle change,
 * [8] coolant change, [10] dwell; motion_control.c:67-73 coincident target). */
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

// motion_control.c:67-73: a coincident motion target under M3 syncs.
function coincidentUnderM3(
  model: GrblLaserPowerModel,
  head: Head,
  ws: ReadonlyArray<{ letter: string; value: number }>,
  hasAxis: boolean,
): boolean {
  if (!hasAxis || model.spindle !== 'cw') return false;
  const x = ws.find((w) => w.letter === 'X')?.value ?? head.x;
  const y = ws.find((w) => w.letter === 'Y')?.value ?? head.y;
  return x === head.x && y === head.y;
}

// gcode.c [7] spindle state change, [4] S change on a line without axis motion.
function spindleSync(
  model: GrblLaserPowerModel,
  ws: ReadonlyArray<{ letter: string; value: number }>,
  hasAxis: boolean,
): boolean {
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
function dwellOrCoolantSync(w: { letter: string; value: number }, coolant: Coolant): boolean {
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

/** Lines where GRBL stops with an M3 beam lit while more burning follows
 * (the job's own ending M9/M5 has the same $1 ms lit stop, but GRBL's guidance
 * is about force-syncs "during a job", so the ending is left out). */
function litDrains(gcode: string): string[] {
  const lines = gcode.split('\n');
  const probe = powerUpGrbl(true);
  let lastBurn = -1;
  lines.forEach((line, index) => {
    executeGrblLine(probe, line);
    // A burn is a G1/G2/G3 XY move with positive S under M3 or M4. (The
    // fixture reports M4 power as 0 because it does not model feed scaling,
    // so `probe.beam` alone would not count M4 burns.)
    const burning =
      probe.spindle !== 'off' && probe.speed > 0 && ['G1', 'G2', 'G3'].includes(probe.motion);
    if (burning && words(line).some((w) => 'XY'.includes(w.letter))) lastBurn = index;
  });
  const model = powerUpGrbl(true);
  const coolant: Coolant = { mist: false, flood: false };
  const head: Head = { x: null, y: null };
  const found: string[] = [];
  lines.forEach((line, index) => {
    const midJob = index < lastBurn;
    if (
      midJob &&
      drainsPlanner(model, coolant, head, line) &&
      model.spindle === 'cw' &&
      model.beam > 0
    ) {
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
    const gcode = grblStrategy.emit(
      { groups: [dialectDefault] },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    );
    expect(litDrains(gcode)).toEqual([]);
  });

  it('M8 air profile, two constant-power layers that differ in air assist', () => {
    const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' };
    const job: Job = { groups: [square('A', 1, true), square('B', 1, false)] };
    expect(litDrains(grblStrategy.emit(job, device))).toEqual([]);
  });

  it('M8 air profile, constant-power layer without air followed by one with air', () => {
    // grblHAL applies its `$673` coolant on-delay (0.5-20 s, coolant_control.c:45-53)
    // inside this drain, so the lit dwell lasts the whole delay there.
    const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' };
    const job: Job = { groups: [square('A', 1, false), square('B', 1, true)] };
    expect(litDrains(grblStrategy.emit(job, device))).toEqual([]);
  });

  // Added 2026-09-25 (second session). emit-raster.ts:301-308 closes a row with
  // `G1 X<same> S0` when overscan is 0 (a zero-length move, "so the line stays a
  // motion block that darkens the beam", :338-340). Under M3 that is exactly GRBL's
  // coincident-target sync (motion_control.c:67-73; grblHAL motion_control.c:182-190),
  // taken with the row's last power still lit. The `grbl-compatible` dialect
  // runs raster in M3 (gcode-dialects.ts:115-117).
  it('grbl-compatible dialect raster with zero overscan closes each row with a zero-length G1 S0', () => {
    const device: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      gcodeDialect: { dialectId: 'grbl-compatible' },
    };
    expect(litDrains(grblStrategy.emit({ groups: [image(0)] }, device))).toEqual([]);
  });

  // emit-raster.ts:113-116 opens every image layer with `M5` "so we don't get
  // stuck in M3 from a preceding cut group"; after a constant-power cut that M5
  // is a spindle-state change (gcode.c:942-948) taken right after the last burn.
  it('constant-power cut followed by an image layer (the raster header M5)', () => {
    const cut = square('A', 1, false);
    expect(
      litDrains(grblStrategy.emit({ groups: [cut, image(5)] }, DEFAULT_DEVICE_PROFILE)),
    ).toEqual([]);
  });
});

function image(overscanMm: number): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'R',
    color: '#000000',
    power: 50,
    speed: 3000,
    passes: 1,
    airAssist: false,
    sValues: new Uint16Array([0, 500, 500, 0, 0, 300, 300, 300]),
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 30, minY: 30, maxX: 34, maxY: 32 },
    overscanMm,
    dotWidthCorrectionMm: 0,
  } as unknown as RasterGroup;
}
