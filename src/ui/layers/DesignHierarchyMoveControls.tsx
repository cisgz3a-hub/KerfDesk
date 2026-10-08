import { useState } from 'react';
import type { Scene } from '../../core/scene';
import {
  designNodeChildren,
  designNodeParent,
  groupAncestors,
} from '../../core/scene/design-hierarchy-membership';
import { nodeOrderKey, type DesignNodeRef } from '../../core/scene/design-hierarchy-order';
import { Button } from '../kit';
import type {
  DesignHierarchyTransferController,
  HierarchyTransfer,
} from './use-design-hierarchy-transfer';

export function DesignHierarchyMoveControls({
  transfer,
  controller,
}: {
  readonly transfer: HierarchyTransfer;
  readonly controller: DesignHierarchyTransferController;
}): JSX.Element {
  const scene = transfer.owner.project.scene;
  const [parentId, setParentId] = useState<string | null>(
    designNodeParent(scene, transfer.node) ?? null,
  );
  const [position, setPosition] = useState('last');
  const children = designNodeChildren(scene, parentId).filter(
    (ref) => nodeOrderKey(ref) !== nodeOrderKey(transfer.node),
  );
  const destinations = (scene.groups ?? []).filter(
    (group) =>
      transfer.node.kind !== 'group' || !groupAncestors(scene, group.id).includes(transfer.node.id),
  );
  return (
    <fieldset
      aria-label={`Move ${transfer.name}`}
      style={{ display: 'grid', gap: 6 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          controller.cancel();
        }
      }}
    >
      <legend>Move {transfer.name}</legend>
      <label>
        Destination
        <select
          className="lf-input"
          aria-label="Design move destination"
          autoFocus
          title="Choose All artwork or a group to receive this design item. Descendants of a moving group are unavailable."
          value={parentId ?? ''}
          onChange={(event) => {
            setParentId(event.currentTarget.value || null);
            setPosition('last');
          }}
        >
          <option value="">All artwork (root)</option>
          {destinations.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <MovePosition
        scene={scene}
        children={children}
        position={position}
        setPosition={setPosition}
      />
      <p className="lf-artwork-hint">
        Groups require two artworks. Shared memberships must be resolved explicitly; a rejected move
        preserves the design.
      </p>
      <HierarchyMoveFooter
        cancel={controller.cancel}
        apply={() =>
          controller.apply({
            node: transfer.node,
            parentId,
            before:
              position === 'first'
                ? (children[0] ?? null)
                : (children.find((ref) => nodeOrderKey(ref) === position) ?? null),
          })
        }
      />
    </fieldset>
  );
}
function HierarchyMoveFooter({
  apply,
  cancel,
}: {
  readonly apply: () => void;
  readonly cancel: () => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <Button
        title="Apply this hierarchy transfer as one undoable edit, preserving canvas and manufacturing order."
        onClick={apply}
      >
        Apply move
      </Button>
      <Button title="Cancel this hierarchy transfer without changing the project." onClick={cancel}>
        Cancel move
      </Button>
    </div>
  );
}
function MovePosition({
  scene,
  children,
  position,
  setPosition,
}: {
  readonly scene: Scene;
  readonly children: ReadonlyArray<DesignNodeRef>;
  readonly position: string;
  readonly setPosition: (position: string) => void;
}): JSX.Element {
  return (
    <label>
      Position
      <select
        className="lf-input"
        aria-label="Design move position"
        title="Choose the item's position among the destination's direct children. This changes only the design tree."
        value={position}
        onChange={(event) => setPosition(event.currentTarget.value)}
      >
        <option value="last">Last child</option>
        <option value="first">First child</option>
        {children.map((ref) => (
          <option key={nodeOrderKey(ref)} value={nodeOrderKey(ref)}>
            Before {nodeName(scene, ref)}
          </option>
        ))}
      </select>
    </label>
  );
}
function nodeName(scene: Scene, ref: DesignNodeRef): string {
  return ref.kind === 'group'
    ? (scene.groups?.find((group) => group.id === ref.id)?.name ?? ref.id)
    : (scene.objects.find((object) => object.id === ref.id)?.name ?? ref.id);
}
