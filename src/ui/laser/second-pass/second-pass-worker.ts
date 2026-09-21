import { rotaryAppliesTo, estimateJobDuration } from '../../../core/job';
import { buildMotionManifest } from '../../../core/job/motion-manifest';
import {
  buildLaserSecondPassProgram,
  type LaserSecondPassSelection,
} from '../../../core/laser-second-pass';
import { fingerprintGcode } from '../../../core/recovery';
import type { PreparedStartProgram } from '../../state/framed-run';
import type { ExecutionArtifactV1 } from '../../state/recovery';
import { executionArtifactIntegrityIsValid } from '../../state/recovery/execution-artifact-integrity';
import { recoveryArtifactPreparedProgramMatches } from '../recovery-artifact-binding';
import { secondPassDrawing, sourceInitialPosition } from './second-pass-preview';

let source: ExecutionArtifactV1 | null = null;
let sourceGeneration = 0;
type WorkerRequest = {
  id: number;
  source?: ExecutionArtifactV1;
  selection?: LaserSecondPassSelection;
  gcode?: string;
  initialPosition?: { x: number; y: number; z: number };
};
self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  void process(event.data).catch((error: unknown) => {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

async function process(request: WorkerRequest): Promise<void> {
  if (request.source) {
    const generation = ++sourceGeneration;
    // Replacement owns the cache immediately. Neither a pending/failed new
    // source nor a late older verification may reuse the previous program.
    source = null;
    const candidate = request.source;
    await validateSource(candidate);
    if (generation !== sourceGeneration)
      throw new Error('A newer saved job replaced this source verification.');
    const initialPosition = sourceInitialPosition(candidate);
    const drawing = secondPassDrawing(
      candidate.gcode,
      candidate.prepared.project.device,
      initialPosition,
    );
    source = candidate;
    self.postMessage(
      { id: request.id, value: drawing },
      { transfer: [drawing.segments.buffer, drawing.chunkBounds.buffer] },
    );
    return;
  }
  if (source && request.gcode && request.initialPosition) {
    self.postMessage({
      id: request.id,
      value: {
        manifest: buildMotionManifest(request.gcode, {
          machineKind: 'laser',
          initialPosition: request.initialPosition,
        }),
        duration: estimateJobDuration(source.prepared.job, source.prepared.project.device, {
          gcode: request.gcode,
          initialPosition: request.initialPosition,
        }),
      },
    });
    return;
  }
  if (!source || !request.selection)
    throw new Error('Open a saved laser job before preparing a second pass.');
  const value = compileSelectedPass(source, request.selection);
  self.postMessage(
    { id: request.id, value },
    { transfer: [value.drawing.segments.buffer, value.drawing.chunkBounds.buffer] },
  );
}

function compileSelectedPass(source: ExecutionArtifactV1, selection: LaserSecondPassSelection) {
  const result = buildLaserSecondPassProgram(source.gcode, selection);
  if (result.kind === 'error') throw new Error(result.message);
  const device = source.prepared.project.device;
  const manifest = buildMotionManifest(result.gcode, { machineKind: 'laser' });
  const fingerprint = fingerprintGcode(result.gcode);
  const motionBounds = result.motionBounds;
  const prepared: PreparedStartProgram = {
    ok: true,
    gcode: result.gcode,
    prepared: source.prepared,
    ...(source.jobOrigin === undefined ? {} : { jobOrigin: source.jobOrigin }),
    warnings: [
      'Second pass: keep the material in its original position and use the same work origin. Painted power multiplies the saved S values; original speed and grayscale are retained. Any repeated passes in the saved job repeat within the painted areas.',
      ...(result.clamped
        ? [
            'Some painted power reaches the saved machine profile maximum. Those values are capped; lighter tones retain their original proportions until that limit.',
          ]
        : []),
    ],
    metrics: {
      duration: estimateJobDuration(source.prepared.job, device, { gcode: result.gcode }),
      jobBounds: result.bounds,
      motionBounds,
      frameJobBounds: result.bounds,
      frameMotionBounds: motionBounds,
      parkTarget: null,
    },
    canvasPlan: {
      manifest,
      fingerprint,
      retentionKey: `second-pass:${source.runId}:${fingerprint.fnv1a}:${fingerprint.chars}`,
      device,
      machineKind: 'laser',
      coordinateFrame: { kind: 'relative', jobOriginOffset: { x: 0, y: 0 } },
      framePerimeter: [],
      jobStart: null,
      approachFrom: null,
      capability: 'settle-only',
      unavailableReason: null,
      resumed: false,
      positionEpoch: 0,
    },
  };
  const drawing = secondPassDrawing(result.gcode, device);
  return { prepared, drawing, burnLengthMm: result.burnLengthMm };
}

async function validateSource(candidate: ExecutionArtifactV1): Promise<void> {
  if (
    candidate.machineKind !== 'laser' ||
    rotaryAppliesTo(candidate.prepared.project.device, candidate.prepared.project.machine)
  ) {
    throw new Error('Painted second passes require a flat laser job.');
  }
  if (
    !(await executionArtifactIntegrityIsValid(candidate)) ||
    !recoveryArtifactPreparedProgramMatches(candidate)
  ) {
    throw new Error('The saved job could not be verified. Its original engraving is unavailable.');
  }
}
