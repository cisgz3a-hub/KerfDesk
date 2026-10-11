/// <reference lib="webworker" />
import { searchProductionNest } from '../../core/nesting/production-nest-plan';
import { searchNestLayouts } from '../../core/nesting/layout-nest';
import type { NestingWorkerRequest, NestingWorkerResponse } from './nesting-worker-protocol';
import { advancedNestingSession } from './advanced-nesting-session';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const send = (response: NestingWorkerResponse): void => scope.postMessage(response);
let advanced: ReturnType<typeof advancedNestingSession> = null;
scope.onmessage = (event: MessageEvent<NestingWorkerRequest>): void => {
  try {
    if (event.data.kind === 'advanced-result') advanced?.accept(event.data.certificate);
    else if (event.data.kind === 'advanced-finished') advanced?.finish(event.data.notice);
    else if (event.data.kind === 'production-search' && event.data.advanced === true) {
      advanced = advancedNestingSession(event.data.input, send);
    } else if (event.data.kind === 'production-search') {
      for (const progress of searchProductionNest(event.data.input))
        send({ kind: 'production-progress', progress });
      send({ kind: 'production-complete' });
    } else {
      for (const progress of searchNestLayouts(event.data.input))
        send({ kind: 'progress', progress });
      send({ kind: 'complete' });
    }
  } catch (error) {
    send({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Nesting search failed.',
    });
  }
};
