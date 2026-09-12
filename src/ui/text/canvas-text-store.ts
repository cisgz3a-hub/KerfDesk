import { create } from 'zustand';
import type { Project, TextObject, Vec2 } from '../../core/scene';
import { useStore } from '../state';
import type { TextDialogState } from '../state/ui-store';

export type CanvasTextSession = {
  readonly id: string;
  readonly state: TextDialogState;
  readonly original: TextObject | null;
  readonly position: Vec2;
  readonly documentEpoch: number;
  readonly variableData: Project['variables'];
};

type CanvasTextState = {
  readonly session: CanvasTextSession | null;
  readonly draft: TextObject | null;
  readonly beginAdd: (position: Vec2) => void;
  readonly beginEdit: (object: TextObject) => void;
  readonly setDraft: (session: CanvasTextSession, draft: TextObject | null) => void;
  readonly close: () => void;
};

/** A text draft never enters project history, autosave, or executable output. */
export const useCanvasTextStore = create<CanvasTextState>((set) => ({
  session: null,
  draft: null,
  beginAdd: (position) =>
    set({ session: createSession({ mode: 'add' }, null, position), draft: null }),
  beginEdit: (object) =>
    set({
      session: createSession({ ...object, mode: 'edit' }, object, object.transform),
      draft: object,
    }),
  setDraft: (session, draft) =>
    set((current) => (current.session === session ? { draft } : current)),
  close: () => set({ session: null, draft: null }),
}));

function createSession(
  state: TextDialogState,
  original: TextObject | null,
  position: Vec2,
): CanvasTextSession {
  return {
    id: crypto.randomUUID(),
    state,
    original,
    position: { x: position.x, y: position.y },
    documentEpoch: useStore.getState().projectDocumentEpoch,
    variableData: useStore.getState().project.variables,
  };
}

export function canvasTextSessionIsCurrent(session: CanvasTextSession): boolean {
  const current = useStore.getState();
  if (useCanvasTextStore.getState().session !== session) return false;
  if (current.projectDocumentEpoch !== session.documentEpoch || current.previewMode) return false;
  if (current.project.variables !== session.variableData) return false;
  return (
    session.original === null ||
    current.project.scene.objects.find((object) => object.id === session.original?.id) ===
      session.original
  );
}
