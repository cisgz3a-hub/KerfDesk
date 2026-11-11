import { Button, Icon } from '../kit';
import { IconFrame } from '../kit/icon-frame';
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
        data-design-tree-name
        pressed={active}
        title={selectTitle(row, name, locked)}
        disabled={row.kind === 'object' && locked}
        onClick={() =>
          row.kind === 'group'
            ? useStore.getState().selectDesignGroup(id)
            : useStore.getState().selectDesignArtwork(id)
        }
      >
        {row.kind === 'group' ? <Icon name="chevron-right" size={14} /> : null}
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
      {locked ? <UnlockRowButton row={row} name={name} /> : null}
    </>
  );
}

function selectTitle(row: DesignTreeRow, name: string, locked: boolean): string {
  if (row.kind === 'group') return `Select all ${row.group.objectIds.length} artworks in ${name}.`;
  return locked
    ? `${name} is locked. Unlock it to select or edit it.`
    : `Select ${name} directly for editing.`;
}

// Frees this row alone; Unlock All is no longer the only way (annoyance audit
// A4-P2-3). A group row unlocks the locked artwork inside it.
function UnlockRowButton({
  row,
  name,
}: {
  readonly row: DesignTreeRow;
  readonly name: string;
}): JSX.Element {
  return (
    <Button
      aria-label={`Unlock ${name}`}
      title={
        row.kind === 'group'
          ? `Unlock the locked artwork in ${name}. Other locked artwork stays locked.`
          : `${name} is locked. Unlock it and select it; other locked artwork stays locked.`
      }
      onClick={() => {
        const app = useStore.getState();
        if (row.kind === 'group') {
          app.unlockObjects(row.group.objectIds);
          return;
        }
        app.unlockObjects([row.object.id]);
        app.selectDesignArtwork(row.object.id);
      }}
    >
      Unlock
    </Button>
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
      <IconFrame size={16}>
        <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth={3} />
      </IconFrame>
    </button>
  );
}
