import type { PlanStats } from '../core/plan/Plan';
import type { Layer } from '../core/scene/Layer';
import type { Scene } from '../core/scene/Scene';

export type JobComplexityLevel = 'Low' | 'Medium' | 'High';

export type JobComplexityWarningKind =
  | 'dense-raster'
  | 'long-job'
  | 'high-command-count';

export interface JobComplexityWarning {
  kind: JobComplexityWarningKind;
  message: string;
}

export interface JobComplexitySummary {
  commandCount: number;
  commandCountLabel: string;
  estimatedTimeSeconds: number | null;
  estimatedTimeLabel: string | null;
  rasterDpiEquivalent: number | null;
  rasterDpiLabel: string | null;
  fillSpacingMm: number | null;
  fillSpacingLabel: string | null;
  travelDistanceMm: number | null;
  travelDistanceLabel: string | null;
  burnDistanceMm: number | null;
  burnDistanceLabel: string | null;
  complexity: JobComplexityLevel;
  warnings: readonly JobComplexityWarning[];
}

export interface BuildJobComplexitySummaryInput {
  gcodeText: string | null | undefined;
  commandCount?: number | null;
  estimatedTimeSeconds?: number | null;
  planStats?: Partial<PlanStats> | null;
  scene?: Scene | null;
}

const MEDIUM_COMMANDS = 20_000;
const HIGH_COMMANDS = 100_000;
const MEDIUM_TIME_SECONDS = 15 * 60;
const HIGH_TIME_SECONDS = 60 * 60;
const MEDIUM_DPI = 254;
const HIGH_DPI = 500;
const HIGH_FILL_SPACING_MM = 0.05;

export function buildJobComplexitySummary(
  input: BuildJobComplexitySummaryInput,
): JobComplexitySummary {
  const commandCount = finiteOrNull(input.commandCount) ?? countGcodeCommands(input.gcodeText);
  const estimatedTimeSeconds = resolveEstimatedTimeSeconds(input);
  const rasterProfile = summarizeRasterProfile(input.scene ?? null);
  const rasterDpiEquivalent = rasterProfile.rasterDpiEquivalent;
  const fillSpacingMm = rasterProfile.fillSpacingMm;
  const travelDistanceMm = finiteOrNull(input.planStats?.rapidDistanceMm);
  const burnDistanceMm = finiteOrNull(input.planStats?.cutDistanceMm);
  const warnings = buildWarnings({
    commandCount,
    estimatedTimeSeconds,
    rasterDpiEquivalent,
    fillSpacingMm,
  });

  return {
    commandCount,
    commandCountLabel: commandCount.toLocaleString('en-US'),
    estimatedTimeSeconds,
    estimatedTimeLabel: estimatedTimeSeconds == null ? null : formatDuration(estimatedTimeSeconds),
    rasterDpiEquivalent,
    rasterDpiLabel: rasterDpiEquivalent == null ? null : `${rasterDpiEquivalent} DPI equivalent`,
    fillSpacingMm,
    fillSpacingLabel: fillSpacingMm == null ? null : formatFillSpacing(fillSpacingMm),
    travelDistanceMm,
    travelDistanceLabel: travelDistanceMm == null ? null : formatDistance(travelDistanceMm),
    burnDistanceMm,
    burnDistanceLabel: burnDistanceMm == null ? null : formatDistance(burnDistanceMm),
    complexity: classifyComplexity({
      commandCount,
      estimatedTimeSeconds,
      rasterDpiEquivalent,
      fillSpacingMm,
    }),
    warnings,
  };
}

export function countGcodeCommands(gcodeText: string | null | undefined): number {
  if (!gcodeText) return 0;
  let count = 0;
  for (const line of gcodeText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith(';') || trimmed.startsWith('(') || trimmed === '%') continue;
    count++;
  }
  return count;
}

function resolveEstimatedTimeSeconds(input: BuildJobComplexitySummaryInput): number | null {
  const explicit = finiteOrNull(input.estimatedTimeSeconds);
  if (explicit != null) return explicit;
  return finiteOrNull(input.planStats?.estimatedTimeSeconds);
}

function summarizeRasterProfile(scene: Scene | null): {
  rasterDpiEquivalent: number | null;
  fillSpacingMm: number | null;
} {
  if (!scene) return { rasterDpiEquivalent: null, fillSpacingMm: null };

  const visibleObjectLayerIds = new Set(
    scene.objects
      .filter(object => object.visible)
      .map(object => object.layerId),
  );
  const candidateLayers = scene.layers.filter(layer =>
    layer.visible &&
    layer.output !== false &&
    visibleObjectLayerIds.has(layer.id) &&
    isRasterLikeLayer(layer),
  );

  let minFillSpacing: number | null = null;
  let maxDpi: number | null = null;
  for (const layer of candidateLayers) {
    const interval = finitePositiveOrNull(layer.settings.fill.interval);
    if (interval != null) {
      minFillSpacing = minFillSpacing == null ? interval : Math.min(minFillSpacing, interval);
      maxDpi = Math.max(maxDpi ?? 0, Math.round(25.4 / interval));
    }
    if (layer.settings.mode === 'image') {
      const imageDpi = finitePositiveOrNull(layer.settings.image.resolution);
      if (imageDpi != null) {
        maxDpi = Math.max(maxDpi ?? 0, Math.round(imageDpi));
      }
    }
  }

  return {
    rasterDpiEquivalent: maxDpi,
    fillSpacingMm: minFillSpacing,
  };
}

function isRasterLikeLayer(layer: Layer): boolean {
  return layer.settings.mode === 'image' ||
    (layer.settings.mode === 'engrave' && layer.settings.fill.enabled);
}

function classifyComplexity(input: {
  commandCount: number;
  estimatedTimeSeconds: number | null;
  rasterDpiEquivalent: number | null;
  fillSpacingMm: number | null;
}): JobComplexityLevel {
  if (
    input.commandCount >= HIGH_COMMANDS ||
    (input.estimatedTimeSeconds ?? 0) >= HIGH_TIME_SECONDS ||
    (input.rasterDpiEquivalent ?? 0) >= HIGH_DPI ||
    (input.fillSpacingMm != null && input.fillSpacingMm <= HIGH_FILL_SPACING_MM)
  ) {
    return 'High';
  }
  if (
    input.commandCount >= MEDIUM_COMMANDS ||
    (input.estimatedTimeSeconds ?? 0) >= MEDIUM_TIME_SECONDS ||
    (input.rasterDpiEquivalent ?? 0) >= MEDIUM_DPI
  ) {
    return 'Medium';
  }
  return 'Low';
}

function buildWarnings(input: {
  commandCount: number;
  estimatedTimeSeconds: number | null;
  rasterDpiEquivalent: number | null;
  fillSpacingMm: number | null;
}): JobComplexityWarning[] {
  const warnings: JobComplexityWarning[] = [];
  if (
    (input.rasterDpiEquivalent ?? 0) >= HIGH_DPI ||
    (input.fillSpacingMm != null && input.fillSpacingMm <= HIGH_FILL_SPACING_MM)
  ) {
    warnings.push({
      kind: 'dense-raster',
      message: 'Raster/fill spacing is very dense. Increasing spacing toward 0.10 mm can cut job time sharply.',
    });
  }
  if ((input.estimatedTimeSeconds ?? 0) >= HIGH_TIME_SECONDS) {
    warnings.push({
      kind: 'long-job',
      message: 'This is a long job. Confirm focus, hold-down, ventilation, and supervision before starting.',
    });
  }
  if (input.commandCount >= HIGH_COMMANDS) {
    warnings.push({
      kind: 'high-command-count',
      message: 'This job has a high G-code command count. Reduce raster density or simplify geometry if the controller stutters.',
    });
  }
  return warnings;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finitePositiveOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatFillSpacing(mm: number): string {
  return `${mm.toFixed(mm < 0.1 ? 3 : 2)} mm`;
}

function formatDistance(mm: number): string {
  const abs = Math.abs(mm);
  if (abs >= 1000) {
    return `${(mm / 1000).toFixed(1)} m`;
  }
  return `${Math.round(mm).toLocaleString('en-US')} mm`;
}
