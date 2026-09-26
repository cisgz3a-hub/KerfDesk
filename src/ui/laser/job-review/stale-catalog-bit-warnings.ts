import type { Project } from '../../../core/scene';
import { staleCatalogBitCorrections } from '../../machine/cnc-bit-catalog-corrections';
import type { CncToolPlanEntry } from '../../state/cnc-tool-plan';

/** Job Review advisory for a bit this job runs that is a copy of a catalog bit
 * saved before the catalog was corrected (ADR-322 Amendment 2). Warning only:
 * the fix is one click in Machine Setup's bit library, and Start is never held. */
export function detectStaleCatalogBitWarnings(
  project: Project,
  toolPlan: ReadonlyArray<CncToolPlanEntry> | undefined,
): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc' || toolPlan === undefined) return [];
  const planned = new Set(toolPlan.flatMap((entry) => (entry.id === null ? [] : [entry.id])));
  return machine.tools
    .filter((tool) => planned.has(tool.id))
    .flatMap((tool) =>
      staleCatalogBitCorrections(tool).map(
        (correction) =>
          `${correction.toolName} is a copy of a catalog bit saved before the catalog was ` +
          `corrected: it still has ${correction.before}, and the catalog now lists ` +
          `${correction.now}, so ${correction.effect}. Machine Setup's bit library offers the ` +
          'corrected value in one click; check it before starting.',
      ),
    );
}
