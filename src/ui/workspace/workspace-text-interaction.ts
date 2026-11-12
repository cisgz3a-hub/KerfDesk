import { useMemo } from 'react';
import { type Project, type TextObject } from '../../core/scene';
import { workspaceHitTest } from './workspace-hit-test';
import { useStore } from '../state';
import { isModalOpen, useUiStore } from '../state/ui-store';
import {
  canvasTextSessionIsCurrent,
  useCanvasTextStore,
  type CanvasTextSession,
} from '../text/canvas-text-store';
import { canvasMouseToScene, pxToMmForCanvas, type ViewState } from './view-transform';
import type { OwnedPointerHandlers } from './workspace-pointer-owner';
import { finishDrawToolOnLeftDoubleClick } from './finish-draw-tool';
import { finishPen } from './pen-tool';
import { openEditorForSelectedObject } from './open-selected-object-editor';

type TextPointerArgs = {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly previewMode: boolean;
  readonly viewState: ViewState;
  readonly handlers: OwnedPointerHandlers;
};

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export function canvasTextSelection(
  textEditing: boolean,
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
} {
  return {
    selectedObjectId: textEditing ? null : selectedObjectId,
    additionalSelectedIds: textEditing ? EMPTY_SELECTION : additionalSelectedIds,
  };
}

// Text editing owns the primary click without starting a drag/history snapshot.
// The editor saves outside clicks first; a pending save retains that ownership.
export function workspaceTextPointerHandlers(args: TextPointerArgs): OwnedPointerHandlers {
  return {
    ...args.handlers,
    onPointerDown: (event) => {
      const ui = useUiStore.getState();
      if (event.defaultPrevented || isModalOpen(ui)) return;
      if (useCanvasTextStore.getState().session !== null) return;
      if (textToolOwnsCanvas(ui, args.previewMode) && event.button === 0) {
        const position = canvasMouseToScene(
          event,
          args.canvasRef.current,
          args.project,
          args.viewState,
        );
        if (position === null) return;
        event.preventDefault();
        ui.closeWorkspaceContextBar();
        const hit = workspaceHitTest(
          args.project.scene,
          position,
          pxToMmForCanvas(args.canvasRef.current, args.project, args.viewState),
        );
        const object = args.project.scene.objects.find((candidate) => candidate.id === hit);
        if (object?.kind === 'text') useCanvasTextStore.getState().beginEdit(object);
        else useCanvasTextStore.getState().beginAdd(position);
        return;
      }
      args.handlers.onPointerDown(event);
    },
    onPointerMove: (event) => {
      if (useCanvasTextStore.getState().session !== null) return;
      args.handlers.onPointerMove(event);
      const ui = useUiStore.getState();
      const canvas = args.canvasRef.current;
      if (canvas !== null && textToolOwnsCanvas(ui, args.previewMode)) {
        canvas.style.cursor = 'text';
      }
    },
  };
}

// Canvas numbering (Run order) owns a click on the canvas whatever the tool,
// as it does for the drawing tools: a text session begun mid-numbering would
// be refused on save by the numbering edit guard, losing what was typed.
function textToolOwnsCanvas(
  ui: ReturnType<typeof useUiStore.getState>,
  previewMode: boolean,
): boolean {
  return (
    ui.toolMode.kind === 'text' &&
    !previewMode &&
    !ui.spaceDown &&
    ui.artworkNumbering.kind !== 'active'
  );
}

export function useCanvasTextDisplayProject(
  project: Project,
  previewMode: boolean,
): {
  readonly displayProject: Project;
  readonly textEditing: boolean;
} {
  const session = useCanvasTextStore((state) => state.session);
  const draft = useCanvasTextStore((state) => state.draft);
  const documentEpoch = useStore((state) => state.projectDocumentEpoch);
  const displayProject = useMemo(
    () =>
      previewMode ? project : projectForCanvasTextDraft(project, session, draft, documentEpoch),
    [previewMode, project, session, draft, documentEpoch],
  );
  return { displayProject, textEditing: session !== null && canvasTextSessionIsCurrent(session) };
}

// Pen/shape completion retains priority over object editing. Only the primary
// double-click in the selection or text tool may enter the object editor.
export function handleCanvasDoubleClick(event: React.MouseEvent<HTMLCanvasElement>): void {
  const app = useStore.getState();
  const ui = useUiStore.getState();
  if (event.defaultPrevented || event.button !== 0 || app.previewMode || isModalOpen(ui)) return;
  if (useCanvasTextStore.getState().session !== null) return;
  if (finishDrawToolOnLeftDoubleClick(event)) return;
  if (ui.toolMode.kind === 'draw' && ui.toolMode.shape === 'polyline') {
    if (ui.penDraft !== null) {
      finishPen({ closed: false, project: app.project, drawShape: app.drawShape });
    }
    return;
  }
  openCanvasObjectEditor(event, app, ui);
}

function openCanvasObjectEditor(
  event: React.MouseEvent<HTMLCanvasElement>,
  app: ReturnType<typeof useStore.getState>,
  ui: ReturnType<typeof useUiStore.getState>,
): void {
  if (ui.toolMode.kind !== 'select' && ui.toolMode.kind !== 'text') return;
  // Numbering's clicks name a run; an editor opened now could not save.
  if (ui.artworkNumbering.kind === 'active') return;
  const point = canvasMouseToScene(event, event.currentTarget, app.project, ui);
  const pxToMm = pxToMmForCanvas(event.currentTarget, app.project, ui);
  const id = point === null ? null : workspaceHitTest(app.project.scene, point, pxToMm);
  if (id === null) return;
  app.selectObject(id);
  openEditorForSelectedObject(id);
}

// Rendering a draft must not change the saved project, output, or undo history.
// An edit replaces its original at the same paint order, including empty drafts.
export function projectForCanvasTextDraft(
  project: Project,
  session: CanvasTextSession | null,
  draft: TextObject | null,
  documentEpoch: number,
): Project {
  if (session === null || session.documentEpoch !== documentEpoch) return project;
  const originalId = session.original?.id;
  if (originalId === undefined) {
    if (draft === null) return project;
    return { ...project, scene: { ...project.scene, objects: [...project.scene.objects, draft] } };
  }
  if (project.scene.objects.find((object) => object.id === originalId) !== session.original) {
    return project;
  }
  const rendered = preserveDraftPathOperations(draft, session.original);
  const objects = project.scene.objects.flatMap((object) =>
    object.id === originalId ? (rendered === null ? [] : [rendered]) : [object],
  );
  return { ...project, scene: { ...project.scene, objects } };
}

function preserveDraftPathOperations(
  draft: TextObject | null,
  original: TextObject | null,
): TextObject | null {
  if (draft === null || original === null) return draft;
  return {
    ...draft,
    paths: draft.paths.map((path, index) => {
      const operationIds = original.paths[index]?.operationIds;
      return operationIds === undefined ? path : { ...path, operationIds };
    }),
  };
}
