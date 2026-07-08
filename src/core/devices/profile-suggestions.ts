import type { ControllerKind, DeviceProfile } from './device-profile';
import {
  GRBL_MACHINE_PROFILE_CATALOG,
  type MachineProfileCatalogEntry,
  type MachineProfileConfidence,
} from './profile-catalog';

export type MachineProfileSuggestionRank = 'suggested' | 'possible' | 'manual-only';

export type MachineProfileSuggestion = {
  readonly profileId: string | undefined;
  readonly entry: MachineProfileCatalogEntry;
  readonly rank: MachineProfileSuggestionRank;
  readonly score: number;
  readonly reasons: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

export type MachineProfileSuggestionInput = {
  readonly detectedControllerKind: ControllerKind | null;
  readonly detectedSettings: Partial<DeviceProfile> | null;
  readonly controllerSettings: Partial<DeviceProfile> | null;
  readonly settingsRows?: ReadonlyArray<unknown>;
};

const RANK_ORDER: Record<MachineProfileSuggestionRank, number> = {
  suggested: 0,
  possible: 1,
  'manual-only': 2,
};

export function suggestMachineProfiles(
  input: MachineProfileSuggestionInput,
): ReadonlyArray<MachineProfileSuggestion> {
  const facts = {
    ...(input.detectedSettings ?? {}),
    ...(input.controllerSettings ?? {}),
  };
  const raw = GRBL_MACHINE_PROFILE_CATALOG.map((entry) =>
    suggestionForEntry(entry, input.detectedControllerKind, facts),
  );
  const hasSpecificSuggestion = raw.some(
    (item) => item.rank === 'suggested' && item.entry.profile.vendor !== 'Generic',
  );
  const suggestions = hasSpecificSuggestion ? raw.map(demoteGenericSuggestion) : raw;
  return [...suggestions].sort(compareSuggestions);
}

function suggestionForEntry(
  entry: MachineProfileCatalogEntry,
  detectedControllerKind: ControllerKind | null,
  facts: Partial<DeviceProfile>,
): MachineProfileSuggestion {
  const profile = entry.profile;
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = confidenceScore(entry.confidence);
  const hasFacts = detectedControllerKind !== null || hasMachineFacts(facts);
  const controllerMatch = controllerMatchForProfile(
    profile,
    detectedControllerKind,
    reasons,
    warnings,
  );

  if (entry.confidence === 'default-starter') {
    warnings.push('Default starter is a manual fallback, not a detected machine identity.');
  }
  score += controllerMatch.score;
  if (bedMatches(profile, facts)) {
    score += 25;
    reasons.push(`Detected ${profile.bedWidth} x ${profile.bedHeight} mm work area.`);
  }
  if (powerScaleMatches(profile, facts)) {
    score += 10;
    reasons.push(`Detected S${profile.maxPowerS} laser power scale.`);
  }
  if (profile.vendor !== undefined && profile.vendor !== 'Generic') {
    score += 10;
  }

  return {
    profileId: profile.profileId,
    entry,
    score,
    reasons,
    warnings,
    rank: rankSuggestion(score, hasFacts, controllerMatch.mismatch, entry.confidence),
  };
}

function controllerMatchForProfile(
  profile: DeviceProfile,
  detectedControllerKind: ControllerKind | null,
  reasons: string[],
  warnings: string[],
): { readonly score: number; readonly mismatch: boolean } {
  if (detectedControllerKind === null) return { score: 0, mismatch: false };
  if (profile.controllerKind === detectedControllerKind) {
    reasons.push(`Detected ${controllerLabel(detectedControllerKind)} controller.`);
    return { score: 50, mismatch: false };
  }
  if (profile.controllerKind === undefined) {
    warnings.push('Profile has no firmware identity; confirm it before applying.');
    return { score: 0, mismatch: false };
  }
  warnings.push(
    `Profile controller ${controllerLabel(profile.controllerKind)} does not match detected ${controllerLabel(
      detectedControllerKind,
    )}.`,
  );
  return { score: 0, mismatch: true };
}

function demoteGenericSuggestion(suggestion: MachineProfileSuggestion): MachineProfileSuggestion {
  if (suggestion.rank !== 'suggested' || suggestion.entry.profile.vendor !== 'Generic') {
    return suggestion;
  }
  return {
    ...suggestion,
    rank: 'possible',
    warnings: [
      ...suggestion.warnings,
      'Generic firmware profile is possible, but a more specific profile also matches.',
    ],
  };
}

function rankSuggestion(
  score: number,
  hasFacts: boolean,
  controllerMismatch: boolean,
  confidence: MachineProfileConfidence,
): MachineProfileSuggestionRank {
  if (!hasFacts || controllerMismatch || confidence === 'default-starter') return 'manual-only';
  if (score >= 80) return 'suggested';
  if (score >= 45) return 'possible';
  return 'manual-only';
}

function compareSuggestions(a: MachineProfileSuggestion, b: MachineProfileSuggestion): number {
  const rank = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
  if (rank !== 0) return rank;
  const score = b.score - a.score;
  if (score !== 0) return score;
  return a.entry.profile.name.localeCompare(b.entry.profile.name);
}

function hasMachineFacts(facts: Partial<DeviceProfile>): boolean {
  return (
    facts.bedWidth !== undefined ||
    facts.bedHeight !== undefined ||
    facts.maxPowerS !== undefined ||
    facts.minPowerS !== undefined
  );
}

function bedMatches(profile: DeviceProfile, facts: Partial<DeviceProfile>): boolean {
  if (facts.bedWidth === undefined || facts.bedHeight === undefined) return false;
  return (
    withinMm(profile.bedWidth, facts.bedWidth, 5) && withinMm(profile.bedHeight, facts.bedHeight, 5)
  );
}

function powerScaleMatches(profile: DeviceProfile, facts: Partial<DeviceProfile>): boolean {
  return facts.maxPowerS !== undefined && Math.abs(profile.maxPowerS - facts.maxPowerS) <= 1;
}

function confidenceScore(confidence: MachineProfileConfidence): number {
  switch (confidence) {
    case 'hardware-verified':
      return 10;
    case 'simulator-tested':
      return 5;
    case 'public-spec-starter':
      return 4;
    case 'experimental':
    case 'default-starter':
      return 0;
  }
}

function controllerLabel(kind: ControllerKind): string {
  switch (kind) {
    case 'grbl-v1.1':
      return 'GRBL v1.1';
    case 'grblhal':
      return 'grblHAL';
    case 'fluidnc':
      return 'FluidNC';
    case 'marlin':
      return 'Marlin';
    case 'smoothieware':
      return 'Smoothieware';
    case 'ruida':
      return 'Ruida';
  }
}

function withinMm(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}
