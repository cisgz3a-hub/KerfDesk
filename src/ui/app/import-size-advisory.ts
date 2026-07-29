// Large-import advisories.
//
// Replaces the F-A3 25 MB blocking confirm (import-size-guard) and the
// per-source byte refusals (import-source-limits). CLAUDE.md rule 7 / ADR-228
// name `import` explicitly as a guard surface: a size threshold is a policy
// judgement, not an integrity fact, so it may INFORM and must never refuse.
// This continues the ADR-241/243 line — those removed the segment and raster
// budgets from Start/Save/Frame; import was the surface they never reached.
//
// The thresholds survive, with their meaning changed: they select WHEN the
// operator is told an import will be slow, never WHETHER it happens. Both
// advisory kinds live in one module so the threshold and the copy cannot drift
// apart — the drift the two predecessor modules each warned about separately.
//
// The advisory is raised WHERE THE REFUSAL STOOD (before the read, when the
// adapter supplies a size), so the operator learns the cost at the moment the
// old build would have stopped them, not after the wait.

const BYTES_PER_MB = 1024 * 1024;

// Generic threshold for the formats with no per-source figure (SVG, DXF, images).
export const LARGE_IMPORT_ADVISORY_BYTES = 25 * BYTES_PER_MB;

export type ImportSourceKind =
  | 'native-project'
  | 'lightburn-project'
  | 'material-library'
  | 'lightburn-clb'
  | 'gcode'
  | 'stl';

// Per-source advisory points. These were hard refusal ceilings; they are kept as
// the sizes at which each format's import becomes slow enough to mention.
export const IMPORT_SOURCE_ADVISORY_BYTES: Readonly<Record<ImportSourceKind, number>> = {
  'native-project': 64 * BYTES_PER_MB,
  'lightburn-project': 20 * BYTES_PER_MB,
  'material-library': 16 * BYTES_PER_MB,
  'lightburn-clb': 5 * BYTES_PER_MB,
  gcode: 64 * BYTES_PER_MB,
  stl: 64 * BYTES_PER_MB,
};

/** Advisory for a file with no per-source figure, or null when it is small. */
export function largeImportAdvisory(name: string, sizeBytes: number): string | null {
  if (sizeBytes <= LARGE_IMPORT_ADVISORY_BYTES) return null;
  return slowImportMessage(name, sizeBytes);
}

/** Advisory for a known source kind, or null when it is small / size unknown. */
export function importSourceSizeAdvisory(
  file: { readonly name: string; readonly size?: number },
  kind: ImportSourceKind,
): string | null {
  const advisoryBytes = IMPORT_SOURCE_ADVISORY_BYTES[kind];
  if (file.size === undefined || file.size <= advisoryBytes) return null;
  return slowImportMessage(file.name, file.size);
}

function slowImportMessage(name: string, sizeBytes: number): string {
  const mb = Math.round(sizeBytes / BYTES_PER_MB);
  return `${name} is ${mb} MB — importing it may take a while and the app may be busy until it finishes.`;
}
