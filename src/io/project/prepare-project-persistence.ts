import type { Project } from '../../core/scene';
import { deserializeProject, type DeserializeResult } from './deserialize-project';
import { serializeProject } from './serialize-project';

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
  return {
    kind: 'ok',
    project: validated.project,
    json: serializeProject(validated.project),
  };
}

function deserializeFailureReason(result: Exclude<DeserializeResult, { kind: 'ok' }>): string {
  if (result.kind === 'invalid') return result.reason;
  if (result.kind === 'schema-too-new') return `unsupported schemaVersion ${result.sawVersion}`;
  return `legacy schemaVersion ${result.sawVersion}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
