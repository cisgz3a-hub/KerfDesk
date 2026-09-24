// marlin-laser-power-model — an independent oracle for what a Marlin laser does
// with the lines KerfDesk sends. It ports only the parts of Marlin 2.1.2.6
// (unchanged in 2.1.2.8) that decide beam power, feed and position, with the
// default Configuration_adv.h (no GCODE_MOTION_MODES, G0_FEEDRATE,
// LASER_POWER_SYNC, LASER_POWER_TRAP or LASER_SYNCHRONOUS_M106_M107):
//  - parser.cpp: a line is a G, M or T command; a line that starts with F or
//    an axis letter is an unknown command and changes nothing;
//  - M3-M5.cpp: `M3 I`/`M4 I` select continuous/dynamic inline mode and enable
//    the inline output; M3/M4 in inline mode set the inline power to S, or to
//    the last unit power; in standard mode they drive the output directly. M5
//    zeroes the output and disables it; `M5 I` also returns to standard mode;
//  - gcode.cpp get_destination_from_command: in inline mode a G1-G3 marks the
//    move powered, takes S as the inline power and an I word re-enables the
//    output; a G0 sets the inline power to 0. In standard mode a G0 applies
//    power 0. An F above 0 sets the one feed rate G0 and G1 share;
//  - planner.cpp and stepper.cpp: a move keeps the inline power and status
//    and the fan speed current when it was planned. In continuous mode an
//    enabled move applies its power (0 when not powered) as it starts; a
//    disabled one leaves the output alone. A zero-length move plans nothing;
//  - M106_M107.cpp: M106 sets the fan to S (255 without one), M107 to 0.
// Dynamic inline mode derives power from the feed rate and is not modelled:
// a move in it throws, and so do arcs, G92 and homing.
// https://github.com/MarlinFirmware/Marlin/tree/2.1.2.6/Marlin/src

export type MarlinPoint = { readonly x: number; readonly y: number };

export type MarlinBurn = {
  /** 1-based line of the text the model ran. */
  readonly line: number;
  readonly from: MarlinPoint;
  readonly to: MarlinPoint;
  /** Laser output (cutter power) or fan speed during the move. */
  readonly power: number;
  /** The cutter in standard or continuous inline mode, or the fan output. */
  readonly source: 'standard' | 'continuous' | 'fan';
  readonly feed: number;
  /** 'off', 'M7', 'M8' or 'M7M8'. */
  readonly air: string;
};

export type MarlinLaserModel = {
  mode: 'standard' | 'continuous' | 'dynamic';
  /** planner.laser_inline.status.isEnabled */
  inlineEnabled: boolean;
  /** planner.laser_inline.status.isPowered */
  isPowered: boolean;
  /** planner.laser_inline.power */
  inlinePower: number;
  /** cutter.unitPower */
  unitPower: number;
  /** The output the cutter drives right now. */
  output: number;
  /** thermalManager.fan_speed[0] */
  fan: number;
  /** feedrate_mm_s, in mm/min. */
  feed: number;
  x: number;
  y: number;
  relative: boolean;
  mist: boolean;
  flood: boolean;
  readonly burns: MarlinBurn[];
  /** Lines Marlin answers with "Unknown command". */
  readonly unknown: string[];
};

type Word = { readonly letter: string; readonly value: number };

// motion.cpp: DEFAULT_FEEDRATE_MM_M.
const DEFAULT_FEED_MM_PER_MIN = 4000;

export function powerUpMarlin(position: MarlinPoint = { x: 0, y: 0 }): MarlinLaserModel {
  return {
    mode: 'standard',
    inlineEnabled: false,
    isPowered: false,
    inlinePower: 0,
    unitPower: 0,
    output: 0,
    fan: 0,
    feed: DEFAULT_FEED_MM_PER_MIN,
    x: position.x,
    y: position.y,
    relative: false,
    mist: false,
    flood: false,
    burns: [],
    unknown: [],
  };
}

export function runMarlinLines(
  model: MarlinLaserModel,
  text: string | ReadonlyArray<string>,
): MarlinLaserModel {
  const lines = typeof text === 'string' ? text.split('\n') : text;
  lines.forEach((raw, index) => executeMarlinLine(model, raw, index + 1));
  return model;
}

export function executeMarlinLine(model: MarlinLaserModel, raw: string, line = 0): void {
  const text = raw.replace(/;.*$/, '').trim().toUpperCase();
  if (text === '') return;
  const words = parseWords(text);
  const command = words[0];
  if (command === undefined || !['G', 'M', 'T'].includes(command.letter)) {
    model.unknown.push(raw.trim());
    return;
  }
  const flag = hasFlag(text);
  if (command.letter === 'M') executeMCode(model, command.value, words, flag);
  else if (command.letter === 'G') executeGCode(model, command.value, words, flag, line);
}

function executeMCode(
  model: MarlinLaserModel,
  code: number,
  words: ReadonlyArray<Word>,
  flag: boolean,
): void {
  if (code === 3 || code === 4) setCutter(model, code === 4, words, flag);
  else if (code === 5) stopCutter(model, flag);
  else if (code === 106) model.fan = Math.min(255, wordValue(words, 'S') ?? 255);
  else if (code === 107) model.fan = 0;
  else if (code === 7) model.mist = true;
  else if (code === 8) model.flood = true;
  else if (code === 9) {
    model.mist = false;
    model.flood = false;
  }
}

// GcodeSuite::M3_M4.
function setCutter(
  model: MarlinLaserModel,
  isM4: boolean,
  words: ReadonlyArray<Word>,
  flag: boolean,
): void {
  if (flag) {
    model.mode = isM4 ? 'dynamic' : 'continuous';
    model.inlinePower = 0;
    model.inlineEnabled = true;
  }
  const power = wordValue(words, 'S');
  if (model.mode === 'standard') {
    if (power === undefined) throw new Error('Standard-mode M3/M4 without S is not modelled.');
    model.unitPower = power;
    model.output = power;
    return;
  }
  model.isPowered = true;
  if (power !== undefined) model.unitPower = power;
  model.inlinePower = model.unitPower;
}

// GcodeSuite::M5.
function stopCutter(model: MarlinLaserModel, flag: boolean): void {
  model.output = 0;
  if (model.mode !== 'standard' && flag) {
    model.inlinePower = 0;
    model.mode = 'standard';
  }
  model.inlineEnabled = false;
}

function executeGCode(
  model: MarlinLaserModel,
  code: number,
  words: ReadonlyArray<Word>,
  flag: boolean,
  line: number,
): void {
  if (executeModalGCode(model, code)) return;
  if (code !== 0 && code !== 1) {
    throw new Error(`Line ${line}: G${code} is outside the oracle's subset`);
  }
  const feed = wordValue(words, 'F');
  if (feed !== undefined && feed > 0) model.feed = feed;
  applyInlinePower(model, code, words, flag);
  move(model, words, line);
}

/** True when `code` is a G code that moves nothing. */
function executeModalGCode(model: MarlinLaserModel, code: number): boolean {
  if (code === 90 || code === 91) {
    model.relative = code === 91;
    return true;
  }
  // G21 is a no-op without INCH_MODE_SUPPORT; G4 dwells.
  if (code === 21 || code === 4) return true;
  // Unknown commands: G54-G59 need CNC_COORDINATE_SYSTEMS, and Marlin has no G94.
  if ((code >= 54 && code <= 59) || code === 94) {
    model.unknown.push(`G${code}`);
    return true;
  }
  return false;
}

function applyInlinePower(
  model: MarlinLaserModel,
  code: number,
  words: ReadonlyArray<Word>,
  flag: boolean,
): void {
  if (model.mode === 'standard') {
    if (code === 0) model.output = 0;
    return;
  }
  if (code === 0) {
    if (model.mode === 'dynamic') model.isPowered = false;
    model.inlinePower = 0;
    return;
  }
  model.isPowered = true;
  if (flag || wordValue(words, 'I') !== undefined) model.inlineEnabled = true;
  const power = wordValue(words, 'S');
  if (power === undefined) return;
  model.unitPower = power;
  model.inlinePower = power;
}

function move(model: MarlinLaserModel, words: ReadonlyArray<Word>, line: number): void {
  if (wordValue(words, 'Z') !== undefined) throw new Error(`Line ${line}: Z is not modelled`);
  const to = {
    x: axis(model, model.x, wordValue(words, 'X')),
    y: axis(model, model.y, wordValue(words, 'Y')),
  };
  if (to.x === model.x && to.y === model.y) return;
  const mode = model.mode;
  if (mode === 'dynamic') throw new Error(`Line ${line}: dynamic inline power is not modelled`);
  // stepper.cpp: an enabled continuous-mode move applies its power as it starts.
  if (mode === 'continuous' && model.inlineEnabled) {
    model.output = model.isPowered ? model.inlinePower : 0;
  }
  recordBurns(model, mode, to, line);
  model.x = to.x;
  model.y = to.y;
}

function recordBurns(
  model: MarlinLaserModel,
  mode: 'standard' | 'continuous',
  to: MarlinPoint,
  line: number,
): void {
  const from = { x: model.x, y: model.y };
  const air = `${model.mist ? 'M7' : ''}${model.flood ? 'M8' : ''}` || 'off';
  if (model.output > 0) {
    model.burns.push({ line, from, to, power: model.output, source: mode, feed: model.feed, air });
  }
  if (model.fan > 0) {
    model.burns.push({ line, from, to, power: model.fan, source: 'fan', feed: model.feed, air });
  }
}

function axis(model: MarlinLaserModel, current: number, word: number | undefined): number {
  if (word === undefined) return current;
  return model.relative ? current + word : word;
}

function parseWords(text: string): Word[] {
  return [...text.matchAll(/([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g)].map((match) => ({
    letter: match[1] ?? '',
    value: Number(match[2]),
  }));
}

// A bare I parameter: the inline flag of M3/M4/M5 (and LightBurn's G1 I).
function hasFlag(text: string): boolean {
  return /(?:^|\s)I(?=\s|$)/.test(text);
}

function wordValue(words: ReadonlyArray<Word>, letter: string): number | undefined {
  for (let index = words.length - 1; index >= 1; index -= 1) {
    const word = words[index];
    if (word?.letter === letter) return word.value;
  }
  return undefined;
}
