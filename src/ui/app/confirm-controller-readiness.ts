// Shared controller-readiness confirmation gate for the Save-G-code paths
// (single-file and per-tile). M11 (AUDIT-2026-06-10): a project max S saved for
// a mismatched $30 clamps beam/spindle power when the file is run from an SD
// card or another sender, and $32 in the wrong mode is a CNC plunge hazard —
// so when the connected controller's settings disagree, gate the export behind
// an explicit confirmation. Extracted so both save paths run ONE gate.

import { runControllerReadiness, type ControllerSettingsSnapshot } from '../../core/preflight';
import type { Project } from '../../core/scene';
import { jobAwareConfirm } from '../state/job-aware-dialogs';

// Returns true to proceed with the save, false to abort. undefined/null
// settings mean nothing was connected this session, so there is nothing to
// prove against — proceed.
export function confirmControllerReadiness(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null | undefined,
): boolean {
  if (controllerSettings === undefined || controllerSettings === null) return true;
  const readiness = runControllerReadiness(project, controllerSettings);
  if (readiness.ok) return true;
  const lines = readiness.errors.map((e) => `• ${e.message}`).join('\n');
  return jobAwareConfirm(
    `The exported file may not run safely on the connected controller:\n\n${lines}\n\nSave anyway?`,
  );
}
