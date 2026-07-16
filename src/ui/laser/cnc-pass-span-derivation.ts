// deriveCncArtifactPassSpans (ADR-215) — recover the per-pass raw-line spans
// for a sealed CNC execution artifact by replaying its recorded emitter
// lineage, exactly like recoveryArtifactPreparedProgramMatches does for
// program identity. Spans are only trusted when the re-emission reproduces
// the sealed bytes; anything else returns null and the caller falls back to
// manual pass selection — a missing sidecar must never block recovery.
//
// Deriving (instead of storing spans on the artifact) keeps the Start path
// untouched and works retroactively for every existing exact CNC capsule.

import { fingerprintGcode, fingerprintsEqual } from '../../core/recovery';
import type { CncPassSpan } from '../../core/output';
import { emitPreparedGcodeWithCncPassSpans } from '../../io/gcode/emit-gcode';
import type { ExecutionArtifactV1 } from '../state/recovery';

export function deriveCncArtifactPassSpans(
  artifact: ExecutionArtifactV1,
): ReadonlyArray<CncPassSpan> | null {
  if (artifact.machineKind !== 'cnc' || artifact.laserResumeChain !== undefined) return null;
  try {
    const emitted = emitPreparedGcodeWithCncPassSpans(artifact.prepared, {
      outputScope: artifact.outputScope,
      ...(artifact.jobOrigin === undefined ? {} : { jobOrigin: artifact.jobOrigin }),
      allowRotaryRaster: true,
    });
    if (emitted.spans === null || emitted.gcode !== artifact.gcode) return null;
    if (!fingerprintsEqual(fingerprintGcode(emitted.gcode), artifact.fingerprint)) return null;
    return emitted.spans;
  } catch {
    return null;
  }
}
