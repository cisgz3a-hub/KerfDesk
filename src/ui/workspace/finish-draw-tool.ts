import { useUiStore } from '../state/ui-store';

export function finishDrawToolOnLeftDoubleClick(e: {
  readonly button: number;
  readonly detail: number;
}): boolean {
  const ui = useUiStore.getState();
  if (ui.toolMode.kind !== 'draw') return false;
  if (ui.toolMode.shape === 'polyline') return false;
  if (e.button !== 0 || e.detail < 2) return false;
  ui.closeWorkspaceContextBar();
  ui.resetToolMode();
  return true;
}
