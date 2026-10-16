// pre-emit — cheap, project-level preflight that runs BEFORE compileJob.
// Since ADR-241/ADR-243 removed the complexity and raster-size refusals
// (vector/fill scenes of any size compile, and rasters of any size stream
// row-by-row), the only issues left here are configuration facts that make
// the travel policy unusable and non-finite scan offsets. Size and duration
// concerns surface as Job Review advisories instead (start-job-readiness).
// This boundary also reports exact configuration facts that make honest
// compilation impossible, such as a contributing V-carve whose V-bit has no
// valid included angle.
// Pure-core: no clock, no random, no I/O.

import { sceneObjectUsesOperation, type Project } from '../scene';
import { collectLayerContours } from '../cnc/collect-cnc-contours';
import type { PreflightIssue, PreflightResult } from './preflight';
import { findInvalidCncToolGeometry } from './cnc-tool-geometry';
import { controlledLaserOffTravelFeedIssue } from './laser-off-motion-policy';
import { operationScanOffsetIssues } from './scan-offset-policy';
import { cncMachineParamIssues } from './cnc-machine-params';

export function runPreEmitPreflight(project: Project): PreflightResult {
  const issues: PreflightIssue[] = [];
  if (project.machine?.kind === 'cnc') {
    if (
      project.scene.layers.some(
        (layer) =>
          layer.output &&
          layer.focusTest !== undefined &&
          // Use the CNC compiler's canonical-curve materializer: a binding
          // with only empty/one-point paths cannot be reinterpreted as a cut.
          (collectLayerContours(project.scene.objects, layer, project.device).length > 0 ||
            project.scene.objects.some(
              (object) => object.kind === 'relief' && sceneObjectUsesOperation(object, layer),
            )),
      )
    )
      issues.push({
        code: 'focus-test-needs-laser',
        message:
          'Focus Test samples contain relative laser Z motion that cannot be compiled as CNC cutting depths. Switch back to Laser mode, or exclude the focus samples from this output.',
      });
    issues.push(...cncMachineParamIssues(project.machine));
    issues.push(...findInvalidCncToolGeometry(project.scene, project.machine, project.device));
    // The laser-off seek feed and the raster scan-offset table shape laser
    // output only; a router job never reads them, so they cannot fail it.
    return { ok: issues.length === 0, issues };
  }
  const controlledFeed = project.device.controlledLaserOffTravelFeedMmPerMin;
  const controlledTravelIssue = controlledLaserOffTravelFeedIssue(project.device);
  if (
    controlledFeed !== undefined &&
    (!Number.isFinite(controlledFeed) || controlledFeed <= 0) &&
    controlledTravelIssue !== null
  ) {
    issues.push({ code: 'speed-out-of-range', message: controlledTravelIssue });
  }
  issues.push(...operationScanOffsetIssues(project, { nonFiniteOnly: true }));
  return { ok: issues.length === 0, issues };
}
