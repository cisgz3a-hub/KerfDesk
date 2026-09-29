// The import report names every LightBurn cut setting a layer opened without
// (ADR-388). A setting KerfDesk did not bring across is named whenever it
// changes what LightBurn would cut, and left out only while LightBurn itself
// ignores it: a switch that is off, a Fill setting on a Line layer, an Image
// setting on a vector layer. A setting this table does not know is named
// whenever it holds anything but 0, off or nothing.

export type LayerKind = 'line' | 'fill' | 'fill+line';

type Field = {
  /** As LightBurn wrote it, for the report. */
  readonly name: string;
  readonly key: string;
  readonly value: string;
  /** A block of settings of its own rather than a value. */
  readonly nested: boolean;
};
type Fields = ReadonlyMap<string, Field>;

type Feature = {
  /** LightBurn's name for the setting. */
  readonly label: string;
  /** The fields that turn it on, any one of them, then those that only count while it is on. */
  readonly switches: ReadonlyArray<string>;
  readonly settings?: ReadonlyArray<string>;
  /** When a switch turns it on; by default whenever it holds anything but 0, off or nothing. */
  readonly on?: (value: string, fields: Fields) => boolean;
  /** The layer modes it applies to; LightBurn ignores it on the others. */
  readonly kinds?: ReadonlyArray<LayerKind>;
  readonly note?: string;
};

const FILL_KINDS: ReadonlyArray<LayerKind> = ['fill', 'fill+line'];

const FEATURES: ReadonlyArray<Feature> = [
  { label: 'Perforation Mode', switches: ['perforate'], settings: ['perflen', 'perfskip'] },
  {
    label: 'Tabs',
    switches: ['tabsenabled'],
    settings: [
      'tabsize',
      'tabcount',
      'tabcountmax',
      'tabspacing',
      'tabsusespacing',
      'skipinnertabs',
      'tabcutpower',
      'manualtabs',
    ],
  },
  { label: 'Overcut', switches: ['overcut'] },
  { label: 'Ramp', switches: ['ramplength'], settings: ['rampouter'] },
  { label: 'Dot Mode', switches: ['dotmode'], settings: ['dottime', 'dotspacing'] },
  {
    label: 'Cut Through',
    switches: ['enablecutthroughstart', 'enablecutthroughend'],
    settings: ['throughpower'],
  },
  { label: 'Z Offset', switches: ['zoffset'] },
  { label: 'Z Step Per Pass', switches: ['zperpass'] },
  { label: 'Start Delay', switches: ['startdelay'] },
  { label: 'End Delay', switches: ['enddelay'] },
  { label: 'PPI', switches: ['enableppi'], settings: ['ppi'] },
  { label: 'Frequency', switches: ['overridefrequency'], settings: ['frequency'] },
  {
    label: 'Laser 2',
    switches: ['enablelaser2'],
    settings: ['minpower2', 'maxpower2', 'throughpower2'],
  },
  {
    label: 'Air Assist speed',
    switches: ['blowerspeedoverride'],
    settings: ['blowerspeedpercent'],
  },
  { label: 'Auto Air Assist', switches: ['autoblower'] },
  { label: 'Constant Power Mode', switches: ['forceconstantpower'] },
  {
    label: 'Min Power',
    switches: ['minpower'],
    on: minPowerApplies,
    note: 'KerfDesk gives the operation one power, its Max Power',
  },
  { label: 'Hide', switches: ['hide'], note: 'the layer opened visible' },
  // A Line operation's kerf opens as its Kerf Offset (lbrn-import.ts importedKerf).
  {
    label: 'Kerf Offset',
    switches: ['kerf'],
    kinds: ['fill'],
    note: 'KerfDesk offsets Line operations only',
  },
  { label: 'Flood Fill', switches: ['floodfill'], kinds: FILL_KINDS },
  {
    label: 'Fill Grouping',
    switches: ['scanopt'],
    // KerfDesk fills all of an operation's shapes together, as "mergeAll" does.
    on: (value) => value.trim().toLowerCase() !== 'mergeall',
    kinds: FILL_KINDS,
  },
];

const NOT_REPORTED = new Set([
  // Read by lbrn-import.ts.
  'index',
  'name',
  'label',
  'type',
  'mode',
  'priority',
  'speed',
  'speedmmsec',
  'maxpower',
  'power',
  'numpasses',
  'passes',
  'runblower',
  'dooutput',
  // Fill settings: read on a Fill, ignored by LightBurn on a Line.
  'interval',
  'lineinterval',
  'scanangle',
  'angle',
  'crosshatch',
  'bidirectional',
  'bidir',
  'overscan',
  'overscanpercent',
  // Image settings, which no vector layer uses.
  'dpi',
  'dithermode',
  'halftoneangle',
  'cellsperinch',
  'linkdpitointerval',
  'negativeimage',
  'negative',
  'passthrough',
  ...FEATURES.flatMap((feature) => [...feature.switches, ...(feature.settings ?? [])]),
]);

/** One line for each setting of `setting` that `layer`, a `kind` operation, opened without. */
export function lightBurnSettingsNotImported(
  setting: Element,
  layer: string,
  kind: LayerKind,
): string[] {
  const fields = directFields(setting);
  const byKey: Fields = new Map(fields.map((field) => [field.key, field]));
  const warnings = FEATURES.flatMap((feature) => featureWarning(feature, byKey, layer, kind));
  for (const field of fields) {
    if (NOT_REPORTED.has(field.key)) continue;
    if (field.nested)
      warnings.push(`${layer}: LightBurn “${field.name}” settings were not imported.`);
    else if (inUse(field, byKey))
      warnings.push(
        `${layer}: LightBurn setting “${field.name}” was not imported (${field.value.trim()}).`,
      );
  }
  return warnings;
}

function featureWarning(
  feature: Feature,
  fields: Fields,
  layer: string,
  kind: LayerKind,
): ReadonlyArray<string> {
  if (feature.kinds !== undefined && !feature.kinds.includes(kind)) return [];
  const on = feature.on ?? setValue;
  const switchedOn = feature.switches.some((key) => {
    const field = fields.get(key);
    return field !== undefined && !field.nested && on(field.value, fields);
  });
  if (!switchedOn) return [];
  const values = [...feature.switches, ...(feature.settings ?? [])]
    .flatMap((key) => fields.get(key) ?? [])
    .map((field) => `${field.name} ${field.value.trim()}`)
    .join(', ');
  const note = feature.note === undefined ? '' : `; ${feature.note}`;
  return [`${layer}: LightBurn ${feature.label} was not imported (${values})${note}.`];
}

// A Min Power equal to the Max Power, or 0, leaves nothing to vary.
function minPowerApplies(value: string, fields: Fields): boolean {
  const min = Number(value);
  const max = Number(fields.get('maxpower')?.value ?? fields.get('power')?.value ?? Number.NaN);
  return Number.isFinite(min) && min !== 0 && min !== max;
}

// Laser 1 counts when it is switched off, a pass count when the layer's passes
// do not already hold it, anything else whenever it is set.
function inUse(field: Field, fields: Fields): boolean {
  if (field.key === 'enablelaser1') return !setValue(field.value);
  if (field.key !== 'passcount') return setValue(field.value);
  const passes = fields.get('numpasses')?.value ?? fields.get('passes')?.value ?? '1';
  return Number(field.value) !== Number(passes);
}

function setValue(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'false' || trimmed === 'off' || trimmed === 'none')
    return false;
  const numeric = Number(trimmed);
  return !Number.isFinite(numeric) || numeric !== 0;
}

function directFields(element: Element): ReadonlyArray<Field> {
  return [
    ...[...element.attributes].map((attribute) => ({
      name: attribute.name,
      key: normalized(attribute.name),
      value: attribute.value,
      nested: false,
    })),
    ...[...element.children].map((child) => ({
      name: child.tagName,
      key: normalized(child.tagName),
      value: child.getAttribute('Value') ?? child.textContent ?? '',
      nested: child.children.length > 0,
    })),
  ];
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
