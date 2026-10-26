// An interpretation only: the stream keeps the original normalized line.
// Marlin dispatches one command per line, and scans the rest as parameters.
// G53 chaining and optional motion modes are deliberately not assumed.
// Independently implemented from the documented behavior of Marlin 2.1.2.8:
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/parser.cpp
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M3-M5.cpp

import { formatGcodeDecimal } from '../gcode/decimal-word';

export type MarlinReadLine = {
  readonly line: string;
  readonly warnings: ReadonlyArray<string>;
  /** Exclude unknown motion and its dependent coordinates from the outline. */
  readonly unplaced?: 'position' | 'origin';
};

type Parameter = {
  readonly letter: string;
  readonly value: number | null;
  readonly separated: boolean;
};
type Line = {
  readonly code: string;
  readonly parameters: ReadonlyArray<Parameter>;
  readonly warnings: string[];
};
type Cutter = {
  readonly laser: boolean;
  inline: boolean;
  inlinePower: number;
  enabled: boolean;
  unitPower: number | null;
};
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/;
const NO_PARAMETERS = new Set(['G17', 'G21', 'G90', 'G91', 'M5', 'M7', 'M8', 'M9', 'M400']);
// These do not change the head position. Do not give M2/M30 GRBL's end semantics.
const NON_MOTION = new Set(['M2', 'M30', 'M82', 'M83', 'M105', 'M114', 'M115', 'M117', 'M118']);

export function createMarlinProgramReader(
  machineKind?: 'laser' | 'cnc',
): (raw: string) => MarlinReadLine {
  // Required Frame sends M5 I and M107 before this executable (Marlin driver).
  const cutter: Cutter = {
    laser: machineKind === 'laser',
    inline: false,
    inlinePower: 0,
    enabled: false,
    unitPower: null,
  };
  return (raw) => {
    if (raw.trim() === '') return { line: '', warnings: [] };
    const line = parseLine(raw);
    if (line === null) {
      return unknown(
        'This line has no explicit Marlin command. Axis-only motion and lowercase commands depend on firmware options that the connected machine does not report.',
        /^[XYZEFIJKPR]/.test(raw.trim()) ? 'position' : 'origin',
      );
    }
    return interpretLine(line, cutter);
  };
}

function interpretLine(line: Line, cutter: Cutter): MarlinReadLine {
  const { code, warnings } = line;
  if (code === 'G0' || code === 'G1') return motionLine(line, cutter);
  if (code === 'M3' || code === 'M4') return cutterLine(line, cutter);
  if (code === 'M5') {
    cutter.enabled = false;
    if (has(line, 'I')) {
      cutter.inline = false;
      cutter.inlinePower = 0;
    }
  }
  if (NO_PARAMETERS.has(code)) return { line: code, warnings };
  if (code === 'G92') return projectParameters(line, 'XYZ');
  if (code === 'G4') return dwellLine(line);
  if (code === 'M106' || code === 'M107') return fanLine(line);
  return unsupportedLine(line);
}

function dwellLine(line: Line): MarlinReadLine {
  const checked = projectParameters(line, 'PS');
  if (checked.unplaced !== undefined) return checked;
  // Marlin P is milliseconds; S is seconds and wins when both occur.
  const seconds = value(line, 'S') ?? (value(line, 'P') ?? 0) / 1000;
  return { line: `G4 P${formatGcodeDecimal(seconds)}`, warnings: line.warnings };
}

function motionLine(source: Line, cutter: Cutter): MarlinReadLine {
  const result = projectParameters(source, 'XYZFS');
  if (result.unplaced !== undefined) return result;
  updateMotionPower(source, cutter);
  // Standard-mode G1 S does not set the cutter's power.
  let line = result.line.replace(/ S[^ ]+/g, '');
  if ((value(source, 'F') ?? 1) <= 0) line = line.replace(/ F[^ ]+/g, '');
  if (cutter.inline) {
    if (source.code === 'G1' && has(source, 'I')) line = `M3 ${line}`;
    line += ` S${formatGcodeDecimal(cutter.inlinePower)}`;
  } else if (source.code === 'G0' && cutter.laser) line += ' S0';
  return { line, warnings: source.warnings };
}

function updateMotionPower(line: Line, cutter: Cutter): void {
  if (line.code === 'G0') {
    cutter.inlinePower = 0;
    return;
  }
  if (!cutter.inline) return;
  if (has(line, 'I')) cutter.enabled = true;
  const power = value(line, 'S');
  if (power === null) return;
  cutter.inlinePower = power;
  cutter.unitPower = power;
}

function enableCutter(line: Line, cutter: Cutter): void {
  const { code, warnings } = line;
  if (has(line, 'I')) {
    if (cutter.laser) {
      cutter.inline = true;
      cutter.enabled = true;
    } else
      warnings.push(
        'Marlin inline I power requires a laser firmware build; this CNC review reads spindle power.',
      );
  }
  if (!cutter.inline) cutter.enabled = true;
  else if (!cutter.enabled)
    // M5 disabled the inline output; this M3/M4 sets power without re-enabling it.
    // With LASER_POWER_SYNC (off by default) Marlin applies that power at once and
    // keeps it through the following moves.
    warnings.push(
      `${code} without I after M5 leaves Marlin's inline output disabled on a default build, so the preview shows the following moves dark. A build with LASER_POWER_SYNC can fire the laser at this power at once and keep it on through the following moves.`,
    );
}

function cutterLine(line: Line, cutter: Cutter): MarlinReadLine {
  const result = projectParameters(line, 'S');
  if (result.unplaced !== undefined) return result;
  const { code, warnings } = line;
  enableCutter(line, cutter);
  const power = value(line, 'S');
  if (power !== null) cutter.unitPower = power;
  else
    warnings.push(
      `${code} has no numeric S. Marlin may use its configured startup or retained power; the preview cannot establish that power.`,
    );
  if (cutter.inline) cutter.inlinePower = cutter.unitPower ?? 0;
  if (code === 'M4' && cutter.inline)
    warnings.push(
      'Marlin M4 I uses dynamic power whose actual output depends on firmware settings and feed rate.',
    );
  return {
    line: cutter.inline
      ? `${cutter.enabled ? code : 'M5'} S${formatGcodeDecimal(cutter.inlinePower)}`
      : result.line,
    warnings,
  };
}

function fanLine(line: Line): MarlinReadLine {
  // P participates in the parser even though it is not passed to the generic
  // fan renderer. Validate it before selecting a fan, including M107's P.
  const checked = projectParameters(line, line.code === 'M106' ? 'PS' : 'P');
  if (checked.unplaced !== undefined) {
    return {
      line: '',
      warnings: [
        ...checked.warnings,
        'Fan output is uncertain after this line. The preview retains the previous fan power; it does not establish that the laser is off.',
      ],
    };
  }
  if ((value(line, 'P') ?? 0) !== 0)
    return unknown(
      `${line.code} selects another fan; the configured laser fan cannot be inferred.`,
      undefined,
      line.warnings,
    );
  return { line: checked.line.replace(/ P[^ ]+/g, ''), warnings: checked.warnings };
}

function unsupportedLine({ code, warnings }: Line): MarlinReadLine {
  if (code === 'G2' || code === 'G3') {
    return unknown(
      'Marlin arc support, workspace plane and arc options depend on the firmware build. This arc and dependent relative moves are not placed in the Frame outline.',
      'position',
      warnings,
    );
  }
  if (code === 'G28' || code === 'G30' || code === 'G53') {
    return unknown(
      `${code} can home, probe or chain motion in machine coordinates on Marlin. Its destination and dependent relative moves are not placed in the Frame outline.`,
      code === 'G53' ? 'origin' : 'position',
      warnings,
    );
  }
  if (NON_MOTION.has(code))
    return {
      line: '',
      warnings: [
        ...warnings,
        `Marlin ${code} is not interpreted as a motion or a tool-off command.`,
      ],
    };
  return unknown(
    `Marlin ${code} is unsupported by this preview or depends on firmware options. Its effects and following coordinates cannot be placed in the Frame outline.`,
    'origin',
    warnings,
  );
}

function parseLine(raw: string): Line | null {
  const command = /^ *([GMT]) *(\d+)(?:\.(\d+))?/.exec(raw);
  if (command === null) return null;
  const base = `${command[1]}${Number(command[2])}`;
  // Ordinary handlers dispatch the integer code; only these use subcodes.
  const subcode = ['G38', 'G59', 'G92'].includes(base) ? Number(command[3] ?? 0) : 0;
  const code = subcode === 0 ? base : `${base}.${subcode}`;
  const parameters = readParameters(raw.slice(command[0].length));
  const warnings: string[] = [];
  if (code !== 'G53' && parameters.some((word) => word.letter === 'G' || word.letter === 'M')) {
    warnings.push(
      `Marlin executes only ${code} on this line; later G/M words are parameters, not additional commands.`,
    );
  }
  return { code, parameters, warnings };
}

function projectParameters({ code, parameters, warnings }: Line, allowed: string): MarlinReadLine {
  const used = parameters.filter((p) => allowed.includes(p.letter));
  if (used.some((p) => p.separated) || parameters.some((p) => /[a-z]/.test(p.letter))) {
    return unknown(
      `${code} uses spaced parameter values or lowercase parameters whose meaning depends on Marlin parser build options. These coordinates are not placed in the Frame outline.`,
      'origin',
      warnings,
    );
  }
  if (new Set(used.map((p) => p.letter)).size !== used.length) {
    return unknown(
      `${code} repeats a parameter. Marlin's fast and slow parsers choose different occurrences; this build option is unknown.`,
      'origin',
      warnings,
    );
  }
  const words = used.flatMap((p) =>
    p.value === null ? [] : [`${p.letter}${formatGcodeDecimal(p.value)}`],
  );
  return { line: [code, ...words].join(' '), warnings };
}

function value(line: Line, letter: string): number | null {
  return line.parameters.find((p) => p.letter === letter)?.value ?? null;
}

function has(line: Line, letter: string): boolean {
  return line.parameters.some((p) => p.letter === letter);
}

function unknown(
  detail: string,
  unplaced?: 'position' | 'origin',
  warnings: ReadonlyArray<string> = [],
): MarlinReadLine {
  return {
    line: '',
    warnings: [...warnings, detail],
    ...(unplaced === undefined ? {} : { unplaced }),
  };
}

// Unlike the generic word scanner, a space ends a Marlin parameter's number.
// Bare letters are retained for flags (M3 I) but are not coordinate values.
function readParameters(text: string): Parameter[] {
  const parameters: Parameter[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const letter = text[index] ?? '';
    if (!/^[A-Za-z]$/.test(letter)) continue;
    const separated = text[index + 1] === ' ';
    while (text[index + 1] === ' ') index += 1;
    const number = NUMBER.exec(text.slice(index + 1))?.[0];
    parameters.push({
      letter,
      value: number === undefined ? null : Number(number),
      separated: separated && number !== undefined,
    });
    if (number !== undefined) index += number.length;
  }
  return parameters;
}
