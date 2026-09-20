import { selectControllerDriver } from '../controllers';
import { isEstimateTimeScale, type ControllerKind, type DeviceProfile } from '../devices';
import { laserPowerControlForDevice, type BuildRenderModelOptions } from '../gcode-view';

export type ProgramTimeCalibration = {
  readonly cutTimeScale: number;
  readonly travelTimeScale: number;
};

/** Calibration changes motion only; deterministic waits and transmission stay unscaled. */
export type ProgramTimingOptions = {
  readonly cutTimeScale?: number;
  readonly travelTimeScale?: number;
  /** Existing timeline callers may supply the two scales as one calibration. */
  readonly timeCalibration?: ProgramTimeCalibration;
  readonly machineKind?: 'laser' | 'cnc';
  readonly laserPowerControl?: BuildRenderModelOptions['laserPowerControl'];
  readonly coordinateRepresentation?: 'grbl';
  /** Omit for geometric simulation or non-serial/offline execution. */
  readonly baudRate?: number;
  readonly hostToolChangePauses?: boolean;
  readonly fanPower?: boolean;
};

export function validTimeScale(value: number | undefined): number {
  return isEstimateTimeScale(value) ? value : 1;
}

/** Uses the same serial default as connection setup; Ruida executes an uploaded binary job. */
export function deviceProgramTimingOptions(
  device: DeviceProfile,
  machineKind: 'laser' | 'cnc',
  controllerKind: ControllerKind = device.controllerKind ?? 'grbl-v1.1',
): ProgramTimingOptions {
  const baudRate = device.baudRate ?? selectControllerDriver(controllerKind).defaultBaudRate;
  const laserPowerControl =
    machineKind === 'laser' ? laserPowerControlForDevice(device) : undefined;
  return {
    cutTimeScale: validTimeScale(device.estimateCutTimeScale),
    travelTimeScale: validTimeScale(device.estimateTravelTimeScale),
    machineKind,
    hostToolChangePauses: machineKind === 'cnc',
    fanPower: laserPowerControl === 'fan',
    ...(machineKind === 'cnc' && isGrblController(controllerKind)
      ? { coordinateRepresentation: 'grbl' as const }
      : {}),
    ...(laserPowerControl === undefined ? {} : { laserPowerControl }),
    ...(controllerKind === 'ruida' ? {} : { baudRate }),
  };
}

function isGrblController(controllerKind: ControllerKind): boolean {
  return (
    controllerKind === 'grbl-v1.1' || controllerKind === 'grblhal' || controllerKind === 'fluidnc'
  );
}
