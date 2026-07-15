import { fingerprintGcode, fingerprintsEqual } from '../../core/recovery';
import { emitPreparedGcode } from '../../io/gcode';
import type { ExecutionArtifactV1 } from '../state/recovery';
import { buildLaserResumeProgram } from './laser-resume-program';

/** Replays the artifact's recorded emitter lineage and proves that its
 * prepared semantics still produce the exact sealed bytes. */
export function recoveryArtifactPreparedProgramMatches(artifact: ExecutionArtifactV1): boolean {
  try {
    let gcode = emitPreparedGcode(artifact.prepared, {
      outputScope: artifact.outputScope,
      ...(artifact.jobOrigin === undefined ? {} : { jobOrigin: artifact.jobOrigin }),
      allowRotaryRaster: true,
    }).gcode;
    for (const step of artifact.laserResumeChain ?? []) {
      const resumed = buildLaserResumeProgram(gcode, step.fromLine);
      if (resumed.kind === 'error') return false;
      gcode = resumed.lines.join('\n');
    }
    return (
      gcode === artifact.gcode && fingerprintsEqual(fingerprintGcode(gcode), artifact.fingerprint)
    );
  } catch {
    return false;
  }
}
