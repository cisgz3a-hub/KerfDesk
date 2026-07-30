// Shared failure-to-reason helpers for the persistence paths.
//
// Extracted when the autosave path became a second caller: both
// prepare-project-persistence and prepare-project-autosave turn the same
// DeserializeResult / thrown-error pair into operator-facing text, and a
// divergence between them would report the same defect two different ways.

import type { DeserializeResult } from './deserialize-project';

export function deserializeFailureReason(
  result: Exclude<DeserializeResult, { kind: 'ok' }>,
): string {
  if (result.kind === 'invalid') return result.reason;
  if (result.kind === 'schema-too-new') return `unsupported schemaVersion ${result.sawVersion}`;
  return `legacy schemaVersion ${result.sawVersion}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
