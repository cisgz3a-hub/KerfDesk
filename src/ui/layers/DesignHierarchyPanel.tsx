import { useState } from 'react';
import { Button } from '../kit';
import { useStore } from '../state';
import { currentHierarchyFocus, useDesignHierarchyStore } from '../state/design-hierarchy-store';
import { designTreeRows } from './design-tree-rows';
import { DesignTree } from './DesignTree';

export function DesignHierarchyPanel(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const scene = useStore((state) => state.project.scene);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  useDesignHierarchyStore((state) => state.focusId);
  const focus = currentHierarchyFocus(scene, epoch);
  const group = scene.groups?.find((candidate) => candidate.id === focus);
  if (scene.objects.length === 0) return null;
  return (
    <details
      aria-label="Design hierarchy"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="lf-artwork-disclosure"
    >
      <summary title="Show named artwork and nested groups so you can inspect the design hierarchy and enter a group for editing.">
        Design objects{group === undefined ? '' : ` · ${group.name}`}
      </summary>
      {open ? (
        <div className="lf-artwork-disclosure__body">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <strong>{group?.name ?? 'All artwork'}</strong>
            {group === undefined ? null : (
              <>
                <Button
                  title="Return to the parent design group."
                  onClick={() => useStore.getState().focusDesignGroup(group.parentId ?? null)}
                >
                  Parent
                </Button>
                <Button
                  title="Leave group editing and show all artwork."
                  onClick={() => useStore.getState().focusDesignGroup(null)}
                >
                  Exit group
                </Button>
              </>
            )}
          </div>
          <p className="lf-artwork-hint">
            Enter a group to edit its children. Names and group structure guide design selection.
          </p>
          <DesignTree rows={designTreeRows(scene, focus)} scene={scene} />
        </div>
      ) : null}
    </details>
  );
}
