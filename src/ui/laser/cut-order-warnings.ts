// Job Review advisory: a closed cut runs before work inside it, so the part
// can drop or shift once it is cut free and the later work lands in the wrong
// place. Warning only: the operator may intend the order (rule 7, ADR-228).
// Job Review offers Sort cuts last beside it (JobReviewWarnings).

import { detectCutOrderHazards } from '../../core/job/cut-order-hazards';
import type { Job } from '../../core/job';
import type { Layer } from '../../core/scene';
import { operationNames } from './job-review/operation-names';

export const CUT_ORDER_WARNING_PREFIX = 'Cut order:';

const LISTED_PAIRS = 3;

const CUT_ORDER_WARNING_BODY =
  'A part can drop or shift once it is cut free, so work inside it that runs later may land ' +
  'in the wrong place. Sort cuts last, in Job Review or Run order, runs each cut after the ' +
  'work it surrounds.';

export function detectCutOrderWarnings(
  job: Job,
  layers: ReadonlyArray<Layer>,
): ReadonlyArray<string> {
  const hazards = detectCutOrderHazards(job);
  if (hazards.length === 0) return [];
  const names = operationNames(layers);
  const name = (id: string): string => `"${names.get(id) ?? id}"`;
  const pairs = hazards.map(
    (hazard) => `${name(hazard.cutLayerId)} before ${name(hazard.enclosedLayerId)}`,
  );
  const listed = pairs.slice(0, LISTED_PAIRS).join(', ');
  const more = pairs.length > LISTED_PAIRS ? ` and ${pairs.length - LISTED_PAIRS} more` : '';
  const subject =
    hazards.length === 1
      ? 'a cut runs before the work inside it'
      : 'cuts run before the work inside them';
  return [`${CUT_ORDER_WARNING_PREFIX} ${subject} (${listed}${more}). ${CUT_ORDER_WARNING_BODY}`];
}

export function isCutOrderWarning(warning: string): boolean {
  return warning.startsWith(CUT_ORDER_WARNING_PREFIX);
}
