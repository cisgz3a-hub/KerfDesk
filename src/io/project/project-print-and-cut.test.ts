import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('print-and-cut project targets', () => {
  it('round-trips design-side targets', () => {
    const project = {
      ...createProject(),
      printAndCutTargets: { first: { x: 10, y: 20 }, second: { x: 80, y: 20 } },
    };
    const result = deserializeProject(serializeProject(project));
    if (result.kind === 'invalid') throw new Error(result.reason);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok')
      expect(result.project.printAndCutTargets).toEqual(project.printAndCutTargets);
  });

  it('rejects coincident design targets', () => {
    const raw = {
      ...createProject(),
      printAndCutTargets: { first: { x: 10, y: 20 }, second: { x: 10, y: 20 } },
    };
    expect(deserializeProject(JSON.stringify(raw))).toMatchObject({ kind: 'invalid' });
  });
});
