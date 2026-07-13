import { createLayer, createProject, type Layer, type Project } from '../../core/scene';
import { colorForCutIndex, importLbrnGeometry } from './lbrn-geometry';

const MAX_LBRN_BYTES = 20_000_000;
const MAX_XML_DEPTH = 64;
const MAX_SHAPES = 50_000;

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
  if (new TextEncoder().encode(xmlText).byteLength > MAX_LBRN_BYTES) {
    return { ok: false, reason: 'LightBurn project exceeds the 20 MB import limit.' };
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlText)) {
    return { ok: false, reason: 'Active XML declarations are not allowed.' };
  }
  const document = parseXml(xmlText);
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
  const shapeCount = [...root.querySelectorAll('Shape, shape')].length;
  if (shapeCount > MAX_SHAPES)
    return { ok: false, reason: 'LightBurn project contains too many shapes.' };

  const geometry = importLbrnGeometry(root, sourceName);
  if (geometry.objects.length === 0) {
    return { ok: false, reason: 'LightBurn project contains no supported vector geometry.' };
  }
  const layers = importedLayers(
    root,
    geometry.objects.flatMap((object) => object.paths.map((path) => path.color)),
  );
  const base = createProject();
  const project: Project = {
    ...base,
    scene: { ...base.scene, objects: geometry.objects, layers },
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
      warnings: geometry.warnings,
    },
  };
}

function importedLayers(root: Element, usedColors: ReadonlyArray<string>): Layer[] {
  const settings = new Map<number, Element>();
  for (const element of [...root.children]) {
    if (normalized(element.tagName) !== 'cutsetting') continue;
    const index = finiteNumber(element.getAttribute('index') ?? element.getAttribute('Index'));
    if (index !== null) settings.set(Math.trunc(index), element);
  }
  const colors = [...new Set(usedColors)];
  return colors.map((color) => {
    const index = findColorIndex(color);
    const setting = settings.get(index);
    const base = createLayer({ id: color, color });
    if (setting === undefined) return base;
    const speedMmSec = numericField(setting, ['speed', 'speedmmsec']);
    const power = numericField(setting, ['maxpower', 'power']);
    const passes = numericField(setting, ['numpasses', 'passes']);
    const mode = textField(setting, ['type', 'mode']).toLowerCase();
    return {
      ...base,
      mode: mode.includes('scan') || mode.includes('fill') ? 'fill' : 'line',
      ...(speedMmSec === null ? {} : { speed: Math.max(1, speedMmSec * 60) }),
      ...(power === null ? {} : { power: Math.max(0, Math.min(100, power)) }),
      ...(passes === null ? {} : { passes: Math.max(1, Math.round(passes)) }),
    };
  });
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
