import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { MAX_GUIDES } from '../../core/scene/guides';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function roundTrip(raw: Record<string, unknown>): Project {
  const result = deserializeProject(JSON.stringify(raw));
  if (result.kind !== 'ok') throw new Error(result.kind);
  return result.project;
}

const saved = (project: Project): Record<string, unknown> =>
  JSON.parse(serializeProject(project)) as Record<string, unknown>;

describe('notes on open and guidelines in .lf2', () => {
  it('round-trips guides and the show-notes-on-open flag', () => {
    const project: Project = {
      ...createProject(),
      showNotesOnOpen: true,
      guides: [
        { id: 'g1', axis: 'x', positionMm: 25 },
        { id: 'g2', axis: 'y', positionMm: -3.5 },
      ],
    };
    const loaded = roundTrip(saved(project));
    expect(loaded.showNotesOnOpen).toBe(true);
    expect(loaded.guides).toEqual(project.guides);
  });

  it('drops malformed guides and a non-boolean flag instead of refusing the file', () => {
    const raw = saved(createProject());
    raw['showNotesOnOpen'] = 'yes';
    raw['guides'] = [
      { id: 'ok', axis: 'y', positionMm: 10 },
      { id: 'ok', axis: 'x', positionMm: 1 },
      { id: 'bad-axis', axis: 'z', positionMm: 1 },
      { id: 'bad-position', axis: 'x', positionMm: 'far' },
      null,
    ];
    const loaded = roundTrip(raw);
    expect(loaded.showNotesOnOpen).toBeUndefined();
    expect(loaded.guides).toEqual([{ id: 'ok', axis: 'y', positionMm: 10 }]);
  });

  it('keeps at most the guide limit', () => {
    const raw = saved(createProject());
    raw['guides'] = Array.from({ length: MAX_GUIDES + 5 }, (_, index) => ({
      id: `g${index}`,
      axis: 'x',
      positionMm: index,
    }));
    expect(roundTrip(raw).guides).toHaveLength(MAX_GUIDES);
  });
});
