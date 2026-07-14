import { normalizeMaterialRecipe, type MaterialRecipe } from '../../core/material-library';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../material-library';

export const MAX_CLB_BYTES = 5_000_000;
const MAX_CLB_ENTRIES = 10_000;
const MAX_XML_DEPTH = 64;

export type ClbImportReport = {
  readonly sourceName: string;
  readonly importedEntries: number;
  readonly unknownFields: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};
export type ClbImportResult =
  | {
      readonly ok: true;
      readonly library: MaterialLibraryDocument;
      readonly report: ClbImportReport;
    }
  | { readonly ok: false; readonly reason: string };

export function importLightBurnClb(
  xmlText: string,
  sourceName: string,
  parseXml: (text: string) => Document = defaultParseXml,
): ClbImportResult {
  if (new TextEncoder().encode(xmlText).byteLength > MAX_CLB_BYTES)
    return { ok: false, reason: 'CLB file exceeds the 5 MB import limit.' };
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlText))
    return { ok: false, reason: 'CLB active XML declarations are not allowed.' };
  const document = parseXml(xmlText);
  if (document.querySelector('parsererror') !== null || document.documentElement === null)
    return { ok: false, reason: 'CLB file is not valid XML.' };
  if (xmlDepth(document.documentElement) > MAX_XML_DEPTH)
    return { ok: false, reason: 'CLB XML nesting is too deep.' };
  const entryElements = elementsByName(document, 'entry');
  if (entryElements.length === 0) return { ok: false, reason: 'CLB contains no material entries.' };
  if (entryElements.length > MAX_CLB_ENTRIES)
    return { ok: false, reason: 'CLB contains too many material entries.' };

  const unknownFields = new Set<string>();
  const warnings: string[] = [];
  const entries = entryElements.flatMap((entry, index) => {
    const parsed = parseEntry(entry, index, sourceName, unknownFields);
    if (parsed !== null) return [parsed];
    warnings.push(`Entry ${index + 1} was skipped because speed or power was missing.`);
    return [];
  });
  if (entries.length === 0) return { ok: false, reason: 'CLB has no supported cut settings.' };
  const name = fileStem(sourceName);
  return {
    ok: true,
    library: {
      format: MATERIAL_LIBRARY_FORMAT,
      librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
      libraryId: slug(name),
      name,
      entries,
    },
    report: {
      sourceName,
      importedEntries: entries.length,
      unknownFields: [...unknownFields].sort(),
      warnings,
    },
  };
}

function parseEntry(
  entry: Element,
  index: number,
  sourceName: string,
  unknownFields: Set<string>,
): MaterialPreset | null {
  const setting = firstDescendant(entry, ['cutsetting', 'cutsetting_0', 'cutsettings']) ?? entry;
  collectUnknownFields(setting, unknownFields);
  const speedMmSec = numberField(setting, ['speed', 'speedmmsec']);
  const power = numberField(setting, ['maxpower', 'power']);
  if (speedMmSec === null || power === null) return null;
  const mode = operationMode(field(setting, ['type', 'mode', 'cutmode']));
  const materialName = ancestorAttribute(entry, ['material'], ['name']) ?? 'Imported material';
  const thickness = numberAttribute(entry, ['thickness']);
  const description = attribute(entry, ['desc', 'description', 'title']) ?? `Entry ${index + 1}`;
  return {
    id: `${slug(materialName)}-${slug(description)}-${index + 1}`,
    materialName,
    ...(thickness === null ? {} : { thicknessMm: thickness }),
    title: description,
    operation: mode === 'line' ? 'cut' : 'engrave',
    description: `${description} (imported from ${sourceName})`,
    recipe: importedRecipe(setting, mode, speedMmSec, power),
    revision: 'lightburn-clb-import-v1',
  };
}

function importedRecipe(
  setting: Element,
  mode: MaterialRecipe['mode'],
  speedMmSec: number,
  power: number,
): MaterialRecipe {
  const interval = numberField(setting, ['interval', 'lineinterval']) ?? 0.1;
  const airAssist = booleanField(setting, ['airassist', 'airassistenable']);
  return normalizeMaterialRecipe({
    mode,
    minPower: numberField(setting, ['minpower']) ?? 0,
    power,
    // CLB stores speed in mm/s; KerfDesk stores mm/min.
    speed: speedMmSec * 60,
    passes: numberField(setting, ['numpasses', 'passes', 'passcount']) ?? 1,
    ...(airAssist === undefined ? {} : { airAssist }),
    hatchAngleDeg: numberField(setting, ['scanangle', 'angle']) ?? 0,
    hatchSpacingMm: interval,
    fillOverscanMm: numberField(setting, ['overscanning', 'overscan']) ?? 0,
    fillBidirectional: booleanField(setting, ['bidirectional', 'bidir']) ?? true,
    fillCrossHatch: booleanField(setting, ['crosshatch']) ?? false,
    ditherAlgorithm: 'floyd-steinberg',
    linesPerMm: 1 / Math.max(0.001, interval),
    negativeImage: booleanField(setting, ['negativeimage', 'negative']) ?? false,
    passThrough: booleanField(setting, ['passthrough']) ?? false,
    dotWidthCorrectionMm: 0,
  });
}

const KNOWN_SETTING_FIELDS = new Set([
  'type',
  'mode',
  'cutmode',
  'speed',
  'speedmmsec',
  'maxpower',
  'power',
  'minpower',
  'numpasses',
  'passes',
  'passcount',
  'interval',
  'lineinterval',
  'airassist',
  'airassistenable',
  'scanangle',
  'angle',
  'overscanning',
  'overscan',
  'bidirectional',
  'bidir',
  'crosshatch',
  'negativeimage',
  'negative',
  'passthrough',
]);

function collectUnknownFields(setting: Element, unknown: Set<string>): void {
  for (const node of [...setting.attributes]) {
    if (!KNOWN_SETTING_FIELDS.has(normalized(node.name))) unknown.add(node.name);
  }
  for (const child of [...setting.children]) {
    if (!KNOWN_SETTING_FIELDS.has(normalized(child.tagName))) unknown.add(child.tagName);
  }
}

function field(element: Element, names: ReadonlyArray<string>): string | null {
  const allowed = new Set(names.map(normalized));
  for (const node of [...element.attributes]) {
    if (allowed.has(normalized(node.name))) return node.value;
  }
  for (const child of [...element.children]) {
    if (allowed.has(normalized(child.tagName))) {
      return attribute(child, ['value']) ?? child.textContent?.trim() ?? null;
    }
  }
  return null;
}

function numberField(element: Element, names: ReadonlyArray<string>): number | null {
  return finiteNumber(field(element, names));
}
function booleanField(element: Element, names: ReadonlyArray<string>): boolean | undefined {
  const value = field(element, names)?.trim().toLowerCase();
  return value === undefined ? undefined : ['1', 'true', 'yes', 'on'].includes(value);
}
function attribute(element: Element, names: ReadonlyArray<string>): string | null {
  const allowed = new Set(names.map(normalized));
  for (const node of [...element.attributes]) {
    if (allowed.has(normalized(node.name))) return node.value;
  }
  return null;
}
function numberAttribute(element: Element, names: ReadonlyArray<string>): number | null {
  return finiteNumber(attribute(element, names));
}
function ancestorAttribute(
  element: Element,
  ancestorNames: ReadonlyArray<string>,
  attributeNames: ReadonlyArray<string>,
): string | null {
  const allowed = new Set(ancestorNames.map(normalized));
  let current = element.parentElement;
  while (current !== null) {
    if (allowed.has(normalized(current.tagName))) return attribute(current, attributeNames);
    current = current.parentElement;
  }
  return null;
}
function firstDescendant(element: Element, names: ReadonlyArray<string>): Element | null {
  const allowed = new Set(names.map(normalized));
  return (
    [...element.querySelectorAll('*')].find((child) => allowed.has(normalized(child.tagName))) ??
    null
  );
}
function elementsByName(document: Document, name: string): Element[] {
  const target = normalized(name);
  return [...document.querySelectorAll('*')].filter(
    (element) => normalized(element.tagName) === target,
  );
}
function operationMode(raw: string | null): MaterialRecipe['mode'] {
  const value = raw?.toLowerCase() ?? '';
  if (value.includes('image')) return 'image';
  if (value.includes('scan') || value.includes('fill')) return 'fill';
  return 'line';
}
function xmlDepth(element: Element): number {
  let max = 0;
  for (const child of [...element.children]) max = Math.max(max, xmlDepth(child));
  return 1 + max;
}
function defaultParseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}
function finiteNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function slug(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return result === '' ? 'imported-library' : result;
}
function fileStem(name: string): string {
  return name.replace(/\.clb$/i, '') || 'Imported CLB';
}
