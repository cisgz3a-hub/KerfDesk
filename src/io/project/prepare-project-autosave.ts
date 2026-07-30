// Autosave-path project preparation.
//
// Manual Save uses prepareProjectForPersistence, which — beyond serializing and
// validating — re-serializes the VALIDATED project and semantically diffs the two
// forms, refusing the save if they disagree. That check protects the operator's
// file of record: a save must never silently rewrite their data.
//
// An autosave slot is not a file of record. It is re-validated on every read
// (readAutosaveAtKey -> deserializeProject), and recovery restores the normalized
// project either way, so storing the pre-normalization serialization is
// equivalent for every consumer. Paying for a second full serialization plus a
// whole-string semantic diff on a 30-second timer therefore buys nothing — while
// on an image-heavy project each of those passes walks a multi-hundred-megabyte
// string and doubles peak allocation. That cost, repeated every 30 s, is the
// dominant source of autosave-tick jank on large scenes.
//
// Validation itself is KEPT: it is what turns a structurally broken project into
// an operator warning ("save manually") at write time, instead of a recovery slot
// that silently fails to restore after a crash.

import type { Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { deserializeFailureReason, errorMessage } from './deserialize-failure-reason';
import { serializeProject } from './serialize-project';

export type PreparedProjectAutosave =
  | { readonly kind: 'ok'; readonly json: string }
  | { readonly kind: 'invalid'; readonly reason: string };

export function prepareProjectForAutosave(project: Project): PreparedProjectAutosave {
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
  return { kind: 'ok', json: serialized };
}
