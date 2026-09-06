import { useMemo, useState } from 'react';
import { captureLayerOperationSettings, type Scene } from '../../../core/scene';
import { Button } from '../../kit';
import { useStore } from '../../state';

/**
 * Tracks the editable Job Review values against their last approved main-store state.
 * `onApprove` runs only for changed values so the caller can refresh the exact prepared job.
 */
export function JobReviewSettingsApproval(props: { readonly onApprove: () => void }): JSX.Element {
  const scene = useStore((state) => state.project.scene);
  const signature = useMemo(() => settingsSignature(scene), [scene]);
  const [approvedSignature, setApprovedSignature] = useState(signature);
  const [hasApproved, setHasApproved] = useState(false);
  const hasChanges = signature !== approvedSignature;

  const handleApprove = (): void => {
    const currentSignature = settingsSignature(useStore.getState().project.scene);
    const shouldRebuild = currentSignature !== approvedSignature;
    setApprovedSignature(currentSignature);
    setHasApproved(true);
    if (shouldRebuild) props.onApprove();
  };

  return (
    <section aria-label="Artwork settings approval" style={approvalStyle}>
      <p role="status" aria-live="polite" style={statusStyle}>
        {approvalStatus(hasChanges, hasApproved)}
      </p>
      <Button
        title={
          hasChanges
            ? 'Approve the changed main settings and refresh the exact job review.'
            : 'Approve the current main Artwork / Operations settings.'
        }
        onClick={handleApprove}
      >
        Approve settings
      </Button>
    </section>
  );
}

function approvalStatus(hasChanges: boolean, hasApproved: boolean): string {
  if (hasChanges) {
    return 'Changes are synced to the main Artwork / Operations settings. Approve them here, or Start job to approve the full review.';
  }
  return hasApproved
    ? 'Approved — current values are synced to the main Artwork / Operations settings.'
    : 'Main Artwork / Operations settings match this review.';
}

function settingsSignature(scene: Scene): string {
  return JSON.stringify({
    layers: scene.layers.map((layer) => ({
      id: layer.id,
      color: layer.color,
      output: layer.output,
      settings: captureLayerOperationSettings(layer),
      cnc: layer.cnc ?? null,
      subLayers: layer.subLayers.map((subLayer) => ({
        id: subLayer.id,
        enabled: subLayer.enabled,
        settings: captureLayerOperationSettings(subLayer.settings),
      })),
    })),
    objects: scene.objects.map((object) => ({
      id: object.id,
      operationIds: object.operationIds,
      operationOverride: object.operationOverride,
      powerScale: object.powerScale,
      color: 'color' in object ? object.color : undefined,
      paths:
        'paths' in object
          ? object.paths.map((path) => ({ color: path.color, operationIds: path.operationIds }))
          : undefined,
    })),
  });
}

const approvalStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 8,
};

const statusStyle: React.CSSProperties = {
  margin: 0,
  marginRight: 'auto',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
