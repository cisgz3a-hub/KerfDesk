import type { UiState } from '../state/ui-store';

type PanelState = Pick<UiState, 'railPanelVisibility' | 'setRailPanelVisible'>;

export function toggleWorkspaceSidePanels(ui: PanelState): void {
  const show = !(ui.railPanelVisibility.layers || ui.railPanelVisibility.machine);
  ui.setRailPanelVisible('layers', show);
  ui.setRailPanelVisible('machine', show);
}

export function resetWorkspaceLayout(ui: PanelState): void {
  ui.setRailPanelVisible('layers', true);
  ui.setRailPanelVisible('machine', true);
}
