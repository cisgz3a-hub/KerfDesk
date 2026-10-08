import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';
import { visitWorkflowArchives } from './project-workflow-archives';
import {
  ARCHIVE_COMPOUND_LOCATIONS,
  archiveAt,
  compoundArchiveProject,
  corruptArchiveCompound,
} from './project-archive-compound.test-fixture';

describe('retained Boolean admission in workflow archives', () => {
  it.each(ARCHIVE_COMPOUND_LOCATIONS)(
    'rejects a structurally valid open retained contour in %s before Save or admission',
    (location) => {
      const project = archiveAt(location, corruptArchiveCompound('open source'));
      const untouched = serializeProject(project);
      expect(prepareProjectForPersistence(project)).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('closed contours'),
      });
      expect(deserializeProject(untouched)).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('closed contours'),
      });
      expect(serializeProject(project)).toBe(untouched);
    },
  );

  it.each(ARCHIVE_COMPOUND_LOCATIONS)('rejects derived-cache drift in %s', (location) => {
    const project = archiveAt(location, corruptArchiveCompound('stale cache'));
    expect(prepareProjectForPersistence(project)).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('scene.objects[0].bounds.maxX'),
    });
    expect(deserializeProject(serializeProject(project))).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('archived compound'),
    });
  });

  it.each(ARCHIVE_COMPOUND_LOCATIONS)(
    'preserves canonical sources, ignorable ranks, archive bytes and output through %s',
    (location) => {
      const project = archiveAt(location, compoundArchiveProject());
      const before: string[] = [];
      expect(visitWorkflowArchives(project, (raw) => before.push(JSON.stringify(raw)))).toBeNull();
      const prepared = prepareProjectForPersistence(project);
      expect(prepared.kind).toBe('ok');
      if (prepared.kind !== 'ok') throw new Error(prepared.reason);
      const after: string[] = [];
      expect(
        visitWorkflowArchives(prepared.project, (raw) => after.push(JSON.stringify(raw))),
      ).toBeNull();
      expect(after).toEqual(before);
      expect(prepared.project.sheetBook).toEqual(project.sheetBook);
      expect(prepared.project.productionManifest).toEqual(project.productionManifest);
      expect(prepared.project.arrayLayouts).toEqual(project.arrayLayouts);
      expect(compileJob(prepared.project.scene, DEFAULT_DEVICE_PROFILE)).toEqual(
        compileJob(project.scene, DEFAULT_DEVICE_PROFILE),
      );
      expect(prepareProjectForPersistence(prepared.project)).toMatchObject({
        kind: 'ok',
        json: prepared.json,
      });
    },
  );

  it('keeps top-level Open source-authoritative and top-level Save drift admission unchanged', () => {
    const project = corruptArchiveCompound('stale cache');
    const opened = deserializeProject(serializeProject(project));
    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') throw new Error('Expected source-authoritative top-level Open');
    expect(opened.project.scene.objects[0]?.bounds.maxX).toBe(5);
    expect(prepareProjectForPersistence(project)).toMatchObject({ kind: 'invalid' });
  });

  it('retains legacy archive strings without demanding unrelated normalization', () => {
    const inner = { ...createProject(), schemaVersion: 12 };
    const project = {
      ...createProject(),
      sheetBook: {
        activeId: 'active',
        activeName: 'Active',
        inactive: [{ id: 'legacy', name: 'Legacy', projectJson: JSON.stringify(inner) }],
      },
    };
    const saved = prepareProjectForPersistence(project);
    expect(saved.kind).toBe('ok');
    if (saved.kind !== 'ok') throw new Error(saved.reason);
    expect(saved.project.sheetBook?.inactive[0]?.projectJson).toBe(JSON.stringify(inner));
  });
});
