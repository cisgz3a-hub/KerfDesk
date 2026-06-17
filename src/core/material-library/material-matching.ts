import type { DeviceProfile } from '../devices';

export type MaterialRecipeOperation =
  | 'cut'
  | 'engrave'
  | 'score'
  | 'image'
  | 'material-test'
  | 'interval-test';
export type MaterialRecipeConfidence = 'starter' | 'calibrated' | 'imported' | 'unsupported';
export type MaterialRecipeMatchScope =
  | 'profile'
  | 'machine-family'
  | 'laser-model'
  | 'optical-power'
  | 'generic';

export type MaterialRecipeCandidate = {
  readonly id: string;
  readonly profileId?: string;
  readonly machineFamily?: string;
  readonly laserModel?: string;
  readonly opticalPowerW?: number;
  readonly material?: string;
  readonly thicknessMm?: number;
  readonly operation?: MaterialRecipeOperation;
  readonly confidence?: MaterialRecipeConfidence;
  readonly warning?: string;
};

export type MaterialRecipeMatchQuery = {
  readonly material?: string;
  readonly thicknessMm?: number;
  readonly operation?: MaterialRecipeOperation;
};

export type MaterialRecipeMatch<T extends MaterialRecipeCandidate> = {
  readonly candidate: T;
  readonly scope: MaterialRecipeMatchScope;
  readonly confidence: MaterialRecipeConfidence;
  readonly score: number;
  readonly warnings: ReadonlyArray<string>;
};

export function rankMaterialRecipeCandidates<T extends MaterialRecipeCandidate>(
  device: DeviceProfile,
  candidates: ReadonlyArray<T>,
  query: MaterialRecipeMatchQuery = {},
): ReadonlyArray<MaterialRecipeMatch<T>> {
  return candidates
    .map((candidate, index) => ({ match: matchCandidate(device, candidate, query), index }))
    .filter(
      (item): item is { readonly match: MaterialRecipeMatch<T>; readonly index: number } =>
        item.match !== null,
    )
    .sort((a, b) => b.match.score - a.match.score || a.index - b.index)
    .map((item) => item.match);
}

export function recipeConfidence(candidate: MaterialRecipeCandidate): MaterialRecipeConfidence {
  return candidate.confidence ?? 'starter';
}

function matchCandidate<T extends MaterialRecipeCandidate>(
  device: DeviceProfile,
  candidate: T,
  query: MaterialRecipeMatchQuery,
): MaterialRecipeMatch<T> | null {
  if (!matchesQuery(candidate, query)) return null;
  const scope = scopeScore(device, candidate);
  if (scope === null) return null;
  const confidence = recipeConfidence(candidate);
  const score = scope.score + confidenceScore(confidence);
  return {
    candidate,
    scope: scope.scope,
    confidence,
    score,
    warnings: warningsFor(candidate, confidence),
  };
}

function matchesQuery(
  candidate: MaterialRecipeCandidate,
  query: MaterialRecipeMatchQuery,
): boolean {
  return (
    stringMatches(candidate.material, query.material) &&
    operationMatches(candidate.operation, query.operation) &&
    thicknessMatches(candidate.thicknessMm, query.thicknessMm)
  );
}

function scopeScore(
  device: DeviceProfile,
  candidate: MaterialRecipeCandidate,
): { readonly scope: MaterialRecipeMatchScope; readonly score: number } | null {
  if (candidate.profileId !== undefined) {
    return candidate.profileId === device.profileId ? { scope: 'profile', score: 400 } : null;
  }
  if (candidate.machineFamily !== undefined) {
    return candidate.machineFamily === device.machineFamily
      ? { scope: 'machine-family', score: 300 }
      : null;
  }
  if (candidate.laserModel !== undefined) {
    return candidate.laserModel === device.laserSubProfile?.model
      ? { scope: 'laser-model', score: 200 }
      : null;
  }
  if (candidate.opticalPowerW !== undefined) {
    return candidate.opticalPowerW === device.laserSubProfile?.opticalPowerW
      ? { scope: 'optical-power', score: 100 }
      : null;
  }
  return { scope: 'generic', score: 0 };
}

function confidenceScore(confidence: MaterialRecipeConfidence): number {
  if (confidence === 'calibrated') return 30;
  if (confidence === 'imported') return 20;
  if (confidence === 'starter') return 10;
  return -1000;
}

function warningsFor(
  candidate: MaterialRecipeCandidate,
  confidence: MaterialRecipeConfidence,
): ReadonlyArray<string> {
  const warnings: string[] = [];
  if (confidence === 'unsupported') warnings.push('Unsupported recipe.');
  if (candidate.warning !== undefined && candidate.warning.trim().length > 0) {
    warnings.push(candidate.warning);
  }
  return warnings;
}

function stringMatches(
  candidateValue: string | undefined,
  queryValue: string | undefined,
): boolean {
  if (candidateValue === undefined || queryValue === undefined) return true;
  return normalizeString(candidateValue) === normalizeString(queryValue);
}

function operationMatches(
  candidateValue: MaterialRecipeOperation | undefined,
  queryValue: MaterialRecipeOperation | undefined,
): boolean {
  return candidateValue === undefined || queryValue === undefined || candidateValue === queryValue;
}

function thicknessMatches(
  candidateValue: number | undefined,
  queryValue: number | undefined,
): boolean {
  if (candidateValue === undefined || queryValue === undefined) return true;
  return Math.abs(candidateValue - queryValue) <= 0.001;
}

function normalizeString(value: string): string {
  return value.trim().toLowerCase();
}
