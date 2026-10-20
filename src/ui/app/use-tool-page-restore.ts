// Leaving a full page (the Registration jig, ADR-641, or Place Board, ADR-636)
// returns to the workspace as it was when the page opened: the main canvas's
// zoom and pan, and the selection. The page edits the same project and
// selection as the main canvas, so the selection it leaves behind is the
// page's, not the operator's. Objects deleted on the page are not reselected,
// and a project opened meanwhile keeps its own view and selection.
import { useEffect } from 'react';
import { isRegistrationBox } from '../../core/scene';
import { useStore } from '../state';
import { toolPageOpen } from '../state/tool-page';
import { useUiStore } from '../state/ui-store';

type WorkspaceSnapshot = {
  readonly projectDocumentEpoch: number;
  readonly selectedIds: ReadonlyArray<string>;
  readonly zoomFactor: number;
  readonly panX: number;
  readonly panY: number;
};

export function useToolPageRestore(): void {
  useEffect(() => {
    let saved: WorkspaceSnapshot | null = null;
    return useUiStore.subscribe((state, previous) => {
      const open = toolPageOpen(state);
      const wasOpen = toolPageOpen(previous);
      if (open && !wasOpen) saved = snapshotWorkspace();
      if (!open && wasOpen && saved !== null) {
        restoreWorkspace(saved);
        saved = null;
      }
    });
  }, []);
}

function snapshotWorkspace(): WorkspaceSnapshot {
  const app = useStore.getState();
  const ui = useUiStore.getState();
  return {
    projectDocumentEpoch: app.projectDocumentEpoch,
    selectedIds: [
      ...(app.selectedObjectId === null ? [] : [app.selectedObjectId]),
      ...app.additionalSelectedIds,
    ],
    zoomFactor: ui.zoomFactor,
    panX: ui.panX,
    panY: ui.panY,
  };
}

function restoreWorkspace(saved: WorkspaceSnapshot): void {
  const app = useStore.getState();
  if (app.projectDocumentEpoch !== saved.projectDocumentEpoch) return;
  useUiStore.setState({ zoomFactor: saved.zoomFactor, panX: saved.panX, panY: saved.panY });
  // Outlines stay locked on the main canvas, so they are never reselected.
  const ids = saved.selectedIds.filter((id) => {
    const object = app.project.scene.objects.find((candidate) => candidate.id === id);
    return object !== undefined && !isRegistrationBox(object);
  });
  useStore.setState({
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
  });
}
