// Shared controller-readiness advisories for the Save-G-code paths
// (single-file, per-tile and standalone surfacing). M11 (AUDIT-2026-06-10): a
// project max S saved for a mismatched $30 clamps beam/spindle power when the
// file is run from an SD card or another sender, and $32 in the wrong mode is
// a CNC plunge hazard — so when the connected controller's settings disagree,
// say so. Extracted so every save path states it the same way.
//
// Rule 7 / ADR-228: this was `confirmControllerReadiness`, a jobAwareConfirm()
// that ABORTED the export when the operator declined. That is a
// controller-setting policy judgement refusing a save — the guard definition
// names "save … export … G-code emission" and "adds confirmation before an
// otherwise available action" verbatim, and names controller-setting policy as
// warn-only. The identical strings have reached Job Review as advisories on the
// Start path since #291 (start-job-controller-policy.ts:28); the export paths
// now state the same facts as post-save warnings instead of gating on them.
// Two defects went with the refusal: jobAwareConfirm returns false WITHOUT
// asking while a job streams, so a mid-job export was silently refused under a
// toast about discarding work; and declining aborted a save that Start allows.

import { runControllerReadiness, type ControllerSettingsSnapshot } from '../../core/preflight';
import type { Project } from '../../core/scene';

// Keeps the wording of the refusal this replaced, so the operator still reads
// the same sentence about the exported file alongside the specific finding.
const EXPORT_ADVISORY_PREFIX = 'The exported file may not run safely on the connected controller';

// undefined/null settings mean nothing was connected this session, so there is
// nothing to prove against — no advisory.
export function controllerReadinessAdvisories(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null | undefined,
): ReadonlyArray<string> {
  if (controllerSettings === undefined || controllerSettings === null) return [];
  return runControllerReadiness(project, controllerSettings).errors.map(
    (issue) => `${EXPORT_ADVISORY_PREFIX}: ${issue.message}`,
  );
}
