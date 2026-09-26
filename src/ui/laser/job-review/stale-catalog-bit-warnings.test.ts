import { describe, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type CncTool } from '../../../core/scene';
import { MODELED_CNC_BIT_CATALOG } from '../../machine/cnc-bit-modeled-catalog';
import { detectStaleCatalogBitWarnings } from './stale-catalog-bit-warnings';

// ADR-322 Amendment 2: Job Review names a bit this job runs that predates a
// catalog correction, and points to the one-click fix in the bit library.
function staleAmana(): CncTool {
  const entry = MODELED_CNC_BIT_CATALOG.find((e) => e.id === 'o-ball-025-amana-51818');
  if (entry === undefined) throw new Error('missing catalog entry');
  const { fluteCount: _flutes, ...tool } = entry.tool;
  return { ...tool, id: 'saved-amana', catalogId: entry.id };
}

function cncProject(tools: ReadonlyArray<CncTool>) {
  return { ...createProject(), machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tools } };
}

describe('detectStaleCatalogBitWarnings', () => {
  it('warns when the job runs a stale catalog bit copy', () => {
    const tool = staleAmana();
    const [warning] = detectStaleCatalogBitWarnings(cncProject([tool]), [
      { id: tool.id, name: tool.name },
    ]);
    expect(warning).toContain(`${tool.name} is a copy of a catalog bit saved before`);
    expect(warning).toContain('the catalog now lists 1 flute');
    expect(warning).toContain('bit library offers the corrected value in one click');
  });

  it('stays silent for a stale copy the job does not run, and for laser projects', () => {
    const tool = staleAmana();
    expect(
      detectStaleCatalogBitWarnings(cncProject([tool]), [{ id: 'other', name: null }]),
    ).toEqual([]);
    expect(detectStaleCatalogBitWarnings(createProject(), [{ id: tool.id, name: null }])).toEqual(
      [],
    );
  });
});
