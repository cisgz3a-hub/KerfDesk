import {
  runControllerReadiness,
  type ControllerSettingsSnapshot,
  type ReadinessSettingsCapability,
} from '../../core/preflight';
import type { Project } from '../../core/scene';

/** A completed Frame may authorize Start only when every live controller fact
 * that is already known agrees with the exact output contract. Unknown laser
 * settings remain explicit Job Review warnings; known-wrong values cannot be
 * converted into proof by tool-off XY motion. CNC keeps the stricter existing
 * requirement because unknown $30/$32 changes spindle/plunge semantics. */
export function frameControllerSettingsIssues(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  settingsCapability: ReadinessSettingsCapability,
): ReadonlyArray<string> {
  return runControllerReadiness(project, controllerSettings, settingsCapability).errors.map(
    (issue) => `Frame cannot authorize this output contract. ${issue.message}`,
  );
}
