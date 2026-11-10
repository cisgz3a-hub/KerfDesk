import { LEGACY_SIZE_UNITS, UNITS_PER_EM } from '../../core/text/single-line-frame-rule';
import type { RawProject } from './migrations';
import { asRecord } from '../../core/util/is-record';

// Schema 19 makes Size the em for single-line fonts, as it already was for
// outline fonts (ADR-682). Older writers scaled these four fonts by a
// cap-height value instead: Relief's real capital height, and the EMS
// sources' placeholder of 500. Each such text keeps exactly what it drew:
// Size grows by the em over that value, and line height and letter spacing,
// which are multiples of Size, shrink by the same factor. A frame counted
// each line as one of those Sizes, so it keeps counting that fraction of the
// em (ADR-682 Amendment 1).

export function migrateV18SingleLineTextEm(raw: RawProject): RawProject {
  const scene = asRecord(raw['scene']);
  return {
    ...raw,
    schemaVersion: 19,
    ...(scene !== null && Array.isArray(scene['objects'])
      ? { scene: { ...scene, objects: scene['objects'].map(emSizedText) } }
      : {}),
  };
}

function emSizedText(value: unknown): unknown {
  const text = asRecord(value);
  if (text === null || text['kind'] !== 'text' || typeof text['fontKey'] !== 'string') return value;
  const legacyUnits = LEGACY_SIZE_UNITS.get(text['fontKey']);
  if (legacyUnits === undefined) return value;
  const factor = UNITS_PER_EM / legacyUnits;
  const box = asRecord(text['textBox']);
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
