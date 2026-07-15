import { describe, expect, it } from 'vitest';
import { selectControllerDriver } from '../../../core/controllers';
import {
  machineSetupControllerGuide,
  machineSetupControllerGuides,
} from './machine-setup-controller-guide';

describe('machineSetupControllerGuide', () => {
  it('covers every supported controller and matches driver transport/commands', () => {
    const guides = machineSetupControllerGuides();
    expect(guides.map((guide) => guide.kind)).toEqual([
      'grbl-v1.1',
      'grblhal',
      'fluidnc',
      'marlin',
      'smoothieware',
      'ruida',
    ]);
    for (const guide of guides) {
      const driver = selectControllerDriver(guide.kind);
      expect(guide.defaultBaudRate).toBe(driver.defaultBaudRate);
      expect(guide.homeCommand).toBe(driver.commands.home);
      expect(guide.cncSupported).toBe(driver.capabilities.cncJobs);
    }
  });

  it('never offers numeric firmware writes for FluidNC, Marlin, Smoothie, or Ruida', () => {
    for (const kind of ['fluidnc', 'marlin', 'smoothieware', 'ruida'] as const) {
      expect(machineSetupControllerGuide(kind).writePolicy).not.toBe('guarded-single-setting');
    }
  });

  it('documents the controller-specific read commands', () => {
    expect(machineSetupControllerGuide('grbl-v1.1').settingsCommands).toEqual(['$$']);
    expect(machineSetupControllerGuide('fluidnc').settingsCommands).toEqual(['$CD', '$$']);
    expect(machineSetupControllerGuide('marlin').settingsCommands).toEqual([
      'M503',
      'M114',
      'M400',
    ]);
    expect(machineSetupControllerGuide('smoothieware').identityCommands).toEqual(['version']);
    expect(machineSetupControllerGuide('ruida').settingsCommands).toEqual([]);
  });
});
