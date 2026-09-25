import { note, type HpglState } from './hpgl-types';

// ADR-268: source and geometry counts disclose cost; they never cap or refuse an import.
export const HPGL_IMPORT_ADVISORIES = {
  textLength: 8_000_000,
  commands: 100_000,
  numbers: 1_000_000,
  points: 250_000,
  paths: 50_000,
} as const;

type SourceSize = {
  readonly textLength: number;
  readonly commands: number;
  readonly numbers: number;
};

export function noteHpglImportSize(state: HpglState, source: SourceSize): void {
  const thresholds = HPGL_IMPORT_ADVISORIES;
  if (
    source.textLength <= thresholds.textLength &&
    source.commands <= thresholds.commands &&
    source.numbers <= thresholds.numbers &&
    state.workPoints <= thresholds.points &&
    state.outputPoints <= thresholds.points &&
    state.paths.length <= thresholds.paths
  ) {
    return;
  }
  note(
    state,
    'large-import',
    `Large HPGL: ${source.textLength.toLocaleString()} characters, ` +
      `${source.commands.toLocaleString()} commands, ` +
      `${source.numbers.toLocaleString()} numeric parameters, ` +
      `${state.workPoints.toLocaleString()} generated points, ` +
      `${state.outputPoints.toLocaleString()} output points across ` +
      `${state.paths.length.toLocaleString()} paths. Editing and output may be slow.`,
  );
}
