import { useMemo, useState } from 'react';
import type { Scene } from '../../core/scene';
import { nodeOrderKey } from '../../core/scene/design-hierarchy-order';
import { Button } from '../kit';
import { useStore } from '../state';
import { DesignTreeItem } from './DesignTreeItem';
import { DesignHierarchyMoveControls } from './DesignHierarchyMoveControls';
import { useDesignHierarchyTransfer } from './use-design-hierarchy-transfer';
import {
  designRowId,
  designRowName,
  designRowRef,
  designRowSuccessors,
  type DesignTreeRow,
} from './design-tree-rows';

type DesignTreeProps = {
  readonly rows: ReadonlyArray<DesignTreeRow>;
  readonly scene: Scene;
};
export function DesignTree({ rows, scene }: DesignTreeProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const selected = useStore((state) => state.selectedObjectId);
  const extra = useStore((state) => state.additionalSelectedIds);
  const transfer = useDesignHierarchyTransfer();
  const successors = useMemo(() => designRowSuccessors(rows), [rows]);
  const visible = rows.filter((row) =>
    designRowName(row).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <input
        type="search"
        className="lf-input"
        aria-label="Find design objects"
        title="Find artwork or groups by their design names."
        placeholder="Find artwork or groups…"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {transfer.transfer?.mode === 'drag' ? (
        <div
          data-design-root-drop
          title="Drop a design item here to make it the last child of All artwork."
          style={{ padding: 6, border: '1px dashed var(--lf-border)' }}
          onDragOver={transfer.dragOver}
          onDrop={(event) => transfer.drop(event, { parentId: null })}
        >
          Move to All artwork
        </div>
      ) : null}
      {transfer.transfer?.mode === 'choose' ? (
        <DesignHierarchyMoveControls
          key={nodeOrderKey(transfer.transfer.node)}
          transfer={transfer.transfer}
          controller={transfer}
        />
      ) : null}
      {transfer.transfer?.mode === 'drag' ? (
        <Button
          title="Cancel this drag without changing group membership or order."
          onClick={transfer.cancel}
        >
          Cancel move
        </Button>
      ) : null}
      <p className="lf-design-status" role="status" aria-live="polite">
        {transfer.message}
      </p>
      <ul aria-label="Design object tree" className="lf-design-tree">
        {visible.map((row) => (
          <DesignTreeItem
            key={nodeOrderKey(designRowRef(row))}
            row={row}
            scene={scene}
            nextSibling={successors.get(nodeOrderKey(designRowRef(row))) ?? null}
            active={
              row.kind === 'object'
                ? selected === designRowId(row) || extra.has(designRowId(row))
                : row.group.objectIds.every((member) => member === selected || extra.has(member))
            }
            editing={editing}
            setEditing={setEditing}
            transfer={transfer}
          />
        ))}
      </ul>
      {visible.length === 0 ? (
        <p className="lf-artwork-hint">No matching artwork or groups.</p>
      ) : null}
    </>
  );
}
