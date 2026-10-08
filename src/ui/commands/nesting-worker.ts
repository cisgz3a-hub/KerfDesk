/// <reference lib="webworker" />
import { searchProductionNest } from '../../core/nesting/production-nest-plan';
import { searchNestLayouts } from '../../core/nesting/layout-nest';
import type { NestingWorkerRequest, NestingWorkerResponse } from './nesting-worker-protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const send = (response: NestingWorkerResponse): void => scope.postMessage(response);
scope.onmessage = (event: MessageEvent<NestingWorkerRequest>): void => {
  try {
    if (event.data.kind === 'production-search') {
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
