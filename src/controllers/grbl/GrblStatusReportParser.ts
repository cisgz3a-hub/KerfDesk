/**
 * T1-124: pure parser for GRBL `<...>` live status reports. Extracted
 * from `GrblController._handleStatusReport` as the first slice of the
 * audit's Sprint 4 "extract pure parsers first" sequence (see
 * docs/ROADMAP.md T2-87 audit). Pre-T1-124 the parser lived inline in
 * a 130-line method that mixed parsing with side effects (state
 * mutation, pause/resume bookkeeping, job-abort gates,
 * safe-state-at-connect verdict). Mixing the two made the parser
 * untestable in isolation and made the side-effect logic harder to
 * audit because every change to either had to read past the other.
 *
 * This module exports a pure `parseGrblStatusReport(raw)` that
 * returns a fully structured `ParsedGrblStatusReport`. The caller
 * (`_handleStatusReport`) reads the parsed object and applies side
 * effects unchanged — the contract is "split parsing from action,
 * keep behavior byte-identical." The pause/resume, job-abort,
 * safe-state, and `_state` mutation logic still lives in the
 * controller; only the parsing logic moved.
 *
 * Status-keyword recognition matches the runtime statusMap exactly
 * (idle / run / hold / hold:0 / hold:1 / alarm / home → homing /
 * check / door / door:0 / door:1 / door:2 / door:3). Door variants
 * are first-class per T1-115. Unrecognized words return
 * `machineStatus: null` so the caller can decide what to do (the
 * controller's pre-T1-124 behavior was to leave `_state.status`
 * unchanged, which we preserve).
 */
import type { MachineStatus, MachinePosition } from '../ControllerInterface';

export interface ParsedGrblStatusReport {
  /** Lowercased state word from the first pipe-section, or null when
   *  the report had no parts. Useful for diagnostics; the caller
   *  typically only consults `machineStatus`. */
  readonly stateWord: string | null;
  /** Recognized canonical `MachineStatus`, or null when the state
   *  word isn't in the runtime status map. T1-115: door variants
   *  collapse to 'door'. */
  readonly machineStatus: MachineStatus | null;
  /** Machine-coordinate position from `MPos:x,y,z`. Z defaults to 0
   *  when only x,y are reported. Null when the field was absent. */
  readonly mPos: MachinePosition | null;
  /** Work-coordinate position from `WPos:x,y,z`. Same semantics as
   *  `mPos`. Null when the field was absent. */
  readonly wPos: MachinePosition | null;
  /** Feed rate from `FS:f,s` or standalone `F:f`. Coerced to 0 when
   *  the field was present but unparseable. Null when neither field
   *  was reported. */
  readonly feedRate: number | null;
  /** Spindle / laser power from `FS:f,s`. Coerced to 0 when the
   *  field was present but unparseable. Null when `FS` was absent
   *  (the standalone `F` field doesn't carry a spindle value). */
  readonly spindleSpeed: number | null;
}

/**
 * Runtime status map. Mirrors the inline statusMap that pre-T1-124
 * lived in `_handleStatusReport`. Door variants collapse to 'door'
 * (T1-115); the full list of accepted door subphases (`door`,
 * `door:0`, `door:1`, `door:2`, `door:3`) is preserved here.
 */
const STATUS_MAP: Record<string, MachineStatus> = {
  idle: 'idle',
  run: 'run',
  jog: 'jog',
  hold: 'hold',
  'hold:0': 'hold',
  'hold:1': 'hold',
  alarm: 'alarm',
  home: 'homing',
  check: 'check',
  door: 'door',
  'door:0': 'door',
  'door:1': 'door',
  'door:2': 'door',
  'door:3': 'door',
};

const EMPTY_RESULT: ParsedGrblStatusReport = {
  stateWord: null,
  machineStatus: null,
  mPos: null,
  wPos: null,
  feedRate: null,
  spindleSpeed: null,
};

function parsePosition(value: string): MachinePosition | null {
  const coords = value.split(',').map(Number);
  if (coords.length < 2) return null;
  const x = coords[0];
  const y = coords[1];
  const z = coords.length >= 3 ? coords[2] : 0;
  // LF-EXT-BCNC-003: do not mark position confirmed from malformed
  // controller coordinates. Missing z still defaults to 0 for the
  // existing two-axis GRBL reports, but non-finite x/y/z makes the
  // entire position unusable.
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return {
    x,
    y,
    z,
  };
}

/**
 * Parse a GRBL status report wire string. Accepts the full
 * `<...>` shape, strips the wrapping brackets, splits on `|`, and
 * returns the structured record. No I/O, no mutation, no
 * exceptions — pre-T1-124 inline behavior parsed defensively and
 * never threw, so the extracted parser preserves that.
 *
 * Caller is expected to have already verified `raw.startsWith('<')
 * && raw.endsWith('>')`. If the bracket strip yields content with no
 * `|`-parts the parser returns the empty-shaped result.
 */
export function parseGrblStatusReport(raw: string): ParsedGrblStatusReport {
  const content = raw.slice(1, -1);
  const parts = content.split('|');
  if (parts.length === 0) return EMPTY_RESULT;

  const stateWord = parts[0].toLowerCase();
  const machineStatus: MachineStatus | null = STATUS_MAP[stateWord] ?? null;

  let mPos: MachinePosition | null = null;
  let wPos: MachinePosition | null = null;
  let feedRate: number | null = null;
  let spindleSpeed: number | null = null;

  for (let i = 1; i < parts.length; i++) {
    const colonIdx = parts[i].indexOf(':');
    if (colonIdx < 0) continue;
    const key = parts[i].slice(0, colonIdx);
    const value = parts[i].slice(colonIdx + 1);

    switch (key) {
      case 'MPos':
        mPos = parsePosition(value);
        break;
      case 'WPos':
        wPos = parsePosition(value);
        break;
      case 'FS': {
        const [feed, spindle] = value.split(',').map(Number);
        feedRate = feed || 0;
        spindleSpeed = spindle || 0;
        break;
      }
      case 'F':
        feedRate = Number(value) || 0;
        break;
    }
  }

  return {
    stateWord,
    machineStatus,
    mPos,
    wPos,
    feedRate,
    spindleSpeed,
  };
}
