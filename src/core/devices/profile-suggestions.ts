import { GRBL_MACHINE_PROFILE_CATALOG, type MachineProfileCatalogEntry } from './profile-catalog';
import type { ControllerKind, DeviceProfile } from './device-profile';

export type MachineProfileSuggestionConfidence = 'suggested' | 'possible' | 'manual-only';

export type MachineProfileSuggestionInput = {
  readonly detectedControllerKind: ControllerKind | null;
  readonly detectedProfilePatch: Partial<DeviceProfile> | null;
  readonly controllerSettings: Partial<DeviceProfile> | null;
  readonly settingsRows: ReadonlyArray<unknown>;
};

export type MachineProfileSuggestion = {
  readonly profileId: string;
  readonly profile: DeviceProfile;
  readonly entry: MachineProfileCatalogEntry;
  readonly confidence: MachineProfileSuggestionConfidence;
  readonly reasons: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

export function suggestMachineProfiles(
  input: MachineProfileSuggestionInput,
): ReadonlyArray<MachineProfileSuggestion> {
  const suggestions = GRBL_MACHINE_PROFILE_CATALOG.map((entry) => suggestionFor(entry, input));
  return suggestions.sort(compareSuggestions);
}

function suggestionFor(
  entry: MachineProfileCatalogEntry,
  input: MachineProfileSuggestionInput,
): MachineProfileSuggestion {
  const profile = entry.profile;
  const profileId = profile.profileId ?? profile.name;
  const facts = {
    ...input.detectedProfilePatch,
    ...input.controllerSettings,
  };
  const reasons = profileReasons(input.detectedControllerKind, facts);
  const warnings: string[] = [];
  const profileKind = normalizedControllerKind(profile.controllerKind);
  const detectedKind = input.detectedControllerKind;
  if (detectedKind !== null && profileKind !== detectedKind) {
    warnings.push(`Profile controller is ${profileKind}, but detected ${detectedKind}.`);
    return { profileId, profile, entry, confidence: 'manual-only', reasons, warnings };
  }

  if (profile.profileId === 'creality-falcon-a1-pro-grblhal' && falconFactsMatch(facts)) {
    return { profileId, profile, entry, confidence: 'suggested', reasons, warnings };
  }

  if (detectedKind !== null && profileKind === detectedKind) {
    return { profileId, profile, entry, confidence: 'possible', reasons, warnings };
  }

  return { profileId, profile, entry, confidence: 'manual-only', reasons, warnings };
}

function profileReasons(
  detectedControllerKind: ControllerKind | null,
  facts: Partial<DeviceProfile>,
): ReadonlyArray<string> {
  const reasons: string[] = [];
  if (detectedControllerKind !== null) {
    reasons.push(`Detected ${controllerKindLabel(detectedControllerKind)} firmware.`);
  }
  if (typeof facts.bedWidth === 'number' && typeof facts.bedHeight === 'number') {
    reasons.push(`Controller reports a ${facts.bedWidth} x ${facts.bedHeight} mm work area.`);
  }
  if (typeof facts.minPowerS === 'number' && typeof facts.maxPowerS === 'number') {
    reasons.push(`Controller reports S range ${facts.minPowerS}-${facts.maxPowerS}.`);
  }
  return reasons;
}

function falconFactsMatch(facts: Partial<DeviceProfile>): boolean {
  return (
    approxEqual(facts.bedWidth, 400) &&
    approxEqual(facts.bedHeight, 400) &&
    facts.minPowerS === 0 &&
    facts.maxPowerS === 1000
  );
}

function approxEqual(value: number | undefined, expected: number): boolean {
  return typeof value === 'number' && Math.abs(value - expected) <= 5;
}

function normalizedControllerKind(kind: ControllerKind | undefined): ControllerKind {
  return kind ?? 'grbl-v1.1';
}

function controllerKindLabel(kind: ControllerKind): string {
  return kind === 'grblhal' ? 'grblHAL' : kind;
}

function compareSuggestions(a: MachineProfileSuggestion, b: MachineProfileSuggestion): number {
  const byConfidence = confidenceRank(a.confidence) - confidenceRank(b.confidence);
  if (byConfidence !== 0) return byConfidence;
  return catalogIndex(a.profileId) - catalogIndex(b.profileId);
}

function confidenceRank(confidence: MachineProfileSuggestionConfidence): number {
  if (confidence === 'suggested') return 0;
  if (confidence === 'possible') return 1;
  return 2;
}

function catalogIndex(profileId: string): number {
  const index = GRBL_MACHINE_PROFILE_CATALOG.findIndex(
    (entry) => (entry.profile.profileId ?? entry.profile.name) === profileId,
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
