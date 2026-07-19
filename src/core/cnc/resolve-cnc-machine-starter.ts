import type { DeviceProfile } from '../devices';
import { findCncMachineStarter, type CncMachineStarterValues } from './cnc-machine-starter-catalog';

export type CncMachineStarterLiveCaps = {
  readonly xMaxFeedMmPerMin?: number;
  readonly yMaxFeedMmPerMin?: number;
  readonly zMaxFeedMmPerMin?: number;
  readonly spindleMaxRpm?: number;
};

export type CncMachineStarterCapSource =
  | 'profile.maxFeed'
  | 'profile.cncSubProfile.spindleMaxRpm'
  | 'machine.params.spindleMaxRpm'
  | 'controller.$110/$111'
  | 'controller.$112'
  | 'controller.$30';

export type CncMachineStarterCapDetail = {
  readonly field: 'feedMmPerMin' | 'plungeMmPerMin' | 'spindleRpm';
  readonly source: CncMachineStarterCapSource;
  readonly limit: number;
  readonly valueBefore: number;
  readonly valueAfter: number;
  readonly didLimit: boolean;
};

export type ResolvedCncMachineStarter = CncMachineStarterValues & {
  readonly tool: {
    readonly toolId: string;
    readonly diameterMm: number;
    readonly fluteCount: number;
  };
  readonly material: {
    readonly key: string;
    readonly label: string;
  };
  readonly provenance: {
    readonly source: 'machine-starter-catalog';
    readonly starterId: string;
    readonly starterRevision: number;
    readonly starterLabel: string;
    readonly matchedBy: 'profile-id' | 'machine-family';
    readonly matchedValue: string;
    readonly capDetails: ReadonlyArray<CncMachineStarterCapDetail>;
  };
};

export type ResolveCncMachineStarterInput = {
  readonly profile: Pick<
    DeviceProfile,
    'profileId' | 'machineFamily' | 'maxFeed' | 'cncSubProfile'
  >;
  readonly machineSpindleMaxRpm?: number;
  readonly liveCaps?: CncMachineStarterLiveCaps;
};

type CapCandidate = {
  readonly field: CncMachineStarterCapDetail['field'];
  readonly source: CncMachineStarterCapSource;
  readonly limit: number | undefined;
};

type ResolutionState = {
  readonly values: CncMachineStarterValues;
  readonly capDetails: ReadonlyArray<CncMachineStarterCapDetail>;
};

/** Resolves a profile starter and lowers suggestions to positive machine limits when provided. */
export function resolveCncMachineStarter(
  input: ResolveCncMachineStarterInput,
): ResolvedCncMachineStarter | null {
  const match = findCncMachineStarter(input.profile);
  if (match === null) return null;

  const controllerXyLimit = lesserPositive(
    input.liveCaps?.xMaxFeedMmPerMin,
    input.liveCaps?.yMaxFeedMmPerMin,
  );
  const candidates: ReadonlyArray<CapCandidate> = [
    {
      field: 'feedMmPerMin',
      source: 'profile.maxFeed',
      limit: input.profile.maxFeed,
    },
    {
      field: 'feedMmPerMin',
      source: 'controller.$110/$111',
      limit: controllerXyLimit,
    },
    {
      field: 'plungeMmPerMin',
      source: 'controller.$112',
      limit: input.liveCaps?.zMaxFeedMmPerMin,
    },
    {
      field: 'spindleRpm',
      source: 'profile.cncSubProfile.spindleMaxRpm',
      limit: input.profile.cncSubProfile?.spindleMaxRpm,
    },
    {
      field: 'spindleRpm',
      source: 'machine.params.spindleMaxRpm',
      limit: input.machineSpindleMaxRpm,
    },
    {
      field: 'spindleRpm',
      source: 'controller.$30',
      limit: input.liveCaps?.spindleMaxRpm,
    },
  ];
  const resolution = candidates.reduce(applyCapCandidate, {
    values: match.starter.values,
    capDetails: [],
  });

  return {
    ...resolution.values,
    tool: match.starter.tool,
    material: match.starter.material,
    provenance: {
      source: 'machine-starter-catalog',
      starterId: match.starter.id,
      starterRevision: match.starter.revision,
      starterLabel: match.starter.label,
      matchedBy: match.matchedBy,
      matchedValue: match.matchedValue,
      capDetails: resolution.capDetails,
    },
  };
}

function applyCapCandidate(state: ResolutionState, candidate: CapCandidate): ResolutionState {
  if (!isPositiveFinite(candidate.limit)) return state;
  const valueBefore = state.values[candidate.field];
  const valueAfter = Math.min(valueBefore, candidate.limit);
  return {
    values: { ...state.values, [candidate.field]: valueAfter },
    capDetails: [
      ...state.capDetails,
      {
        field: candidate.field,
        source: candidate.source,
        limit: candidate.limit,
        valueBefore,
        valueAfter,
        didLimit: valueAfter < valueBefore,
      },
    ],
  };
}

function lesserPositive(left: number | undefined, right: number | undefined): number | undefined {
  if (isPositiveFinite(left) && isPositiveFinite(right)) return Math.min(left, right);
  if (isPositiveFinite(left)) return left;
  return isPositiveFinite(right) ? right : undefined;
}

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
