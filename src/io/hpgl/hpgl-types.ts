import type { ColoredPath, ImportedSvg, Polyline, Vec2 } from '../../core/scene';

export const HPGL_IMPORT_LIMITS = {
  textLength: 8_000_000,
  commands: 100_000,
  numbers: 1_000_000,
  points: 250_000,
  paths: 50_000,
} as const;

export const HPGL_SUPPORTED_COMMANDS = [
  'IN',
  'DF',
  'CO',
  'PA',
  'PR',
  'PU',
  'PD',
  'SP',
  'IP',
  'SC',
  'CI',
  'AA',
  'AR',
  'EA',
  'ER',
  'RA',
  'RR',
  'PM',
  'EP',
  'FP',
  'LT',
  'FT',
] as const;

export type HpglDiagnostic = {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  /** Zero-based source character offset; HPGL command input is ASCII. */
  readonly offset: number;
  readonly command: string | null;
};

export type ParseHpglResult =
  | {
      readonly kind: 'error';
      readonly reason: string;
      readonly diagnostics: readonly HpglDiagnostic[];
    }
  | {
      readonly kind: 'ok';
      readonly object: ImportedSvg | null;
      readonly pathCount: number;
      readonly notes: readonly string[];
      readonly diagnostics: readonly HpglDiagnostic[];
    };

export type HpglCommand = {
  readonly name: string;
  readonly values: readonly number[];
  readonly offset: number;
};
export type HpglMapping = {
  readonly sx: number;
  readonly sy: number;
  readonly tx: number;
  readonly ty: number;
};
export type HpglScaling = {
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
  readonly type: number;
  readonly left: number;
  readonly bottom: number;
};
export type HpglContour = { readonly points: Vec2[]; readonly down: boolean[] };
export type HpglPath = {
  readonly pen: number;
  readonly polylines: readonly Polyline[];
  readonly fillRule?: ColoredPath['fillRule'];
};
export type HpglState = {
  command: HpglCommand;
  position: Vec2;
  pen: number;
  down: boolean;
  relative: boolean;
  mapping: HpglMapping;
  p1: Vec2 | null;
  p2: Vec2 | null;
  scaling: HpglScaling | null;
  polygonMode: boolean;
  polygon: HpglContour[];
  contour: HpglContour | null;
  active: { pen: number; points: Vec2[] } | null;
  paths: HpglPath[];
  workPoints: number;
  outputPoints: number;
  diagnostics: Map<string, HpglDiagnostic>;
};

export const PLOTTER_MAPPING: HpglMapping = { sx: 1, sy: 1, tx: 0, ty: 0 };

export class HpglError extends Error {
  readonly diagnostic: HpglDiagnostic;
  constructor(
    code: string,
    message: string,
    command: Pick<HpglCommand, 'name' | 'offset'> | null = null,
  ) {
    const location =
      command === null ? '' : ` at character ${command.offset + 1} (${command.name})`;
    super(`HPGL${location}: ${message}`);
    this.name = 'HpglError';
    this.diagnostic = {
      severity: 'error',
      code,
      message: this.message,
      offset: command?.offset ?? 0,
      command: command?.name ?? null,
    };
  }
}

export function requireArgs(command: HpglCommand, counts: readonly number[]): void {
  if (!counts.includes(command.values.length)) {
    throw new HpglError(
      'invalid-parameters',
      `${command.name} expects ${counts.join(' or ')} numeric parameters.`,
      command,
    );
  }
}

export function finitePoint(point: Vec2, command: HpglCommand): Vec2 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new HpglError(
      'invalid-geometry',
      'Coordinate arithmetic exceeds finite geometry.',
      command,
    );
  }
  return point;
}

export function reservePoints(state: HpglState, count: number): void {
  state.workPoints += count;
  if (!Number.isSafeInteger(count) || count < 0 || state.workPoints > HPGL_IMPORT_LIMITS.points) {
    throw new HpglError(
      'limit-exceeded',
      `Import exceeds ${HPGL_IMPORT_LIMITS.points} generated points.`,
      state.command,
    );
  }
}

export function note(state: HpglState, code: string, message: string): void {
  if (state.diagnostics.has(code)) return;
  state.diagnostics.set(code, {
    severity: 'warning',
    code,
    message,
    offset: state.command.offset,
    command: state.command.name,
  });
}
