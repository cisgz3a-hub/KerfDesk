import { resolveMarlinDialect, type DeviceProfile } from '../../devices';

/**
 * The power commands a laser program switches its beam with: those of the
 * output strategy that wrote it (core/output/select-output-strategy.ts).
 * Resume transform 3 rebuilds the beam in them (ADR-364).
 */
export type LaserResumeDialect = 'grbl' | 'smoothieware' | 'marlin-inline' | 'marlin-fan';

/** The device fields that choose a program's output strategy. */
export type LaserResumeDevice = Pick<DeviceProfile, 'controllerKind' | 'gcodeDialect'>;

/** The dialect of a program emitted for `device`. Pass the profile the program
 * was emitted with, which for a saved recovery is the archived one. */
export function laserResumeDialectForDevice(device: LaserResumeDevice): LaserResumeDialect {
  if (device.controllerKind === 'smoothieware') return 'smoothieware';
  if (device.controllerKind !== 'marlin') return 'grbl';
  return resolveMarlinDialect(device).powerMode === 'fan' ? 'marlin-fan' : 'marlin-inline';
}
