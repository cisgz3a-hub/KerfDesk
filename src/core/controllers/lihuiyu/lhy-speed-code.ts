// LHYMicro-GL speed codes (ADR-703), reimplemented from MeerK40t's MIT
// laserspeed.py (meerk40t/lihuiyu/laserspeed.py at d511944e, L158-457). A
// speed code sets the board's stepper period for program (vector) mode:
//   CV<value:6><accel:1>[<step:3><diagonal:6>][C][W<power:3>]
// where <value> is 65536 − (b + m·T) for the period T in ms of one 1/1000 in
// step, written as two zero-padded 3-digit bytes (encode_16bit). Boards A, B
// and M carry no diagonal correction. A trailing C (suffix C) selects the
// twitchless timing MeerK40t uses for vector mode by default (driver.py
// program_mode, `twitches` off), with its own slope m/12. W<nnn> is the M3's
// per-mille power (only M3 firmware 2024.01.18g or newer reads it).
//
// The constants (784/896/1024, 5120/5632/6144, 12120, 2000, 0.261199033289,
// the 25.4/60/127/320 mm/s acceleration bands and the 7 mm/s suffix-C
// cut-off) are MeerK40t's measured values, carried over under its MIT
// licence (THIRD_PARTY_NOTICES.md). None has been checked on hardware here.

export type LihuiyuBoard = 'M2' | 'M3' | 'B2' | 'M' | 'M1' | 'A' | 'B' | 'B1';

export const LIHUIYU_BOARDS: ReadonlyArray<LihuiyuBoard> = [
  'M2',
  'M3',
  'B2',
  'M',
  'M1',
  'A',
  'B',
  'B1',
];

/** MeerK40t's default diagonal ratio (laserspeed.py L188-189). */
export const LHY_DEFAULT_D_RATIO = 0.261199033289;

export type LhySpeedCodeOptions = {
  readonly board: LihuiyuBoard;
  /** Suffix C (twitchless vector timing). MeerK40t's vector default is on. */
  readonly suffixC: boolean;
  /** Per-mille power for an M3 that reads W (0..999); absent: no W suffix. */
  readonly powerPerMille?: number;
};

type Equation = { readonly b: number; readonly m: number };

/** The acceleration band for a vector (non-raster) speed (laserspeed.py L367-401). */
export function lhyAccelerationFor(mmPerSecond: number): 1 | 2 | 3 | 4 {
  if (mmPerSecond <= 25.4) return 1;
  if (mmPerSecond <= 60) return 2;
  if (mmPerSecond < 127) return 3;
  return 4;
}

/** b and m of value = m·T + b (laserspeed.py get_equation, L421-457). */
export function lhyEquation(board: LihuiyuBoard, accel: number, suffixC: boolean): Equation {
  const rapidB = accel === 3 ? 896 : accel === 4 ? 1024 : 784;
  if (board === 'A' || board === 'B' || board === 'B1') return { b: rapidB, m: 2000 };
  const m = 12120;
  if (board === 'B2') return suffixC ? { b: rapidB, m: (m * 2) / 12 } : { b: rapidB, m: m * 2 };
  if (suffixC) return { b: 8, m: m / 12 };
  return { b: accel === 3 ? 5632 : accel === 4 ? 6144 : 5120, m };
}

/** Two 3-digit bytes of a 16-bit value, high first (encode_16bit, L360-364). */
export function encodeLhy16(value: number): string {
  const v = Math.trunc(value);
  const low = v & 255;
  const high = (v >> 8) & 0xffffff;
  return `${pad3(high)}${pad3(low)}`;
}

/** Inverse of encodeLhy16 for well-formed codes (decode_16bit, L350-357). */
export function decodeLhy16(code: string): number {
  return (Number.parseInt(code.slice(0, -3), 10) << 8) + Number.parseInt(code.slice(-3), 10);
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

/** The speed code for a vector speed in mm/s (get_code_from_speed with
 *  fix_limit and fix_lows on, as driver.py program_mode calls it). */
export function lhySpeedCode(mmPerSecond: number, options: LhySpeedCodeOptions): string {
  if (!(mmPerSecond > 0) || !Number.isFinite(mmPerSecond)) {
    throw new RangeError(`LHY speed must be a positive number of mm/s, got ${mmPerSecond}.`);
  }
  const accel = lhyAccelerationFor(mmPerSecond);
  const { board, suffixC } = options;
  const { b, m } = lhyEquation(board, accel, suffixC);
  // Same float steps as get_value_from_speed (L314-323), so codes match it.
  const frequencyKhz = mmPerSecond / 25.4;
  const periodMs = 1.0 / frequencyKhz;
  const value = Math.max(0, 65536 - (m * periodMs + b));
  const power = powerSuffix(options.powerPerMille);
  const head = `CV${encodeLhy16(value)}${suffixC ? 1 : accel}`;
  if (board === 'A' || board === 'B' || board === 'M') {
    return `${head}${suffixC ? 'C' : ''}${power}`;
  }
  const step = Math.min(Math.floor(mmPerSecond) + 1, 128);
  const diagonal = Math.min(0xffff, Math.max(0, (LHY_DEFAULT_D_RATIO * m * periodMs) / step));
  return `${head}${pad3(step)}${encodeLhy16(diagonal)}${suffixC ? 'C' : ''}${power}`;
}

function powerSuffix(powerPerMille: number | undefined): string {
  if (powerPerMille === undefined || powerPerMille < 0 || powerPerMille >= 1000) return '';
  return `W${pad3(Math.trunc(powerPerMille))}`;
}

export type ParsedLhySpeedCode = {
  readonly value: number;
  readonly accel: number;
  readonly step: number;
  readonly diagonal: number;
  readonly suffixC: boolean;
  readonly powerPerMille: number | null;
};

/** Splits a CV speed code (parse_speed_code, L252-311, without its raster G
 *  steps, which this encoder never writes). */
export function parseLhySpeedCode(code: string): ParsedLhySpeedCode {
  const power = /W(\d{3})$/.exec(code);
  let body = power === null ? code : code.slice(0, -4);
  const suffixC = body.endsWith('C');
  if (suffixC) body = body.slice(0, -1);
  if (!body.startsWith('CV')) throw new SyntaxError(`Not an LHY speed code: ${code}`);
  const value = 65536 - decodeLhy16(body.slice(2, 8));
  const accel = Number.parseInt(body.slice(8, 9), 10);
  const rest = body.slice(9);
  return {
    value,
    accel,
    step: rest.length >= 9 ? Number.parseInt(rest.slice(0, 3), 10) : 0,
    diagonal: rest.length >= 9 ? decodeLhy16(rest.slice(3)) : 0,
    suffixC,
    powerPerMille: power === null ? null : Number.parseInt(power[1] ?? '0', 10),
  };
}

/** The mm/s a speed code commands on `board` (get_speed_from_code, L138-155). */
export function lhySpeedFromCode(code: string, board: LihuiyuBoard): number {
  const parsed = parseLhySpeedCode(code);
  const { b, m } = lhyEquation(board, parsed.accel, parsed.suffixC);
  const periodMs = (parsed.value - b) / m;
  return periodMs > 0 ? 25.4 / periodMs : 0;
}
