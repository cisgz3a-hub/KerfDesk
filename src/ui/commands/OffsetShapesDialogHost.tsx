import { useStore } from '../state';
import type { OffsetShapesRequest } from '../state/offset-shapes-actions';
import { registrationArtworkSnapshot } from '../state/registration-output-actions';
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
  const artworkSnapshot = useStore(registrationArtworkSnapshot);
  const widthMm = useStore((state) => state.project.device.bedWidth);
  const heightMm = useStore((state) => state.project.device.bedHeight);
  return (
    <OffsetShapesDialog
      scene={scene}
      selectedIds={selectedObjectIds(primary, additional)}
      initial={lastApplied}
      artworkSnapshot={artworkSnapshot}
      bed={{ widthMm, heightMm }}
      onCancel={props.onClose}
      onApply={(request, prepared) => {
        if (!offset(request, prepared)) return;
        // The operation belongs to this selection; the next one picks its own.
        const { operationId: _operationId, ...remembered } = request;
        lastApplied = remembered;
        props.onClose();
      }}
    />
  );
}

/** Test seam: forget the remembered settings. */
export function resetOffsetShapesDialogMemory(): void {
  lastApplied = DEFAULT_OFFSET_SHAPES_REQUEST;
}
