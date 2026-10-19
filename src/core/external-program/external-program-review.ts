// external-program-review — what an external run's review shows (ADR-630):
// the XY envelope its Frame traces, the units it declares, and warnings. Every
// warning informs; none refuses (PROJECT.md non-negotiable 21, ADR-228).
// The parsed model is the G-code Inspector's own (core/gcode-view), read from
// the exact canonical bytes the run sends and from where the head stands, so
// the Frame traces the outline the controller will run. Commands are found
// with the same word scanner the parsers use, so spellings such as `G+91`,
// `G91.0` or `G 91` cannot hide one.

import type { GcodeRenderModel, ProgramFinding } from '../gcode-view';
import { scanGcodeWords } from '../gcode/word-scan';

export type ExternalProgramEnvelope = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type ExternalProgramUnits = 'mm' | 'inch' | 'both' | 'undeclared';

export type ExternalProgramReview = {
  /** Work-coordinate XY extent in mm; null when the program never moves. */
  readonly envelope: ExternalProgramEnvelope | null;
  readonly units: ExternalProgramUnits;
  readonly warnings: ReadonlyArray<string>;
};

export type ExternalProgramContext = {
  readonly machineKind: 'laser' | 'cnc';
  /** The laser's S value for 100% power (`$30`). */
  readonly laserMaxPowerS: number;
};

type ReviewModel = Pick<GcodeRenderModel, 'stats' | 'events'>;

/** The G and M commands a program uses, to a tenth (G28.1 is 28.1). */
type Commands = {
  readonly g: ReadonlySet<number>;
  readonly m: ReadonlySet<number>;
  readonly offsetWrites: ReadonlySet<number>;
};

const COMMAND_WARNINGS: ReadonlyArray<{
  readonly matches: (commands: Commands) => boolean;
  readonly warning: string;
}> = [
  {
    matches: (c) => c.g.has(53),
    warning:
      'The program moves in machine coordinates (G53). The Frame traced work coordinates, so those moves were not traced.',
  },
  {
    matches: (c) => [92, 92.1, 92.2, 92.3].some((code) => c.g.has(code)),
    warning:
      'The program sets or clears its own origin (G92). Moves after it are placed from that origin, not from the one the Frame used.',
  },
  {
    matches: (c) => c.g.has(28) || c.g.has(30),
    warning:
      'The program moves to a stored position (G28 or G30). The Frame cannot trace where that is.',
  },
  {
    matches: (c) => c.g.has(28.1) || c.g.has(30.1),
    warning:
      'The program stores a new G28 or G30 position (G28.1 or G30.1). The controller keeps it for later programs.',
  },
  {
    matches: (c) => c.g.has(91),
    warning:
      'The program uses relative moves (G91). Its outline is read from where the head stands now; Start runs it from that same spot.',
  },
  {
    matches: (c) => c.m.has(6),
    warning:
      'The program asks for a tool change (M6). Stock GRBL does not support M6 and stops with an error there.',
  },
  {
    // An external run sends M0/M1 unchanged; the hold is the controller's own.
    matches: (c) => c.m.has(0) || c.m.has(1),
    warning:
      "The program stops with M0 or M1. The controller holds there until the machine's own cycle start is pressed; KerfDesk's Resume does not release a stop the program asked for.",
  },
];

export function reviewExternalProgram(
  gcode: string,
  model: ReviewModel,
  context: ExternalProgramContext,
  findings: ReadonlyArray<ProgramFinding> = [],
): ExternalProgramReview {
  const commands = commandsIn(gcode);
  const warnings = [
    ...offsetWriteWarnings(commands),
    ...COMMAND_WARNINGS.filter((check) => check.matches(commands)).map((check) => check.warning),
    ...coordinateSystemWarnings(model),
    ...pointEnvelopeWarnings(gcode, model),
    ...unitWarnings(model),
    ...toolLeftOnWarnings(model),
    ...machineModeWarnings(model, context),
    ...findings
      .filter((finding) => finding.severity !== 'info')
      .map((finding) => `${finding.title}: ${finding.detail}`),
  ];
  return { envelope: envelopeOf(model), units: declaredUnits(model), warnings };
}

function commandsIn(gcode: string): Commands {
  const g = new Set<number>();
  const m = new Set<number>();
  const offsetWrites = new Set<number>();
  for (const line of gcode.split('\n')) {
    const words = scanGcodeWords(line);
    for (const word of words) {
      const code = Math.round(word.value * 10) / 10;
      if (word.letter === 'G') g.add(code);
      else if (word.letter === 'M') m.add(code);
    }
    if (words.some((word) => word.letter === 'G' && Math.round(word.value * 10) === 100)) {
      const mode = words.find((word) => word.letter === 'L')?.value;
      if (mode === 2 || mode === 20) offsetWrites.add(mode);
    }
  }
  return { g, m, offsetWrites };
}

// Offset writes lead: a program that moves its own origin runs somewhere the
// Frame did not trace, and the controller keeps the new offset afterwards.
function offsetWriteWarnings(commands: Commands): ReadonlyArray<string> {
  return [...commands.offsetWrites].map(
    (mode) =>
      `The program writes work-coordinate offsets (G10 L${mode}). The Frame used the current work origin and does not model this write; subsequent moves may be displaced from the traced outline, and later jobs start from the changed origin.`,
  );
}

function pointEnvelopeWarnings(gcode: string, model: ReviewModel): ReadonlyArray<string> {
  const bounds = model.stats.programBounds;
  if (bounds === null || bounds.minX !== bounds.maxX || bounds.minY !== bounds.maxY) return [];
  const axes = new Set(
    gcode
      .split('\n')
      .flatMap((line) => scanGcodeWords(line))
      .map((word) => word.letter),
  );
  const unset = ['X', 'Y'].filter((axis) => !axes.has(axis));
  return [
    'The program has zero XY extent: its Frame visits a point, with no XY outline to trace. The Frame does not prove Z clearance or cutting depth.' +
      (unset.length === 0
        ? ''
        : ` It never sets ${unset.join(' or ')}, so it runs where the head stands now on that axis.`),
  ];
}

function envelopeOf(model: ReviewModel): ExternalProgramEnvelope | null {
  const bounds = model.stats.programBounds;
  if (bounds === null) return null;
  const values = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
  if (!values.every(Number.isFinite)) return null;
  return { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY };
}

// The run's first line is KerfDesk's G21G90 baseline (EXTERNAL_PROGRAM_BASELINE),
// so it is not one of the program's own unit choices.
function programUnitEvents(model: ReviewModel): ReadonlyArray<'mm' | 'inch'> {
  return model.events.flatMap((event) =>
    event.kind === 'units' && event.line > 0 ? [event.units] : [],
  );
}

function declaredUnits(model: ReviewModel): ExternalProgramUnits {
  const declared = new Set(programUnitEvents(model));
  if (declared.size === 0) return 'undeclared';
  if (declared.size > 1) return 'both';
  return declared.has('inch') ? 'inch' : 'mm';
}

// GRBL's unit mode follows the last G20/G21, so the warning names how the
// program ends, not merely that inches appear somewhere.
function unitWarnings(model: ReviewModel): ReadonlyArray<string> {
  const events = programUnitEvents(model);
  if (!events.includes('inch')) return [];
  return events.at(-1) === 'inch'
    ? [
        'The program is in inches (G20). It also leaves the controller in inches until a program sends G21.',
      ]
    : ['Part of the program is in inches (G20); it switches back and ends in millimetres (G21).'];
}

function coordinateSystemWarnings(model: ReviewModel): ReadonlyArray<string> {
  const codes = new Set<number>();
  for (const event of model.events) {
    if (event.kind === 'wcs-select' && event.code !== 54) codes.add(event.code);
  }
  if (codes.size === 0) return [];
  const names = [...codes].sort((a, b) => a - b).map((code) => `G${code}`);
  return [
    `The program switches to ${names.join(', ')}. The Frame traced G54, so moves in another work coordinate system were not traced.`,
  ];
}

function toolLeftOnWarnings(model: ReviewModel): ReadonlyArray<string> {
  let on = false;
  for (const event of model.events) {
    if (event.kind === 'spindle-on') on = true;
    else if (event.kind === 'spindle-off') on = false;
  }
  return on
    ? [
        'The laser or spindle is still on when the program ends: it never sends M5 after its last M3 or M4.',
      ]
    : [];
}

function machineModeWarnings(
  model: ReviewModel,
  context: ExternalProgramContext,
): ReadonlyArray<string> {
  const bounds = model.stats.programBounds;
  const movesZ = bounds !== null && bounds.maxZ - bounds.minZ > 0;
  if (context.machineKind === 'cnc') {
    return bounds !== null && !movesZ
      ? ['The program never moves Z, as a laser program does. KerfDesk is in CNC mode.']
      : [];
  }
  const warnings: string[] = [];
  const powerMax = model.stats.powerMax;
  if (powerMax !== null && powerMax > context.laserMaxPowerS) {
    warnings.push(
      `The program asks for S${powerMax}, above this laser's S max of ${context.laserMaxPowerS}. It may be a router program; KerfDesk is in Laser mode.`,
    );
  }
  if (movesZ) {
    warnings.push('The program moves Z, as a router program does. KerfDesk is in Laser mode.');
  }
  return warnings;
}
