import type { DeviceProfile, LaserTechnology } from '../devices';

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
  | 'laser-head'
  | 'optical-power'
  | 'generic';

export type MaterialRecipeCandidate = {
  readonly id: string;
  readonly profileId?: string;
  readonly machineFamily?: string;
  readonly laserModel?: string;
  readonly laserTechnology?: LaserTechnology;
  readonly opticalPowerW?: number;
  readonly wavelengthNm?: number;
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
    warnings: warningsFor(candidate, confidence, scope.scope),
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
  const headScope = laserHeadScope(device, candidate);
  if (headScope !== undefined) return headScope;
  if (candidate.opticalPowerW !== undefined) {
    return candidate.opticalPowerW === device.laserSubProfile?.opticalPowerW
      ? { scope: 'optical-power', score: 100 }
      : null;
  }
  return { scope: 'generic', score: 0 };
}

function laserHeadScope(
  device: DeviceProfile,
  candidate: MaterialRecipeCandidate,
): { readonly scope: MaterialRecipeMatchScope; readonly score: number } | null | undefined {
  const hasHeadCriteria =
    candidate.laserTechnology !== undefined || candidate.wavelengthNm !== undefined;
  if (!hasHeadCriteria) return undefined;
  const head = device.laserSubProfile;
  if (head === undefined) return null;
  if (candidate.laserTechnology !== undefined && candidate.laserTechnology !== head.technology) {
    return null;
  }
  if (candidate.wavelengthNm !== undefined) {
    if (head.wavelengthNm === undefined) return null;
    if (!wavelengthCompatible(head.wavelengthNm, candidate.wavelengthNm)) return null;
  }
  if (candidate.opticalPowerW !== undefined) {
    if (head.opticalPowerW === undefined) return null;
    if (!opticalPowerCompatible(head.opticalPowerW, candidate.opticalPowerW)) return null;
  }
  return { scope: 'laser-head', score: 150 };
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
  scope: MaterialRecipeMatchScope,
): ReadonlyArray<string> {
  const warnings: string[] = [];
  if (confidence === 'unsupported') warnings.push('Unsupported recipe.');
  if (scope === 'laser-head') {
    warnings.push('Matched by laser head class. Run a material test before production.');
  }
  if (candidate.warning !== undefined && candidate.warning.trim().length > 0) {
    warnings.push(candidate.warning);
  }
  return warnings;
}

function wavelengthCompatible(deviceNm: number, recipeNm: number): boolean {
  return Math.abs(deviceNm - recipeNm) <= 10;
}

function opticalPowerCompatible(devicePowerW: number, recipePowerW: number): boolean {
  return Math.abs(devicePowerW - recipePowerW) <= Math.max(1, devicePowerW * 0.15);
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
