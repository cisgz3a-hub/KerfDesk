import type { ControllerLifecycleRefs } from './laser-interactive-command';

export function controllerCommandOwnsStartSettleDwell(refs: ControllerLifecycleRefs): boolean {
  return (
    refs.controllerCommand?.kind === 'start-arming' &&
    (refs.controllerCommand.statusOwnership === 'cnc-start-settle-dwell' ||
      refs.controllerCommand.statusOwnership === 'laser-start-override-dwell')
  );
}
