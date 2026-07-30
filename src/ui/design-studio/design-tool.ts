// design-tool — the Design Studio tool union and its two-rail grouping
// (ADR-268, Phase N DS-2).
//
// The rail split is LightBurn's: a Creation toolbar for making geometry above a
// Modifiers toolbar for combining and altering it. Keeping the grouping in the
// data (not in the component) means the rails cannot drift out of sync with the
// union, and a new tool is one row here rather than an edit in three places.
//
// A tool is a STATE, not a flag (tldraw's model): the canvas asks the active
// tool what a pointer event means, so modifier keys can mean different things
// per tool without a pile of booleans.

export type DesignToolKind =
  // Creation rail
  | 'select'
  | 'node'
  | 'line'
  | 'path'
  | 'rect'
  | 'circle'
  | 'arc'
  | 'polygon'
  | 'dimension'
  // Modifiers rail
  | 'trim'
  | 'extend'
  | 'fillet'
  | 'chamfer'
  | 'offset'
  | 'mirror'
  | 'array'
  | 'boolean';

export type DesignToolRail = 'create' | 'modify';

export type DesignToolDefinition = {
  readonly kind: DesignToolKind;
  readonly rail: DesignToolRail;
  readonly label: string;
  // Shown in the tooltip and in the status bar while the tool is armed, so the
  // hint lives on the tool rather than in a help page (LightBurn's convention).
  readonly hint: string;
  // Single-key shortcut, matched case-insensitively with no modifier. Chosen to
  // avoid the app-level Ctrl chords, which are suppressed while the overlay is
  // open anyway.
  readonly shortcut: string;
  // Tools that only act on an existing selection are disabled-looking but never
  // refused: pressing one with nothing selected simply arms it and the status
  // bar says what to pick. Rule 7 - inform, never block.
  readonly needsSelection: boolean;
  // Not yet implemented. Listed so the rail shows the finished shape of the
  // tool set from the first release instead of growing buttons stage by stage.
  readonly planned?: boolean;
};

export const DESIGN_TOOLS: ReadonlyArray<DesignToolDefinition> = [
  {
    kind: 'select',
    rail: 'create',
    label: 'Select',
    hint: 'Click to select. Shift+click adds. Drag a marquee for many.',
    shortcut: 'v',
    needsSelection: false,
  },
  {
    kind: 'node',
    rail: 'create',
    label: 'Edit nodes',
    hint: 'Drag a node to move it. Hover a node and press D to delete, I to insert.',
    shortcut: 'n',
    needsSelection: false,
    planned: true,
  },
  {
    kind: 'line',
    rail: 'create',
    label: 'Line',
    hint: 'Click the start, then the end. Shift constrains to 45 degrees; type a length to set it exactly.',
    shortcut: 'l',
    needsSelection: false,
  },
  {
    kind: 'path',
    rail: 'create',
    label: 'Polyline',
    hint: 'Click each corner. Double-click to finish open, click the start to close.',
    shortcut: 'p',
    needsSelection: false,
  },
  {
    kind: 'rect',
    rail: 'create',
    label: 'Rectangle',
    hint: 'Drag a corner to corner. Shift squares it; Alt draws from the centre.',
    shortcut: 'r',
    needsSelection: false,
  },
  {
    kind: 'circle',
    rail: 'create',
    label: 'Circle',
    hint: 'Drag from the centre. Type a radius or diameter to set it exactly.',
    shortcut: 'c',
    needsSelection: false,
  },
  {
    kind: 'arc',
    rail: 'create',
    label: 'Arc',
    hint: 'Click the centre, the start, then sweep to the end.',
    shortcut: 'a',
    needsSelection: false,
  },
  {
    kind: 'polygon',
    rail: 'create',
    label: 'Polygon',
    hint: 'Drag from the centre. Set the side count in the options bar.',
    shortcut: 'g',
    needsSelection: false,
    planned: true,
  },
  {
    kind: 'dimension',
    rail: 'create',
    label: 'Dimension',
    hint: 'Pick geometry; the dimension type follows what you picked. Type a value to drive it.',
    shortcut: 'd',
    needsSelection: false,
    planned: true,
  },
  {
    kind: 'trim',
    rail: 'modify',
    label: 'Trim',
    hint: 'Click a segment to cut it back to its nearest intersection.',
    shortcut: 't',
    needsSelection: false,
    planned: true,
  },
  {
    kind: 'extend',
    rail: 'modify',
    label: 'Extend',
    hint: 'Click an open end to run it out to the next edge.',
    shortcut: 'e',
    needsSelection: false,
    planned: true,
  },
  {
    kind: 'fillet',
    rail: 'modify',
    label: 'Fillet',
    hint: 'Click a corner to round it at the radius in the options bar. A rectangle rounds all four.',
    shortcut: 'f',
    needsSelection: false,
  },
  {
    kind: 'chamfer',
    rail: 'modify',
    label: 'Chamfer',
    hint: 'Click a corner to flatten it by the distance in the options bar. A rectangle chamfers all four.',
    shortcut: 'h',
    needsSelection: false,
  },
  {
    kind: 'offset',
    rail: 'modify',
    label: 'Offset',
    hint: 'Offset the selection inward or outward by a distance.',
    shortcut: 'o',
    needsSelection: true,
    planned: true,
  },
  {
    kind: 'mirror',
    rail: 'modify',
    label: 'Mirror',
    hint: 'Mirror the selection across an axis you draw.',
    shortcut: 'm',
    needsSelection: true,
    planned: true,
  },
  {
    kind: 'array',
    rail: 'modify',
    label: 'Array',
    hint: 'Repeat the selection on a grid or around a centre.',
    shortcut: 'y',
    needsSelection: true,
    planned: true,
  },
  {
    kind: 'boolean',
    rail: 'modify',
    label: 'Boolean',
    hint: 'Union, subtract, or intersect two or more closed shapes.',
    shortcut: 'b',
    needsSelection: true,
    planned: true,
  },
];

export const DESIGN_TOOL_BY_KIND: Readonly<Record<DesignToolKind, DesignToolDefinition>> =
  Object.fromEntries(DESIGN_TOOLS.map((tool) => [tool.kind, tool])) as Readonly<
    Record<DesignToolKind, DesignToolDefinition>
  >;

export function designToolsForRail(rail: DesignToolRail): ReadonlyArray<DesignToolDefinition> {
  return DESIGN_TOOLS.filter((tool) => tool.rail === rail);
}

export function designToolForShortcut(key: string): DesignToolDefinition | null {
  const lower = key.toLowerCase();
  return DESIGN_TOOLS.find((tool) => tool.shortcut === lower) ?? null;
}
