import { prepareOutput } from '../../io/gcode';
import { prepareOutputForStructuredClone } from '../../io/gcode/prepared-output-persistence';
import { emitSavePreparedOutput } from './save-output-emission';
import { prepareStartJob } from './start-job-readiness';
import type {
  OutputPreparationRequest,
  OutputPreparationResponse,
  StartOutputPreparationRequest,
} from './output-preparation-protocol';

export function prepareOutputRequest(request: OutputPreparationRequest): OutputPreparationResponse {
  if (request.kind === 'save') {
    const prepared = prepareOutput(request.project, request.options);
    return { kind: 'save', result: emitSavePreparedOutput(prepared, request.options) };
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
