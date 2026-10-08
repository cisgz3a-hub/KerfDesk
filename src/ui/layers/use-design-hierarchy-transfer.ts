import { useRef, useState, type DragEvent } from 'react';
import type { DesignHierarchyMove } from '../../core/scene/design-hierarchy-edit';
import type { DesignNodeRef } from '../../core/scene/design-hierarchy-order';
import { useStore } from '../state';
import type { DesignHierarchyOwner } from '../state/design-hierarchy-actions';

export type HierarchyTransfer = {
  readonly node: DesignNodeRef;
  readonly name: string;
  readonly mode: 'drag' | 'choose';
  readonly owner: DesignHierarchyOwner;
};
export function useDesignHierarchyTransfer() {
  const [transfer, setTransfer] = useState<HierarchyTransfer | null>(null);
  const [message, setMessage] = useState('');
  const returnFocus = useRef<HTMLElement | null>(null);
  const begin = (node: DesignNodeRef, name: string, mode: 'drag' | 'choose'): void => {
    const { project, projectDocumentEpoch } = useStore.getState();
    returnFocus.current =
      mode === 'choose' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setTransfer({ node, name, mode, owner: { project, projectDocumentEpoch } });
    setMessage('');
  };
  const apply = (move: DesignHierarchyMove): void => {
    if (transfer === null) return;
    const result = useStore.getState().moveDesignNode(move, transfer.owner);
    if (result.kind === 'error') setMessage(result.message);
    else {
      setMessage(
        result.changed
          ? `Moved ${transfer.name}. Manufacturing order is unchanged.`
          : 'The item is already in that position.',
      );
      setTransfer(null);
      returnFocus.current?.focus();
    }
  };
  const drop = (event: DragEvent, move: Omit<DesignHierarchyMove, 'node'>): void => {
    if (transfer?.mode !== 'drag') return;
    event.preventDefault();
    event.stopPropagation();
    apply({ ...move, node: transfer.node });
    setTransfer(null);
  };
  return {
    transfer,
    message,
    begin,
    apply,
    drop,
    cancel: (): void => {
      setTransfer(null);
      setMessage('Move cancelled.');
      returnFocus.current?.focus();
    },
    dragStart: (event: DragEvent, node: DesignNodeRef, name: string): void => {
      begin(node, name, 'drag');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-kerfdesk-design-node', `${node.kind}:${node.id}`);
    },
    dragEnd: (): void => setTransfer((current) => (current?.mode === 'drag' ? null : current)),
    dragOver: (event: DragEvent): void => {
      if (transfer?.mode !== 'drag') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
  };
}
export type DesignHierarchyTransferController = ReturnType<typeof useDesignHierarchyTransfer>;
