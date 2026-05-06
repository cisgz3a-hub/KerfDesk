import {
  createEditorStore,
  editorInitialState,
} from '../src/ui/stores/editorStore';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function idsOf(ids: ReadonlySet<string>): string {
  return [...ids].sort().join(',');
}

{
  const store = createEditorStore();
  const state = store.getState();
  assert(state.activeTool === 'select', 'active tool starts as select');
  assert(state.selectedIds.size === 0, 'selection starts empty');
}

{
  const store = createEditorStore();
  store.getState().setActiveTool('rect');
  assert(store.getState().activeTool === 'rect', 'active tool updates');
  store.getState().setActiveTool('text');
  assert(store.getState().activeTool === 'text', 'active tool updates again');
}

{
  const store = createEditorStore();
  const ids = new Set(['b', 'a']);
  store.getState().setSelectedIds(ids);
  assert(idsOf(store.getState().selectedIds) === 'a,b', 'selection set updates');
  assert(store.getState().selectedIds !== ids, 'selection setter snapshots caller-owned sets');

  ids.add('c');
  assert(idsOf(store.getState().selectedIds) === 'a,b', 'selection snapshot is not mutated by caller');
}

{
  const store = createEditorStore();
  store.getState().selectOnly('obj-1');
  assert(idsOf(store.getState().selectedIds) === 'obj-1', 'selectOnly selects one object');
  store.getState().clearSelection();
  assert(store.getState().selectedIds.size === 0, 'clearSelection empties selection');
}

{
  const store = createEditorStore();
  store.getState().setActiveTool('ellipse');
  store.getState().setSelectedIds(new Set(['x']));
  store.getState().resetEditor();
  assert(store.getState().activeTool === editorInitialState.activeTool, 'reset restores active tool');
  assert(store.getState().selectedIds.size === 0, 'reset clears selection');
  assert(store.getState().selectedIds === editorInitialState.selectedIds, 'reset restores initial selection object');
}
