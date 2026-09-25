import { sourceFragmentObjects } from '../state/svg-fragment-mutation';
import type { SceneObject } from '../../core/scene';
import {
  handleReimportSelectedArtwork,
  canReimportSelectedArtwork,
} from '../app/reimport-selected-artwork';
import { usePlatformOptional } from '../app/platform-context';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

export function SelectedSourceReimportControl(props: {
  readonly object: SceneObject | null;
}): JSX.Element | null {
  const platform = usePlatformOptional();
  const reimportFragment = useStore((state) => state.reimportSvgFragment);
  const reimportObject = useStore((state) => state.reimportSvgObject);
  const pushToast = useToastStore((state) => state.pushToast);
  const target = props.object;
  if (platform === null || target === null || !canReimportSelectedArtwork(target)) return null;
  return (
    <div style={containerStyle}>
      <button
        type="button"
        className="lf-btn"
        title="Replace the artwork from this source file together; a fresh import always appends."
        onClick={() =>
          void handleReimportSelectedArtwork({
            platform,
            target,
            getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
            getTargetObject: () =>
              useStore
                .getState()
                .project.scene.objects.find((candidate) => candidate.id === target.id),
            reimportObject,
            reimportFragment,
            getSourceObjects: () =>
              sourceFragmentObjects(useStore.getState().project.scene, target),
            pushToast,
          })
        }
      >
        Re-import selected source…
      </button>
      <span style={hintStyle}>
        Replaces the artwork imported from {target.source}. Fresh imports always append.
      </span>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  marginBottom: 8,
};
const hintStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
