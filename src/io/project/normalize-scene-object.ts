import { DEFAULT_TEXT_LETTER_SPACING } from '../../core/text';
import { normalizeLibraryAssetProvenance } from './project-library-provenance-normalizer';
import { withNormalizedTraceSettings } from './project-trace-settings-normalizer';
import { normalizeBooleanCompound } from './normalize-boolean-compound';
import { normalizeReliefAuthoringObject } from './project-relief-authoring-validator';
import { parsePartGeneratorSource } from './project-part-generator-validator';
import { parseConstrainedSketch } from './project-constrained-sketch-validator';
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function normalizeSceneObject(obj: unknown): unknown {
  if (!isObject(obj)) return obj;
  const { libraryProvenance: rawLibraryProvenance, ...withoutLibraryProvenance } = obj;
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
  if (obj['kind'] === 'relief') return normalizeReliefAuthoringObject(normalized);
  const intent = normalizedDesignIntent(obj, normalized);
  if (intent !== null) return intent;
  if (obj['kind'] !== 'text') return normalized;
  if (typeof obj['letterSpacing'] === 'number') return normalized;
  return { ...normalized, letterSpacing: DEFAULT_TEXT_LETTER_SPACING };
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
