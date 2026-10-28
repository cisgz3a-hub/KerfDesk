import type { Project } from '../../core/scene';
import { withReferencedEmbeddedFonts } from '../../core/text/embedded-font-set';
import { deserializeProject } from './deserialize-project';
import { deserializeFailureReason, errorMessage } from './deserialize-failure-reason';
import { serializeProject } from './serialize-project';
import { firstPersistenceSemanticDrift } from './persistence-semantic-integrity';
import { isTextLengthLimitError, PROJECT_TEXT_TOO_LARGE_REASON } from './project-text-limit';

export type PreparedProjectPersistence =
  | { readonly kind: 'ok'; readonly project: Project; readonly json: string }
  | { readonly kind: 'invalid'; readonly reason: string };

// The live store is typed, but imports, migrations, and browser extensions can
// still leave runtime values outside that type. Persistence therefore uses the
// same validation + normalization boundary as Open before any bytes are saved.
//
// The file is written compact, as autosave is (ADR-204 Amendment 2): indented
// JSON took about 349 bytes per imported vector point, so Save was refused
// with "Invalid string length" past about 1.5M points (J10-P3-3).
export function prepareProjectForPersistence(project: Project): PreparedProjectPersistence {
  let serialized: string;
  try {
    // Fonts no text uses are not written (ADR-628 Amendment 1).
    serialized = serializeProject(withReferencedEmbeddedFonts(project), { compact: true });
  } catch (error) {
    return { kind: 'invalid', reason: serializationFailureReason(error) };
  }

  const validated = deserializeProject(serialized);
  if (validated.kind !== 'ok') {
    return { kind: 'invalid', reason: deserializeFailureReason(validated) };
  }
  let normalizedJson: string;
  try {
    normalizedJson = serializeProject(validated.project, { compact: true });
  } catch (error) {
    return { kind: 'invalid', reason: serializationFailureReason(error) };
  }
  const driftPath = firstPersistenceSemanticDrift(serialized, normalizedJson);
  if (driftPath !== null) {
    return {
      kind: 'invalid',
      reason: `saving would change \`${driftPath}\` during validation; repair or reload the project before saving`,
    };
  }
  return {
    kind: 'ok',
    project: validated.project,
    json: normalizedJson,
  };
}

function serializationFailureReason(error: unknown): string {
  return isTextLengthLimitError(error) ? PROJECT_TEXT_TOO_LARGE_REASON : errorMessage(error);
}
