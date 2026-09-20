import type { UiState } from '../state/ui-store';
import { useWorkspaceLayoutStore } from '../state/workspace-layout-store';

type PanelState = Pick<UiState, 'railPanelVisibility' | 'setRailPanelVisible'>;

export function toggleWorkspaceSidePanels(ui: PanelState): void {
  const show = !(ui.railPanelVisibility.layers || ui.railPanelVisibility.machine);
  ui.setRailPanelVisible('layers', show);
  ui.setRailPanelVisible('machine', show);
}

export function resetWorkspaceLayout(ui: PanelState): void {
  useWorkspaceLayoutStore.getState().reset();
  ui.setRailPanelVisible('layers', true);
  ui.setRailPanelVisible('machine', true);
}
