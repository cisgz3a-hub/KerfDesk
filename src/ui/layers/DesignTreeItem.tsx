import type { Scene } from '../../core/scene';
import { nodeOrderKey, type DesignNodeRef } from '../../core/scene/design-hierarchy-order';
import { DesignRowButtons } from './DesignRowButtons';
import { DesignNameField } from './DesignNameField';
import { designRowId, designRowName, designRowRef, type DesignTreeRow } from './design-tree-rows';
import type { DesignHierarchyTransferController } from './use-design-hierarchy-transfer';

export function DesignTreeItem({
  row,
  scene,
  active,
  editing,
  setEditing,
  transfer,
  nextSibling,
}: {
  readonly row: DesignTreeRow;
  readonly scene: Scene;
  readonly active: boolean;
  readonly editing: string | null;
  readonly setEditing: (id: string | null) => void;
  readonly transfer: DesignHierarchyTransferController;
  readonly nextSibling: DesignNodeRef | null;
}): JSX.Element {
  const id = designRowId(row),
    name = designRowName(row),
    ref = designRowRef(row),
    key = nodeOrderKey(ref);
  const locked =
    row.kind === 'object'
      ? row.object.locked === true
      : scene.objects.some(
          (object) => object.locked === true && row.group.objectIds.includes(object.id),
        );
  return (
    <li
      data-design-node={key}
      style={{ marginLeft: Math.min(row.depth, 8) * 12, display: 'grid', gap: 4 }}
    >
      <DesignDropEdge row={row} nextSibling={nextSibling} transfer={transfer} edge="before" />
      <div
        style={{ display: 'flex', gap: 4, alignItems: 'center' }}
        data-design-drop={key}
        title={
          row.kind === 'group'
            ? `Drop a design item into ${name}.`
            : `Drop a design item before ${name}.`
        }
        onDragOver={transfer.dragOver}
        onDrop={(event) =>
          transfer.drop(
            event,
            row.kind === 'group' ? { parentId: id } : { parentId: row.parentId, before: ref },
          )
        }
      >
        <DesignRowButtons
          row={row}
          active={active}
          locked={locked}
          setEditing={setEditing}
          transfer={transfer}
        />
      </div>
      {editing === key ? <DesignNameField row={row} close={() => setEditing(null)} /> : null}
      <DesignDropEdge row={row} nextSibling={nextSibling} transfer={transfer} edge="after" />
    </li>
  );
}
function DesignDropEdge({
  row,
  nextSibling,
  transfer,
  edge,
}: {
  readonly row: DesignTreeRow;
  readonly nextSibling: DesignNodeRef | null;
  readonly transfer: DesignHierarchyTransferController;
  readonly edge: 'before' | 'after';
}): JSX.Element | null {
  if (transfer.transfer?.mode !== 'drag') return null;
  const ref = designRowRef(row);
  const before = edge === 'before' ? ref : nextSibling;
  return (
    <span
      data-design-edge={`${edge}:${nodeOrderKey(ref)}`}
      title={`Insert ${edge} ${designRowName(row)} in this sibling list.`}
      style={{ minHeight: 10, borderTop: '1px dashed var(--lf-border)' }}
      onDragOver={transfer.dragOver}
      onDrop={(event) => transfer.drop(event, { parentId: row.parentId, before })}
    >
      <small className="lf-muted">
        {edge === 'before' ? 'Before' : 'After'} {designRowName(row)}
      </small>
    </span>
  );
}
