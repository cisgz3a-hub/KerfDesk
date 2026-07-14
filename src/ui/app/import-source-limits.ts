import { MAX_CLB_BYTES, MAX_LBRN_BYTES } from '../../io/lightburn';

const MB = 1024 * 1024;

export type ImportSourceKind =
  | 'native-project'
  | 'lightburn-project'
  | 'material-library'
  | 'lightburn-clb'
  | 'gcode'
  | 'stl';

export const IMPORT_SOURCE_LIMITS: Readonly<Record<ImportSourceKind, number>> = {
  'native-project': 64 * MB,
  'lightburn-project': MAX_LBRN_BYTES,
  'material-library': 16 * MB,
  'lightburn-clb': MAX_CLB_BYTES,
  gcode: 64 * MB,
  stl: 64 * MB,
};

export function importSourceSizeIssue(
  file: { readonly name: string; readonly size?: number },
  kind: ImportSourceKind,
): string | null {
  const limit = IMPORT_SOURCE_LIMITS[kind];
  if (file.size === undefined || file.size <= limit) return null;
  return `${file.name} exceeds the ${formatLimit(limit)} ${sourceLabel(kind)} import limit.`;
}

function sourceLabel(kind: ImportSourceKind): string {
  if (kind === 'native-project') return 'project';
  if (kind === 'lightburn-project') return 'LightBurn project';
  if (kind === 'material-library') return 'material-library';
  if (kind === 'lightburn-clb') return 'CLB';
  if (kind === 'gcode') return 'G-code';
  return 'STL';
}

function formatLimit(bytes: number): string {
  const mb = bytes / MB;
  return Number.isInteger(mb) ? `${mb} MB` : `${(bytes / 1_000_000).toFixed(0)} MB`;
}
