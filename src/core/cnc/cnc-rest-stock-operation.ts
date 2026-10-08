import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
} from '../scene';
import type { CncRestPocketOperation } from './cnc-rest-operation';
import { pocketToolpathsForSettingsWithEvidence } from './cnc-pocket-toolpaths';
import type { PocketToolpaths } from './pocket-paths';
import { predictCnc2dStock, type Cnc2dStockEvidence } from './cnc-pocket-stock';
import { normalizeCncPocketRestStock } from './cnc-pocket-rest-stock-settings';
import { planRestPocketResidualToolpaths } from './rest-pocket';

type RestOk = Extract<CncRestPocketOperation, { readonly kind: 'ok' }>;

export function resolveStockAwareRestPocket(
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): CncRestPocketOperation {
  const rough = config.tools.find((tool) => tool.id === settings.pocketRoughToolId);
  const finish = layerCncTool(config, settings);
  if (rough?.kind !== 'end-mill')
    return fullPocketFallback(
      contours,
      settings,
      rough ?? finish,
      finish,
      'The stock source roughing cutter is missing, unselected or is not a flat end mill.',
    );
  const issue = sourceIssue(settings, rough, finish);
  if (issue !== null) return fullPocketFallback(contours, settings, rough, finish, issue);
  const roughing = pocketToolpathsForSettingsWithEvidence(contours, settings, rough);
  if (roughing.toolpaths.length === 0)
    return fullPocketFallback(
      contours,
      settings,
      rough,
      finish,
      'The previous cutter has no executable roughing routes in this source.',
    );
  const source = normalizeCncPocketRestStock(settings.pocketRestStock);
  if (source === undefined)
    return fullPocketFallback(
      contours,
      settings,
      rough,
      finish,
      'The retained stock source is invalid.',
    );
  const stock = predictCnc2dStock(
    contours,
    roughing.toolpaths,
    rough,
    settings.depthMm,
    source.toleranceMm,
  );
  if (!stock.ok) return fullPocketFallback(contours, settings, rough, finish, stock.reason);
  const rest = planRestPocketResidualToolpaths(
    contours,
    stock.residualContours,
    finish.diameterMm,
    settings.stepoverPercent,
  );
  if (!rest.ok) return fullPocketFallback(contours, settings, rough, finish, rest.reason);
  return stockAwareResult(
    rough,
    finish,
    roughing,
    rest.toolpaths,
    rest.completion,
    rest.stepoverUsed,
    stock.evidence,
  );
}

function sourceIssue(settings: CncLayerSettings, rough: CncTool, finish: CncTool): string | null {
  const source = normalizeCncPocketRestStock(settings.pocketRestStock);
  if (source === undefined) return 'The retained previous-stock source is invalid.';
  if (source.previousToolId !== rough.id || source.previousToolDiameterMm !== rough.diameterMm)
    return 'The previous-stock cutter changed. Review and rebind the stock source to regenerate residuals.';
  if (finish.kind !== 'end-mill' || rough.diameterMm <= finish.diameterMm)
    return 'This stock-aware rest model requires a smaller flat finishing end mill.';
  if (
    settings.pocketStrategy === 'adaptive' ||
    settings.helixEntry !== undefined ||
    (settings.rampEntryDeg ?? 0) > 0
  )
    return 'Previous-route stock currently supports constant-Z offset or raster roughing without adaptive, helix or ramp entry.';
  return null;
}

function stockAwareResult(
  rough: CncTool,
  finish: CncTool,
  roughing: PocketToolpaths,
  restPaths: ReadonlyArray<Polyline>,
  completion: RestOk['completion'],
  stepoverUsed: boolean,
  stock: Cnc2dStockEvidence,
): RestOk {
  return {
    kind: 'ok',
    roughTool: rough,
    finishTool: finish,
    roughToolpaths: roughing.toolpaths,
    restToolpaths: restPaths,
    roughingOffsetFailed: roughing.offsetFailed,
    roughingPassLimited: roughing.passLimited,
    offsetFailed: roughing.offsetFailed || completion === 'geometry-failed',
    passLimited: roughing.passLimited || completion === 'pass-limit',
    stepoverUsed: roughing.stepoverUsed || stepoverUsed,
    completion,
    stockEvidence: stock,
    findings: [
      `Rest stock is predicted from ${rough.name} final-depth routes at ${stock.depthMm} mm, with ${stock.toleranceMm} mm conservative sweep tolerance. Entry/link extra clearance is excluded; actual stock is unmeasured.`,
      ...(roughing.offsetFailed || roughing.passLimited
        ? [
            'Previous roughing coverage is incomplete; the finishing target retains every area absent from the supplied routes.',
          ]
        : []),
    ],
  };
}

function fullPocketFallback(
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  rough: CncTool,
  finish: CncTool,
  reason: string,
): RestOk {
  const paths = pocketToolpathsForSettingsWithEvidence(
    contours,
    { ...settings, pocketStrategy: 'offset' },
    finish,
  );
  return {
    kind: 'ok',
    roughTool: rough,
    finishTool: finish,
    roughToolpaths: [],
    restToolpaths: paths.toolpaths,
    roughingOffsetFailed: false,
    roughingPassLimited: false,
    offsetFailed: paths.offsetFailed,
    passLimited: paths.passLimited,
    stepoverUsed: paths.stepoverUsed,
    completion: paths.offsetFailed
      ? 'geometry-failed'
      : paths.passLimited
        ? 'pass-limit'
        : 'complete',
    findings: [`Full offset-pocket fallback: ${reason} No previous-stock subtraction is used.`],
  };
}
