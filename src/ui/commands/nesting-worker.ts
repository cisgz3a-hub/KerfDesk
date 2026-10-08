/// <reference lib="webworker" />
import { searchNestLayouts } from '../../core/nesting/layout-nest';
import type { NestingWorkerRequest, NestingWorkerResponse } from './nesting-worker-protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const send = (response: NestingWorkerResponse): void => scope.postMessage(response);
scope.onmessage = (event: MessageEvent<NestingWorkerRequest>): void => {
  if (event.data.kind !== 'search') return;
  try {
    for (const progress of searchNestLayouts(event.data.input))
      send({ kind: 'progress', progress });
    send({ kind: 'complete' });
  } catch (error) {
    send({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Nesting search failed.',
    });
  }
};
