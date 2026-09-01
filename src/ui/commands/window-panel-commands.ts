import { enabled, type AppCommand, type AppCommandContext } from './command-types';

export function windowPanelCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const layers = {
    ...enabled(
      'window.toggle-layers-panel',
      'window',
      'Cuts / Layers Panel',
      'Show or hide the Cuts / Layers panel',
      ctx.toggleLayersPanel,
    ),
    active: ctx.layersPanelOpen,
  };
  const machine = {
    ...enabled(
      'window.toggle-machine-panel',
      'window',
      'Machine Controls Panel',
      'Show or hide the machine controls panel',
      ctx.toggleMachinePanel,
    ),
    active: ctx.machinePanelOpen,
  };
  const toggleSidePanels = enabled(
    'window.toggle-side-panels',
    'window',
    'Toggle Side Panels',
    'Show or hide both side panels',
    ctx.toggleSidePanels,
    'F12',
  );
  const resetLayout = enabled(
    'window.reset-layout',
    'window',
    'Reset Workspace Layout',
    'Restore both side panels to the standard workspace layout',
    ctx.resetWorkspaceLayout,
  );
  return [layers, machine, toggleSidePanels, resetLayout];
}
