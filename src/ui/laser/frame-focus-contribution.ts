import { resolveGrblDialect } from '../../core/devices';
import { laserArcMovesEnabled } from '../../core/devices/laser-arc-moves';
import type { JobPlacementSettings } from '../../core/job';
import { hasRepresentedCutBurn } from '../../core/output/grbl-strategy';
import { powerScaleVersionForDevice } from '../../core/output/laser-power-scale-version';
import { outputOperationLayers, type OutputScope, type Project } from '../../core/scene';
import { prepareOutput } from '../../io/gcode/prepare-output';

/** Called only on a spatial projection cache miss; retain layer IDs,
 * never compiled geometry. Absolute output needs only Focus operations.
 * Relative output needs the full source's canonical placement bounds, including
 * registration boxes and unselected artwork when selection-origin is off.
 * This API has no frozen live absolute/current-position translation, controller
 * power range or Print-and-Cut transform.
 * In those cases retain intent: a fractional translation/registration can
 * make a pre-placement collapsed stroke executable. Null means unresolved,
 * never a refusal or evidence of absent Z motion.
 */
export function frameFocusContributingLayers(
  project: Project,
  scope: OutputScope,
  placement: JobPlacementSettings,
): ReadonlySet<string> | null {
  const layers = project.scene.layers.filter(
    (layer) => layer.output && layer.focusTest !== undefined,
  );
  if (layers.length === 0) return new Set();
  if (
    project.machine?.kind === 'cnc' ||
    project.printAndCutTargets !== undefined ||
    placement.startFrom === 'current-position'
  )
    return null;
  try {
    const source =
      placement.startFrom === 'absolute'
        ? { ...project, scene: { ...project.scene, layers } }
        : project;
    const prepared = prepareOutput(source, {
      outputScope: scope,
      jobOrigin: { startFrom: placement.startFrom, anchor: placement.anchor },
    });
    if (!prepared.ok) return null;
    const device = prepared.project.device;
    const context = {
      device: { ...device, maxPowerS: 1000 },
      dialect: resolveGrblDialect(device),
      arcMovesEnabled: laserArcMovesEnabled(device),
      laserPowerScaleVersion: powerScaleVersionForDevice(device),
    };
    // A compiled subpass owns an expanded operation ID, but Focus intent is
    // stored on its parent. Use canonical expansion rather than parsing IDs.
    const parents = new Map(
      layers.flatMap((layer) =>
        outputOperationLayers(layer).map((operation) => [operation.id, layer.id] as const),
      ),
    );
    // Unknown live G54 can make a subprecision Absolute edge executable.
    // Only raw zero effective power or exactly stationary geometry proves
    // absence independently of that translation and the live controller S range.
    // Relative placement is resolved here; test its geometry at positive power.
    return new Set(
      prepared.job.groups.flatMap((group) =>
        group.kind === 'cut' &&
        group.focusTest !== undefined &&
        group.power > 0 &&
        (placement.startFrom === 'absolute'
          ? group.segments.some((segment) => {
              const first = segment.polyline[0];
              return (
                first !== undefined &&
                (segment.arcMoves !== undefined ||
                  segment.polyline.some((point) => point.x !== first.x || point.y !== first.y))
              );
            })
          : hasRepresentedCutBurn({ ...group, power: 100 }, context))
          ? [parents.get(group.layerId) ?? group.layerId]
          : [],
      ),
    );
  } catch {
    // Display identity is conservative on unresolved output; ordinary output
    // preparation still reports the factual error through its own contract.
    return null;
  }
}
