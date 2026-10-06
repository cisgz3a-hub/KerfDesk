import type { Project } from '../../core/scene';
import { unpackProjectMessage } from '../packed-project-transfer';
import type { ProjectSavePreparationMessage } from './project-save-preparation-client';
import {
  prepareProjectForPersistence,
  serializeProject,
  type PreparedProjectPersistence,
} from '../../io/project';

export type ProjectSavePreparation =
  | Pick<Extract<PreparedProjectPersistence, { readonly kind: 'ok' }>, 'kind' | 'json'>
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
    return { kind: 'ok', json: serializeProject(project) };
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}
