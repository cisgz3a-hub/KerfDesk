import type { CncLayerSettings, CncTool } from '../scene';
import type {
  CncCuttingContext,
  CncCuttingPreset,
  CncCuttingToolContext,
  CncCuttingValues,
} from '../scene/cnc-cutting-preset';

export const CNC_CUTTING_VALUE_KEYS = [
  'feedMmPerMin',
  'plungeMmPerMin',
  'spindleRpm',
  'depthPerPassMm',
  'stepoverPercent',
] as const satisfies ReadonlyArray<keyof CncCuttingValues>;

export type CncCuttingDifference = {
  readonly key: keyof CncCuttingValues;
  readonly current: number;
  readonly saved: number;
};

export type CncCuttingPresetPreview = {
  readonly compatible: boolean;
  readonly contextFindings: ReadonlyArray<string>;
  readonly evidenceFindings: ReadonlyArray<string>;
  readonly differences: ReadonlyArray<CncCuttingDifference>;
};

export function cncCuttingToolContext(tool: CncTool): CncCuttingToolContext {
  return {
    id: tool.id,
    name: tool.name,
    kind: tool.kind,
    diameterMm: tool.diameterMm,
    ...(tool.tipAngleDeg === undefined ? {} : { tipAngleDeg: tool.tipAngleDeg }),
    ...(tool.tipDiameterMm === undefined ? {} : { tipDiameterMm: tool.tipDiameterMm }),
    ...(tool.family === undefined ? {} : { family: tool.family }),
    ...(tool.fluteCount === undefined ? {} : { fluteCount: tool.fluteCount }),
  };
}

export function cncCuttingValues(settings: CncCuttingValues): CncCuttingValues {
  return {
    feedMmPerMin: settings.feedMmPerMin,
    plungeMmPerMin: settings.plungeMmPerMin,
    spindleRpm: settings.spindleRpm,
    depthPerPassMm: settings.depthPerPassMm,
    stepoverPercent: settings.stepoverPercent,
  };
}

export function cncCuttingPresetDifferences(
  preset: CncCuttingPreset,
  settings: CncCuttingValues,
): ReadonlyArray<CncCuttingDifference> {
  return CNC_CUTTING_VALUE_KEYS.filter((key) => preset[key] !== settings[key]).map((key) => ({
    key,
    current: settings[key],
    saved: preset[key],
  }));
}

/** Tool IDs/names are descriptive; cutter geometry and flute/family identity govern reuse. */
export function previewCncCuttingPreset(
  preset: CncCuttingPreset,
  settings: CncCuttingValues,
  current: CncCuttingContext | null,
): CncCuttingPresetPreview {
  const contextFindings = contextCompatibility(preset.context, current);
  return {
    compatible: contextFindings.length === 0,
    contextFindings,
    evidenceFindings: cuttingEvidenceFindings(preset),
    differences: cncCuttingPresetDifferences(preset, settings),
  };
}

function contextCompatibility(
  saved: CncCuttingContext | undefined,
  current: CncCuttingContext | null,
): ReadonlyArray<string> {
  if (saved === undefined) return ['This unbound record has no tool, material or machine binding.'];
  if (current === null) return ['Choose a CNC machine and material to compare this record.'];
  const findings: string[] = [];
  if (!sameCuttingTool(saved.tool, current.tool)) {
    findings.push(
      `Cutter differs: saved ${saved.tool.name} (${saved.tool.diameterMm} mm), current ${current.tool.name} (${current.tool.diameterMm} mm).`,
    );
  }
  if (saved.materialKey !== current.materialKey) {
    findings.push(`Material differs: saved ${saved.materialKey}, current ${current.materialKey}.`);
  }
  if (!sameCuttingMachine(saved.machine, current.machine)) {
    findings.push(
      `Machine context differs: saved ${saved.machine.name}, current ${current.machine.name}.`,
    );
  }
  return findings;
}

function sameCuttingTool(a: CncCuttingToolContext, b: CncCuttingToolContext): boolean {
  return (
    a.kind === b.kind &&
    a.diameterMm === b.diameterMm &&
    a.tipAngleDeg === b.tipAngleDeg &&
    a.tipDiameterMm === b.tipDiameterMm &&
    a.family === b.family &&
    a.fluteCount === b.fluteCount
  );
}

function sameCuttingMachine(
  a: CncCuttingContext['machine'],
  b: CncCuttingContext['machine'],
): boolean {
  return (
    a.profileId === b.profileId &&
    a.name === b.name &&
    a.controllerKind === b.controllerKind &&
    a.spindleMaxRpm === b.spindleMaxRpm &&
    a.maxFeedMmPerMin === b.maxFeedMmPerMin
  );
}

function cuttingEvidenceFindings(preset: CncCuttingPreset): ReadonlyArray<string> {
  const findings: string[] = [];
  if (preset.provenance === undefined || preset.provenance.reference.trim() === '') {
    findings.push('No source reference is recorded.');
  }
  if (preset.qualification?.status !== 'operator-qualified') {
    findings.push('No operator material-cut qualification is recorded for this context.');
  } else if (preset.qualification.notes.trim() === '') {
    findings.push('Operator qualification has no supporting notes.');
  }
  return findings;
}

/** Explicit Apply copies values once. Later edits never read live library values. */
export function cncCuttingPresetPatch(preset: CncCuttingPreset): Partial<CncLayerSettings> {
  return { ...cncCuttingValues(preset), cuttingPreset: preset };
}
