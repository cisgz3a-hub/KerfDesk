import {
  advancedNestImproves,
  prepareAdvancedNest,
  readAdvancedNest,
} from '../../core/nesting/packing-solver-adapter';
import { searchProductionNest } from '../../core/nesting/production-nest-plan';
import type {
  ProductionNestResult,
  ProductionNestingInput,
} from '../../core/nesting/production-nest';
import type { NestingWorkerResponse } from './nesting-worker-protocol';

export function advancedNestingSession(
  input: ProductionNestingInput,
  send: (response: NestingWorkerResponse) => void,
) {
  let best: ProductionNestResult | null = null;
  let attempted = 0;
  let rejected = false;
  const progress = (notice?: string): void =>
    send({
      kind: 'production-progress',
      progress: {
        attempted,
        total: attempted,
        best,
        advanced: true,
        ...(notice === undefined ? {} : { notice }),
      },
    });
  // Honour the selected standard search before trying the optional engine.
  // Publish each incumbent so cancellation keeps the best completed draft.
  for (const standard of searchProductionNest(input)) {
    best = standard.best;
    attempted = standard.attempted;
    progress();
  }
  const request = prepareAdvancedNest(input);
  if (request.kind === 'unavailable') {
    progress(request.reason);
    send({ kind: 'production-complete' });
    return null;
  }
  send({ kind: 'advanced-start', instance: request.instance });
  return {
    accept(certificate: string): void {
      attempted += 1;
      const result = readAdvancedNest(input, certificate);
      if (result === null) rejected = true;
      else if (advancedNestImproves(result, best)) best = result;
      progress();
    },
    finish(notice?: string): void {
      progress(
        notice ??
          (rejected
            ? 'An advanced result failed geometry validation. The best valid draft is retained.'
            : undefined),
      );
      send({ kind: 'production-complete' });
    },
  };
}
