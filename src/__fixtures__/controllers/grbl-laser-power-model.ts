// grbl-laser-power-model — an independent oracle for what laser power GRBL
// commands after a sequence of lines. It ports only the parts of gnea/grbl
// gcode.c gc_execute_line() that decide laser output, so a test can feed the
// real bytes KerfDesk writes and ask whether the beam is lit:
//   - `$J=` jogs force G1 in the block only and return before gc_state.modal
//     is written; other `$` commands never touch the parser's modal state;
//   - an explicit G1/G2/G3 (or implicit axis motion) with the feed rate still
//     undefined fails with error:22 and changes nothing;
//   - laser mode ($32=1): any block whose motion mode is not G1/G2/G3 sets
//     LASER_DISABLE, and [4]/[7] then sync the spindle at power 0;
//   - M4 in laser mode is dynamic power, 0 while stationary;
//   - M2/M30 reset modal motion to G1 and switch the spindle off;
//   - power-up and soft reset start in G0 with the spindle off and F0.
// grblHAL core gcode.c applies the same rule (motion_is_lasercut).
// https://github.com/gnea/grbl/blob/master/grbl/gcode.c
// https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode

export type GrblMotionMode = 'G0' | 'G1' | 'G2' | 'G3' | 'G38' | 'G80';
type SpindleMode = 'off' | 'cw' | 'ccw';

export type GrblLaserPowerModel = {
  readonly laserMode: boolean;
  motion: GrblMotionMode;
  spindle: SpindleMode;
  speed: number;
  feed: number;
  /** The power the controller is commanding right now (0 = dark). */
  beam: number;
  readonly errors: string[];
};

type ParsedBlock = {
  readonly motion: GrblMotionMode;
  readonly explicitMotion: boolean;
  readonly axisWords: boolean;
  readonly nonModalAxisCommand: boolean;
  readonly speed: number | undefined;
  readonly feed: number | undefined;
  readonly spindle: SpindleMode | undefined;
  readonly programEnd: boolean;
};

const LASERCUT_MODES: ReadonlyArray<GrblMotionMode> = ['G1', 'G2', 'G3'];

export function powerUpGrbl(laserMode: boolean): GrblLaserPowerModel {
  return { laserMode, motion: 'G0', spindle: 'off', speed: 0, feed: 0, beam: 0, errors: [] };
}

export function runGrblLines(
  model: GrblLaserPowerModel,
  text: string | ReadonlyArray<string>,
): GrblLaserPowerModel {
  const joined = typeof text === 'string' ? text : text.join('\n');
  for (const line of joined.split('\n')) executeGrblLine(model, line);
  return model;
}

export function executeGrblLine(model: GrblLaserPowerModel, raw: string): void {
  const line = raw
    .replace(/\([^)]*\)/g, '')
    .replace(/;.*$/, '')
    .trim()
    .toUpperCase();
  if (line === '' || line.startsWith('$')) return;
  const block = parseBlock(model, line);
  const blockFeed = block.feed ?? model.feed;
  const axisCommandIsMotion =
    block.explicitMotion || (block.axisWords && !block.nonModalAxisCommand);
  if (axisCommandIsMotion && LASERCUT_MODES.includes(block.motion) && blockFeed === 0) {
    model.errors.push(`error:22 on "${raw.trim()}"`);
    return;
  }
  const flags = laserFlags(model, block, axisCommandIsMotion);
  const blockSpeed = block.speed ?? model.speed;
  model.feed = blockFeed;
  // [4. Set spindle speed]
  if (model.speed !== blockSpeed || flags.forceSync) {
    if (model.spindle !== 'off' && !flags.isMotion) {
      model.beam = commandedPower(model, model.spindle, flags.laserDisable ? 0 : blockSpeed);
    }
    model.speed = blockSpeed;
  }
  const plannerSpeed = flags.laserDisable ? 0 : model.speed;
  // [7. Spindle control]
  const blockSpindle = block.spindle ?? model.spindle;
  if (model.spindle !== blockSpindle) {
    model.beam = commandedPower(model, blockSpindle, plannerSpeed);
    model.spindle = blockSpindle;
  }
  model.motion = block.motion;
  if (flags.isMotion) model.beam = commandedPower(model, model.spindle, plannerSpeed);
  if (block.programEnd) {
    model.motion = 'G1';
    model.spindle = 'off';
    model.beam = 0;
  }
}

function parseBlock(model: GrblLaserPowerModel, line: string): ParsedBlock {
  let motion = model.motion;
  let explicitMotion = false;
  let axisWords = false;
  let nonModalAxisCommand = false;
  let speed: number | undefined;
  let feed: number | undefined;
  let spindle: SpindleMode | undefined;
  let programEnd = false;
  for (const word of line.match(/[A-Z][-+]?[0-9.]+/g) ?? []) {
    const letter = word[0] ?? '';
    const value = Number(word.slice(1));
    if (letter === 'G') {
      if (value === 0 || value === 1 || value === 2 || value === 3) {
        motion = `G${value}` as GrblMotionMode;
        explicitMotion = true;
      } else if (Math.floor(value) === 38) {
        motion = 'G38';
        explicitMotion = true;
      } else if (value === 80) {
        motion = 'G80';
      } else if ([10, 28, 30, 92].includes(Math.floor(value))) {
        nonModalAxisCommand = true;
      }
    } else if (letter === 'M') {
      if (value === 3) spindle = 'cw';
      else if (value === 4) spindle = 'ccw';
      else if (value === 5) spindle = 'off';
      else if (value === 2 || value === 30) programEnd = true;
    } else if (letter === 'S') {
      speed = value;
    } else if (letter === 'F') {
      feed = value;
    } else if ('XYZABC'.includes(letter)) {
      axisWords = true;
    }
  }
  return { motion, explicitMotion, axisWords, nonModalAxisCommand, speed, feed, spindle, programEnd };
}

function laserFlags(
  model: GrblLaserPowerModel,
  block: ParsedBlock,
  axisCommandIsMotion: boolean,
): { readonly laserDisable: boolean; readonly isMotion: boolean; readonly forceSync: boolean } {
  if (!model.laserMode) return { laserDisable: false, isMotion: false, forceSync: false };
  const laserDisable = !LASERCUT_MODES.includes(block.motion);
  if (block.axisWords && axisCommandIsMotion) {
    return { laserDisable, isMotion: true, forceSync: false };
  }
  let forceSync = false;
  if (model.spindle === 'cw') {
    forceSync = LASERCUT_MODES.includes(model.motion) ? laserDisable : !laserDisable;
  }
  return { laserDisable, isMotion: false, forceSync };
}

function commandedPower(model: GrblLaserPowerModel, spindle: SpindleMode, rpm: number): number {
  if (spindle === 'off') return 0;
  // spindle_control.c: laser mode forces a stationary M4 to zero power.
  if (spindle === 'ccw' && model.laserMode) return 0;
  return rpm;
}
