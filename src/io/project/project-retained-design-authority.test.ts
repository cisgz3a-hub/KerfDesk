import { describe, expect, it } from 'vitest';
import type { ImportedSvg, Project } from '../../core/scene';
import { defaultConstrainedSketch } from '../../core/sketch-constraints/default-constrained-sketch';
import { generatedPart } from '../../core/parts/part-generator.test-fixture';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { archiveAt, compoundArchiveProject } from './project-archive-compound.test-fixture';

function projectWithSources(
  sources: 'sketch and part' | 'sketch and Boolean' | 'part and Boolean',
): Project {
  const project = compoundArchiveProject();
  const original = project.scene.objects[0] as ImportedSvg;
  const { booleanCompound, ...plain } = original;
  const object = {
    ...plain,
    ...(sources === 'part and Boolean' ? {} : { constrainedSketch: defaultConstrainedSketch() }),
    ...(sources === 'sketch and Boolean' ? {} : { partGenerator: generatedPart().partGenerator }),
    ...(sources === 'sketch and part' ? {} : { booleanCompound }),
  };
  return { ...project, scene: { ...project.scene, objects: [object] } };
}
describe('single retained vector authoring authority', () => {
  it.each(['sketch and part', 'sketch and Boolean', 'part and Boolean'] as const)(
    'rejects contradictory %s sources on Open and Save',
    (sources) => {
      const project = projectWithSources(sources);
      const json = serializeProject(project);
      expect(deserializeProject(json)).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('competing'),
      });
      expect(prepareProjectForPersistence(project)).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('competing'),
      });
      expect(serializeProject(project)).toBe(json);
    },
  );
  it.each(['sketch and Boolean', 'part and Boolean'] as const)(
    'rejects contradictory %s sources inside an inactive sheet',
    (sources) => {
      const project = archiveAt('inactive sheet', projectWithSources(sources));
      expect(deserializeProject(serializeProject(project))).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('competing'),
      });
      expect(prepareProjectForPersistence(project)).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('competing'),
      });
    },
  );
  it('continues to admit ordinary retained Boolean sources', () => {
    const project = compoundArchiveProject();
    expect(deserializeProject(serializeProject(project)).kind).toBe('ok');
    expect(prepareProjectForPersistence(project).kind).toBe('ok');
  });
});
