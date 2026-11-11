// Rolling audit v11 W5-P2-1 (ADR-307 Amendment 5): a project holding an object
// past the loader's 1,000,000 mm was refused by Save with
// "missing or invalid `scene.objects[1].bounds.maxX`", autosave blamed image
// size, and the raw recovery copy Save offered was refused on reopen too. The
// importers no longer produce such an object, but any other route still can,
// so the refusals name the object and the recovery copy reopens.
import { describe, expect, it, vi } from 'vitest';
import { projectSaveRequestEpochCallbacks } from '../../__fixtures__/file-actions';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import {
  deserializeProject,
  prepareProjectForAutosave,
  prepareProjectForPersistence,
} from '../../io/project';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { svgObj } from '../state/test-helpers';
import { handleSaveProject } from './file-actions';
import { planRecoveryCopy } from './recovery-copy-plan';
import { AUTOSAVE_FAILURE_MESSAGE, createAutosaveFailureReporter } from './use-autosave';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => false),
  jobAwareAlert: vi.fn(),
}));

const mockConfirm = vi.mocked(jobAwareConfirm);

const SITE: SceneObject = {
  kind: 'imported-svg',
  id: 'site',
  source: 'site.dxf',
  bounds: { minX: 0, minY: 0, maxX: 1_800_010, maxY: 0 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 1_800_010, y: 0 },
          ],
        },
      ],
    },
  ],
};

function projectWithSite(): Project {
  const base = createProject();
  const square = svgObj('square', ['#000000']);
  return { ...base, scene: { ...base.scene, objects: [square, SITE] } };
}

const NAMED =
  /^object 2 \(imported from “site\.dxf”\) has coordinates past the 1,000,000 mm a project file can hold\. Delete it \(or undo its import\) and save again\.$/;

describe('Save and autosave name an out-of-range object', () => {
  it('Save and autosave quote the object, not the validator path', () => {
    const project = projectWithSite();
    const saved = prepareProjectForPersistence(project);
    const autosaved = prepareProjectForAutosave(project);
    expect(saved.kind === 'invalid' && saved.reason).toMatch(NAMED);
    expect(autosaved.kind === 'invalid' && autosaved.reason).toMatch(NAMED);
  });

  it('autosave warns with that reason instead of blaming image size', () => {
    const project = projectWithSite();
    const prepared = prepareProjectForAutosave(project);
    if (prepared.kind !== 'invalid') throw new Error('expected a refusal');
    const pushToast = vi.fn();
    createAutosaveFailureReporter(pushToast)({
      kind: 'failed',
      reason: 'invalid-project',
      error: new Error(prepared.reason),
    });
    expect(pushToast).toHaveBeenCalledTimes(1);
    const [message] = pushToast.mock.calls[0] ?? [];
    expect(message).toMatch(
      /^Autosave cannot keep a recovery copy, and Save will refuse it too: object 2 \(imported from “site\.dxf”\)/,
    );
    expect(message).not.toBe(AUTOSAVE_FAILURE_MESSAGE);
  });

  it('leaves other refusals as the loader words them', () => {
    const project = {
      ...createProject(),
      workspace: { ...createProject().workspace, width: Number.NaN },
    } as Project;
    const saved = prepareProjectForPersistence(project);
    expect(saved.kind === 'invalid' && saved.reason).toBe('missing or invalid `workspace.width`');
  });

  it('plans a recovery copy without the object, which reopens', () => {
    const plan = planRecoveryCopy(projectWithSite());
    expect(plan.leftOut).toEqual(['object 2 (imported from “site.dxf”)']);
    expect(plan.project.scene.objects.map((object) => object.id)).toEqual(['square']);
    expect(prepareProjectForPersistence(plan.project).kind).toBe('ok');
  });

  it('Save offers that copy, writes it, and the file it writes reopens', async () => {
    mockConfirm.mockReturnValue(true);
    let written = '';
    const target: SaveTarget = {
      displayName: 'untitled-recovery.lf2',
      write: async (contents) => {
        written = typeof contents === 'string' ? contents : await contents.text();
      },
    };
    const pickFileForSave = vi.fn(async () => target);
    const pushToast = vi.fn();
    const project = projectWithSite();
    const platform = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave,
      serial: { isSupported: () => false, requestPort: async () => null },
    } satisfies PlatformAdapter;

    await expect(
      handleSaveProject({
        platform,
        project,
        expectedProject: project,
        projectDocumentEpoch: 0,
        getProjectDocumentEpoch: () => 0,
        ...projectSaveRequestEpochCallbacks(),
        savedName: null,
        lastSaveTarget: null,
        markSaved: vi.fn(),
        pushToast,
      }),
    ).resolves.toBe('error');

    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Could not save project: object 2 \(imported from “site\.dxf”\) has coordinates past/,
      ),
      'error',
    );
    expect(mockConfirm).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /Export a recovery copy without object 2 \(imported from “site\.dxf”\) to a new file instead\? Everything else is kept, and the copy opens as a normal project\.$/,
      ),
    );
    expect(pushToast).toHaveBeenCalledWith(
      'Exported a recovery copy to untitled-recovery.lf2 without object 2 (imported from “site.dxf”), which a project file cannot hold. It opens as a normal project.',
      'warning',
    );
    const reopened = deserializeProject(written);
    expect(reopened.kind).toBe('ok');
    if (reopened.kind === 'ok') {
      expect(reopened.project.scene.objects.map((object) => object.id)).toEqual(['square']);
    }
  });
});
