import type { Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { deserializeFailureReason, errorMessage } from './deserialize-failure-reason';
import { serializeProject } from './serialize-project';
import { firstPersistenceSemanticDrift } from './persistence-semantic-integrity';

export type PreparedProjectPersistence =
  | { readonly kind: 'ok'; readonly project: Project; readonly json: string }
  | { readonly kind: 'invalid'; readonly reason: string };

// The live store is typed, but imports, migrations, and browser extensions can
// still leave runtime values outside that type. Persistence therefore uses the
// same validation + normalization boundary as Open before any bytes are saved.
export function prepareProjectForPersistence(project: Project): PreparedProjectPersistence {
  let serialized: string;
  try {
    serialized = serializeProject(project);
  } catch (error) {
    return { kind: 'invalid', reason: errorMessage(error) };
  }

  const validated = deserializeProject(serialized);
  if (validated.kind !== 'ok') {
    return { kind: 'invalid', reason: deserializeFailureReason(validated) };
  }
  const normalizedJson = serializeProject(validated.project);
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
