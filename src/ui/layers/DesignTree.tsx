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
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <p className="lf-artwork-hint">
        Drag the handle into a group or between rows. Move offers the same destination and position
        choices from the keyboard. Manufacturing order stays separate.
      </p>
      <div
        data-design-root-drop
        title="Drop a design item here to make it the last child of All artwork."
        style={{ padding: 6, border: '1px dashed var(--lf-border)' }}
        onDragOver={transfer.dragOver}
        onDrop={(event) => transfer.drop(event, { parentId: null })}
      >
        All artwork · root drop target
      </div>
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
      <p role="status" aria-live="polite">
        {transfer.message}
      </p>
      <ul
        aria-label="Design object tree"
        style={{ listStyle: 'none', padding: 0, maxHeight: 280, overflow: 'auto' }}
      >
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
    </>
  );
}
