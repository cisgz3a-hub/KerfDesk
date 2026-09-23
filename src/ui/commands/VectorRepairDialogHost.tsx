import { useStore } from '../state';
import { selectedObjectIds } from './selection-command-state';
import { JoinPathsDialog } from './JoinPathsDialog';
import { UnionSilhouetteDialog } from './UnionSilhouetteDialog';

export function VectorRepairDialogHost(props: {
  readonly kind: 'union' | 'join';
  readonly onClose: () => void;
}): JSX.Element {
  const scene = useStore((state) => state.project.scene);
  const primary = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const union = useStore((state) => state.unionSilhouetteSelection);
  const join = useStore((state) => state.joinSelectedPaths);
  const ids = selectedObjectIds(primary, additional);
  return props.kind === 'union' ? (
    <UnionSilhouetteDialog
      scene={scene}
      selectedIds={ids}
      onCancel={props.onClose}
      onApply={(operationId) => {
        if (union(operationId)) props.onClose();
      }}
    />
  ) : (
    <JoinPathsDialog
      scene={scene}
      selectedIds={ids}
      onCancel={props.onClose}
      onApply={(toleranceMm) => {
        if (join(toleranceMm)) props.onClose();
      }}
    />
  );
}
