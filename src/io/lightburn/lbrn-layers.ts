import { createLayer, nextOperationColor, type Layer } from '../../core/scene';
import { booleanField, finiteNumber, normalized, numericField, textField } from './lbrn-fields';
import { colorForCutIndex } from './lbrn-geometry';
import { resolveLightBurnOverscan } from './lbrn-overscan';
import { lightBurnSettingsNotImported, type LayerKind } from './lbrn-setting-report';

// A LightBurn project's layers open as KerfDesk operations (ADR-388): each
// CutSetting is a layer, and each of its tabs (the layer's own settings, then
// its sub-layers) an operation on the layer's artwork.

// The range the Kerf Offset field takes (CutSettingsCommonFields).
const KERF_OFFSET_LIMIT_MM = 10;

// A CutSetting's `type` is LightBurn's layer mode: Line is "Cut", Fill is
// "Scan" and Fill+Line is "Scan+Cut" (ADR-388).
const LIGHTBURN_LAYER_KINDS: ReadonlyMap<string, LayerKind> = new Map([
  ['cut', 'line'],
  ['scan', 'fill'],
  ['scan+cut', 'fill+line'],
]);
// LightBurn's tool layers, T1 and T2, hold guides it never cuts (ADR-388).
const TOOL_LAYER_INDEXES: ReadonlySet<number> = new Set([30, 31]);

export function importedLayers(
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
  for (const { layer, following } of imported) {
    layers.push(layer);
    // The operations that follow a layer's first run on the same artwork,
    // each listed right after the one before so it runs next.
    for (const operation of following) {
      const color = nextOperationColor([...imported.map((entry) => entry.layer), ...layers]);
      layers.push({
        ...createLayer({ id: operation.id, name: operation.name, color }),
        ...operation.fields,
      });
    }
    operationIdsByColor.set(layer.color, [layer.id, ...following.map((operation) => operation.id)]);
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

/** An operation on the same artwork that runs after the layer's first. */
type FollowingOperation = {
  readonly id: string;
  readonly name: string;
  readonly fields: Partial<Layer>;
};

/** One tab of a LightBurn layer's Cut Settings: the layer's own, or a sub-layer. */
type LightBurnTab = {
  readonly element: Element;
  readonly id: string;
  readonly name: string;
};

/** A layer, and the operations that follow it on the same artwork. */
function importedLayer(
  color: string,
  settings: ReadonlyMap<number, Element>,
  warnings: string[],
): { readonly layer: Layer; readonly following: ReadonlyArray<FollowingOperation> } {
  const index = findColorIndex(color);
  const setting = settings.get(index);
  const importedName = setting === undefined ? '' : textField(setting, ['name', 'label']).trim();
  const name = importedName || defaultLayerName(index, color);
  const base = createLayer({ id: color, name, color });
  if (isToolLayer(index, setting)) {
    warnings.push(
      `${name}: a LightBurn tool layer, which LightBurn never cuts, so it opened with Output off.`,
    );
    return { layer: { ...base, output: false }, following: [] };
  }
  if (setting === undefined) return { layer: base, following: [] };
  if (isHiddenLayer(setting))
    warnings.push(
      `${name}: hidden in LightBurn, which does not cut a hidden layer, so it opened with Output off. Switch Output on to cut it.`,
    );
  const tabs = lightBurnTabs(setting, base.id, name);
  warnings.push(...switchedOffTabWarnings(name, tabs));
  const [first, ...following] = tabs.flatMap((tab) => tabOperations(tab, setting, warnings));
  return { layer: { ...base, ...first?.fields }, following };
}

// A layer's first tab is its CutSetting; each <SubLayer> in it is another tab,
// which LightBurn runs in turn, left to right (LightBurn Sub-Layers).
function lightBurnTabs(setting: Element, id: string, name: string): ReadonlyArray<LightBurnTab> {
  const subLayers = [...setting.children].filter(
    (child) => normalized(child.tagName) === 'sublayer',
  );
  return [
    { element: setting, id, name },
    ...subLayers.map((element, position) => {
      const subname = textField(element, ['subname']).trim();
      return {
        element,
        id: `${id}-sub${position + 1}`,
        name: `${name} (${subname || `Sub-layer ${position + 2}`})`,
      };
    }),
  ];
}

// Each tab has its own Output switch (`suboutput`), on unless written `0`.
// The layer's Output switch (`doOutput`) and hiding the layer keep every tab
// out of the job.
function tabOutput(setting: Element, tab: LightBurnTab): boolean | null {
  if (isHiddenLayer(setting) || isSwitchedOffTab(tab)) return false;
  return booleanField(setting, ['dooutput']);
}

function isSwitchedOffTab(tab: LightBurnTab): boolean {
  return booleanField(tab.element, ['suboutput']) === false;
}

function switchedOffTabWarnings(name: string, tabs: ReadonlyArray<LightBurnTab>): string[] {
  const off = tabs.filter(isSwitchedOffTab).map((tab) => `“${tab.name}”`);
  if (off.length === 0) return [];
  const listed =
    off.length === 1 ? off.join('') : `${off.slice(0, -1).join(', ')} and ${off.at(-1) ?? ''}`;
  return [
    off.length === 1
      ? `${name}: sub-layer ${listed} is switched off in LightBurn, so its operation opened with Output off.`
      : `${name}: sub-layers ${listed} are switched off in LightBurn, so their operations opened with Output off.`,
  ];
}

// A tab opens as an operation of its own mode and settings. A Fill+Line tab
// fills the shapes, then cuts their outlines: a Line operation after the fill.
function tabOperations(
  tab: LightBurnTab,
  setting: Element,
  warnings: string[],
): ReadonlyArray<FollowingOperation> {
  const { element, id, name } = tab;
  const kind = lightBurnLayerKind(element, name, warnings);
  warnings.push(...lightBurnSettingsNotImported(element, name, kind));
  const output = tabOutput(setting, tab);
  const common = {
    ...importedCommonLayerFields(element),
    ...(output === null ? {} : { output }),
  };
  const line = (): Partial<Layer> => ({
    mode: 'line',
    ...common,
    ...importedKerf(element, name, warnings),
  });
  if (kind === 'line') return [{ id, name, fields: line() }];
  const fill: Partial<Layer> = {
    mode: 'fill',
    ...common,
    ...importedScanSettings(element, name, warnings),
  };
  if (kind === 'fill') return [{ id, name, fields: fill }];
  return [
    { id, name, fields: fill },
    { id: `${id}-line`, name: `${name} (Line)`, fields: line() },
  ];
}

function defaultLayerName(index: number, color: string): string {
  if (TOOL_LAYER_INDEXES.has(index)) return `LightBurn T${index - 29}`;
  return index >= 0 ? `LightBurn C${index.toString().padStart(2, '0')}` : `Imported ${color}`;
}

// T1 and T2 are CutIndex 30 and 31, and their cut settings are of type "Tool".
function isToolLayer(index: number, setting: Element | undefined): boolean {
  if (TOOL_LAYER_INDEXES.has(index)) return true;
  return (
    setting !== undefined && textField(setting, ['type', 'mode']).trim().toLowerCase() === 'tool'
  );
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

function importedScanSettings(setting: Element, name: string, warnings: string[]): Partial<Layer> {
  const overscan = resolveLightBurnOverscan(
    booleanField(setting, ['overscan']),
    numericField(setting, ['overscanpercent']),
    numericField(setting, ['speed', 'speedmmsec']),
    name,
  );
  warnings.push(...overscan.warnings);
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

function isHiddenLayer(setting: Element): boolean {
  return booleanField(setting, ['hide']) === true;
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

function findColorIndex(color: string): number {
  for (let index = 0; index < 256; index += 1) if (colorForCutIndex(index) === color) return index;
  return -1;
}
