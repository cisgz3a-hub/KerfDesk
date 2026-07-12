import { combinedBBox } from '../../core/scene';
import { useStore } from '../state';
import { ArrayDialog } from './ArrayDialog';

export function ArrayDialogHost(props: { readonly onClose: () => void }): JSX.Element | null {
  const project = useStore((state) => state.project);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const arraySelection = useStore((state) => state.arraySelection);
  const selectedIds = new Set([
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ]);
  const bounds = combinedBBox(project.scene.objects.filter((object) => selectedIds.has(object.id)));
  if (bounds === null) return null;
  return (
    <ArrayDialog
      selectionBounds={bounds}
      onCancel={props.onClose}
      onApply={(spec) => {
        arraySelection(spec);
        props.onClose();
      }}
    />
  );
}
