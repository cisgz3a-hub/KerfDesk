import { cancelledFillCopies } from '../job/cancelled-fill-copies';
import { machineKindOf, type Project } from '../scene';
import type { PreflightIssue } from './preflight';

// Advisory only (ADR-683): exact stacked copies on a laser Fill operation
// cancel under the pooled even-odd fill and burn nothing. An intended hole
// made this way is legitimate, so this warns and never refuses.
export function cancelledFillCopyIssues(project: Project): ReadonlyArray<PreflightIssue> {
  if (machineKindOf(project.machine) !== 'laser') return [];
  const copiesByOperation = new Map<string, number>();
  for (const set of cancelledFillCopies(project.scene)) {
    const count = copiesByOperation.get(set.operationName) ?? 0;
    copiesByOperation.set(set.operationName, count + set.objectIds.length);
  }
  return [...copiesByOperation].map(([operationName, copies]) => ({
    code: 'fill-stacked-copies-cancel',
    message:
      `${copies} stacked copies on Fill operation "${operationName}" burn nothing. ` +
      'Fill burns where an odd number of its shapes overlap, so a shape and an exact copy ' +
      'on top of it cancel each other, as in LightBurn. Delete the extra copies ' +
      '(Edit > Delete Duplicates, Alt+D) unless the gap is intended.',
  }));
}
