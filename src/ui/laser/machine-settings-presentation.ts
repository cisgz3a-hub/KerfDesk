import type { GrblSettingRow } from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import { explicitMachineKindsForProfile } from '../../core/devices/device-profile';
import { machineKindOf, type MachineConfig, type MachineKind } from '../../core/scene';

export type MachineSettingsPresentationContext = {
  readonly machineKinds: ReadonlyArray<MachineKind>;
  readonly activeMachineKind: MachineKind;
};

export type GrblSettingPresentation = {
  readonly name: string;
  readonly unit: string | null;
  readonly description: string;
  readonly categoryLabel: string;
};

type OutputSettingId = 30 | 31 | 32;
type OutputSettingPresentation = Omit<GrblSettingPresentation, 'categoryLabel'>;
type PresentationMode = 'laser' | 'cnc' | 'hybrid' | 'legacy';

const CATEGORY_LABELS: Readonly<Record<GrblSettingRow['category'], string>> = {
  laser: 'Laser + CNC output',
  motion: 'Motion',
  homing: 'Homing',
  limits: 'Limits',
  reporting: 'Reporting',
  system: 'System',
  unknown: 'Unknown',
};

const LASER_OUTPUT_SETTINGS: Readonly<Record<OutputSettingId, OutputSettingPresentation>> = {
  30: {
    name: 'Laser S maximum',
    unit: 'S value',
    description: 'Highest S/PWM value treated as 100% laser power.',
  },
  31: {
    name: 'Laser S minimum',
    unit: 'S value',
    description: 'Lowest nonzero S/PWM output; S0 still turns the laser output off.',
  },
  32: {
    name: 'Laser mode',
    unit: '0/1',
    description: '1 enables motion-linked power updates; KerfDesk laser jobs expect 1.',
  },
};

const CNC_OUTPUT_SETTINGS: Readonly<Record<OutputSettingId, OutputSettingPresentation>> = {
  30: {
    name: 'Maximum spindle speed',
    unit: 'RPM',
    description: 'Highest commanded spindle speed and the full-scale PWM point.',
  },
  31: {
    name: 'Minimum spindle speed',
    unit: 'RPM',
    description: 'Lowest nonzero spindle command used by the controller PWM mapping.',
  },
  32: {
    name: 'Spindle output mode',
    unit: '0/1',
    description: '0 keeps the controller behavior expected by KerfDesk CNC jobs.',
  },
};

const LEGACY_OUTPUT_SETTINGS: Readonly<Record<OutputSettingId, OutputSettingPresentation>> = {
  30: {
    name: 'Laser S maximum / spindle maximum',
    unit: 'S / RPM',
    description:
      'Shared full-scale PWM setting; save machine capability to make its meaning specific.',
  },
  31: {
    name: 'Laser S minimum / spindle minimum',
    unit: 'S / RPM',
    description:
      'Shared minimum nonzero PWM setting; save machine capability to make its meaning specific.',
  },
  32: {
    name: 'Laser / spindle output mode',
    unit: '0/1',
    description: '1 uses the laser motion contract; 0 uses the spindle contract.',
  },
};

export function machineSettingsContextForProfile(
  profile: Pick<DeviceProfile, 'capabilities'>,
  machine: MachineConfig | undefined,
): MachineSettingsPresentationContext {
  return {
    machineKinds: explicitMachineKindsForProfile(profile),
    activeMachineKind: machineKindOf(machine),
  };
}

export function presentGrblSetting(
  row: GrblSettingRow,
  context: MachineSettingsPresentationContext,
): GrblSettingPresentation {
  const categoryLabel =
    row.category === 'laser'
      ? machineSettingsOutputCategoryLabel(context)
      : CATEGORY_LABELS[row.category];
  if (!isOutputSettingId(row.id)) {
    return {
      name: row.name,
      unit: row.unit,
      description: row.description,
      categoryLabel,
    };
  }
  return {
    ...outputSettingPresentation(row.id, context),
    categoryLabel,
  };
}

export function machineSettingsContextNotice(context: MachineSettingsPresentationContext): string {
  switch (presentationMode(context)) {
    case 'laser':
      return 'Showing the Laser output contract. Shared motion, homing, limit, reporting, and system settings remain visible.';
    case 'cnc':
      return 'Showing the CNC spindle output contract. Shared motion, homing, limit, reporting, and system settings remain visible.';
    case 'hybrid':
      return `This profile supports Laser + CNC. ${titleCase(context.activeMachineKind)} is active; switching workspace mode does not write controller firmware.`;
    case 'legacy':
      return 'This profile has no saved Laser/CNC capability yet, so shared output settings use combined labels. Save Machine Setup to make the view specific.';
  }
}

export function machineSettingsFirmwareNotice(
  context: MachineSettingsPresentationContext,
): string | null {
  if (presentationMode(context) !== 'hybrid') return null;
  const active = titleCase(context.activeMachineKind);
  const other = context.activeMachineKind === 'laser' ? 'CNC' : 'Laser';
  return `Hybrid profile: queued writes prepare the controller for the active ${active} contract only. Switching to ${other} later does not rewrite firmware; review $30/$31/$32 before using the other toolhead.`;
}

function machineSettingsOutputCategoryLabel(context: MachineSettingsPresentationContext): string {
  switch (presentationMode(context)) {
    case 'laser':
      return 'Laser output';
    case 'cnc':
      return 'CNC spindle output';
    case 'hybrid':
      return `Laser + CNC output (${titleCase(context.activeMachineKind)} active)`;
    case 'legacy':
      return 'Laser + CNC output (capability not set)';
  }
}

function outputSettingPresentation(
  id: OutputSettingId,
  context: MachineSettingsPresentationContext,
): OutputSettingPresentation {
  switch (presentationMode(context)) {
    case 'laser':
      return LASER_OUTPUT_SETTINGS[id];
    case 'cnc':
      return CNC_OUTPUT_SETTINGS[id];
    case 'hybrid':
      return hybridOutputSettings(context.activeMachineKind)[id];
    case 'legacy':
      return LEGACY_OUTPUT_SETTINGS[id];
  }
}

function hybridOutputSettings(
  activeMachineKind: MachineKind,
): Readonly<Record<OutputSettingId, OutputSettingPresentation>> {
  if (activeMachineKind === 'laser') {
    return {
      30: {
        name: 'Laser S maximum / spindle maximum',
        unit: 'S / RPM',
        description:
          'Shared full-scale PWM setting: S maximum for Laser and maximum RPM for CNC. The active Laser contract uses the S scale.',
      },
      31: {
        name: 'Laser S minimum / spindle minimum',
        unit: 'S / RPM',
        description:
          'Shared minimum nonzero PWM setting for both toolheads. The active Laser contract uses the S scale.',
      },
      32: {
        name: 'Laser / spindle output mode',
        unit: '0/1',
        description: '1 for Laser, 0 for CNC. The active Laser contract expects 1.',
      },
    };
  }
  return {
    30: {
      name: 'Spindle maximum / laser S maximum',
      unit: 'RPM / S',
      description:
        'Shared full-scale PWM setting: maximum RPM for CNC and S maximum for Laser. The active CNC contract uses RPM.',
    },
    31: {
      name: 'Spindle minimum / laser S minimum',
      unit: 'RPM / S',
      description:
        'Shared minimum nonzero PWM setting for both toolheads. The active CNC contract uses RPM.',
    },
    32: {
      name: 'Spindle / laser output mode',
      unit: '0/1',
      description: '0 for CNC, 1 for Laser. The active CNC contract expects 0.',
    },
  };
}

function presentationMode(context: MachineSettingsPresentationContext): PresentationMode {
  const laser = context.machineKinds.includes('laser');
  const cnc = context.machineKinds.includes('cnc');
  if (laser && cnc) return 'hybrid';
  if (laser) return 'laser';
  if (cnc) return 'cnc';
  return 'legacy';
}

function isOutputSettingId(id: number): id is OutputSettingId {
  return id === 30 || id === 31 || id === 32;
}

function titleCase(kind: MachineKind): string {
  return kind === 'cnc' ? 'CNC' : 'Laser';
}
