import { isActiveJob } from './laser-store-helpers';
import { useLaserStore } from './laser-store';
import { useUiStore } from './ui-store';

export function useMachineRailVisibility(): {
  readonly isExpanded: boolean;
  readonly isJobActive: boolean;
  readonly toggle: () => void;
} {
  const requestedVisible = useUiStore((state) => state.railPanelVisibility.machine);
  const togglePanel = useUiStore((state) => state.toggleRailPanel);
  const streamer = useLaserStore((state) => state.streamer);
  const isJobActive = isActiveJob(streamer);
  return {
    isExpanded: requestedVisible || isJobActive,
    isJobActive,
    toggle: () => togglePanel('machine'),
  };
}
