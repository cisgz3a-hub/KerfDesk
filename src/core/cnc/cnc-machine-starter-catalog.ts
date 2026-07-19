import type { DeviceProfile } from '../devices';
import type { ChiploadMaterial } from './feeds-calculator';

export type CncMachineStarterValues = {
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
  readonly depthPerPassMm: number;
};

export type CncMachineStarter = {
  readonly id: string;
  readonly revision: number;
  readonly label: string;
  readonly confidence: 'engineering-starter';
  readonly operatorNotice: string;
  readonly sources: ReadonlyArray<{
    readonly label: string;
    readonly url: string;
    readonly supports: string;
  }>;
  readonly profileIds: ReadonlyArray<string>;
  readonly machineFamilies: ReadonlyArray<string>;
  readonly tool: {
    readonly toolId: string;
    readonly diameterMm: number;
    readonly fluteCount: number;
  };
  readonly material: {
    readonly key: ChiploadMaterial;
    readonly label: string;
  };
  readonly values: CncMachineStarterValues;
};

export type CncMachineStarterMatch = {
  readonly starter: CncMachineStarter;
  readonly matchedBy: 'profile-id' | 'machine-family';
  readonly matchedValue: string;
};

const NEOTRONICS_4040_PROFILE_ID = 'neotronics-4040-max-lt4lds-v2-20w';
const NEOTRONICS_4040_MACHINE_FAMILY = 'neotronics-4040-max';
const DEFAULT_END_MILL_TOOL_ID = 'em-3175';
const DEFAULT_END_MILL_DIAMETER_MM = 3.175;
const DEFAULT_END_MILL_FLUTE_COUNT = 2;
const NEOTRONICS_4040_FEED_MM_PER_MIN = 600;
const NEOTRONICS_4040_PLUNGE_MM_PER_MIN = 120;
const NEOTRONICS_4040_SPINDLE_RPM = 12_000;
const NEOTRONICS_4040_DEPTH_PER_PASS_MM = 0.75;

/** Conservative machine starters used only when a profile is explicitly identified. */
export const CNC_MACHINE_STARTER_CATALOG: ReadonlyArray<CncMachineStarter> = [
  {
    id: 'neotronics-4040-shallow-wood-mdf',
    revision: 1,
    label: 'Neotronics 4040 shallow wood / MDF starter',
    confidence: 'engineering-starter',
    operatorNotice:
      'Engineering starter — assumes a 3.175 mm 2-flute cutter; verify on this machine.',
    sources: [
      {
        label: 'Neotronics 4040 Max product specification',
        url: 'https://neotronics.co.za/index.php?product_id=1018&route=product%2Fproduct',
        supports: '400 x 400 x 75 mm envelope and default 500 W spindle; no cut recipe published',
      },
      {
        label: 'Neotronics 500 W spindle specification',
        url: 'https://neotronics.co.za/index.php?limit=25&order=ASC&path=113_115&product_id=297&route=product%2Fproduct&sort=p.price',
        supports: '12,000 RPM maximum for the default 500 W spindle',
      },
      {
        label: 'GRBL v1.1 settings documentation',
        url: 'https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md',
        supports: '$110-$112 are axis ceilings, not material cutting recommendations',
      },
    ],
    profileIds: [NEOTRONICS_4040_PROFILE_ID],
    machineFamilies: [NEOTRONICS_4040_MACHINE_FAMILY],
    tool: {
      toolId: DEFAULT_END_MILL_TOOL_ID,
      diameterMm: DEFAULT_END_MILL_DIAMETER_MM,
      fluteCount: DEFAULT_END_MILL_FLUTE_COUNT,
    },
    material: {
      key: 'plywood-mdf',
      label: 'Wood / MDF',
    },
    values: {
      feedMmPerMin: NEOTRONICS_4040_FEED_MM_PER_MIN,
      plungeMmPerMin: NEOTRONICS_4040_PLUNGE_MM_PER_MIN,
      spindleRpm: NEOTRONICS_4040_SPINDLE_RPM,
      depthPerPassMm: NEOTRONICS_4040_DEPTH_PER_PASS_MM,
    },
  },
];

/** Looks up the catalog entry named by persisted layer provenance. */
export function findCncMachineStarterById(starterId: string): CncMachineStarter | null {
  return CNC_MACHINE_STARTER_CATALOG.find((starter) => starter.id === starterId) ?? null;
}

/** Resolves an exact profile id before falling back to its machine family. */
export function findCncMachineStarter(
  profile: Pick<DeviceProfile, 'profileId' | 'machineFamily'>,
): CncMachineStarterMatch | null {
  const profileIdMatch = findByKey(CNC_MACHINE_STARTER_CATALOG, 'profileIds', profile.profileId);
  if (profileIdMatch !== null && profile.profileId !== undefined) {
    return { starter: profileIdMatch, matchedBy: 'profile-id', matchedValue: profile.profileId };
  }

  const familyMatch = findByKey(
    CNC_MACHINE_STARTER_CATALOG,
    'machineFamilies',
    profile.machineFamily,
  );
  return familyMatch !== null && profile.machineFamily !== undefined
    ? {
        starter: familyMatch,
        matchedBy: 'machine-family',
        matchedValue: profile.machineFamily,
      }
    : null;
}

function findByKey(
  catalog: ReadonlyArray<CncMachineStarter>,
  key: 'profileIds' | 'machineFamilies',
  value: string | undefined,
): CncMachineStarter | null {
  if (value === undefined) return null;
  return catalog.find((starter) => starter[key].includes(value)) ?? null;
}
