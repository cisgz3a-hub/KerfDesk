import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  createLayer,
  nextOperationColor,
  type ImportedSvg,
  type Layer,
  type Project,
} from '../../core/scene';
import { createProject } from '../../core/scene/project';
import { lightBurnSceneFrame } from './lbrn-frame';
import { colorForCutIndex, importLbrnGeometry } from './lbrn-geometry';
import { resolveLightBurnOverscan } from './lbrn-overscan';

// MAX_XML_DEPTH is an integrity bound, not a policy cap: unbounded nesting
// overflows the recursive walker. It stays. The former 20 MB byte ceiling and
// 50 000 shape ceiling were policy caps and are gone (rule 7 / ADR-228) — the
// UI advises on size at the picker instead.
const MAX_XML_DEPTH = 64;
// The range the Kerf Offset field takes (CutSettingsCommonFields).
const KERF_OFFSET_LIMIT_MM = 10;

type LayerKind = 'line' | 'fill' | 'fill+line';
// A CutSetting's `type` is LightBurn's layer mode: Line is "Cut", Fill is
// "Scan" and Fill+Line is "Scan+Cut" (ADR-388).
const LIGHTBURN_LAYER_KINDS: ReadonlyMap<string, LayerKind> = new Map([
  ['cut', 'line'],
  ['scan', 'fill'],
  ['scan+cut', 'fill+line'],
]);

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

// A LightBurn project carries no KerfDesk machine, so it opens on `device`:
// the machine already open in KerfDesk, as when opening any artwork (ADR-388).
// Its bed also places the project (lightBurnSceneFrame).
export function importLightBurnProject(
  xmlText: string,
  sourceName: string,
  parseXml: (text: string) => Document = defaultParseXml,
  device: DeviceProfile = DEFAULT_DEVICE_PROFILE,
): LbrnImportResult {
  if (!/\.lbrn2?$/i.test(sourceName))
    return { ok: false, reason: 'Expected a .lbrn or .lbrn2 project.' };
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlText)) {
    return { ok: false, reason: 'Active XML declarations are not allowed.' };
  }
  return importLightBurnProjectDocument(parseXml(xmlText), sourceName, device);
}

export function importLightBurnProjectDocument(
  document: Document,
  sourceName: string,
  device: DeviceProfile = DEFAULT_DEVICE_PROFILE,
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
  const base = createProject(device);
  const frame = lightBurnSceneFrame(root, {
    width: base.device.bedWidth,
    height: base.device.bedHeight,
  });
  const geometry = importLbrnGeometry(root, sourceName, frame);
  if (geometry.objects.length === 0) {
    return { ok: false, reason: 'LightBurn project contains no supported vector geometry.' };
  }
  const layerImport = importedLayers(
    root,
    geometry.objects.flatMap((object) => object.paths.map((path) => path.color)),
  );
  const layers = layerImport.layers;
  const objects = geometry.objects.map((object) => ({
    ...object,
    paths: object.paths.map((path) => {
      const operationIds = layerImport.operationIdsByColor.get(path.color);
      return operationIds === undefined ? path : { ...path, operationIds };
    }),
  }));
  const project: Project = {
    ...base,
    scene: {
      ...base.scene,
      objects,
      layers,
      artworkOrder: layerByLayerArtworkOrder(objects, layers),
    },
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
      warnings: [...geometry.warnings, ...layerImport.warnings, ...cutPlannerWarnings(root)],
    },
  };
}

function importedLayers(
  root: Element,
  usedColors: ReadonlyArray<string>,
): {
  readonly layers: Layer[];
  readonly operationIdsByColor: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly warnings: ReadonlyArray<string>;
} {
  const settings = new Map<number, Element>();
  for (const element of [...root.children]) {
    if (normalized(element.tagName) !== 'cutsetting') continue;
    const index = numericField(element, ['index']);
    if (index !== null) settings.set(Math.trunc(index), element);
  }
  const colors = [...new Set(usedColors)]
    .map((color) => ({ color, rank: lightBurnLayerRank(color, settings) }))
    .sort((left, right) => left.rank[0] - right.rank[0] || left.rank[1] - right.rank[1])
    .map((entry) => entry.color);
  const warnings: string[] = [];
  const imported = colors.map((color) => importedLayer(color, settings, warnings));
  const layers: Layer[] = [];
  const operationIdsByColor = new Map<string, ReadonlyArray<string>>();
  for (const { layer, outline } of imported) {
    layers.push(layer);
    if (outline === null) {
      operationIdsByColor.set(layer.color, [layer.id]);
      continue;
    }
    // Fill+Line fills the shapes, then cuts their outlines: a Line operation
    // on the same artwork, listed right after the fill so it runs second.
    const color = nextOperationColor([...imported.map((entry) => entry.layer), ...layers]);
    const line = {
      ...createLayer({ id: `${layer.id}-line`, name: `${layer.name} (Line)`, color }),
      ...outline,
    };
    layers.push(line);
    operationIdsByColor.set(layer.color, [layer.id, line.id]);
  }
  return { layers, operationIdsByColor, warnings: [...new Set(warnings)].sort() };
}

// LightBurn runs a project layer by layer in its Cuts / Layers list order,
// which each CutSetting records as `priority`, then by index. A layer written
// without a priority keeps its index's place (ADR-388).
function lightBurnLayerRank(
  color: string,
  settings: ReadonlyMap<number, Element>,
): readonly [number, number] {
  const index = findColorIndex(color);
  const setting = settings.get(index);
  const priority = setting === undefined ? null : numericField(setting, ['priority']);
  return [priority ?? index, index];
}

// The Cut Planner in LightBurn's Optimization Settings ranks its orderings,
// 0 first; KerfDesk always runs a LightBurn project layer by layer.
function cutPlannerWarnings(root: Element): ReadonlyArray<string> {
  const prefs = [...root.children].find((child) => normalized(child.tagName) === 'uiprefs');
  const byLayer = prefs === undefined ? '' : textField(prefs, ['optimizebylayer']).trim();
  if (byLayer === '' || byLayer === '0') return [];
  return [
    `LightBurn's Cut Planner for this project does not run layers first (Optimize_ByLayer ${byLayer}); KerfDesk runs it layer by layer in the Cuts / Layers order. Check the Run order view.`,
  ];
}

// Artwork priority decides which operation runs first (ADR-211), so artwork
// is ordered by its layer's place in the list, drawing order within a layer.
// The canvas stacking (`objects`) keeps LightBurn's drawing order.
function layerByLayerArtworkOrder(
  objects: ReadonlyArray<ImportedSvg>,
  layers: ReadonlyArray<Layer>,
): string[] {
  const position = new Map(layers.map((layer, index) => [layer.id, index]));
  return objects
    .map((object, drawn) => ({
      id: object.id,
      drawn,
      layer: position.get(object.paths[0]?.operationIds?.[0] ?? '') ?? layers.length,
    }))
    .sort((left, right) => left.layer - right.layer || left.drawn - right.drawn)
    .map((entry) => entry.id);
}

/** A layer, and for Fill+Line the settings of the Line operation that follows it. */
function importedLayer(
  color: string,
  settings: ReadonlyMap<number, Element>,
  warnings: string[],
): { readonly layer: Layer; readonly outline: Partial<Layer> | null } {
  const index = findColorIndex(color);
  const setting = settings.get(index);
  const importedName = setting === undefined ? '' : textField(setting, ['name', 'label']).trim();
  const name =
    importedName ||
    (index >= 0 ? `LightBurn C${index.toString().padStart(2, '0')}` : `Imported ${color}`);
  const base = createLayer({ id: color, name, color });
  if (setting === undefined) return { layer: base, outline: null };
  const kind = lightBurnLayerKind(setting, name, warnings);
  const common = importedCommonLayerFields(setting);
  const line = (): Partial<Layer> => ({
    mode: 'line',
    ...common,
    ...importedKerf(setting, name, warnings),
  });
  if (kind === 'line') return { layer: { ...base, ...line() }, outline: null };
  const fill: Layer = { ...base, mode: 'fill', ...common };
  return {
    layer: { ...fill, ...importedScanSettings(setting, name, kind, warnings) },
    outline: kind === 'fill+line' ? line() : null,
  };
}

// A setting without a type keeps LightBurn's default mode, Line. A type
// KerfDesk has no operation for is named, and opens as Line to be reviewed.
function lightBurnLayerKind(setting: Element, name: string, warnings: string[]): LayerKind {
  const type = textField(setting, ['type', 'mode']).trim();
  const kind = LIGHTBURN_LAYER_KINDS.get(type.toLowerCase());
  if (kind !== undefined) return kind;
  if (type !== '') {
    warnings.push(
      `${name}: LightBurn layer mode “${type}” has no KerfDesk equivalent, so it opened as a Line operation. Check its settings before cutting.`,
    );
  }
  return 'line';
}

// LightBurn's Kerf Offset moves a Cut layer's closed shapes out by the offset
// and the holes inside them in, as KerfDesk's Kerf Offset does (ADR-486), so it
// opens as the layer's own. One the field cannot hold is named, never dropped
// (ADR-388).
function importedKerf(setting: Element, name: string, warnings: string[]): Partial<Layer> {
  const text = textField(setting, ['kerf']).trim();
  const kerf = finiteNumber(text);
  if (kerf !== null && Math.abs(kerf) <= KERF_OFFSET_LIMIT_MM)
    return kerf === 0 ? {} : { kerfOffsetMm: kerf };
  if (text !== '') {
    const problem =
      kerf === null
        ? 'is not a number'
        : `is outside KerfDesk's Kerf Offset range (-${KERF_OFFSET_LIMIT_MM} to ${KERF_OFFSET_LIMIT_MM} mm)`;
    warnings.push(
      `${name}: LightBurn kerf offset “${text}” ${problem} and was not imported. Set this layer's Kerf Offset before cutting.`,
    );
  }
  return {};
}

function importedScanSettings(
  setting: Element,
  name: string,
  kind: LayerKind,
  warnings: string[],
): Partial<Layer> {
  const overscan = resolveLightBurnOverscan(
    booleanField(setting, ['overscan']),
    numericField(setting, ['overscanpercent']),
    numericField(setting, ['speed', 'speedmmsec']),
    name,
  );
  // Fill+Line's kerf opens on its Line operation.
  const imported = kind === 'fill+line' ? ['kerf'] : [];
  warnings.push(...unsupportedScanSettingWarnings(setting, name, imported), ...overscan.warnings);
  return {
    ...importedScanLayerFields(setting),
    ...(overscan.distanceMm === null ? {} : { fillOverscanMm: overscan.distanceMm }),
  };
}

function importedCommonLayerFields(setting: Element): Partial<Layer> {
  const speedMmSec = numericField(setting, ['speed', 'speedmmsec']);
  const power = numericField(setting, ['maxpower', 'power']);
  const passes = numericField(setting, ['numpasses', 'passes']);
  // LightBurn writes a layer's Air Assist as `runBlower`.
  const airAssist = booleanField(setting, ['runblower']);
  return {
    ...(speedMmSec === null ? {} : { speed: Math.max(1, speedMmSec * 60) }),
    ...(power === null ? {} : { power: Math.max(0, Math.min(100, power)) }),
    ...(passes === null ? {} : { passes: Math.max(1, Math.round(passes)) }),
    ...(airAssist === null ? {} : { airAssist }),
  };
}

function importedScanLayerFields(setting: Element): Partial<Layer> {
  const intervalMm = numericField(setting, ['interval', 'lineinterval']);
  const angleDeg = numericField(setting, ['scanangle', 'angle']);
  const crossHatch = booleanField(setting, ['crosshatch']);
  const bidirectional = booleanField(setting, ['bidirectional', 'bidir']);
  return {
    ...(intervalMm !== null && intervalMm > 0 ? { hatchSpacingMm: intervalMm } : {}),
    ...(angleDeg === null ? {} : { hatchAngleDeg: angleDeg }),
    ...(crossHatch === null ? {} : { fillCrossHatch: crossHatch }),
    ...(bidirectional === null ? {} : { fillBidirectional: bidirectional }),
  };
}

function unsupportedScanSettingWarnings(
  setting: Element,
  layerName: string,
  alsoImported: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const warnings: string[] = [];
  const supported = new Set([
    ...alsoImported,
    'index',
    'name',
    'label',
    'type',
    'mode',
    'priority',
    'runblower',
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
    'overscanpercent',
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
