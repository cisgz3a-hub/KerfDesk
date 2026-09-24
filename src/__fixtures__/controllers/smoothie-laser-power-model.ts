// smoothie-laser-power-model — an independent oracle for what a Smoothieware
// laser does with the lines KerfDesk sends. It ports only the parts of
// Smoothieware (edge branch) that decide beam power, feed and position:
//  - GcodeDispatch.cpp: lowercase lines are shell commands; a line starting
//    with X, Y or Z runs as the last G0-G3 command, one starting with F as G1;
//    any other uppercase line without a G, M, T or S command does nothing;
//  - Laser.cpp: `fire <percent>` drives the beam at that power whatever the
//    motion (manual mode) until `fire off`/`fire 0`. `M221 S` sets the power
//    scale in percent and P > 0 disables proportional power, both at once. A
//    G1/G2/G3 block fires at s_value / laser_module_maximum_s_value x scale
//    (x the speed ratio when proportional); a G0 block never fires; a halt
//    ends manual fire but keeps the scale;
//  - Robot.cpp: S is modal on G0-G3 lines and s_value powers up at
//    laser_module_default_power (0.8). F sets the seek rate on a G0 line and
//    the feed rate on G1-G3. M3 and M5 change nothing while the laser module
//    is loaded.
// Arcs, G92, homing and Z moves throw.
// https://github.com/Smoothieware/Smoothieware/tree/edge/src/modules

export type SmoothiePoint = { readonly x: number; readonly y: number };

export type SmoothieBurn = {
  /** 1-based line of the text the model ran. */
  readonly line: number;
  readonly from: SmoothiePoint;
  readonly to: SmoothiePoint;
  /** Fraction of full power at the programmed speed (0-1). */
  readonly power: number;
  /** Power follows speed (M221 P0) or stays constant (P1); manual fire ignores both. */
  readonly mode: 'proportional' | 'constant' | 'manual';
  readonly feed: number;
  /** 'off', 'M7', 'M8' or 'M7M8'. */
  readonly air: string;
};

export type SmoothieLaserModel = {
  /** Manual `fire` power (0-1); 0 in automatic mode. */
  manualFire: number;
  /** M221 S / 100. */
  scale: number;
  /** Laser.cpp disable_auto_power, inverted. */
  proportional: boolean;
  /** Robot s_value. */
  sValue: number;
  readonly maximumS: number;
  feedRate: number;
  seekRate: number;
  /** GcodeDispatch modal_group_1: the G0-G3 a bare axis line runs as. */
  modalMotion: number;
  x: number;
  y: number;
  relative: boolean;
  mist: boolean;
  flood: boolean;
  readonly burns: SmoothieBurn[];
};

type Word = { readonly letter: string; readonly value: number };

// The config-sample default_feed_rate/default_seek_rate and Laser.cpp and
// Robot.cpp's defaults for laser_module_maximum_s_value and
// laser_module_default_power.
const DEFAULT_RATE_MM_PER_MIN = 4000;
const DEFAULT_S_VALUE = 0.8;

export function powerUpSmoothie(
  options: { readonly position?: SmoothiePoint; readonly maximumS?: number } = {},
): SmoothieLaserModel {
  return {
    manualFire: 0,
    scale: 1,
    proportional: true,
    sValue: DEFAULT_S_VALUE,
    maximumS: options.maximumS ?? 1,
    feedRate: DEFAULT_RATE_MM_PER_MIN,
    seekRate: DEFAULT_RATE_MM_PER_MIN,
    modalMotion: 0,
    x: options.position?.x ?? 0,
    y: options.position?.y ?? 0,
    relative: false,
    mist: false,
    flood: false,
    burns: [],
  };
}

export function runSmoothieLines(
  model: SmoothieLaserModel,
  text: string | ReadonlyArray<string>,
): SmoothieLaserModel {
  const lines = typeof text === 'string' ? text.split('\n') : text;
  lines.forEach((raw, index) => executeSmoothieLine(model, raw, index + 1));
  return model;
}

/** Laser::on_halt: the beam goes off and manual fire ends; M221 is kept. */
export function haltSmoothie(model: SmoothieLaserModel): void {
  model.manualFire = 0;
}

export function executeSmoothieLine(model: SmoothieLaserModel, raw: string, line = 0): void {
  const text = raw
    .replace(/\([^)]*\)/g, '')
    .replace(/;.*$/, '')
    .trim();
  if (text === '') return;
  if (/^[a-z]/.test(text)) {
    executeShellLine(model, text);
    return;
  }
  const first = text[0] ?? '';
  let command = text.toUpperCase();
  if ('XYZ'.includes(first)) command = `G${model.modalMotion} ${command}`;
  else if (first === 'F') command = `G1 ${command}`;
  else if (!'GMTSN'.includes(first)) return;
  executeCommand(model, parseWords(command), line);
}

function executeShellLine(model: SmoothieLaserModel, text: string): void {
  const [name, argument] = text.split(/\s+/);
  if (name !== 'fire' || argument === undefined || argument === 'status') return;
  model.manualFire = argument === 'off' ? 0 : Math.min(100, Math.max(0, Number(argument))) / 100;
}

function executeCommand(model: SmoothieLaserModel, words: ReadonlyArray<Word>, line: number): void {
  const m = words.find((word) => word.letter === 'M')?.value;
  if (m !== undefined) {
    executeMCode(model, m, words);
    return;
  }
  const g = words.find((word) => word.letter === 'G')?.value;
  if (g === undefined) return;
  if (g === 90 || g === 91) model.relative = g === 91;
  else if (g >= 0 && g <= 3) executeMotion(model, g, words, line);
  else if (!NO_EFFECT_G.has(g)) {
    throw new Error(`Line ${line}: G${g} is outside the oracle's subset`);
  }
}

// G4 dwells, G21 is millimetres, G54-G59 select a work system (offsets are not
// modelled) and Robot.cpp has no G94.
const NO_EFFECT_G: ReadonlySet<number> = new Set([4, 21, 54, 55, 56, 57, 58, 59, 94]);

function executeMCode(model: SmoothieLaserModel, code: number, words: ReadonlyArray<Word>): void {
  if (code === 221) {
    const scale = wordValue(words, 'S');
    const p = wordValue(words, 'P');
    if (scale !== undefined) model.scale = scale / 100;
    if (p !== undefined) model.proportional = p <= 0;
  } else if (code === 7) model.mist = true;
  else if (code === 8) model.flood = true;
  else if (code === 9) {
    model.mist = false;
    model.flood = false;
  }
}

function executeMotion(
  model: SmoothieLaserModel,
  g: number,
  words: ReadonlyArray<Word>,
  line: number,
): void {
  if (g >= 2) throw new Error(`Line ${line}: arcs are not modelled`);
  if (wordValue(words, 'Z') !== undefined) throw new Error(`Line ${line}: Z is not modelled`);
  model.modalMotion = g;
  const s = wordValue(words, 'S');
  if (s !== undefined) model.sValue = s;
  const feed = wordValue(words, 'F');
  if (feed !== undefined && g === 0) model.seekRate = feed;
  if (feed !== undefined && g !== 0) model.feedRate = feed;
  const to = {
    x: axis(model, model.x, wordValue(words, 'X')),
    y: axis(model, model.y, wordValue(words, 'Y')),
  };
  if (to.x === model.x && to.y === model.y) return;
  recordBurn(model, g, to, line);
  model.x = to.x;
  model.y = to.y;
}

function recordBurn(model: SmoothieLaserModel, g: number, to: SmoothiePoint, line: number): void {
  const burn = blockPower(model, g);
  if (burn.power <= 0) return;
  model.burns.push({
    line,
    from: { x: model.x, y: model.y },
    to,
    power: burn.power,
    mode: burn.mode,
    feed: g === 0 ? model.seekRate : model.feedRate,
    air: `${model.mist ? 'M7' : ''}${model.flood ? 'M8' : ''}` || 'off',
  });
}

// Laser::set_proportional_power and get_laser_power, at the programmed speed.
function blockPower(
  model: SmoothieLaserModel,
  g: number,
): { readonly power: number; readonly mode: SmoothieBurn['mode'] } {
  if (model.manualFire > 0) return { power: model.manualFire, mode: 'manual' };
  if (g === 0) return { power: 0, mode: 'constant' };
  const power = Math.min(1, Math.max(0, (model.sValue / model.maximumS) * model.scale));
  return { power, mode: model.proportional ? 'proportional' : 'constant' };
}

function axis(model: SmoothieLaserModel, current: number, word: number | undefined): number {
  if (word === undefined) return current;
  return model.relative ? current + word : word;
}

function parseWords(text: string): Word[] {
  return [...text.matchAll(/([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g)].map((match) => ({
    letter: match[1] ?? '',
    value: Number(match[2]),
  }));
}

function wordValue(words: ReadonlyArray<Word>, letter: string): number | undefined {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (word?.letter === letter) return word.value;
  }
  return undefined;
}
