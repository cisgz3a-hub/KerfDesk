import { selectControllerDriver, type ControllerDriver } from '../../../core/controllers';
import type { ControllerCommandSet, ControllerKind } from '../../../core/devices/device-profile';

export type MachineSetupWritePolicy =
  | 'guarded-single-setting'
  | 'read-only'
  | 'external-config'
  | 'file-only';

export type MachineSetupControllerGuide = {
  readonly kind: ControllerKind;
  readonly label: string;
  readonly transportLabel: string;
  readonly defaultBaudRate: number;
  readonly identityCommands: ReadonlyArray<string>;
  readonly settingsCommands: ReadonlyArray<string>;
  readonly configurationSurface: string;
  readonly writePolicy: MachineSetupWritePolicy;
  readonly writeExplanation: string;
  readonly homeCommand: string | null;
  readonly statusCommand: string | null;
  readonly streamingExplanation: string;
  readonly cncSupported: boolean;
};

/**
 * Controller-specific setup contract shown to beginners. Commands are kept in
 * one pure table and checked against the actual driver so setup copy cannot
 * silently drift away from connection, homing, status, or streaming behavior.
 */
export function machineSetupControllerGuide(
  kind: ControllerKind,
  commandSet?: ControllerCommandSet,
): MachineSetupControllerGuide {
  const driver = selectControllerDriver(kind, commandSet);
  const common = commonControllerGuide(kind, driver);

  if (driver.commandSet === 'creality-falcon-a1-pro') {
    return {
      ...common,
      identityCommands: [],
      settingsCommands: [],
      configurationSurface: 'Creality Falcon A1 Pro vendor configuration',
      writePolicy: 'external-config',
      writeExplanation:
        'Creality disables settings fetch and native $J jogging in its A1 Pro device file. Use the vendor workflow for firmware settings. KerfDesk uses finite, tool-off G1 jogs and frames, and homes X then Y; native jog cancellation is unavailable.',
    };
  }

  switch (kind) {
    case 'grbl-v1.1':
      return {
        ...common,
        identityCommands: ['$I'],
        settingsCommands: ['$$'],
        configurationSurface: 'GRBL numeric $ settings',
        writePolicy: 'guarded-single-setting',
        writeExplanation:
          'Read and export a backup first. KerfDesk can then confirm and verify one common setting at a time.',
      };
    case 'grblhal':
      return {
        ...common,
        identityCommands: ['$I'],
        settingsCommands: ['$$'],
        configurationSurface: 'grblHAL numeric $ settings and board-specific plugins',
        writePolicy: 'guarded-single-setting',
        writeExplanation:
          'Read and export a backup first. KerfDesk writes only the common settings it can re-read and verify.',
      };
    case 'fluidnc':
      return {
        ...common,
        identityCommands: ['$I'],
        settingsCommands: ['$CD', '$$'],
        configurationSurface: 'FluidNC config.yaml / WebUI',
        writePolicy: 'external-config',
        writeExplanation:
          'Treat the in-app dump as reference only. Change machine geometry, pins, motors, and limits in FluidNC YAML or WebUI.',
      };
    case 'marlin':
      return {
        ...common,
        identityCommands: ['M115'],
        settingsCommands: ['M503', 'M114', 'M400'],
        configurationSurface: 'Marlin Configuration.h / EEPROM tools',
        writePolicy: 'read-only',
        writeExplanation:
          'KerfDesk does not write Marlin EEPROM. Review M503 output, then use the controller vendor workflow to change and save settings.',
      };
    case 'smoothieware':
      return {
        ...common,
        identityCommands: ['version'],
        settingsCommands: ['M114'],
        configurationSurface: 'Smoothieware SD-card config file',
        writePolicy: 'external-config',
        writeExplanation:
          'Match laser_module_maximum_s_value to the profile and set laser_module_minimum_power to 0 for dark S0 feed moves. Edit the config through the Smoothieware USB/SD workflow, then reset and reconnect.',
      };
    case 'ruida':
      return {
        ...common,
        identityCommands: [],
        settingsCommands: [],
        configurationSurface: 'Ruida controller panel and vendor software',
        writePolicy: 'file-only',
        writeExplanation:
          'This build exports files for Ruida. Connection, jogging, reads, and firmware writes are unavailable.',
      };
  }
}

function commonControllerGuide(kind: ControllerKind, driver: ControllerDriver) {
  return {
    kind,
    label: driver.label,
    transportLabel: driver.capabilities.transport === 'serial' ? 'USB serial' : 'File export',
    defaultBaudRate: driver.defaultBaudRate,
    homeCommand: driver.commands.home,
    statusCommand: driver.realtime.statusQuery ?? driver.commands.queuedStatusQuery,
    streamingExplanation:
      kind === 'marlin' || kind === 'smoothieware'
        ? 'One line is sent only after the previous line is acknowledged.'
        : 'Commands use the controller receive window for buffered streaming.',
    cncSupported: driver.capabilities.cncJobs,
  } as const;
}

export function machineSetupControllerGuides(): ReadonlyArray<MachineSetupControllerGuide> {
  return (['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware', 'ruida'] as const).map(
    (kind) => machineSetupControllerGuide(kind),
  );
}
