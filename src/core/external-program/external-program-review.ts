// external-program-review — what an external run's review shows (ADR-630):
// the XY envelope its Frame traces, the units it declares, and warnings. Every
// warning informs; none refuses (PROJECT.md non-negotiable 21, ADR-228).
// The parsed model is the G-code Inspector's own (core/gcode-view), read from
// the exact canonical bytes the run sends and from where the head stands, so
// the Frame traces the outline the controller will run. Commands are found
// with the same word scanner the parsers use, so spellings such as `G+91`,
// `G91.0` or `G 91` cannot hide one. The model is built with
// `boundsFromStart`, so the envelope holds only motion placed in the work
// coordinates the program starts in (ADR-630 Amendment 1).

import type { GcodeRenderModel, ProgramFinding } from '../gcode-view';
import type { ControllerKind } from '../devices';
import { scanGcodeWords } from '../gcode/word-scan';
import { createMarlinProgramReader } from './marlin-program-reader';
import {
  grblBlockRejection,
  grblBlockUncertainty,
  grblRejectedBlockWarning,
} from '../gcode-view/grbl-block-rejection';
import { externalProgramBaseline } from './normalize-external-program';
import { kerfDeskBitChangeWarnings } from './kerfdesk-bit-changes';
import { programStopWarnings } from './program-stops';

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
  readonly controllerKind?: ControllerKind;
  readonly machineKind: 'laser' | 'cnc';
  /** The laser's S value for 100% power (`$30`). */
  readonly laserMaxPowerS: number;
  /** Where the program is read from, in work mm. A program that never moves
   * runs there, so its Frame visits that point. */
  readonly start?: { readonly x: number; readonly y: number };
  /** The bits KerfDesk's own bit-change comments name, in file order
   * (`kerfDeskBitChangeLabels` on the file as opened). */
  readonly kerfDeskBitChanges?: ReadonlyArray<string>;
};

type ReviewModel = Pick<GcodeRenderModel, 'stats' | 'events' | 'skippedMotions'>;

/** The G and M commands a program uses, to a tenth (G28.1 is 28.1). */
type Commands = {
  readonly g: ReadonlySet<number>;
  readonly m: ReadonlySet<number>;
  readonly offsetWrites: ReadonlySet<number>;
  /** An M3 or M4 runs before any S word: a later S does not cover it. */
  readonly onBeforeSpeed: boolean;
};

const PROBE_CODES: ReadonlyArray<number> = [38.2, 38.3, 38.4, 38.5];

/** Unsupported words another warning already explains. */
const EXPLAINED_WORDS: ReadonlySet<string> = new Set([
  'G28.1',
  'G30',
  'G30.1',
  'G53',
  'G92',
  'G92.1',
  'G92.2',
  'G92.3',
  'M6',
  ...PROBE_CODES.map((code) => `G${code}`),
]);

const COMMAND_WARNINGS: ReadonlyArray<{
  readonly matches: (commands: Commands) => boolean;
  readonly warning: string;
}> = [
  {
    matches: (c) => c.g.has(53),
    warning:
      'The program moves in machine coordinates (G53). Those moves are not in the Frame outline, which is in work coordinates, and neither are relative moves after one until the program sets that axis again. The head still makes them when the program runs.',
  },
  {
    matches: (c) => [92, 92.1, 92.2, 92.3].some((code) => c.g.has(code)),
    warning:
      'The program sets or clears its own origin (G92). Moves after it on the axes it sets run from that origin, which the Frame cannot place, so they are not in the Frame outline. The head still makes them when the program runs.',
  },
  {
    matches: (c) => PROBE_CODES.some((code) => c.g.has(code)),
    warning:
      'The program probes (G38.2 to G38.5). A probe stops where it touches and the Frame does not probe, so probe moves are not in the Frame outline, and neither are relative moves after one until the program sets that axis again.',
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
    matches: (c) => c.onBeforeSpeed,
    warning:
      'The program switches the laser or spindle on (M3 or M4) before it sets S, so it starts at the S value the controller already holds, which may be left from an earlier program.',
  },
  {
    matches: (c) => c.m.has(6),
    warning:
      'The program asks for a tool change (M6). Stock GRBL does not support M6 and stops with an error there.',
  },
];

export function reviewExternalProgram(
  gcode: string,
  model: ReviewModel,
  context: ExternalProgramContext,
  findings: ReadonlyArray<ProgramFinding> = [],
): ExternalProgramReview {
  const interpreted = controllerReviewText(gcode, context);
  const reviewedText = interpreted?.gcode ?? gcode;
  const baselineLines = baselineLineCount(gcode, context.controllerKind);
  const scanned = commandsIn(reviewedText, baselineLines);
  // Marlin's M3/M4 without S uses configured startup power; its reader names
  // that separately. GRBL's retained-S warning would contradict it.
  const commands =
    context.controllerKind === 'marlin' ? { ...scanned, onBeforeSpeed: false } : scanned;
  // Motion the Inspector could not draw is not "never moves": it has no envelope.
  const still =
    model.stats.programBounds === null && model.skippedMotions.length === 0
      ? context.start
      : undefined;
  const warnings = [
    ...(interpreted?.warnings ?? []),
    ...offsetWriteWarnings(commands),
    ...COMMAND_WARNINGS.filter((check) => check.matches(commands)).map((check) => check.warning),
    ...programStopWarnings(commands.m, context.controllerKind),
    ...kerfDeskBitChangeWarnings(commands.m.has(0), context.kerfDeskBitChanges ?? []),
    ...coordinateSystemWarnings(model),
    ...(still === undefined ? pointEnvelopeWarnings(reviewedText, model) : [NEVER_MOVES]),
    ...unitWarnings(model),
    ...toolLeftOnWarnings(model, baselineLines),
    ...machineModeWarnings(model, context),
    ...skippedMotionWarnings(model),
    ...findings
      .filter((finding) => finding.severity !== 'info' && finding.id !== SKIPPED_MOTION_FINDING)
      .map((finding) => `${finding.title}: ${finding.detail}`),
    ...unsupportedWordWarnings(findings),
  ];
  const envelope =
    still === undefined
      ? envelopeOf(model)
      : { minX: still.x, minY: still.y, maxX: still.x, maxY: still.y };
  return { envelope, units: declaredUnits(model), warnings };
}

function controllerReviewText(gcode: string, context: ExternalProgramContext) {
  if (context.controllerKind === 'marlin') return marlinReviewText(gcode, context.machineKind);
  return context.controllerKind === 'grbl-v1.1' ? grblReviewText(gcode) : null;
}

function marlinReviewText(
  gcode: string,
  machineKind: 'laser' | 'cnc',
): { readonly gcode: string; readonly warnings: ReadonlyArray<string> } {
  const read = createMarlinProgramReader(machineKind);
  const warnings: string[] = [];
  const lines = gcode.split('\n').map((line, index) => {
    const result = read(line);
    warnings.push(...result.warnings.map((warning) => `Line ${index + 1}: ${warning}`));
    return result.line;
  });
  return { gcode: lines.join('\n'), warnings };
}

function grblReviewText(gcode: string): { readonly gcode: string; readonly warnings: string[] } {
  const warnings: string[] = [];
  const lines = gcode.split('\n').map((line, index) => {
    const rejected = grblBlockRejection(line);
    const uncertain = grblBlockUncertainty(line);
    if (rejected === null && uncertain !== null) warnings.push(`Line ${index + 1}: ${uncertain}`);
    if (rejected === null) return line;
    warnings.push(`Line ${index + 1}: ${grblRejectedBlockWarning(rejected)}`);
    return '';
  });
  return { gcode: lines.join('\n'), warnings };
}

const NEVER_MOVES =
  'The program never moves: its Frame visits the point where the head stands, where the program runs. The Frame does not prove Z clearance.';

/** Program Health's notice for the same moves, which the warning below replaces. */
const SKIPPED_MOTION_FINDING = 'skipped-motion';

// A move the Inspector cannot read (an arc whose radius does not match, say)
// adds nothing to the outline. A controller with looser limits may still run
// it, so the review says the Frame leaves it out, as it does for every other
// move it cannot place (ADR-630 Amendment 2). Lines count in the sent
// program, baseline first.
function skippedMotionWarnings(model: ReviewModel): ReadonlyArray<string> {
  const first = model.skippedMotions[0];
  if (first === undefined) return [];
  const count = model.skippedMotions.length;
  const one = count === 1;
  return [
    `The Inspector could not read ${one ? 'one move' : `${count} moves`} (first: line ${first.line + 1} of the sent program, ${first.reason}), so ${one ? 'it is' : 'they are'} not in the Frame outline. If the controller runs ${one ? 'it' : 'them'}, the head still makes ${one ? 'that move' : 'those moves'}.`,
  ];
}

// Program Health lists what the Inspector does not interpret as notes; a run
// sends those words anyway, so the review names them.
function unsupportedWordWarnings(findings: ReadonlyArray<ProgramFinding>): ReadonlyArray<string> {
  const prefix = 'unsupported-word:';
  const words = findings
    .filter((finding) => finding.id.startsWith(prefix))
    .map((finding) => finding.id.slice(prefix.length))
    .filter((word) => !EXPLAINED_WORDS.has(word));
  if (words.length === 0) return [];
  const one = words.length === 1;
  return [
    `The Inspector does not interpret ${words.join(', ')}, so what ${one ? 'it does' : 'they do'} is not in this review or the Frame outline. The controller may still act on ${one ? 'it' : 'them'}, or answer with an error.`,
  ];
}

// The sent program opens with KerfDesk's baseline (externalProgramBaseline).
// Its lines set the modes the review assumes; they are not the program's own
// commands. Smoothieware's `M221 S100` restores the power-up scale: it is not
// an S the program set, nor the program leaving its laser on.
function baselineLineCount(gcode: string, kind: ControllerKind | undefined): number {
  const baseline = externalProgramBaseline(kind ?? 'grbl-v1.1');
  return gcode.startsWith(`${baseline}\n`) ? baseline.split('\n').length : 0;
}

function commandsIn(gcode: string, baselineLines: number): Commands {
  const g = new Set<number>();
  const m = new Set<number>();
  const offsetWrites = new Set<number>();
  const speed = createSpeedTracker();
  for (const line of gcode.split('\n').slice(baselineLines)) {
    const words = scanGcodeWords(line);
    for (const word of words) {
      const code = Math.round(word.value * 10) / 10;
      if (word.letter === 'G') g.add(code);
      else if (word.letter === 'M') m.add(code);
    }
    speed.block(words);
    if (words.some((word) => word.letter === 'G' && Math.round(word.value * 10) === 100)) {
      const mode = words.find((word) => word.letter === 'L')?.value;
      if (mode === 2 || mode === 20) offsetWrites.add(mode);
    }
  }
  return { g, m, offsetWrites, onBeforeSpeed: speed.onBeforeSpeed() };
}

// GRBL keeps S across blocks and programs, so an S on the M3/M4 block or on
// any earlier one sets the speed it starts at; a later S does not.
function createSpeedTracker() {
  let speedSet = false;
  let onBeforeSpeed = false;
  return {
    block: (words: ReadonlyArray<{ readonly letter: string; readonly value: number }>): void => {
      if (words.some((word) => word.letter === 'S')) speedSet = true;
      const switchesOn = words.some(
        (word) => word.letter === 'M' && (word.value === 3 || word.value === 4),
      );
      if (switchesOn && !speedSet) onBeforeSpeed = true;
    },
    onBeforeSpeed: (): boolean => onBeforeSpeed,
  };
}

// Offset writes lead: a program that moves its own origin runs somewhere the
// Frame did not trace, and the controller keeps the new offset afterwards.
function offsetWriteWarnings(commands: Commands): ReadonlyArray<string> {
  return [...commands.offsetWrites].map(
    (mode) =>
      `The program writes work-coordinate offsets (G10 L${mode}). Moves after a write to the G54 origin the Frame used run from the new origin, which the Frame cannot place, so they are not in the Frame outline and may be displaced from the traced outline. Later jobs also start from the changed origin.`,
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

// The run's first line is KerfDesk's baseline (externalProgramBaseline),
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

// GRBL switches the spindle or laser off at a program end (M2/M30), as the
// Inspector's parser does, so a CAM program ending in M30 without M5 is fine.
function toolLeftOnWarnings(model: ReviewModel, baselineLines: number): ReadonlyArray<string> {
  let on = false;
  for (const event of model.events) {
    if (event.line < baselineLines) continue;
    if (event.kind === 'spindle-on') on = true;
    else if (event.kind === 'spindle-off' || event.kind === 'program-end') on = false;
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
