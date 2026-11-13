import type { DeviceProfile } from '../devices';
import type { CncTool } from '../scene';
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
  // 'engineering-starter' = derived from public specs and chipload math;
  // 'maintainer-verified' requires an attributable physical cutting record;
  // 'unverified-starter' retains legacy values without inventing qualification.
  readonly confidence: 'engineering-starter' | 'maintainer-verified' | 'unverified-starter';
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
  // ADR-256 Amendment 1: the fitted spindle's lowest rated speed. When the
  // starter's feed caps a material recipe, the recipe lowers its RPM until the
  // chip load reaches the chart, but never below this.
  readonly spindleMinRpm?: number;
};

/** Whether retained starter values still describe their original cutter. */
export function cncStarterMatchesTool(starter: CncMachineStarter, tool: CncTool): boolean {
  return (
    tool.id === starter.tool.toolId &&
    tool.kind === 'end-mill' &&
    tool.diameterMm === starter.tool.diameterMm &&
    (tool.fluteCount ?? 2) === starter.tool.fluteCount
  );
}

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
// Revision 3 (ADR-256 Amendment 1, CNC audit FS-2): the maintainer kept the
// 300 mm/min feed cap and chose to lower RPM to it ("Keep 300, lower RPM",
// 2026-11-13). At 12,000 RPM a 2-flute 1/8" bit took 0.0125 mm/tooth and
// rubbed; at the 500 W spindle's 3,000 RPM minimum it takes 0.050. The values
// still have no attributable physical cutting record, so the label stays.
const NEOTRONICS_4040_FEED_MM_PER_MIN = 300;
const NEOTRONICS_4040_PLUNGE_MM_PER_MIN = 250;
const NEOTRONICS_4040_SPINDLE_RPM = 3_000;
const NEOTRONICS_4040_SPINDLE_MIN_RPM = 3_000;
const NEOTRONICS_4040_DEPTH_PER_PASS_MM = 0.75;

/** Conservative machine starters used only when a profile is explicitly identified. */
export const CNC_MACHINE_STARTER_CATALOG: ReadonlyArray<CncMachineStarter> = [
  {
    id: 'neotronics-4040-shallow-wood-mdf',
    revision: 3,
    label: 'Neotronics 4040 shallow wood / MDF starter',
    confidence: 'unverified-starter',
    operatorNotice:
      'Unverified cutting starter for a 3.175 mm 2-flute cutter and assumed 500 W spindle: feed held at 300 mm/min with the spindle at its 3,000 RPM minimum, so each tooth takes about 0.05 mm. Public specifications do not provide this recipe, and no attributable physical cutting record is attached. Confirm the fitted spindle, bit, stock and cut before production.',
    sources: [
      {
        label: 'Neotronics 4040 Max product specification',
        url: 'https://neotronics.co.za/index.php?product_id=1018&route=product%2Fproduct',
        supports:
          '400 x 400 x 75 mm envelope and multiple spindle variants; no cut recipe published',
      },
      {
        label: 'Neotronics 500 W spindle specification',
        // The category-listing form of this link (limit/order/path/sort) opened
        // the 4040 Max page instead of the spindle when rechecked on 2026-09-24.
        url: 'https://neotronics.co.za/index.php?product_id=297&route=product%2Fproduct',
        supports: '3,000-12,000 RPM range for the assumed 500 W spindle variant, not all bundles',
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
    spindleMinRpm: NEOTRONICS_4040_SPINDLE_MIN_RPM,
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

/**
 * The lowest rated speed of the spindle this profile's starter assumes
 * (ADR-256 Amendment 1), or undefined when no starter records one.
 */
export function cncSpindleMinRpm(
  profile: Pick<DeviceProfile, 'profileId' | 'machineFamily'>,
): number | undefined {
  return findCncMachineStarter(profile)?.starter.spindleMinRpm;
}

function findByKey(
  catalog: ReadonlyArray<CncMachineStarter>,
  key: 'profileIds' | 'machineFamilies',
  value: string | undefined,
): CncMachineStarter | null {
  if (value === undefined) return null;
  return catalog.find((starter) => starter[key].includes(value)) ?? null;
}
