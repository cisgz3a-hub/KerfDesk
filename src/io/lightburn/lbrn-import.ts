import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { ImportedSvg, Layer, Project } from '../../core/scene';
import { createProject } from '../../core/scene/project';
import { normalized, textField } from './lbrn-fields';
import { lightBurnSceneFrame } from './lbrn-frame';
import { importLbrnGeometry } from './lbrn-geometry';
import { importedLayers } from './lbrn-layers';
import { lightBurnNotesWarnings, lightBurnProjectNotes } from './lbrn-notes';
import {
  PROJECT_SCENE_LIMITS,
  validateSceneBudgets,
} from '../project/project-scene-integrity-validator';

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
    return {
      ok: false,
      reason: [
        'LightBurn project contains no supported vector geometry.',
        ...geometry.warnings,
      ].join(' '),
    };
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
  const warnings = [
    ...lightBurnNotesWarnings(root),
    ...geometry.warnings,
    ...layerImport.warnings,
    ...cutPlannerWarnings(root),
  ];
  const project: Project = {
    ...base,
    notes: lightBurnProjectNotes(root, sourceName, warnings),
    scene: {
      ...base.scene,
      objects,
      layers,
      artworkOrder: layerByLayerArtworkOrder(objects, layers),
    },
  };
  const overLimit = projectLimitRefusal(project);
  if (overLimit !== null) return { ok: false, reason: overLimit };
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
      warnings,
    },
  };
}

// The Cut Planner in LightBurn's Optimization Settings ranks its orderings,
// 0 first; KerfDesk always runs a LightBurn project layer by layer.
function cutPlannerWarnings(root: Element): ReadonlyArray<string> {
  const prefs = [...root.children].find((child) => normalized(child.tagName) === 'uiprefs');
  const byLayer = prefs === undefined ? '' : textField(prefs, ['optimizebylayer']).trim();
  if (byLayer === '' || byLayer === '0') return [];
  return [
    `LightBurn's Cut Planner for this project does not run layers first (Optimize_ByLayer ${byLayer}); KerfDesk runs it operation by operation, in the Artwork panel's operation order. Check the Run order view.`,
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

function optionalAttribute<K extends string>(
  element: Element,
  attribute: string,
  key: K,
): Partial<Record<K, string>> {
  const value = element.getAttribute(attribute);
  return value === null ? {} : ({ [key]: value } as Partial<Record<K, string>>);
}

function xmlDepth(element: Element): number {
  let max = 0;
  for (const child of [...element.children]) max = Math.max(max, xmlDepth(child));
  return 1 + max;
}

function defaultParseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

// The loader's limits, checked before the import replaces the open document:
// Save and autosave refuse a project past them, so it would hold work that can
// never be kept (ADR-307 Amendment 2, audit 13-P2-1).
function projectLimitRefusal(project: Project): string | null {
  const refusal = validateSceneBudgets(project.scene as unknown as Record<string, unknown>);
  if (refusal === null) return null;
  const objects = project.scene.objects.length;
  return objects > PROJECT_SCENE_LIMITS.objects
    ? `This LightBurn project has ${objects} shapes, but a KerfDesk project holds at most ${PROJECT_SCENE_LIMITS.objects} objects, so it could never be saved. Split the design into smaller LightBurn projects and import each one.`
    : `This LightBurn project is past a KerfDesk project limit, so it could never be saved (${refusal}).`;
}
