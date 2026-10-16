import type { Project, Vec2 } from '../scene';
import { applyJobOriginOffset } from '../job/job-origin';
import { optimizePaths } from '../job/optimize-paths';
import { compileJob } from '../job/compile-job';
import { resolveGrblDialect } from '../devices';
import { laserArcMovesEnabled } from '../devices/laser-arc-moves';
import { hasRepresentedCutBurn } from '../output/grbl-strategy';
import { powerScaleVersionForDevice } from '../output/laser-power-scale-version';

/** Test actual Focus contribution, not merely a binding on empty artwork.
 * Remove only the admission metadata in this read-only compilation copy: the
 * question is whether those operations have motion whose Focus meaning CNC
 * would otherwise discard. Normal output never uses this probe's job. */
export function hasContributingFocusMotion(project: Project, offset: Vec2): boolean {
  const layers = project.scene.layers
    .filter(
      (layer) => layer.output && layer.focusTest !== undefined && layer.focusTest.offsetMm !== 0,
    )
    .map(({ focusTest: _focus, ...layer }) => layer);
  if (layers.length === 0) return false;
  const device = project.device;
  const laserPowerScaleVersion = powerScaleVersionForDevice(device);
  const compiled = compileJob({ ...project.scene, layers }, device, laserPowerScaleVersion);
  // The caller resolves placement from the complete CNC job. Rounding before
  // that translation can turn a real subprecision contour into a false absence.
  const job = optimizePaths(
    applyJobOriginOffset(compiled, offset),
    project.optimization,
    device.scanningOffsets,
    device.origin,
  );
  const context = {
    device,
    laserPowerScaleVersion,
    dialect: resolveGrblDialect(device),
    arcMovesEnabled: laserArcMovesEnabled(device),
  };
  return job.groups.some((group) =>
    group.kind === 'cut' ? hasRepresentedCutBurn(group, context) : true,
  );
}
