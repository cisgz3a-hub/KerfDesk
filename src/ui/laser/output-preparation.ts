import { emitGcode } from '../../io/gcode';
import { prepareOutputForStructuredClone } from '../../io/gcode/prepared-output-persistence';
import { prepareStartJob } from './start-job-readiness';
import type {
  OutputPreparationRequest,
  OutputPreparationResponse,
  StartOutputPreparationRequest,
} from './output-preparation-protocol';

export function prepareOutputRequest(request: OutputPreparationRequest): OutputPreparationResponse {
  if (request.kind === 'save') {
    return { kind: 'save', result: emitGcode(request.project, request.options) };
  }
  return { kind: 'start', result: prepareStartOutput(request) };
}

function prepareStartOutput(request: StartOutputPreparationRequest) {
  const result = prepareStartJob(
    request.project,
    request.controllerSettings,
    request.machine,
    request.jobPlacement,
    request.outputScope,
    request.resolvedJobOrigin,
    request.allowRotaryRaster,
    request.requireFrame,
  );
  return result.ok
    ? { ...result, prepared: prepareOutputForStructuredClone(result.prepared) }
    : result;
}
