import { useUiStore } from './ui-store';

export function useMachineRailVisibility(): {
  readonly isExpanded: boolean;
  readonly toggle: () => void;
} {
  const requestedVisible = useUiStore((state) => state.railPanelVisibility.machine);
  const togglePanel = useUiStore((state) => state.toggleRailPanel);
  return {
    isExpanded: requestedVisible,
    toggle: () => togglePanel('machine'),
  };
}
