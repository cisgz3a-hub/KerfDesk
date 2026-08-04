import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  createProject,
  type CncTool,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';

const FLAT_ENGRAVER: CncTool = {
  id: 'flat-engraver',
  name: '30 degree flat-tip engraver',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
  tipDiameterMm: 0.2,
};

function projectWithTool(tool: CncTool): Project {
  const project = createProject();
  return {
    ...project,
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [tool], toolId: tool.id },
  };
}

function deserializeOk(text: string): Project {
  const result = deserializeProject(text);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result.project;
}

function loadTool(tool: Record<string, unknown>): CncTool | undefined {
  const raw = JSON.parse(serializeProject(projectWithTool(FLAT_ENGRAVER))) as Record<
    string,
    unknown
  >;
  const machine = raw['machine'] as Record<string, unknown>;
  machine['tools'] = [tool];
  machine['toolId'] = tool['id'];
  const loaded = deserializeOk(`${JSON.stringify(raw)}\n`);
  return loaded.machine?.kind === 'cnc' ? loaded.machine.tools[0] : undefined;
}

describe('.lf2 CNC tip-diameter persistence', () => {
  it('round-trips a flat-tip engraver through the manual-save validation path', () => {
    const prepared = prepareProjectForPersistence(projectWithTool(FLAT_ENGRAVER));
    expect(prepared.kind).toBe('ok');
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);

    const loaded = deserializeOk(prepared.json);
    const tool = loaded.machine?.kind === 'cnc' ? loaded.machine.tools[0] : undefined;
    expect(tool).toEqual(FLAT_ENGRAVER);
  });

  it.each([0, 0.2])('keeps a valid %s mm engraving tip diameter', (tipDiameterMm) => {
    expect(loadTool({ ...FLAT_ENGRAVER, tipDiameterMm })?.tipDiameterMm).toBe(tipDiameterMm);
  });

  it.each([-0.1, FLAT_ENGRAVER.diameterMm, 4])(
    'preserves an invalid %s mm tip diameter so it cannot become a point',
    (tipDiameterMm) => {
      const tool = loadTool({ ...FLAT_ENGRAVER, tipDiameterMm });
      expect(tool?.id).toBe(FLAT_ENGRAVER.id);
      expect(tool?.tipDiameterMm).toBe(tipDiameterMm);
    },
  );

  it('drops a nonnumeric tip field instead of adding unsupported metadata', () => {
    expect(loadTool({ ...FLAT_ENGRAVER, tipDiameterMm: '0.2' })?.tipDiameterMm).toBeUndefined();
  });

  it('drops a tip diameter from a V-bit so pointed V-bit behavior stays unchanged', () => {
    const tool = loadTool({
      ...FLAT_ENGRAVER,
      id: 'point-v',
      kind: 'v-bit',
      tipDiameterMm: 0.2,
    });
    expect(tool).toMatchObject({ id: 'point-v', kind: 'v-bit', tipAngleDeg: 30 });
    expect(tool?.tipDiameterMm).toBeUndefined();
  });
});
