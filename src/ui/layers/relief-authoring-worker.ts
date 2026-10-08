import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import { materializeReliefAuthoring } from '../../core/relief/materialize-relief-authoring';

self.onmessage = (event: MessageEvent<ReliefAuthoringDocument>): void => {
  const result = materializeReliefAuthoring(event.data, {
    progress: (fraction) => self.postMessage({ kind: 'progress', fraction }),
  });
  self.postMessage({ kind: 'result', result });
};
