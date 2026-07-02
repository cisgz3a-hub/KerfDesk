// laser-command-family — the machine-connection commands (Connect /
// Disconnect / Home). Split from command-families.ts when it crossed the
// 400-line cap. The family KEY stays 'laser' for both machine kinds
// (ADR-100 §7); only user-visible copy follows the machine noun.

import { machineNoun } from '../machine/machine-labels';
import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function laserCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const noun = machineNoun(ctx.machineKind);
  const connect =
    ctx.serialSupported && !ctx.connected
      ? enabled(
          'laser.connect',
          'laser',
          'Connect',
          `Connect to ${noun} controller`,
          ctx.connectLaser,
        )
      : disabled('laser.connect', 'laser', 'Connect', connectDisabledReason(ctx), ctx.connectLaser);
  const disconnect =
    ctx.connected && !ctx.machineBusy
      ? enabled(
          'laser.disconnect',
          'laser',
          'Disconnect',
          `Disconnect from ${noun} controller`,
          ctx.disconnectLaser,
        )
      : disabled(
          'laser.disconnect',
          'laser',
          'Disconnect',
          disconnectDisabledReason(ctx),
          ctx.disconnectLaser,
        );
  const home =
    ctx.connected && ctx.homingEnabled && !ctx.machineBusy
      ? enabled('laser.home', 'laser', 'Home', 'Send homing command', ctx.homeLaser)
      : disabled('laser.home', 'laser', 'Home', homeDisabledReason(ctx), ctx.homeLaser);
  return [connect, disconnect, home];
}

function connectDisabledReason(ctx: AppCommandContext): string {
  const machine = capitalizedMachineNoun(ctx);
  if (!ctx.serialSupported) return 'WebSerial is not supported in this browser.';
  if (ctx.connected) return `${machine} is already connected.`;
  return `${machine} is not ready to connect.`;
}

function disconnectDisabledReason(ctx: AppCommandContext): string {
  if (!ctx.connected) return `${capitalizedMachineNoun(ctx)} is not connected.`;
  if (ctx.machineBusy) return 'Machine is busy. Use the machine panel controls first.';
  return 'Disconnect is unavailable.';
}

function homeDisabledReason(ctx: AppCommandContext): string {
  if (!ctx.connected) return `Connect to the ${machineNoun(ctx.machineKind)} first.`;
  if (!ctx.homingEnabled) return 'Homing is disabled in Device settings.';
  if (ctx.machineBusy) return 'Machine is busy. Wait or stop the active operation first.';
  return 'Home is unavailable.';
}

function capitalizedMachineNoun(ctx: AppCommandContext): string {
  const noun = machineNoun(ctx.machineKind);
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}
