// The `source` a Box Generator panel carries on the sheet. A generated box
// changes material thickness by being generated again, so geometry tools that
// would resize only some of its joints recognise its panels by it (ADR-570
// Amendment 2).

export const BOX_PANEL_SOURCE_PREFIX = 'Box panel: ';

/** Whether an object's `source` names a panel the Box Generator placed. */
export function isBoxGeneratorPanelSource(source: string): boolean {
  return source.startsWith(BOX_PANEL_SOURCE_PREFIX);
}
