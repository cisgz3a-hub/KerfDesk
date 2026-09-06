import {
  isScanOffsetMagnitudeForProfile,
  scanOffsetMagnitudeLimitMm,
} from '../devices/scan-offset-profile';
import { outputOperationLayers, sceneObjectUsesOperation, type Project } from '../scene';
import type { PreflightIssue } from './preflight';
import { operationOverrideForObject } from '../effective-output';

type ScanOffsetIssueOptions = {
  /** Pre-compile callers report invalid overrides that normalization will ignore. */
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
      message: `${owner} bidirectional scan offset ${String(offset)} mm is not finite and will be ignored. Output inheriting this invalid value uses the device table for bidirectional compensation, or 0 mm when no table is saved.`,
    };
  }
  if (options.nonFiniteOnly === true || isScanOffsetMagnitudeForProfile(offset, project.device)) {
    return null;
  }
  const limit = scanOffsetMagnitudeLimitMm(project.device);
  // Distinct advisory code (rule 7): a finite over-cap magnitude is a
  // heuristic finding — it must warn (Job Review, post-save toast), never
  // block. Non-finite overrides above are also advisory and normalize to absent.
  return {
    code: 'scan-offset-above-cap',
    message: `${owner} bidirectional scan offset ${String(offset)} mm exceeds the device limit of ±${limit} mm.`,
  };
}
