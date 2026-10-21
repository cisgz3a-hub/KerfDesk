// Audit 13-P2-1 (regression). A LightBurn project with more than 10,000 shapes
// opened, but Save and autosave both refused it and the recovery prompt blamed
// "machine or output settings". The import now checks the loader's limits
// before it replaces the open document (ADR-307 Amendment 2).
//
// jsdom walks a 10,000-shape XML document in minutes, so the shape walk is
// replaced by copies of one real imported shape. Everything after it is the
// real import, the real limit and the real Save preparation.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as geometry from '../../io/lightburn/lbrn-geometry';
import { importLightBurnProject } from '../../io/lightburn/lbrn-import';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { completeLightBurnProjectOpen } from './project-open-completion';

vi.mock('../../io/lightburn/lbrn-geometry', async (importOriginal) => {
  const actual = await importOriginal<typeof geometry>();
  return { ...actual, importLbrnGeometry: vi.fn(actual.importLbrnGeometry) };
});

const ONE_RECT = `<?xml version="1.0"?>
<LightBurnProject AppVersion="1.7.08" FormatVersion="1">
  <CutSetting index="1" type="Cut" speed="10" maxPower="80" numPasses="1" />
  <Shape Type="Rect" CutIndex="1" W="2" H="2"><XForm>1 0 0 1 10 10</XForm></Shape>
</LightBurnProject>`;

async function importWithShapes(count: number): Promise<ReturnType<typeof importLightBurnProject>> {
  const actual = await vi.importActual<typeof geometry>('../../io/lightburn/lbrn-geometry');
  vi.mocked(geometry.importLbrnGeometry).mockImplementationOnce((root, sourceName, frame) => {
    const [shape] = actual.importLbrnGeometry(root, sourceName, frame).objects;
    if (shape === undefined) throw new Error('the sample shape did not import');
    return {
      objects: Array.from({ length: count }, (_, index) => ({
        ...shape,
        id: `lbrn-tags-${index + 1}`,
      })),
      unsupportedShapeTypes: [],
      warnings: [],
    };
  });
  return importLightBurnProject(ONE_RECT, 'tags.lbrn2');
}

afterEach(() => {
  vi.mocked(geometry.importLbrnGeometry).mockClear();
});

describe('LightBurn project open and the project object limit', () => {
  it('opens 10,000 shapes as a project that Save accepts', async () => {
    const imported = await importWithShapes(10_000);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.project.scene.objects).toHaveLength(10_000);
    expect(prepareProjectForPersistence(imported.project).kind).toBe('ok');
  }, 120_000);

  it('refuses 10,001 shapes with the count, and leaves the open document alone', async () => {
    const imported = await importWithShapes(10_001);
    expect(imported).toEqual({
      ok: false,
      reason: expect.stringMatching(/has 10001 shapes.*at most 10000 objects/),
    });

    const setProject = vi.fn();
    const pushToast = vi.fn();
    const opened = completeLightBurnProjectOpen(
      { setProject, markLoaded: vi.fn(), pushToast },
      'tags.lbrn2',
      imported,
    );

    expect(opened).toBe(false);
    expect(setProject).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/^Could not import tags\.lbrn2: This LightBurn project has 10001/),
      'error',
    );
  });
});
