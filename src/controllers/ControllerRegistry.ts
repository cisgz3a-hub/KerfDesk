import { type LaserController } from './ControllerInterface';
import { GrblController } from './grbl/GrblController';

export type ControllerId = 'grbl';
export type ControllerFactory = () => LaserController;

const registry = new Map<ControllerId, ControllerFactory>();

export function registerController(id: ControllerId, factory: ControllerFactory): void {
  registry.set(id, factory);
}

export function createController(id: ControllerId): LaserController {
  const factory = registry.get(id);
  if (!factory) {
    throw new Error(`Controller not registered: ${id}`);
  }
  return factory();
}

export function listRegisteredControllers(): ControllerId[] {
  return [...registry.keys()];
}

// Built-in controllers
registerController('grbl', () => new GrblController());
