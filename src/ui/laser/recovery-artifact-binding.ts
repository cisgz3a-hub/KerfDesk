import { fingerprintGcode, fingerprintsEqual } from '../../core/recovery';
import { emitPreparedGcode } from '../../io/gcode';
import { hydratePreparedExecutionOutput } from '../../io/gcode/prepared-output-persistence';
import { type ExecutionArtifactV1, type PreparedExecutionOutput } from '../state/recovery';
import { buildLaserResumeProgram } from './laser-resume-program';
import { buildLaserSecondPassProgram } from '../../core/laser-second-pass';

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
      sourceGeometryChecks: 'compiled-evidence-only',
    }).gcode;
    for (const stage of artifact.laserSecondPassChain ?? []) {
      if (stage.selection.maxPowerS !== prepared.project.device.maxPowerS) return null;
      gcode = applyResumeChain(gcode, stage.resumeChainBefore);
      if (!fingerprintsEqual(fingerprintGcode(gcode), stage.sourceFingerprint)) return null;
      const secondPass = buildLaserSecondPassProgram(gcode, stage.selection);
      if (secondPass.kind === 'error') return null;
      gcode = secondPass.gcode;
    }
    gcode = applyResumeChain(gcode, artifact.laserResumeChain ?? []);
    return gcode === artifact.gcode &&
      fingerprintsEqual(fingerprintGcode(gcode), artifact.fingerprint)
      ? prepared
      : null;
  } catch {
    return null;
  }
}

function applyResumeChain(
  gcode: string,
  chain: NonNullable<ExecutionArtifactV1['laserResumeChain']>,
): string {
  for (const step of chain) {
    const resumed = buildLaserResumeProgram(gcode, step.fromLine);
    if (resumed.kind === 'error') throw new Error(resumed.reason);
    gcode = resumed.lines.join('\n');
  }
  return gcode;
}
