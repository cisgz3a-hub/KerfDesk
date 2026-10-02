import type { DeviceProfile } from '../../core/devices';
import type { Project } from '../../core/scene';
import type { PrepareOutputOptions } from '../../io/gcode';
import type { NativeBedEvidence } from '../state/native-bed-frame';

/** Only a current connection may supply the execution power range (ADR-567). */
export type LaserPowerScaleSource = NativeBedEvidence & { readonly connected?: boolean };

export type LaserPowerScale = {
  readonly maxPowerS: number;
  readonly source: 'controller' | 'profile';
  readonly controllerSessionEpoch?: number;
};

function isGrblFamily(kind: DeviceProfile['controllerKind']): boolean {
  return kind === undefined || kind === 'grbl-v1.1' || kind === 'grblhal' || kind === 'fluidnc';
}

function currentPowerObservation(source: LaserPowerScaleSource): boolean {
  const stamp = source.controllerSettingsObservation;
  return (
    source.connected === true &&
    source.activeControllerKind !== undefined &&
    isGrblFamily(source.activeControllerKind) &&
    source.controllerSessionEpoch !== undefined &&
    Number.isSafeInteger(source.controllerSessionEpoch) &&
    stamp?.sessionEpoch === source.controllerSessionEpoch &&
    Number.isFinite(stamp.observedAt)
  );
}

export function observedLaserMaxPowerS(source: LaserPowerScaleSource): number | undefined {
  const value = source.controllerSettings?.maxPowerS;
  return currentPowerObservation(source) &&
    value !== undefined &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : undefined;
}

export function laserPowerScaleBinding(
  project: Project,
  source: LaserPowerScaleSource,
): { readonly laserPowerScale?: LaserPowerScale } {
  return project.machine?.kind === 'cnc'
    ? {}
    : { laserPowerScale: resolveLaserPowerScale(project.device, source) };
}

export function bindPreparedLaserPowerScale<T extends { readonly ok: boolean }>(
  prepared: T,
  scale: LaserPowerScale | undefined,
): T & { readonly laserPowerScale?: LaserPowerScale } {
  return !prepared.ok || scale === undefined ? prepared : { ...prepared, laserPowerScale: scale };
}

export function preparedLaserPowerScaleWarnings(
  project: Project,
  source: LaserPowerScaleSource,
  scale: LaserPowerScale | undefined,
): ReadonlyArray<string> {
  return scale === undefined
    ? frozenLaserPowerScaleWarnings(project, source)
    : laserPowerScaleWarnings(project, source);
}

export function resolveLaserPowerScale(
  device: DeviceProfile,
  source: LaserPowerScaleSource = {},
): LaserPowerScale {
  const observed = isGrblFamily(device.controllerKind) ? observedLaserMaxPowerS(source) : undefined;
  return observed === undefined || source.controllerSessionEpoch === undefined
    ? { maxPowerS: device.maxPowerS, source: 'profile' }
    : {
        maxPowerS: observed,
        source: 'controller',
        controllerSessionEpoch: source.controllerSessionEpoch,
      };
}

export function laserPowerPreparationOptions(
  project: Project,
  source: LaserPowerScaleSource = {},
): Pick<PrepareOutputOptions, 'laserMaxPowerS'> {
  return project.machine?.kind === 'cnc'
    ? {}
    : { laserMaxPowerS: resolveLaserPowerScale(project.device, source).maxPowerS };
}

export function laserPowerScaleWarnings(
  project: Project,
  source: LaserPowerScaleSource = {},
): ReadonlyArray<string> {
  if (project.machine?.kind === 'cnc') return [];
  const scale = resolveLaserPowerScale(project.device, source);
  if (scale.source === 'profile') {
    return [
      `Output power uses saved profile S${scale.maxPowerS}; no current controller power range was verified. 100% means S${scale.maxPowerS} under that profile assumption, not measured optical power.`,
    ];
  }
  return scale.maxPowerS === project.device.maxPowerS
    ? []
    : [
        `Output power uses the connected controller's $30=${scale.maxPowerS}: 100% means S${scale.maxPowerS}. The saved profile remains S${project.device.maxPowerS}.`,
      ];
}

export function laserPowerScaleStillCurrent(
  project: Project,
  preparedScale: LaserPowerScale | undefined,
  source: LaserPowerScaleSource,
): boolean {
  // Frozen archives and older callers own their original exact bytes. Fresh
  // laser preparations always carry this binding; CNC has no laser binding.
  if (preparedScale === undefined) return true;
  const current = resolveLaserPowerScale(project.device, source);
  return (
    preparedScale.maxPowerS === current.maxPowerS &&
    preparedScale.source === current.source &&
    preparedScale.controllerSessionEpoch === current.controllerSessionEpoch
  );
}

/** Immutable recovery output is never silently rescaled for a new $30. */
export function frozenLaserPowerScaleWarnings(
  project: Project,
  source: LaserPowerScaleSource,
): ReadonlyArray<string> {
  if (project.machine?.kind === 'cnc' || !isGrblFamily(project.device.controllerKind)) return [];
  const observed = observedLaserMaxPowerS(source);
  return observed === undefined || observed === project.device.maxPowerS
    ? []
    : [
        `This saved job retains its original S${project.device.maxPowerS} scale; the current controller reports $30=${observed}. Its exact saved bytes are unchanged, so the original job's power percentages do not describe the current controller's full range.`,
      ];
}
