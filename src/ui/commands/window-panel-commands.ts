import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

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
  const machine = ctx.jobActive
    ? {
        ...disabled(
          'window.toggle-machine-panel',
          'window',
          'Machine Controls Panel',
          'Machine controls stay visible while a job is active so Stop remains reachable',
          ctx.toggleMachinePanel,
        ),
        active: true,
      }
    : {
        ...enabled(
          'window.toggle-machine-panel',
          'window',
          'Machine Controls Panel',
          'Show or hide the machine controls panel',
          ctx.toggleMachinePanel,
        ),
        active: ctx.machinePanelOpen,
      };
  return [layers, machine];
}
