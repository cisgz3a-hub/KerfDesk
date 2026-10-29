import type { RawProject } from './migrations';

// Schema 19 makes Size the em for single-line fonts, as it already was for
// outline fonts (ADR-682). Older writers scaled these four fonts by a
// cap-height value instead: Relief's real capital height, and the EMS
// sources' placeholder of 500. Each such text keeps exactly what it drew:
// Size grows by the em over that value, and line height and letter spacing,
// which are multiples of Size, shrink by the same factor. A frame counted
// each line as one of those Sizes, so it keeps counting that fraction of the
// em (ADR-682 Amendment 1).
const UNITS_PER_EM = 1000;
const LEGACY_SIZE_UNITS: ReadonlyMap<string, number> = new Map([
  ['relief-single-line', 680],
  ['ems-nixish', 500],
  ['ems-decorous-script', 500],
  ['ems-casual-hand', 500],
]);

export function migrateV18SingleLineTextEm(raw: RawProject): RawProject {
  const scene = record(raw['scene']);
  return {
    ...raw,
    schemaVersion: 19,
    ...(scene !== null && Array.isArray(scene['objects'])
      ? { scene: { ...scene, objects: scene['objects'].map(emSizedText) } }
      : {}),
  };
}

function emSizedText(value: unknown): unknown {
  const text = record(value);
  if (text === null || text['kind'] !== 'text' || typeof text['fontKey'] !== 'string') return value;
  const legacyUnits = LEGACY_SIZE_UNITS.get(text['fontKey']);
  if (legacyUnits === undefined) return value;
  const factor = UNITS_PER_EM / legacyUnits;
  const box = record(text['textBox']);
  return {
    ...text,
    ...scaled(text, 'sizeMm', factor),
    ...scaled(text, 'lineHeight', 1 / factor),
    ...scaled(text, 'letterSpacing', 1 / factor),
    // A shrink-to-fit frame's smallest size is a Size too.
    ...(box === null
      ? {}
      : {
          textBox: {
            ...box,
            ...scaled(box, 'minSizeMm', factor),
            legacyLineEm: legacyUnits / UNITS_PER_EM,
          },
        }),
  };
}

// Anything that is not a finite number is left for the shape validator.
function scaled(
  owner: Record<string, unknown>,
  key: string,
  factor: number,
): Record<string, number> {
  const value = owner[key];
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value * factor } : {};
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
