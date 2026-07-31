import { generateBox } from '../../core/box';
import type {
  BoxGenerationMetrics,
  BoxGenerationWorkerRequest,
  BoxGenerationWorkerResponse,
} from './box-generation-worker-protocol';

export function runBoxGenerationRequest(
  request: BoxGenerationWorkerRequest,
): BoxGenerationWorkerResponse {
  const result = generateBox(request.spec);
  return {
    kind: 'result',
    id: request.id,
    result,
    metrics: result.kind === 'generated' ? measureGeneratedBox(result.panels) : null,
  };
}

function measureGeneratedBox(
  panels: Extract<ReturnType<typeof generateBox>, { readonly kind: 'generated' }>['panels'],
): BoxGenerationMetrics {
  let ringCount = 0;
  let pointCount = 0;
  for (const panel of panels) {
    const rings = [panel.outline, ...panel.cutouts];
    ringCount += rings.length;
    for (const ring of rings) pointCount += ring.points.length;
  }
  return { panelCount: panels.length, ringCount, pointCount };
}
