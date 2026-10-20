// The Registration jig and Place Board pages (ADR-641, ADR-636) are full
// pages: while one is open it takes the whole window except the docked machine
// panel. The menu bar, the toolbars, the tool strip, the Artwork panel and the
// status bar are not shown, and the main canvas is not mounted.
import { useUiStore, type UiState } from './ui-store';

type ToolPageFlags = Pick<UiState, 'registrationPanelOpen' | 'boardCapturePanelOpen'>;

/** Whether the jig page or the Place Board page has replaced the workspace. */
export function toolPageOpen(state: ToolPageFlags = useUiStore.getState()): boolean {
  return state.registrationPanelOpen || state.boardCapturePanelOpen;
}

export function useToolPageOpen(): boolean {
  return useUiStore(toolPageOpen);
}
