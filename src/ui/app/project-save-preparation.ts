import type { Project } from '../../core/scene';
import { unpackProjectMessage } from '../packed-project-transfer';
import type { ProjectSavePreparationMessage } from './project-save-preparation-client';
import {
  prepareProjectForPersistence,
  serializeProjectChunks,
  type PreparedProjectPersistence,
} from '../../io/project';

// Canonical preparation returns validated text, which Save seals. The raw
// recovery copy is a Blob of compact chunks that are never joined, so it
// still reaches a file when the project's text passes the engine's longest
// string, which is when Save itself is refused (J10-P3-3).
export type ProjectSavePreparation =
  | { readonly kind: 'ok'; readonly json: string | Blob }
  | Extract<PreparedProjectPersistence, { readonly kind: 'invalid' }>
  | { readonly kind: 'failed'; readonly reason: string };

export function prepareProjectSaveRequest(
  message: ProjectSavePreparationMessage,
): ProjectSavePreparation {
  // The envelope owns decoding. A raw project's unrelated `kind` field cannot
  // be mistaken for the packed geometry transport discriminator.
  const project =
    message.representation === 'packed'
      ? unpackProjectMessage(message.project)
      : (message.project as Project);
  return message.mode === 'recovery'
    ? prepareProjectRecoveryMessage(project)
    : prepareProjectSaveMessage(project);
}

// The worker returns only bytes; cloning a normalized dense scene back would
// place the same large geometry graph on the UI thread again.
export function prepareProjectSaveMessage(project: Project): ProjectSavePreparation {
  const result = prepareProjectForPersistence(project);
  return result.kind === 'ok' ? { kind: 'ok', json: result.json } : result;
}

export function prepareProjectRecoveryMessage(project: Project): ProjectSavePreparation {
  try {
    return { kind: 'ok', json: new Blob([...serializeProjectChunks(project)]) };
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}
