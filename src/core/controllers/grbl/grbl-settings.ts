export type GrblSettingCategory =
  | 'motion'
  | 'limits'
  | 'homing'
  | 'laser'
  | 'reporting'
  | 'system'
  | 'unknown';

export type GrblSettingWriteRisk = 'read-only' | 'common' | 'machine-critical' | 'unknown';

export type GrblSettingRow = {
  readonly id: number;
  readonly code: `$${number}`;
  readonly rawValue: string;
  readonly numericValue: number | null;
  readonly name: string;
  readonly unit: string | null;
  readonly description: string;
  readonly category: GrblSettingCategory;
  readonly known: boolean;
  readonly writeRisk: GrblSettingWriteRisk;
};

export type GrblSettingsBackup = {
  readonly format: 'laserforge.grbl-settings.backup';
  readonly version: 1;
  readonly createdAt: string;
  readonly settings: ReadonlyArray<GrblSettingRow>;
};

type GrblSettingDefinition = {
  readonly name: string;
  readonly unit: string | null;
  readonly description: string;
  readonly category: GrblSettingCategory;
  readonly writeRisk: GrblSettingWriteRisk;
};

const SETTING_DEFINITIONS: ReadonlyMap<number, GrblSettingDefinition> = new Map([
  [
    0,
    {
      name: 'Step pulse time',
      unit: 'microseconds',
      description: 'Stepper driver pulse length.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    1,
    {
      name: 'Step idle delay',
      unit: 'milliseconds',
      description: 'How long steppers stay enabled after motion stops.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    10,
    {
      name: 'Status report mask',
      unit: null,
      description: 'Controls which fields GRBL includes in status reports.',
      category: 'reporting',
      writeRisk: 'common',
    },
  ],
  [
    11,
    {
      name: 'Junction deviation',
      unit: 'mm',
      description: 'Planner cornering tolerance.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    12,
    {
      name: 'Arc tolerance',
      unit: 'mm',
      description: 'Planner arc approximation tolerance.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    13,
    {
      name: 'Report inches',
      unit: '0/1',
      description: 'Controls whether reports use inches instead of millimeters.',
      category: 'reporting',
      writeRisk: 'common',
    },
  ],
  [
    20,
    {
      name: 'Soft limits',
      unit: '0/1',
      description: 'Enables travel-limit checking from configured machine size.',
      category: 'limits',
      writeRisk: 'machine-critical',
    },
  ],
  [
    21,
    {
      name: 'Hard limits',
      unit: '0/1',
      description: 'Enables physical limit switch checking.',
      category: 'limits',
      writeRisk: 'machine-critical',
    },
  ],
  [
    22,
    {
      name: 'Homing cycle',
      unit: '0/1',
      description: 'Enables GRBL homing with $H.',
      category: 'homing',
      writeRisk: 'machine-critical',
    },
  ],
  [
    23,
    {
      name: 'Homing direction invert',
      unit: 'mask',
      description: 'Controls which directions axes move during homing.',
      category: 'homing',
      writeRisk: 'machine-critical',
    },
  ],
  [
    24,
    {
      name: 'Homing seek feed',
      unit: 'mm/min',
      description: 'Slow homing locate speed.',
      category: 'homing',
      writeRisk: 'machine-critical',
    },
  ],
  [
    25,
    {
      name: 'Homing search feed',
      unit: 'mm/min',
      description: 'Fast homing search speed.',
      category: 'homing',
      writeRisk: 'machine-critical',
    },
  ],
  [
    26,
    {
      name: 'Homing debounce',
      unit: 'milliseconds',
      description: 'Switch debounce time for homing.',
      category: 'homing',
      writeRisk: 'machine-critical',
    },
  ],
  [
    27,
    {
      name: 'Homing pull-off',
      unit: 'mm',
      description: 'Distance moved away from switches after homing.',
      category: 'homing',
      writeRisk: 'machine-critical',
    },
  ],
  [
    30,
    {
      name: 'Max spindle speed / laser S max',
      unit: 'S value',
      description: 'Top PWM/S value GRBL treats as full laser power.',
      category: 'laser',
      writeRisk: 'common',
    },
  ],
  [
    31,
    {
      name: 'Min spindle speed / laser S min',
      unit: 'S value',
      description: 'Lowest PWM/S value GRBL uses for spindle or laser output.',
      category: 'laser',
      writeRisk: 'common',
    },
  ],
  [
    32,
    {
      name: 'Laser mode',
      unit: '0/1',
      description: 'Enables GRBL laser mode for motion-linked laser power changes.',
      category: 'laser',
      writeRisk: 'common',
    },
  ],
  [
    100,
    {
      name: 'X steps per mm',
      unit: 'steps/mm',
      description: 'X-axis motion calibration.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    101,
    {
      name: 'Y steps per mm',
      unit: 'steps/mm',
      description: 'Y-axis motion calibration.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    102,
    {
      name: 'Z steps per mm',
      unit: 'steps/mm',
      description: 'Z-axis motion calibration.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    110,
    {
      name: 'X max rate',
      unit: 'mm/min',
      description: 'Maximum X-axis feed rate.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    111,
    {
      name: 'Y max rate',
      unit: 'mm/min',
      description: 'Maximum Y-axis feed rate.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    112,
    {
      name: 'Z max rate',
      unit: 'mm/min',
      description: 'Maximum Z-axis feed rate.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    120,
    {
      name: 'X acceleration',
      unit: 'mm/sec^2',
      description: 'Maximum X-axis acceleration.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    121,
    {
      name: 'Y acceleration',
      unit: 'mm/sec^2',
      description: 'Maximum Y-axis acceleration.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    122,
    {
      name: 'Z acceleration',
      unit: 'mm/sec^2',
      description: 'Maximum Z-axis acceleration.',
      category: 'motion',
      writeRisk: 'machine-critical',
    },
  ],
  [
    130,
    {
      name: 'X max travel',
      unit: 'mm',
      description: 'Configured X-axis machine travel.',
      category: 'limits',
      writeRisk: 'machine-critical',
    },
  ],
  [
    131,
    {
      name: 'Y max travel',
      unit: 'mm',
      description: 'Configured Y-axis machine travel.',
      category: 'limits',
      writeRisk: 'machine-critical',
    },
  ],
  [
    132,
    {
      name: 'Z max travel',
      unit: 'mm',
      description: 'Configured Z-axis machine travel.',
      category: 'limits',
      writeRisk: 'machine-critical',
    },
  ],
]);

export function settingsMapToRows(map: ReadonlyMap<number, string>): ReadonlyArray<GrblSettingRow> {
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([id, rawValue]) => {
      const definition = SETTING_DEFINITIONS.get(id);
      const code = `$${id}` as `$${number}`;
      const numericValue = parseFiniteNumber(rawValue);
      if (definition === undefined) {
        return {
          id,
          code,
          rawValue,
          numericValue,
          name: 'Unknown GRBL setting',
          unit: null,
          description:
            'This setting is reported by the controller but is not in KerfDesk metadata.',
          category: 'unknown',
          known: false,
          writeRisk: 'unknown',
        };
      }
      return {
        id,
        code,
        rawValue,
        numericValue,
        ...definition,
        known: true,
      };
    });
}

export function createGrblSettingsBackup(
  rows: ReadonlyArray<GrblSettingRow>,
  createdAt: string,
): GrblSettingsBackup {
  return {
    format: 'laserforge.grbl-settings.backup',
    version: 1,
    createdAt,
    settings: rows,
  };
}

function parseFiniteNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
