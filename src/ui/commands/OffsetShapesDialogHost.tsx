import { useStore } from '../state';
import type { OffsetShapesRequest } from '../state/offset-shapes-actions';
import { DEFAULT_OFFSET_SHAPES_REQUEST, OffsetShapesDialog } from './OffsetShapesDialog';
import { selectedObjectIds } from './selection-command-state';

// The dialog reopens with the settings last applied in this session, so a
// repeated offset (a kerf ring, a weed border) is one click.
let lastApplied: OffsetShapesRequest = DEFAULT_OFFSET_SHAPES_REQUEST;

export function OffsetShapesDialogHost(props: { readonly onClose: () => void }): JSX.Element {
  const scene = useStore((state) => state.project.scene);
  const primary = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const offset = useStore((state) => state.offsetShapesSelection);
  return (
    <OffsetShapesDialog
      scene={scene}
      selectedIds={selectedObjectIds(primary, additional)}
      initial={lastApplied}
      onCancel={props.onClose}
      onApply={(request) => {
        if (!offset(request)) return;
        lastApplied = request;
        props.onClose();
      }}
    />
  );
}

/** Test seam: forget the remembered settings. */
export function resetOffsetShapesDialogMemory(): void {
  lastApplied = DEFAULT_OFFSET_SHAPES_REQUEST;
}
