import { DEFAULT_TEXT_LETTER_SPACING } from '../../core/text';
import { normalizeLibraryAssetProvenance } from './project-library-provenance-normalizer';
import { withNormalizedTraceSettings } from './project-trace-settings-normalizer';
import { normalizeBooleanCompound } from './normalize-boolean-compound';
import {
  normalizeReliefAuthoringObject,
  type ReliefAuthoringResolutions,
} from './project-relief-authoring-validator';
import { parsePartGeneratorSource } from './project-part-generator-validator';
import { parseConstrainedSketch } from './project-constrained-sketch-validator';
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function normalizeSceneObject(
  obj: unknown,
  resolvedDocuments?: ReliefAuthoringResolutions,
): unknown {
  if (!isObject(obj)) return obj;
  const { libraryProvenance: rawLibraryProvenance, ...withoutLibraryProvenance } =
    withoutLegacyTraceSourceRole(obj);
  const libraryProvenance =
    obj['kind'] === 'imported-svg'
      ? normalizeLibraryAssetProvenance(rawLibraryProvenance)
      : undefined;
  const normalized = normalizeBooleanCompound(
    withNormalizedTraceSettings(
      libraryProvenance === undefined
        ? withoutLibraryProvenance
        : { ...withoutLibraryProvenance, libraryProvenance },
    ),
  );
  if (obj['kind'] === 'relief')
    return normalizeReliefAuthoringObject(normalized, resolvedDocuments?.get(obj));
  const intent = normalizedDesignIntent(obj, normalized);
  if (intent !== null) return intent;
  if (obj['kind'] !== 'text') return normalized;
  if (typeof obj['letterSpacing'] === 'number') return normalized;
  return { ...normalized, letterSpacing: DEFAULT_TEXT_LETTER_SPACING };
}

// ADR-648: earlier builds tagged a photo kept behind a trace
// `role: 'trace-source'` and left it out of every job. A kept photo is now an
// ordinary image, so the marker is dropped on load: the photo engraves on its
// operation like any other, and the next save writes it without the marker.
function withoutLegacyTraceSourceRole(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj['kind'] !== 'raster-image' || !('role' in obj)) return obj;
  const { role: _legacyRole, ...ordinaryImage } = obj;
  return ordinaryImage;
}

function normalizedDesignIntent(
  object: Record<string, unknown>,
  normalized: Record<string, unknown>,
): Record<string, unknown> | null {
  if (object['kind'] !== 'imported-svg') return null;
  if (object['constrainedSketch'] !== undefined) {
    const parsed = parseConstrainedSketch(object['constrainedSketch']);
    if (parsed.kind === 'ok') return { ...normalized, constrainedSketch: parsed.sketch };
  }
  if (object['partGenerator'] !== undefined) {
    const parsed = parsePartGeneratorSource(object['partGenerator']);
    if (parsed.kind === 'ok') return { ...normalized, partGenerator: parsed.value };
  }
  return null;
}
