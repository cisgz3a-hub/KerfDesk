import { Button } from '../kit';
import { useStore } from '../state';
import { nodeOrderKey } from '../../core/scene/design-hierarchy-order';
import { designRowId, designRowName, designRowRef, type DesignTreeRow } from './design-tree-rows';
import type { DesignHierarchyTransferController } from './use-design-hierarchy-transfer';

export type DesignRowButtonProps = {
  readonly row: DesignTreeRow;
  readonly active: boolean;
  readonly locked: boolean;
  readonly setEditing: (id: string | null) => void;
  readonly transfer: DesignHierarchyTransferController;
};
export function DesignRowButtons({
  row,
  active,
  locked,
  setEditing,
  transfer,
}: DesignRowButtonProps): JSX.Element {
  const id = designRowId(row),
    name = designRowName(row),
    ref = designRowRef(row);
  return (
    <>
      <DesignDragHandle row={row} locked={locked} transfer={transfer} />
      <Button
        pressed={active}
        title={
          row.kind === 'group'
            ? `Select all ${row.group.objectIds.length} artworks in ${name}.`
            : `Select ${name} directly for editing.`
        }
        disabled={row.kind === 'object' && locked}
        onClick={() =>
          row.kind === 'group'
            ? useStore.getState().selectDesignGroup(id)
            : useStore.getState().selectDesignArtwork(id)
        }
      >
        {row.kind === 'group' ? '▸ ' : ''}
        {name}
      </Button>
      {row.kind === 'group' ? (
        <Button
          title={`Enter ${name} to edit its children.`}
          onClick={() => useStore.getState().focusDesignGroup(id)}
        >
          Enter
        </Button>
      ) : null}
      <Button
        aria-label={`Rename ${name}`}
        title={`Rename ${name}.`}
        onClick={() => setEditing(nodeOrderKey(ref))}
      >
        Rename
      </Button>
      <Button
        aria-label={`Move ${name}`}
        disabled={locked}
        title={
          locked
            ? `Unlock artwork in ${name} before moving it.`
            : `Choose a destination and sibling position for ${name}, using keyboard-accessible controls.`
        }
        onClick={() => transfer.begin(ref, name, 'choose')}
      >
        Move
      </Button>
      {locked ? <span className="lf-muted">Locked</span> : null}
    </>
  );
}
function DesignDragHandle({
  row,
  locked,
  transfer,
}: Pick<DesignRowButtonProps, 'row' | 'locked' | 'transfer'>): JSX.Element {
  const name = designRowName(row);
  return (
    <button
      type="button"
      className="lf-btn"
      draggable={!locked}
      disabled={locked}
      aria-label={`Drag ${name}`}
      title={
        locked
          ? `Unlock artwork in ${name} before moving it.`
          : `Drag ${name} into a group, to All artwork, or between sibling rows. Use Move for keyboard controls.`
      }
      onDragStart={(event) => transfer.dragStart(event, designRowRef(row), name)}
      onDragEnd={transfer.dragEnd}
    >
      ⋮⋮
    </button>
  );
}
