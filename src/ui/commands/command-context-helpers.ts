import type { CommandDialogs } from './app-command-context-types';
import type { AppCommandContext } from './command-types';

export function railPanelCommandContext(
  dialogs: CommandDialogs,
  jobActive: boolean,
): Pick<
  AppCommandContext,
  'jobActive' | 'layersPanelOpen' | 'toggleLayersPanel' | 'machinePanelOpen' | 'toggleMachinePanel'
> {
  return {
    jobActive,
    layersPanelOpen: dialogs.layersPanelOpen,
    toggleLayersPanel: dialogs.toggleLayersPanel,
    machinePanelOpen: dialogs.machinePanelOpen,
    toggleMachinePanel: dialogs.toggleMachinePanel,
  };
}
