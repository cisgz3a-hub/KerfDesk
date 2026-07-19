import type { GrblSettingRow } from '../../../core/controllers/grbl';
import type { DeviceProfile } from '../../../core/devices';
import { numbersClose } from '../../../core/util';
import {
  computeFirmwareDiffs,
  type ComputeFirmwareDiffOptions,
} from '../device-setup/device-setup-firmware-diff';

export type SuperConsoleDiagnosticSection = 'output' | 'motion' | 'machine';

export type SuperConsoleDiagnosticComparisonKind =
  | 'output-contract'
  | 'command-cap-reference'
  | 'planner-reference'
  | 'profile-reference'
  | 'live-only';

export type SuperConsoleDiagnosticStatus =
  | 'matches-contract'
  | 'differs-from-contract'
  | 'same-as-reference'
  | 'different-from-reference'
  | 'live-only'
  | 'not-comparable';

export type SuperConsoleSettingDiagnostic = {
  readonly id: number;
  readonly code: `$${number}`;
  readonly label: string;
  readonly section: SuperConsoleDiagnosticSection;
  readonly current: string;
  readonly numericValue: number | null;
  readonly unit: string | null;
  readonly comparisonKind: SuperConsoleDiagnosticComparisonKind;
  readonly status: SuperConsoleDiagnosticStatus;
  readonly reference: string | null;
  readonly referenceLabel: string | null;
  readonly note: string;
};

export type BuildSuperConsoleSettingsDiagnosticsOptions = ComputeFirmwareDiffOptions;

const OUTPUT_IDS = [30, 31, 32] as const;

type ReferenceComparisonKind = Exclude<
  SuperConsoleDiagnosticComparisonKind,
  'output-contract' | 'live-only'
>;

type DiagnosticSpec =
  | {
      readonly kind: 'live';
      readonly id: number;
      readonly section: SuperConsoleDiagnosticSection;
      readonly note: string;
    }
  | {
      readonly kind: 'reference';
      readonly id: number;
      readonly section: SuperConsoleDiagnosticSection;
      readonly reference: (profile: DeviceProfile) => number;
      readonly referenceLabel: string;
      readonly comparisonKind: ReferenceComparisonKind;
      readonly note: string;
    };

const DIAGNOSTIC_SPECS: ReadonlyArray<DiagnosticSpec> = [
  {
    kind: 'live',
    id: 100,
    section: 'motion',
    note: 'Live X-axis calibration from the controller.',
  },
  {
    kind: 'live',
    id: 101,
    section: 'motion',
    note: 'Live Y-axis calibration from the controller.',
  },
  {
    kind: 'reference',
    id: 110,
    section: 'motion',
    reference: (profile) => profile.maxFeed,
    referenceLabel: 'Profile app command cap',
    comparisonKind: 'command-cap-reference',
    note: 'The controller X-axis ceiling and the app command cap serve different roles; this comparison is context only.',
  },
  {
    kind: 'reference',
    id: 111,
    section: 'motion',
    reference: (profile) => profile.maxFeed,
    referenceLabel: 'Profile app command cap',
    comparisonKind: 'command-cap-reference',
    note: 'The controller Y-axis ceiling and the app command cap serve different roles; this comparison is context only.',
  },
  {
    kind: 'reference',
    id: 120,
    section: 'motion',
    reference: (profile) => profile.accelMmPerSec2,
    referenceLabel: 'Profile ETA/planner reference',
    comparisonKind: 'planner-reference',
    note: 'Live X acceleration is compared with the shared profile value used for ETA planning; no controller value is changed.',
  },
  {
    kind: 'reference',
    id: 121,
    section: 'motion',
    reference: (profile) => profile.accelMmPerSec2,
    referenceLabel: 'Profile ETA/planner reference',
    comparisonKind: 'planner-reference',
    note: 'Live Y acceleration is compared with the shared profile value used for ETA planning; no controller value is changed.',
  },
  {
    kind: 'reference',
    id: 11,
    section: 'motion',
    reference: (profile) => profile.junctionDeviationMm,
    referenceLabel: 'Profile ETA/planner reference',
    comparisonKind: 'planner-reference',
    note: 'Live junction deviation is compared with the profile value used for ETA planning; no controller value is changed.',
  },
  { kind: 'live', id: 20, section: 'machine', note: 'Live controller soft-limit state.' },
  { kind: 'live', id: 21, section: 'machine', note: 'Live controller hard-limit state.' },
  {
    kind: 'reference',
    id: 22,
    section: 'machine',
    reference: (profile) => (profile.homing.enabled ? 1 : 0),
    referenceLabel: 'Profile homing workflow reference',
    comparisonKind: 'profile-reference',
    note: 'Controller homing support is compared with the profile workflow setting for visibility only.',
  },
  {
    kind: 'reference',
    id: 130,
    section: 'machine',
    reference: (profile) => profile.bedWidth,
    referenceLabel: 'Profile work-area width',
    comparisonKind: 'profile-reference',
    note: 'Controller X travel and the profile work area can legitimately differ when the machine reserves margins.',
  },
  {
    kind: 'reference',
    id: 131,
    section: 'machine',
    reference: (profile) => profile.bedHeight,
    referenceLabel: 'Profile work-area height',
    comparisonKind: 'profile-reference',
    note: 'Controller Y travel and the profile work area can legitimately differ when the machine reserves margins.',
  },
];

/**
 * Builds a read-only, operator-facing summary from the controller's latest
 * `$$` snapshot. A profile reference is deliberately not called a desired
 * firmware value: several pairs below serve different roles and can
 * legitimately differ.
 */
export function buildSuperConsoleSettingsDiagnostics(
  profile: DeviceProfile,
  rows: ReadonlyArray<GrblSettingRow>,
  options: BuildSuperConsoleSettingsDiagnosticsOptions = {},
): ReadonlyArray<SuperConsoleSettingDiagnostic> {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const diagnostics = [...buildOutputDiagnostics(profile, rows, rowsById, options)];
  for (const spec of DIAGNOSTIC_SPECS) {
    const row = rowsById.get(spec.id);
    if (row === undefined) continue;
    diagnostics.push(
      spec.kind === 'live'
        ? liveDiagnostic(row, spec.section, spec.note)
        : referenceDiagnostic(row, spec, spec.reference(profile)),
    );
  }

  return diagnostics;
}

function buildOutputDiagnostics(
  profile: DeviceProfile,
  rows: ReadonlyArray<GrblSettingRow>,
  rowsById: ReadonlyMap<number, GrblSettingRow>,
  options: BuildSuperConsoleSettingsDiagnosticsOptions,
): ReadonlyArray<SuperConsoleSettingDiagnostic> {
  const outputDiffs = new Map(
    computeFirmwareDiffs(profile, rows, options)
      .filter((diff) => OUTPUT_IDS.includes(diff.id as (typeof OUTPUT_IDS)[number]))
      .map((diff) => [diff.id, diff]),
  );
  return OUTPUT_IDS.flatMap((id) => {
    const row = rowsById.get(id);
    if (row === undefined) return [];
    const diff = outputDiffs.get(id);
    if (diff === undefined) {
      return [
        liveDiagnostic(
          row,
          'output',
          'No profile output contract is defined for this setting in the active machine mode.',
        ),
      ];
    }
    return [
      {
        ...diagnosticBase(row, diff.label, 'output'),
        comparisonKind: 'output-contract' as const,
        status:
          row.numericValue === null
            ? ('not-comparable' as const)
            : diff.differs
              ? ('differs-from-contract' as const)
              : ('matches-contract' as const),
        reference: diff.desired,
        referenceLabel: 'Active profile output contract',
        note: 'This controller value is checked against the active profile output contract used by generated jobs.',
      },
    ];
  });
}

function referenceDiagnostic(
  row: GrblSettingRow,
  spec: Extract<DiagnosticSpec, { readonly kind: 'reference' }>,
  reference: number,
): SuperConsoleSettingDiagnostic {
  return {
    ...diagnosticBase(row, row.name, spec.section),
    comparisonKind: spec.comparisonKind,
    status:
      row.numericValue === null
        ? 'not-comparable'
        : numbersClose(row.numericValue, reference)
          ? 'same-as-reference'
          : 'different-from-reference',
    reference: String(reference),
    referenceLabel: spec.referenceLabel,
    note: spec.note,
  };
}

function liveDiagnostic(
  row: GrblSettingRow,
  section: SuperConsoleDiagnosticSection,
  note: string,
): SuperConsoleSettingDiagnostic {
  return {
    ...diagnosticBase(row, row.name, section),
    comparisonKind: 'live-only',
    status: 'live-only',
    reference: null,
    referenceLabel: null,
    note,
  };
}

function diagnosticBase(
  row: GrblSettingRow,
  label: string,
  section: SuperConsoleDiagnosticSection,
): Pick<
  SuperConsoleSettingDiagnostic,
  'id' | 'code' | 'label' | 'section' | 'current' | 'numericValue' | 'unit'
> {
  return {
    id: row.id,
    code: row.code,
    label,
    section,
    current: row.rawValue,
    numericValue: row.numericValue,
    unit: row.unit,
  };
}
