import { type LaserController } from '../controllers/ControllerInterface';

export type MachineCommandGatewayController = Pick<LaserController, 'sendCommand' | 'safetyOff'>;
export type MachineCommandGatewayAxis = 'X' | 'Y';

export type LaserOffResult = Awaited<ReturnType<LaserController['safetyOff']>>;

/**
 * T2-10 pass 1: a single command choke point that preserves existing behavior.
 * Policy checks land after call sites migrate through this wrapper.
 */
export class MachineCommandGateway {
  constructor(private readonly controller: MachineCommandGatewayController) {}

  sendInternalCommand(command: string): void {
    this.controller.sendCommand(command, 'internal');
  }

  unlock(): void {
    this.sendInternalCommand('$X');
  }

  home(): void {
    this.sendInternalCommand('$H');
  }

  setOriginAtCurrentPosition(): void {
    this.sendInternalCommand('G10 L20 P1 X0 Y0');
  }

  resetWcsToMachineOrigin(): void {
    this.sendInternalCommand('G10 L2 P1 X0 Y0 Z0');
  }

  jog(axis: MachineCommandGatewayAxis, distanceMm: number, feedRateMmPerMinute: number): void {
    this.sendInternalCommand(`$J=G91 G21 ${axis}${distanceMm} F${feedRateMmPerMinute}`);
  }

  laserOff(): Promise<LaserOffResult> {
    return this.controller.safetyOff();
  }
}
