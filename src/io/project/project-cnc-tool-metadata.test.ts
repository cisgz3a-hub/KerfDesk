import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  createProject,
  type CncTool,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function cncProject(): Project {
  return { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
}

function deserializeOk(text: string): Project {
  const result = deserializeProject(text);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result.project;
}

function loadTool(tool: Record<string, unknown>): CncTool | undefined {
  const raw = JSON.parse(serializeProject(cncProject())) as Record<string, unknown>;
  (raw['machine'] as Record<string, unknown>)['tools'] = [tool];
  const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
  return loaded.machine?.kind === 'cnc' ? loaded.machine.tools[0] : undefined;
}

describe('.lf2 CNC tool catalog metadata', () => {
  it('keeps bounded catalog metadata on a valid tool', () => {
    expect(
      loadTool({
        id: 'catalog',
        name: 'Single O-flute',
        kind: 'end-mill',
        diameterMm: 3.175,
        family: 'o-flute-upcut',
        shankDiameterMm: 6.35,
        fluteCount: 1,
        catalogId: 'o-upcut-0125',
      }),
    ).toEqual({
      id: 'catalog',
      name: 'Single O-flute',
      kind: 'end-mill',
      diameterMm: 3.175,
      family: 'o-flute-upcut',
      shankDiameterMm: 6.35,
      fluteCount: 1,
      catalogId: 'o-upcut-0125',
    });
  });

  it('drops malformed catalog metadata without dropping the tool', () => {
    expect(
      loadTool({
        id: 'catalog-bad',
        name: 'Still usable',
        kind: 'end-mill',
        diameterMm: 3.175,
        family: 'x'.repeat(121),
        shankDiameterMm: -1,
        fluteCount: 1.5,
        catalogId: '',
      }),
    ).toEqual({
      id: 'catalog-bad',
      name: 'Still usable',
      kind: 'end-mill',
      diameterMm: 3.175,
    });
  });

  it('round-trips catalog metadata', () => {
    const project = cncProject();
    if (project.machine?.kind !== 'cnc') throw new Error('CNC machine missing');
    const catalogTool: CncTool = {
      id: 'catalog-o-flute',
      name: '3.175 mm single O-flute',
      kind: 'end-mill',
      diameterMm: 3.175,
      family: 'o-flute-upcut',
      shankDiameterMm: 3.175,
      fluteCount: 1,
      catalogId: 'o-upcut-0125',
    };
    const withCatalogTool: Project = {
      ...project,
      machine: { ...project.machine, tools: [...project.machine.tools, catalogTool] },
    };

    const loaded = deserializeOk(serializeProject(withCatalogTool));
    const tools = loaded.machine?.kind === 'cnc' ? loaded.machine.tools : [];
    expect(tools.find((tool) => tool.id === catalogTool.id)).toEqual(catalogTool);
  });
});
