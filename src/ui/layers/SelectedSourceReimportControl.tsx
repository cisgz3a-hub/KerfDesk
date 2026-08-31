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
  const reimportObject = useStore((state) => state.reimportSvgObject);
  const pushToast = useToastStore((state) => state.pushToast);
  const target = props.object;
  if (platform === null || target === null || !canReimportSelectedArtwork(target)) return null;
  return (
    <div style={containerStyle}>
      <button
        type="button"
        className="lf-btn"
        title="Replace only this selected source-aware object; a fresh import always appends a new object."
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
            pushToast,
          })
        }
      >
        Re-import selected source…
      </button>
      <span style={hintStyle}>
        Replaces only this selected {target.source} object. Fresh imports always append.
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
