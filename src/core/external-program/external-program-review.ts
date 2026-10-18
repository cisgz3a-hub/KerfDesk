// external-program-review — what an external run's review shows (ADR-630):
// the XY envelope its Frame traces, the units it declares, and warnings. Every
// warning informs; none refuses (PROJECT.md non-negotiable 21, ADR-228).
// The parsed model is the G-code Inspector's own (core/gcode-view), so the
// Frame traces the same outline the Inspector draws.

import type { GcodeRenderModel, ProgramFinding } from '../gcode-view';

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

const WORD_WARNINGS: ReadonlyArray<{ readonly pattern: RegExp; readonly warning: string }> = [
  {
    pattern: /G0*53(?![0-9.])/i,
    warning:
      'The program moves in machine coordinates (G53). The Frame traced work coordinates, so those moves were not traced.',
  },
  {
    pattern: /G0*92(?![0-9])/i,
    warning:
      'The program sets its own origin (G92). Moves after it are placed from that origin, not from the one the Frame used.',
  },
  {
    pattern: /G0*(?:28|30)(?![0-9])/i,
    warning:
      'The program moves to a stored position (G28 or G30). The Frame cannot trace where that is.',
  },
  {
    pattern: /G0*91(?![0-9.])/i,
    warning:
      'The program uses relative moves (G91). The Frame assumed it starts at the work origin; it really starts wherever the head is.',
  },
  {
    pattern: /M0*6(?![0-9.])/i,
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
  const units = declaredUnits(model);
  const warnings = [
    ...WORD_WARNINGS.filter((check) => check.pattern.test(gcode)).map((check) => check.warning),
    ...coordinateSystemWarnings(model),
    ...(units === 'inch' || units === 'both' ? [INCH_WARNING] : []),
    ...toolLeftOnWarnings(model),
    ...machineModeWarnings(model, context),
    ...findings
      .filter((finding) => finding.severity !== 'info')
      .map((finding) => `${finding.title}: ${finding.detail}`),
  ];
  return { envelope: envelopeOf(model), units, warnings };
}

const INCH_WARNING =
  'The program is in inches (G20). It also leaves the controller in inches until a program sends G21.';

function envelopeOf(model: ReviewModel): ExternalProgramEnvelope | null {
  const bounds = model.stats.programBounds;
  if (bounds === null) return null;
  const values = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
  if (!values.every(Number.isFinite)) return null;
  return { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY };
}

function declaredUnits(model: ReviewModel): ExternalProgramUnits {
  const declared = new Set<string>();
  for (const event of model.events) if (event.kind === 'units') declared.add(event.units);
  if (declared.size === 0) return 'undeclared';
  if (declared.size > 1) return 'both';
  return declared.has('inch') ? 'inch' : 'mm';
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
