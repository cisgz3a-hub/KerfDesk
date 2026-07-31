import type { CncTool } from '../../core/scene';
import { cncToolGeometryLabel } from '../common/cnc-tool-geometry-label';

export type CncToolGroup = {
  readonly key: string;
  readonly label: string;
  readonly tools: ReadonlyArray<CncTool>;
};

const FAMILY_LABELS = new Map<string, string>([
  ['straight', 'Square / straight end mills'],
  ['upcut', 'Upcut spiral end mills'],
  ['downcut', 'Downcut spiral end mills'],
  ['compression', 'Compression end mills'],
  ['o-flute-upcut', 'Single O-flute upcut end mills'],
  ['o-flute-downcut', 'Single O-flute downcut end mills'],
  ['o-flute-straight', 'Single O-flute straight bits'],
  ['o-flute-double', 'Double O-flute plastic-cutting bits'],
  ['mortise', 'Mortise-bit envelopes'],
  ['ball-nose', 'Ball-nose end mills'],
  ['core-box', 'Core-box / round-nose bits'],
  ['v-groove', 'V-groove bits (point-cone model)'],
  ['engraving', 'Legacy engraving tools'],
]);

const FAMILY_ORDER = [...FAMILY_LABELS.keys()];

export function cncToolFamilyLabel(tool: CncTool): string {
  const key = toolFamilyKey(tool);
  return FAMILY_LABELS.get(key) ?? `Custom / other (${key})`;
}

export function groupCncTools(tools: ReadonlyArray<CncTool>): ReadonlyArray<CncToolGroup> {
  const grouped = new Map<string, CncTool[]>();
  for (const tool of tools) {
    const key = toolFamilyKey(tool);
    const group = grouped.get(key);
    if (group === undefined) grouped.set(key, [tool]);
    else group.push(tool);
  }
  const orderedKeys = [
    ...FAMILY_ORDER.filter((key) => grouped.has(key)),
    ...[...grouped.keys()].filter((key) => !FAMILY_ORDER.includes(key)),
  ];
  return orderedKeys.map((key) => ({
    key,
    label: FAMILY_LABELS.get(key) ?? `Custom / other (${key})`,
    tools: grouped.get(key) ?? [],
  }));
}

export function CncToolOptions(props: { readonly tools: ReadonlyArray<CncTool> }): JSX.Element {
  return (
    <>
      {groupCncTools(props.tools).map((group) => (
        <optgroup key={group.key} label={group.label}>
          {group.tools.map((tool) => (
            <option key={tool.id} value={tool.id}>
              {cncToolGeometryLabel(tool)} — {tool.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function toolFamilyKey(tool: CncTool): string {
  if (tool.family !== undefined && tool.family.trim() !== '') return tool.family;
  switch (tool.kind) {
    case 'end-mill':
      return 'straight';
    case 'ball-nose':
      return 'ball-nose';
    case 'v-bit':
      return 'v-groove';
    case 'engraving':
      return 'engraving';
  }
}
