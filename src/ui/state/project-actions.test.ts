import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { dependencyProject, shapeObject } from './testing/scene-clipboard-fixtures';

describe('project actions', () => {
  beforeEach(resetStore);

  it('retains the scene clipboard across Open and New document lifecycles', () => {
    const sourceObject = { ...shapeObject(), id: 'source' };
    useStore.setState({ project: dependencyProject([sourceObject]) });
    useStore.getState().selectObject(sourceObject.id);
    useStore.getState().copySelection();
    const clipboard = useStore.getState().sceneClipboard;

    useStore.getState().setProject(createProject());
    expect(useStore.getState().sceneClipboard).toBe(clipboard);

    useStore.getState().newProject();
    expect(useStore.getState().sceneClipboard).toBe(clipboard);
  });
});
