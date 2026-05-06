import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { type ToolType } from '../components/ToolBar';

// T2-6 Phase 2: editor-shell state shared by canvas, toolbar, shortcuts, and panels.
export interface EditorState {
  activeTool: ToolType;
  selectedIds: ReadonlySet<string>;
}

export interface EditorActions {
  setActiveTool: (tool: ToolType) => void;
  setSelectedIds: (ids: ReadonlySet<string>) => void;
  selectOnly: (id: string) => void;
  clearSelection: () => void;
  resetEditor: () => void;
}

export type EditorStore = EditorState & EditorActions;

export const editorInitialState: EditorState = {
  activeTool: 'select',
  selectedIds: new Set(),
};

export function createEditorStore(): UseBoundStore<StoreApi<EditorStore>> {
  return create<EditorStore>((set) => ({
    ...editorInitialState,
    setActiveTool: (tool) => set({ activeTool: tool }),
    setSelectedIds: (ids) => set({ selectedIds: new Set(ids) }),
    selectOnly: (id) => set({ selectedIds: new Set([id]) }),
    clearSelection: () => set({ selectedIds: new Set() }),
    resetEditor: () => set(editorInitialState),
  }));
}

export const useEditorStore = createEditorStore();
