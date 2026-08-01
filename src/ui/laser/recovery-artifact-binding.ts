import { fingerprintGcode, fingerprintsEqual } from '../../core/recovery';
import { emitPreparedGcode } from '../../io/gcode';
import { hydratePreparedExecutionOutput } from '../../io/gcode/prepared-output-persistence';
import { type ExecutionArtifactV1, type PreparedExecutionOutput } from '../state/recovery';
import { buildLaserResumeProgram } from './laser-resume-program';

/** Replays the artifact's recorded emitter lineage and proves that its
 * prepared semantics still produce the exact sealed bytes. */
export function recoveryArtifactPreparedProgramMatches(artifact: ExecutionArtifactV1): boolean {
  return recoveryArtifactPreparedOutput(artifact) !== null;
}

export function recoveryArtifactPreparedOutput(
  artifact: ExecutionArtifactV1,
): PreparedExecutionOutput | null {
  try {
    const prepared = hydratePreparedExecutionOutput(artifact.prepared);
    if (prepared === null) return null;
    let gcode = emitPreparedGcode(prepared, {
      outputScope: artifact.outputScope,
      ...(artifact.jobOrigin === undefined ? {} : { jobOrigin: artifact.jobOrigin }),
      allowRotaryRaster: true,
    }).gcode;
    for (const step of artifact.laserResumeChain ?? []) {
      const resumed = buildLaserResumeProgram(gcode, step.fromLine);
      if (resumed.kind === 'error') return null;
      gcode = resumed.lines.join('\n');
    }
    return gcode === artifact.gcode &&
      fingerprintsEqual(fingerprintGcode(gcode), artifact.fingerprint)
      ? prepared
      : null;
  } catch {
    return null;
  }
}
