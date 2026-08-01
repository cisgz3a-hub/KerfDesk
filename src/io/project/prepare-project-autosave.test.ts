import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForAutosave } from './prepare-project-autosave';
import { prepareProjectForPersistence } from './prepare-project-persistence';

function projectWithRaster(): Project {
  const base = createProject();
  const image: SceneObject = {
    kind: 'raster-image',
    id: 'img-1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
  return { ...base, scene: { ...base.scene, objects: [image] } };
}

describe('prepareProjectForAutosave', () => {
  it('produces JSON that deserializes back to the same project as the manual-save path', () => {
    const project = projectWithRaster();

    const autosaved = prepareProjectForAutosave(project);
    const saved = prepareProjectForPersistence(project);
    expect(autosaved.kind).toBe('ok');
    expect(saved.kind).toBe('ok');
    if (autosaved.kind !== 'ok' || saved.kind !== 'ok') return;

    // The autosave slot stores the PRE-normalization serialization, so the two
    // strings may differ; what must not differ is the project recovery yields.
    const fromAutosave = deserializeProject(autosaved.json);
    const fromSave = deserializeProject(saved.json);
    expect(fromAutosave.kind).toBe('ok');
    expect(fromSave.kind).toBe('ok');
    if (fromAutosave.kind !== 'ok' || fromSave.kind !== 'ok') return;
    expect(fromAutosave.project).toEqual(fromSave.project);
  });

  it('keeps the write-time validation signal for a structurally invalid project', () => {
    const base = projectWithRaster();
    const broken = {
      ...base,
      scene: {
        ...base.scene,
        // pixelWidth must be a positive number; a string is the shape an import
        // or extension can leave behind and is what validation exists to catch.
        objects: [{ ...base.scene.objects[0], pixelWidth: 'wide' }],
      },
    } as unknown as Project;

    const result = prepareProjectForAutosave(broken);

    expect(result.kind).toBe('invalid');
  });

  it('reports a reason rather than throwing when the project cannot serialize', () => {
    const cyclic = createProject() as unknown as Record<string, unknown>;
    cyclic['self'] = cyclic;

    const result = prepareProjectForAutosave(cyclic as unknown as Project);

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
