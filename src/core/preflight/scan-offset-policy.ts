import {
  isScanOffsetMagnitudeForProfile,
  scanOffsetMagnitudeLimitMm,
} from '../devices/scan-offset-profile';
import { outputOperationLayers, sceneObjectUsesOperation, type Project } from '../scene';
import type { PreflightIssue } from './preflight';
import { operationOverrideForObject } from '../effective-output';

type ScanOffsetIssueOptions = {
  /** Pre-compile callers use this to reject only values no emitter can encode. */
  readonly nonFiniteOnly?: boolean;
};

export function operationScanOffsetIssues(
  project: Project,
  options: ScanOffsetIssueOptions = {},
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const outputLayers = project.scene.layers.flatMap(outputOperationLayers);
  for (const layer of outputLayers) {
    const issue = scanOffsetIssue(
      `Layer ${layer.id}`,
      layer.bidirectionalScanOffsetMm,
      project,
      options,
    );
    if (issue !== null) issues.push(issue);
  }
  for (const object of project.scene.objects) {
    const offsets = new Set(
      outputLayers
        .filter((layer) => sceneObjectUsesOperation(object, layer))
        .map((layer) => operationOverrideForObject(layer, object)?.bidirectionalScanOffsetMm),
    );
    for (const offset of offsets) {
      const issue = scanOffsetIssue(`Object ${object.id}`, offset, project, options);
      if (issue !== null) issues.push(issue);
    }
  }
  return issues;
}

function scanOffsetIssue(
  owner: string,
  offset: number | undefined,
  project: Project,
  options: ScanOffsetIssueOptions,
): PreflightIssue | null {
  if (offset === undefined) return null;
  if (!Number.isFinite(offset)) {
    return {
      code: 'scan-offset-out-of-range',
      message: `${owner} bidirectional scan offset ${String(offset)} mm must be finite.`,
    };
  }
  if (options.nonFiniteOnly === true || isScanOffsetMagnitudeForProfile(offset, project.device)) {
    return null;
  }
  const limit = scanOffsetMagnitudeLimitMm(project.device);
  // Distinct advisory code (rule 7): a finite over-cap magnitude is a
  // heuristic finding — it must warn (Job Review, post-save toast), never
  // block. Only the non-finite case above is a hard validity failure.
  return {
    code: 'scan-offset-above-cap',
    message: `${owner} bidirectional scan offset ${String(offset)} mm exceeds the device limit of ±${limit} mm.`,
  };
}
