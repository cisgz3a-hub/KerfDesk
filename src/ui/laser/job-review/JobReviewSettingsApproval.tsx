import { useState } from 'react';
import type { Layer, LayerOperationSettings } from '../../../core/scene';
import { Button } from '../../kit';
import { useStore } from '../../state';

/**
 * Tracks the editable Job Review values against their last approved main-store state.
 * `onApprove` runs only for changed values so the caller can refresh the exact prepared job.
 */
export function JobReviewSettingsApproval(props: { readonly onApprove: () => void }): JSX.Element {
  const signature = useStore((state) => settingsSignature(state.project.scene.layers));
  const [approvedSignature, setApprovedSignature] = useState(signature);
  const [hasApproved, setHasApproved] = useState(false);
  const hasChanges = signature !== approvedSignature;

  const handleApprove = (): void => {
    const currentSignature = settingsSignature(useStore.getState().project.scene.layers);
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

function settingsSignature(layers: ReadonlyArray<Layer>): string {
  return JSON.stringify(
    layers.map((layer) => ({
      id: layer.id,
      settings: editableOperationSettings(layer),
      cnc: layer.cnc ?? null,
      subLayers: layer.subLayers.map((subLayer) => ({
        id: subLayer.id,
        settings: editableOperationSettings(subLayer.settings),
      })),
    })),
  );
}

function editableOperationSettings(settings: LayerOperationSettings): object {
  return {
    power: settings.power,
    speed: settings.speed,
    passes: settings.passes,
    airAssist: settings.airAssist,
  };
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
