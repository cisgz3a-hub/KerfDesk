import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';

// T3-18: semantic validation over the final emitted G-code stream.
export interface OutputValidatorOptions {
  maxSpindle?: number | null;
}

export interface OutputGcodeFinding {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  lineNumber: number;
  line: string;
}

interface ModalState {
  unitsDeclared: boolean;
  distanceModeDeclared: boolean;
  feedModeDeclared: boolean;
  planeDeclared: boolean;
  safetyLaserOffSeen: boolean;
  laserMode: 'off' | 'M3' | 'M4';
  spindle: number;
  motionMode: 'G0' | 'G1' | 'G2' | 'G3' | null;
}

const MAX_GRBL_LINE_LENGTH = 127;
const EPS = 0.000001;
const ALLOWED_G_CODES = new Set([
  0, 1, 2, 3, 4, 10, 17, 18, 19, 20, 21, 28, 30, 38.2, 38.3, 38.4, 38.5,
  40, 43.1, 49, 53, 54, 55, 56, 57, 58, 59, 61, 80, 90, 91, 92, 93, 94,
]);
const ALLOWED_M_CODES = new Set([0, 1, 2, 3, 4, 5, 7, 8, 9, 30]);

function stripComments(line: string): string {
  return line.replace(/;.*$/, '').replace(/\([^)]*\)/g, '').trim();
}

function readNumber(line: string, letter: string): number | null {
  const match = new RegExp(`${letter}\\s*([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)`, 'i').exec(line);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function readCodes(line: string, letter: 'G' | 'M'): number[] {
  const codes: number[] = [];
  const re = new RegExp(`${letter}\\s*([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`, 'ig');
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) != null) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) codes.push(parsed);
  }
  return codes;
}

function setupComplete(state: ModalState): boolean {
  return (
    state.unitsDeclared &&
    state.distanceModeDeclared &&
    state.feedModeDeclared &&
    state.planeDeclared &&
    state.safetyLaserOffSeen
  );
}

function formatLine(lineNumber: number, line: string): string {
  return `Line ${lineNumber}: ${line.trim()}`;
}

export function validateEmittedGcode(
  gcode: string,
  options: OutputValidatorOptions = {},
): OutputGcodeFinding[] {
  const findings: OutputGcodeFinding[] = [];
  const maxSpindle = options.maxSpindle ?? null;
  const state: ModalState = {
    unitsDeclared: false,
    distanceModeDeclared: false,
    feedModeDeclared: false,
    planeDeclared: false,
    safetyLaserOffSeen: false,
    laserMode: 'off',
    spindle: 0,
    motionMode: null,
  };

  const push = (
    code: string,
    message: string,
    lineNumber: number,
    rawLine: string,
  ): void => {
    findings.push({
      severity: 'error',
      code,
      message: `${formatLine(lineNumber, rawLine)}\n${message}`,
      lineNumber,
      line: rawLine,
    });
  };

  const lines = gcode.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const lineNumber = i + 1;
    const clean = stripComments(rawLine);
    if (!clean) continue;

    if (clean.length > MAX_GRBL_LINE_LENGTH) {
      push(
        PREFLIGHT_CODES.OUTPUT_LINE_TOO_LONG,
        `G-code line is ${clean.length} characters; GRBL accepts at most ${MAX_GRBL_LINE_LENGTH}.`,
        lineNumber,
        rawLine,
      );
    }

    const gCodes = readCodes(clean, 'G');
    const mCodes = readCodes(clean, 'M');
    for (const g of gCodes) {
      if (!ALLOWED_G_CODES.has(g)) {
        push(PREFLIGHT_CODES.OUTPUT_UNSUPPORTED_COMMAND, `Unsupported GRBL G-code G${g}.`, lineNumber, rawLine);
      }
      if (g === 20 || g === 21) state.unitsDeclared = true;
      if (g === 90 || g === 91) state.distanceModeDeclared = true;
      if (g === 93 || g === 94) state.feedModeDeclared = true;
      if (g === 17 || g === 18 || g === 19) state.planeDeclared = true;
      if (g === 0) state.motionMode = 'G0';
      if (g === 1) state.motionMode = 'G1';
      if (g === 2) state.motionMode = 'G2';
      if (g === 3) state.motionMode = 'G3';
    }
    for (const m of mCodes) {
      if (!ALLOWED_M_CODES.has(m)) {
        push(PREFLIGHT_CODES.OUTPUT_UNSUPPORTED_COMMAND, `Unsupported GRBL M-code M${m}.`, lineNumber, rawLine);
      }
      if (m === 3) state.laserMode = 'M3';
      if (m === 4) state.laserMode = 'M4';
      if (m === 5) {
        state.laserMode = 'off';
        state.spindle = 0;
        state.safetyLaserOffSeen = true;
      }
    }

    const s = readNumber(clean, 'S');
    if (s != null) {
      state.spindle = s;
      if (maxSpindle != null && maxSpindle > 0 && s > maxSpindle + EPS) {
        push(
          PREFLIGHT_CODES.OUTPUT_SPINDLE_EXCEEDS_MAX,
          `G-code requests S${s}, above max spindle ${maxSpindle}.`,
          lineNumber,
          rawLine,
        );
      }
    }
    const f = readNumber(clean, 'F');
    if (f != null && f <= 0) {
      push(
        PREFLIGHT_CODES.OUTPUT_FEED_INVALID,
        `G-code feed rate must be positive; got F${f}.`,
        lineNumber,
        rawLine,
      );
    }

    const hasMotionWord = /[XYZIJK]\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/i.test(clean);
    const laserOn = state.laserMode !== 'off' && state.spindle > EPS;
    if (laserOn && !setupComplete(state)) {
      push(
        PREFLIGHT_CODES.OUTPUT_LASER_ON_BEFORE_SETUP,
        'Laser power is enabled before LaserForge sees the safe modal setup (units, plane, distance mode, feed mode, and M5).',
        lineNumber,
        rawLine,
      );
    }
    if (hasMotionWord && state.motionMode === 'G0' && laserOn) {
      push(
        PREFLIGHT_CODES.OUTPUT_RAPID_WITH_LASER_ON,
        'Rapid G0 motion occurs while M3/M4 and non-zero S are active.',
        lineNumber,
        rawLine,
      );
    }
  }

  if (state.laserMode !== 'off' && state.spindle > EPS) {
    const lastLineNumber = Math.max(1, lines.length);
    const lastLine = lines[lines.length - 1] ?? '';
    push(
      PREFLIGHT_CODES.OUTPUT_LASER_LEFT_ON,
      'Final emitted G-code leaves M3/M4 active. The job must end with M5 before program end.',
      lastLineNumber,
      lastLine,
    );
  }

  return findings;
}

export function runOutputGcodeSemanticChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const gcode = ctx.emittedGcode;
  if (!gcode) return;
  const maxSpindle =
    ctx.liveMachineInfo?.maxSpindle && ctx.liveMachineInfo.maxSpindle > 0
      ? ctx.liveMachineInfo.maxSpindle
      : ctx.profile?.maxSpindle;
  for (const finding of validateEmittedGcode(gcode, { maxSpindle })) {
    out.push({
      severity: finding.severity,
      code: finding.code,
      message: finding.message,
    });
  }
}
