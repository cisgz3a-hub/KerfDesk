// The Settings section of the Job Review dialog (ADR-224 v3): one card per
// output-enabled operation (plus enabled laser sub-operations). Laser cards
// edit power, speed, passes and air in place and Save them to the main
// settings through the panel store actions; CNC cards are read-only and
// changes return to Artwork settings. Each card keeps a muted detail line
// with the mode-specific settings and bound material.

import {
  activeCncTool,
  DEFAULT_CNC_LAYER_SETTINGS,
  isRegistrationLayer,
  layerFromSubLayer,
  operationArtworkCount,
  type CncMachineConfig,
  type Layer,
  type LayerSubLayer,
  type MachineKind,
  type SceneObject,
} from '../../../core/scene';
import { placedLaserTabCount } from '../../../core/job/laser-tab-anchors';
import { layerSubLayerOperationId } from '../../../core/scene/layer';
import type { MaterialLibraryDocument } from '../../../io/material-library';
import { useStore } from '../../state';
import { operationListStyle } from './job-review-card.styles';
import {
  boundMaterialLabel,
  cncOperationDetail,
  laserOperationDetail,
} from './job-review-detail-facts';
import type { JobReviewEffectiveOperation } from './job-review-effective-operations';
import { formatLayerMode } from './job-review-format';
import {
  artworkOwnerPatches,
  reviewRowSettings,
  type ReviewRowPatch,
} from './job-review-operation-edit';
import {
  bannerStyle,
  sectionHeadingStyle,
  sectionHintStyle,
  sectionStyle,
} from './job-review.styles';
import type { MaterialChip } from './JobReviewCardParts';
import { JobReviewCncOperationCard } from './JobReviewCncOperationCard';
import { JobReviewLaserOperationCard } from './JobReviewLaserOperationCard';

type OperationsProps = {
  readonly machineKind: MachineKind;
  readonly effectiveOperations: ReadonlyArray<JobReviewEffectiveOperation>;
  /** Runs after a card saved its values to the main settings. */
  readonly onSaved?: () => void;
  /** Reports which cards are mid-edit, keyed by operation id. */
  readonly onEditingChange?: (operationId: string, isEditing: boolean) => void;
};

export function JobReviewOperations(props: OperationsProps): JSX.Element {
  const layers = useStore((s) => s.project.scene.layers);
  const outputLayers = layers.filter((layer) => layer.output);
  return (
    <section aria-label="Settings" style={sectionStyle}>
      <h3 style={sectionHeadingStyle}>
        Settings
        <span style={sectionHintStyle}>{reviewHint(props.machineKind)}</span>
      </h3>
      {outputLayers.length === 0 ? (
        <div className="lf-banner lf-banner--info" style={bannerStyle}>
          No operations have Output enabled, so there is nothing to run. Cancel and turn on Output
          for at least one operation.
        </div>
      ) : props.machineKind === 'cnc' ? (
        <CncOperations layers={outputLayers} effectiveOperations={props.effectiveOperations} />
      ) : (
        <LaserOperations {...props} layers={outputLayers} />
      )}
    </section>
  );
}

function LaserOperations(
  props: OperationsProps & { readonly layers: ReadonlyArray<Layer> },
): JSX.Element {
  const objects = useStore((s) => s.project.scene.objects);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const materialLibrary = useStore((s) => s.materialLibrary);
  const commitLayer = useCommitLayerPatch();
  const updateLayerSubLayer = useStore((s) => s.updateLayerSubLayer);
  const saved = (commit: () => void): void => {
    commit();
    props.onSaved?.();
  };
  const editing = (operationId: string) => (isEditing: boolean) =>
    props.onEditingChange?.(operationId, isEditing);
  return (
    <div style={operationListStyle}>
      {props.layers.flatMap((layer) => [
        <JobReviewLaserOperationCard
          key={layer.id}
          operationId={layer.id}
          ariaContext={layer.name}
          name={layer.name}
          color={layer.color}
          modeLabel={formatLayerMode(layer.mode)}
          material={materialChip(layer, materialLibrary)}
          meta={artworkMeta(operationArtworkCount(objects, layer))}
          settings={reviewRowSettings(layer, objects)}
          detail={laserOperationReviewDetail(layer, objects)}
          maxFeedMmPerMin={maxFeed}
          effectiveOperations={props.effectiveOperations}
          onSave={(patch) => saved(() => commitLayer(layer, objects, patch))}
          onEditingChange={editing(layer.id)}
        />,
        ...layer.subLayers
          .filter((subLayer) => subLayer.enabled)
          .map((subLayer) => {
            const operationId = layerSubLayerOperationId(layer.id, subLayer.id);
            return (
              <JobReviewLaserOperationCard
                key={operationId}
                operationId={operationId}
                ariaContext={`${layer.name} ${subLayer.label}`}
                name={subLayer.label}
                parentName={layer.name}
                color={layer.color}
                modeLabel={formatLayerMode(subLayer.settings.mode)}
                material={null}
                meta="Sub-operation"
                settings={subLayer.settings}
                detail={subLayerReviewDetail(layer, subLayer, objects)}
                maxFeedMmPerMin={maxFeed}
                effectiveOperations={props.effectiveOperations}
                onSave={(patch) => saved(() => updateLayerSubLayer(layer.id, subLayer.id, patch))}
                onEditingChange={editing(operationId)}
              />
            );
          }),
      ])}
    </div>
  );
}

// Artworks that own an edited field keep it over the base (ADR-317), so the
// edit must reach them too (controller audit speed-2), in the same undo step
// as the base (audit 2026-10-21 06-P2-5).
function useCommitLayerPatch(): (
  layer: Layer,
  objects: ReadonlyArray<SceneObject>,
  patch: ReviewRowPatch,
) => void {
  const save = useStore((s) => s.setLayerParamWithArtworkOverrides);
  return (layer, objects, patch) =>
    save(layer.id, patch, artworkOwnerPatches(layer, objects, patch));
}

function CncOperations(props: {
  readonly layers: ReadonlyArray<Layer>;
  readonly effectiveOperations: ReadonlyArray<JobReviewEffectiveOperation>;
}): JSX.Element {
  const objects = useStore((s) => s.project.scene.objects);
  const machine = useStore((s) => s.project.machine);
  if (machine?.kind !== 'cnc') return <p style={{ margin: 0 }}>Machine is not in CNC mode.</p>;
  return (
    <div style={operationListStyle}>
      {props.layers.map((layer) => {
        const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
        const effective = props.effectiveOperations.find((entry) => entry.layerId === layer.id);
        return (
          <JobReviewCncOperationCard
            key={layer.id}
            operationId={layer.id}
            name={layer.name}
            color={layer.color}
            toolName={layerToolName(settings.toolId, machine)}
            meta={artworkMeta(operationArtworkCount(objects, layer))}
            settings={settings}
            detail={cncOperationDetail(
              settings,
              machine.stock.thicknessMm,
              effective?.plungingReliefStages,
              effective?.relief,
              effective?.unrampedShapes,
              effective === undefined ? undefined : effective.tabbedShapes === true,
              effective?.strategyFallback,
            )}
            effective={effective}
            effectiveOperations={props.effectiveOperations}
          />
        );
      })}
    </div>
  );
}

function subLayerReviewDetail(
  layer: Layer,
  subLayer: LayerSubLayer,
  objects: ReadonlyArray<SceneObject>,
): string {
  const placed = placedLaserTabCount(objects, layerFromSubLayer(layer, subLayer));
  return laserOperationDetail(subLayer.settings, placed);
}

function laserOperationReviewDetail(layer: Layer, objects: ReadonlyArray<SceneObject>): string {
  const detail = laserOperationDetail(layer, placedLaserTabCount(objects, layer));
  const artworkCount = operationArtworkCount(objects, layer);
  if (!isRegistrationLayer(layer)) return detail;
  return `Registration jig outline operation (${artworkCount} ${artworkCount === 1 ? 'outline' : 'outlines'}) · ${detail}`;
}

function artworkMeta(count: number): string {
  return `${count} ${count === 1 ? 'artwork' : 'artworks'}`;
}

function reviewHint(machineKind: MachineKind): string {
  return machineKind === 'cnc'
    ? 'read-only — change them in Artwork settings'
    : 'Edit saves to your Artwork settings';
}

function materialChip(layer: Layer, library: MaterialLibraryDocument | null): MaterialChip | null {
  const label = boundMaterialLabel(layer.materialBinding, library);
  return label === null ? null : { label, color: layer.color };
}

function layerToolName(toolId: string | undefined, machine: CncMachineConfig): string {
  const tool = toolId === undefined ? undefined : machine.tools.find((t) => t.id === toolId);
  return (tool ?? activeCncTool(machine)).name;
}
