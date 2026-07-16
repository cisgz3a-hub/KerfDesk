import { describe, expect, it } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG } from '../../core/scene';
import {
  machineSettingsContextForProfile,
  machineSettingsContextNotice,
  presentGrblSetting,
  type MachineSettingsPresentationContext,
} from './machine-settings-presentation';

const OUTPUT_ROWS = settingsMapToRows(
  new Map([
    [30, '1000'],
    [31, '0'],
    [32, '1'],
  ]),
);

describe('machine settings presentation', () => {
  it('shows only laser terminology for a Laser-only profile', () => {
    const text = presentedText({
      machineKinds: ['laser'],
      activeMachineKind: 'laser',
    });

    expect(text).toContain('Laser output');
    expect(text).toContain('Laser S maximum');
    expect(text).not.toMatch(/spindle|CNC|RPM/i);
  });

  it('shows only CNC terminology for a CNC-only profile', () => {
    const text = presentedText({
      machineKinds: ['cnc'],
      activeMachineKind: 'cnc',
    });

    expect(text).toContain('CNC spindle output');
    expect(text).toContain('Maximum spindle speed');
    expect(text).not.toMatch(/laser/i);
  });

  it('shows both contracts and the active mode for a hybrid profile', () => {
    const context: MachineSettingsPresentationContext = {
      machineKinds: ['laser', 'cnc'],
      activeMachineKind: 'laser',
    };
    const text = presentedText(context);

    expect(text).toContain('Laser + CNC output (Laser active)');
    expect(text).toContain('Laser S maximum / spindle maximum');
    expect(machineSettingsContextNotice(context)).toContain(
      'switching workspace mode does not write',
    );
  });

  it('uses combined labels when an older profile has no saved capability', () => {
    const context = machineSettingsContextForProfile(
      DEFAULT_DEVICE_PROFILE,
      DEFAULT_CNC_MACHINE_CONFIG,
    );
    const text = presentedText(context);

    expect(text).toContain('Laser + CNC output (capability not set)');
    expect(text).toContain('Laser S maximum / spindle maximum');
    expect(machineSettingsContextNotice(context)).toContain('no saved Laser/CNC capability');
  });

  it('derives explicit capabilities and active mode independently', () => {
    const context = machineSettingsContextForProfile(
      {
        ...DEFAULT_DEVICE_PROFILE,
        capabilities: ['grbl', 'laser-output', 'cnc-output'],
      },
      LASER_MACHINE_CONFIG,
    );

    expect(context).toEqual({
      machineKinds: ['laser', 'cnc'],
      activeMachineKind: 'laser',
    });
  });
});

function presentedText(context: MachineSettingsPresentationContext): string {
  return OUTPUT_ROWS.flatMap((row) => {
    const presentation = presentGrblSetting(row, context);
    return [
      presentation.categoryLabel,
      presentation.name,
      presentation.unit ?? '',
      presentation.description,
    ];
  }).join(' ');
}
