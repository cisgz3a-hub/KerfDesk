import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function repoFile(path: string): string {
  return readFileSync(resolve(__dirname, '../../..', path), 'utf8');
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`missing section: ${start}`);
  return source.slice(startIndex, endIndex);
}

function singleSpaced(source: string): string {
  return source.replace(/\s+/g, ' ');
}

describe('current climb-direction documentation', () => {
  it('keeps the source contract aligned with the corrected M3 winding', () => {
    const machine = repoFile('src/core/scene/machine.ts');
    const contract = section(
      machine,
      '// H.9: which side of the travel direction',
      'export type CncCutDirection',
    );
    expect(contract).toContain('material on the RIGHT of travel');
    expect(contract).not.toContain('material on the LEFT of travel');
  });

  it('documents truthful editor applicability and winding in F-CNC18', () => {
    const workflow = repoFile('WORKFLOW.md');
    const contract = singleSpaced(section(workflow, '### F-CNC18.', '### F-CNC19.'));
    expect(contract).toContain('only for outside/inside profiles and pockets');
    expect(contract).toContain('material RIGHT of travel');
    expect(contract).toContain('outside profiles run CW');
    expect(contract).toContain('inside/pocket run CCW');
    expect(contract).not.toContain('material LEFT of travel');
  });

  it('keeps ADR-252 on the accepted ADR-251 amendment', () => {
    const decisions = repoFile('DECISIONS.md');
    const contract = singleSpaced(section(decisions, '## ADR-252', '## ADR-253'));
    expect(contract).toContain('material on the RIGHT of travel');
    expect(contract).not.toContain('material on the LEFT of travel');
  });
});
