import type { ProjectOptimizationSettings } from '../../core/scene';

/** ADR-385 Cut Planner options, read from the raw project's `optimization`:
 * only an explicit opt-in is kept, so a project saved with them off reads back
 * with no new keys at all. */
export function withClosedCutOptions(
  settings: ProjectOptimizationSettings,
  rawProject: Readonly<Record<string, unknown>>,
): ProjectOptimizationSettings {
  const raw = rawProject['optimization'];
  if (typeof raw !== 'object' || raw === null) return settings;
  const value = raw as Readonly<Record<string, unknown>>;
  return {
    ...settings,
    ...(value['bestStartPoint'] === true ? { bestStartPoint: true } : {}),
    ...(value['preferCorners'] === true ? { preferCorners: true } : {}),
    ...(value['bestDirection'] === true ? { bestDirection: true } : {}),
  };
}
