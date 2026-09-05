import { createLayer, type Layer, type Project } from '../../core/scene';
import { createProject } from '../../core/scene/project';
import { colorForCutIndex, importLbrnGeometry } from './lbrn-geometry';

// MAX_XML_DEPTH is an integrity bound, not a policy cap: unbounded nesting
// overflows the recursive walker. It stays. The former 20 MB byte ceiling and
// 50 000 shape ceiling were policy caps and are gone (rule 7 / ADR-228) — the
// UI advises on size at the picker instead.
const MAX_XML_DEPTH = 64;

export type LbrnImportReport = {
  readonly sourceName: string;
  readonly appVersion?: string;
  readonly formatVersion?: string;
  readonly importedObjects: number;
  readonly importedLayers: number;
  readonly unsupportedShapeTypes: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

export type LbrnImportResult =
  | { readonly ok: true; readonly project: Project; readonly report: LbrnImportReport }
  | { readonly ok: false; readonly reason: string };

export function importLightBurnProject(
  xmlText: string,
  sourceName: string,
  parseXml: (text: string) => Document = defaultParseXml,
): LbrnImportResult {
  if (!/\.lbrn2?$/i.test(sourceName))
    return { ok: false, reason: 'Expected a .lbrn or .lbrn2 project.' };
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlText)) {
    return { ok: false, reason: 'Active XML declarations are not allowed.' };
  }
  return importLightBurnProjectDocument(parseXml(xmlText), sourceName);
}

export function importLightBurnProjectDocument(
  document: Document,
  sourceName: string,
): LbrnImportResult {
  if (!/\.lbrn2?$/i.test(sourceName))
    return { ok: false, reason: 'Expected a .lbrn or .lbrn2 project.' };
  const root = document.documentElement;
  if (
    root === null ||
    document.querySelector('parsererror') !== null ||
    normalized(root.tagName) !== 'lightburnproject'
  ) {
    return { ok: false, reason: 'File is not a valid LightBurn project XML document.' };
  }
  if (xmlDepth(root) > MAX_XML_DEPTH)
    return { ok: false, reason: 'LightBurn XML nesting is too deep.' };
  const geometry = importLbrnGeometry(root, sourceName);
  if (geometry.objects.length === 0) {
    return { ok: false, reason: 'LightBurn project contains no supported vector geometry.' };
  }
  const layerImport = importedLayers(
    root,
    geometry.objects.flatMap((object) => object.paths.map((path) => path.color)),
  );
  const layers = layerImport.layers;
  const operationIdByColor = new Map(layers.map((operation) => [operation.color, operation.id]));
  const objects = geometry.objects.map((object) => ({
    ...object,
    paths: object.paths.map((path) => {
      const operationId = operationIdByColor.get(path.color);
      return operationId === undefined ? path : { ...path, operationIds: [operationId] };
    }),
  }));
  const base = createProject();
  const project: Project = {
    ...base,
    scene: { ...base.scene, objects, layers },
  };
  return {
    ok: true,
    project,
    report: {
      sourceName,
      ...optionalAttribute(root, 'AppVersion', 'appVersion'),
      ...optionalAttribute(root, 'FormatVersion', 'formatVersion'),
      importedObjects: geometry.objects.length,
      importedLayers: layers.length,
      unsupportedShapeTypes: geometry.unsupportedShapeTypes,
      warnings: [...geometry.warnings, ...layerImport.warnings],
    },
  };
}

function importedLayers(
  root: Element,
  usedColors: ReadonlyArray<string>,
): { readonly layers: Layer[]; readonly warnings: ReadonlyArray<string> } {
  const settings = new Map<number, Element>();
  for (const element of [...root.children]) {
    if (normalized(element.tagName) !== 'cutsetting') continue;
    const index = numericField(element, ['index']);
    if (index !== null) settings.set(Math.trunc(index), element);
  }
  const colors = [...new Set(usedColors)];
  const warnings: string[] = [];
  const layers = colors.map((color) => importedLayer(color, settings, warnings));
  return { layers, warnings: [...new Set(warnings)].sort() };
}

function importedLayer(
  color: string,
  settings: ReadonlyMap<number, Element>,
  warnings: string[],
): Layer {
  const index = findColorIndex(color);
  const setting = settings.get(index);
  const importedName = setting === undefined ? '' : textField(setting, ['name', 'label']).trim();
  const name =
    importedName ||
    (index >= 0 ? `LightBurn C${index.toString().padStart(2, '0')}` : `Imported ${color}`);
  const base = createLayer({ id: color, name, color });
  if (setting === undefined) return base;
  const mode = textField(setting, ['type', 'mode']).toLowerCase();
  const isScan = mode.includes('scan') || mode.includes('fill');
  if (isScan) {
    const overscan = numericField(setting, ['overscan']);
    const speedMmSec = numericField(setting, ['speed', 'speedmmsec']);
    warnings.push(...unsupportedScanSettingWarnings(setting, name, overscan, speedMmSec));
  }
  return {
    ...base,
    mode: isScan ? 'fill' : 'line',
    ...importedCommonLayerFields(setting),
    ...(isScan ? importedScanLayerFields(setting) : {}),
  };
}

function importedCommonLayerFields(setting: Element): Partial<Layer> {
  const speedMmSec = numericField(setting, ['speed', 'speedmmsec']);
  const power = numericField(setting, ['maxpower', 'power']);
  const passes = numericField(setting, ['numpasses', 'passes']);
  return {
    ...(speedMmSec === null ? {} : { speed: Math.max(1, speedMmSec * 60) }),
    ...(power === null ? {} : { power: Math.max(0, Math.min(100, power)) }),
    ...(passes === null ? {} : { passes: Math.max(1, Math.round(passes)) }),
  };
}

function importedScanLayerFields(setting: Element): Partial<Layer> {
  const intervalMm = numericField(setting, ['interval', 'lineinterval']);
  const angleDeg = numericField(setting, ['scanangle', 'angle']);
  const crossHatch = booleanField(setting, ['crosshatch']);
  const bidirectional = booleanField(setting, ['bidirectional', 'bidir']);
  const overscan = numericField(setting, ['overscan']);
  const speedMmSec = numericField(setting, ['speed', 'speedmmsec']);
  const fixedOverscanMm = lightBurnOverscanMm(overscan, speedMmSec);
  return {
    ...(intervalMm !== null && intervalMm > 0 ? { hatchSpacingMm: intervalMm } : {}),
    ...(angleDeg === null ? {} : { hatchAngleDeg: angleDeg }),
    ...(crossHatch === null ? {} : { fillCrossHatch: crossHatch }),
    ...(bidirectional === null ? {} : { fillBidirectional: bidirectional }),
    ...(fixedOverscanMm === null ? {} : { fillOverscanMm: fixedOverscanMm }),
  };
}

function lightBurnOverscanMm(
  overscanPercent: number | null,
  speedMmSec: number | null,
): number | null {
  if (overscanPercent === null) return null;
  if (overscanPercent === 0) return 0;
  if (speedMmSec === null || speedMmSec <= 0) return null;
  return Math.max(0, (speedMmSec * overscanPercent) / 100);
}

function unsupportedScanSettingWarnings(
  setting: Element,
  layerName: string,
  overscan: number | null,
  speedMmSec: number | null,
): ReadonlyArray<string> {
  const warnings: string[] = [];
  if (overscan !== null && overscan !== 0) {
    const fixedMm = lightBurnOverscanMm(overscan, speedMmSec);
    warnings.push(
      fixedMm === null
        ? `${layerName}: LightBurn Scan overscan ${overscan}% could not be converted without a positive imported speed; review the default 5 mm runway.`
        : `${layerName}: LightBurn Scan overscan ${overscan}% was converted to ${fixedMm} mm at ${speedMmSec} mm/s; review it after changing speed because LaserForge stores a fixed physical runway.`,
    );
  }
  const supported = new Set([
    'index',
    'name',
    'label',
    'type',
    'mode',
    'speed',
    'speedmmsec',
    'maxpower',
    'minpower',
    'minpower2',
    'power',
    'numpasses',
    'passes',
    'interval',
    'lineinterval',
    'scanangle',
    'angle',
    'crosshatch',
    'bidirectional',
    'bidir',
    'overscan',
  ]);
  for (const field of directFields(setting)) {
    if (supported.has(field.name) || !meaningfulLightBurnValue(field.value)) continue;
    warnings.push(
      `${layerName}: unsupported LightBurn Scan field “${field.name}” was not imported.`,
    );
  }
  const minPower = numericField(setting, ['minpower', 'minpower2']);
  if (minPower !== null && minPower !== 0) {
    warnings.push(
      `${layerName}: LightBurn Scan minimum power is not equivalent to LaserForge image grayscale minimum power and was not imported.`,
    );
  }
  return warnings;
}

function directFields(
  element: Element,
): ReadonlyArray<{ readonly name: string; readonly value: string }> {
  return [
    ...[...element.attributes].map((attribute) => ({
      name: normalized(attribute.name),
      value: attribute.value,
    })),
    ...[...element.children].map((child) => ({
      name: normalized(child.tagName),
      value: child.getAttribute('Value') ?? child.textContent ?? '',
    })),
  ];
}

function meaningfulLightBurnValue(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'false' || trimmed === 'off' || trimmed === 'none')
    return false;
  const numeric = Number(trimmed);
  return !Number.isFinite(numeric) || numeric !== 0;
}

function booleanField(element: Element, names: ReadonlyArray<string>): boolean | null {
  const value = textField(element, names).trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes') return true;
  if (value === '0' || value === 'false' || value === 'no') return false;
  return null;
}

function numericField(element: Element, names: ReadonlyArray<string>): number | null {
  return finiteNumber(textField(element, names));
}

function textField(element: Element, names: ReadonlyArray<string>): string {
  const allowed = new Set(names.map(normalized));
  for (const attribute of [...element.attributes]) {
    if (allowed.has(normalized(attribute.name))) return attribute.value;
  }
  for (const child of [...element.querySelectorAll('*')]) {
    if (allowed.has(normalized(child.tagName)))
      return child.getAttribute('Value') ?? child.textContent ?? '';
  }
  return '';
}

function optionalAttribute<K extends string>(
  element: Element,
  attribute: string,
  key: K,
): Partial<Record<K, string>> {
  const value = element.getAttribute(attribute);
  return value === null ? {} : ({ [key]: value } as Partial<Record<K, string>>);
}

function findColorIndex(color: string): number {
  for (let index = 0; index < 256; index += 1) if (colorForCutIndex(index) === color) return index;
  return -1;
}

function finiteNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function xmlDepth(element: Element): number {
  let max = 0;
  for (const child of [...element.children]) max = Math.max(max, xmlDepth(child));
  return 1 + max;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function defaultParseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}
