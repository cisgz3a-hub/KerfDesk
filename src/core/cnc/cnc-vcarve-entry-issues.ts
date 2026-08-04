import type { DeviceProfile } from '../devices';
import type { Job } from '../job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncMachineConfig,
  type Layer,
  type Scene,
} from '../scene';
import { collectLayerPolylines } from './compile-cnc-job';
import { vcarveMedialPasses } from './vcarve-medial';

export type CncVCarveEntryIssue = {
  readonly layerId: string;
  readonly reason: string;
};

export function findCncVCarveEntryIssues(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
  compiledJob?: Job,
): ReadonlyArray<CncVCarveEntryIssue> {
  if (compiledJob !== undefined) {
    const compiledEvidence = compiledJob.cncCompilation?.vcarveOperations;
    // Exact archived jobs can predate the compilation sidecar. Recovery must
    // never rebuild a costly V-carve plan on the browser thread merely to
    // recover advisory detail; the sealed program remains authoritative.
    if (compiledEvidence === undefined) return [];
    return compiledEvidence.flatMap((evidence) =>
      evidence.entryIssue === null
        ? []
        : [{ layerId: evidence.layerId, reason: evidence.entryIssue }],
    );
  }
  const issues: CncVCarveEntryIssue[] = [];
  for (const layer of scene.layers) {
    const reason = vcarveEntryIssueForLayer(scene, layer, device, config);
    if (reason !== null) issues.push({ layerId: layer.id, reason });
  }
  return issues;
}

function vcarveEntryIssueForLayer(
  scene: Scene,
  layer: Layer,
  device: DeviceProfile,
  config: CncMachineConfig,
): string | null {
  if (!layer.output) return null;
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  if (settings.cutType !== 'v-carve' || settings.vCarveRampEntryDeg === undefined) return null;
  const polylines = collectLayerPolylines(scene.objects, layer, device);
  if (polylines.length === 0) return null;
  return vcarveMedialPasses(polylines, {
    tool: layerCncTool(config, settings),
    maxDepthMm:
      (settings.vCarveFlatDepthEnabled ?? true) ? settings.depthMm : Number.POSITIVE_INFINITY,
    depthPerPassMm: settings.depthPerPassMm,
    resolutionMm: settings.vResolutionMm,
    rampAngleDeg: settings.vCarveRampEntryDeg,
  }).entryIssue;
}
