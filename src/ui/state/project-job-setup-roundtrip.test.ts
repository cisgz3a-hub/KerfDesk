import { beforeEach, describe, expect, it } from 'vitest';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { currentOutputScope } from './output-scope-state';
import { projectWithCurrentJobSetup } from './project-job-setup';
import { resetStore, svgObj } from './test-helpers';

describe('project-owned placement and output scope', () => {
  beforeEach(() => resetStore());

  it('restores setup and produces byte-identical prepared output after save/reopen', () => {
    useStore.getState().importSvgObject(svgObj('first', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('second', ['#0000ff']));
    useStore.getState().selectObject('second');
    useStore.getState().setJobPlacement({ startFrom: 'user-origin', anchor: 'center' });
    useStore.getState().setOutputScopeSettings({
      cutSelectedGraphics: true,
      useSelectionOrigin: true,
    });
    const before = useStore.getState();
    const savedProject = projectWithCurrentJobSetup(before);
    const beforeBytes = preparedBytes(
      savedProject,
      before.jobPlacement,
      currentOutputScope(before),
    );

    const loaded = deserializeProject(serializeProject(savedProject));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    useStore.getState().setProject(loaded.project);
    const after = useStore.getState();
    const afterBytes = preparedBytes(after.project, after.jobPlacement, currentOutputScope(after));

    expect(after.jobPlacement).toEqual({ startFrom: 'user-origin', anchor: 'center' });
    expect(after.outputScopeSettings).toEqual({
      cutSelectedGraphics: true,
      useSelectionOrigin: true,
    });
    expect(after.selectedObjectId).toBe('second');
    expect(afterBytes).toBe(beforeBytes);
  });

  it('migrates schema v3 files to an explicit full-job setup', () => {
    const raw = JSON.parse(
      serializeProject(projectWithCurrentJobSetup(useStore.getState())),
    ) as Record<string, unknown>;
    raw['schemaVersion'] = 3;
    delete raw['jobSetup'];

    const loaded = deserializeProject(JSON.stringify(raw));

    expect(loaded).toMatchObject({
      kind: 'ok',
      migratedFrom: 3,
      project: {
        jobSetup: {
          placement: { startFrom: 'user-origin', anchor: 'front-left' },
          outputScope: {
            cutSelectedGraphics: false,
            useSelectionOrigin: false,
            selectedObjectIds: [],
          },
        },
      },
    });
  });
});

function preparedBytes(
  project: ReturnType<typeof useStore.getState>['project'],
  jobOrigin: ReturnType<typeof useStore.getState>['jobPlacement'],
  outputScope: ReturnType<typeof currentOutputScope>,
): string {
  if (jobOrigin.startFrom !== 'user-origin') throw new Error('test expects user-origin placement');
  const prepared = prepareOutput(project, {
    jobOrigin: { startFrom: 'user-origin', anchor: jobOrigin.anchor },
    outputScope,
  });
  if (!prepared.ok)
    throw new Error(prepared.preflight.issues.map((issue) => issue.message).join(' / '));
  return emitPreparedGcode(prepared).gcode;
}
