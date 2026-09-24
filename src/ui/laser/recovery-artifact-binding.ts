import type { DeviceProfile } from '../../core/devices';
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
    let gcode: string | null = emitPreparedGcode(prepared, {
      outputScope: artifact.outputScope,
      ...(artifact.jobOrigin === undefined ? {} : { jobOrigin: artifact.jobOrigin }),
      sourceGeometryChecks: 'compiled-evidence-only',
    }).gcode;
    const device = prepared.project.device;
    for (const stage of artifact.laserSecondPassChain ?? []) {
      gcode = applySecondPassStage(gcode, stage, device);
      if (gcode === null) return null;
    }
    gcode = applyResumeChain(gcode, artifact.laserResumeChain ?? [], device);
    return gcode === artifact.gcode &&
      fingerprintsEqual(fingerprintGcode(gcode), artifact.fingerprint)
      ? prepared
      : null;
  } catch {
    return null;
  }
}

/** One painted stage: its recorded resumes, then its recorded writer. Null
 * when the stage no longer reproduces its sealed source. */
function applySecondPassStage(
  gcode: string,
  stage: NonNullable<ExecutionArtifactV1['laserSecondPassChain']>[number],
  device: DeviceProfile,
): string | null {
  if (stage.selection.maxPowerS !== device.maxPowerS) return null;
  const source = applyResumeChain(gcode, stage.resumeChainBefore, device);
  if (!fingerprintsEqual(fingerprintGcode(source), stage.sourceFingerprint)) return null;
  // A stage saved before writers were versioned was written by writer 1.
  const secondPass = buildLaserSecondPassProgram(source, stage.selection, {
    writerVersion: stage.writerVersion ?? 1,
  });
  return secondPass.kind === 'error' ? null : secondPass.gcode;
}

/** `device` is the profile the archive emitted its program with; transforms 1
 * and 2 ignore it, because they wrote GRBL power commands for every program. */
function applyResumeChain(
  gcode: string,
  chain: NonNullable<ExecutionArtifactV1['laserResumeChain']>,
  device: DeviceProfile,
): string {
  for (const step of chain) {
    // A step saved before transforms were versioned was built by transform 1.
    const resumed = buildLaserResumeProgram(gcode, step.fromLine, device, step.version ?? 1);
    if (resumed.kind === 'error') throw new Error(resumed.reason);
    gcode = resumed.lines.join('\n');
  }
  return gcode;
}
