// ADR-258 Amendment 6: the "Stock thickness set" mark survives a save, and a
// project saved before it keeps its old reading (6.35 mm unset, any other
// value set), since a stored 6.35 cannot say whether the operator chose it.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject, type Project } from '../../core/scene';
import { setStockThicknessMm } from '../../core/scene/machine';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function withStock(stock: Record<string, unknown>): Project {
  const project: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
  const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
  const machine = raw['machine'] as Record<string, unknown>;
  machine['stock'] = { ...(machine['stock'] as Record<string, unknown>), ...stock };
  const result = deserializeProject(`${JSON.stringify(raw)}\n`);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result.project;
}

function readStock(project: Project) {
  if (project.machine?.kind !== 'cnc') throw new Error('expected a CNC machine');
  return project.machine.stock;
}

describe('.lf2 stock thickness mark (ADR-258 Amendment 6)', () => {
  it('keeps a set 6.35 mm stock set across save and load', () => {
    const stock = readStock(withStock({ thicknessMm: 6.35, thicknessSet: true }));
    expect(stock.thicknessSet).toBe(true);
    expect(setStockThicknessMm(stock)).toBe(6.35);
  });

  it('reads a project saved before the mark as it always did', () => {
    const legacyDefault = readStock(withStock({ thicknessMm: 6.35 }));
    expect(legacyDefault.thicknessSet).toBeUndefined();
    expect(setStockThicknessMm(legacyDefault)).toBeUndefined();
    expect(setStockThicknessMm(readStock(withStock({ thicknessMm: 18 })))).toBe(18);
  });

  it('drops a mark that is not exactly true', () => {
    for (const thicknessSet of ['yes', 1, false, null]) {
      const stock = readStock(withStock({ thicknessMm: 6.35, thicknessSet }));
      expect(stock.thicknessSet).toBeUndefined();
      expect(setStockThicknessMm(stock)).toBeUndefined();
    }
  });
});
