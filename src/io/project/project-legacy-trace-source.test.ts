// ADR-673 and its Amendment 1: builds up to 1.0.27 saved a picture kept behind
// a trace with `role: 'trace-source'` and left it out of every job. Such a
// project still opens and the marker is dropped, but the picture keeps the job
// it had: its Image operation opens with Output off (or it moves to an
// output-off copy of one other artwork shares), a kept photo is counted so the
// reader can say so, and the next save no longer writes the marker.
import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { operationIdsForObject, type Project, type RasterImage } from '../../core/scene';
import { CAMERA_CAPTURE_SOURCE } from '../../core/scene/reference-image-output';
import {
  legacyPhoto as photo,
  legacyTrace as trace,
  legacyTraceDocument as legacyDocument,
} from '../../__fixtures__/legacy-trace-source-project';
import { deserializeProject } from './deserialize-project';
import type { LoadedProject } from './project-load-metadata';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';

function loaded(text: string): LoadedProject {
  const result = deserializeProject(text);
  if (result.kind !== 'ok') throw new Error(`load failed: ${result.kind}`);
  return result;
}

function load(text: string): Project {
  return loaded(text).project;
}

function jobKinds(project: Project): string[] {
  return compileJob(project.scene, project.device).groups.map((group) => group.kind);
}

function rasterSources(project: Project): Array<string | undefined> {
  return compileJob(project.scene, project.device).groups.flatMap((group) =>
    group.kind === 'raster' ? [group.sourceObjectId] : [],
  );
}

function operationOf(project: Project, objectId: string) {
  const object = project.scene.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) throw new Error(`missing ${objectId}`);
  const ids = operationIdsForObject(object, project.scene.layers);
  return { ids, layers: project.scene.layers.filter((layer) => ids.includes(layer.id)) };
}

describe('a project saved with the legacy trace-source marker (ADR-673 Amendment 1)', () => {
  it('opens with the kept photo out of the job, its operation Output off, and counts it', () => {
    const result = loaded(legacyDocument());
    const [loadedPhoto, loadedTrace] = result.project.scene.objects;

    expect(loadedPhoto).toMatchObject({ kind: 'raster-image', id: 'photo' });
    expect(loadedPhoto).not.toHaveProperty('role');
    expect(loadedTrace).toMatchObject({ kind: 'traced-image', traceSourceId: 'photo' });
    expect(operationOf(result.project, 'photo').ids).toEqual(['photo-operation']);
    expect(
      result.project.scene.layers.find((layer) => layer.id === 'photo-operation')?.output,
    ).toBe(false);
    // The trace-only job 1.0.27 ran.
    expect(jobKinds(result.project)).toEqual(['cut']);
    expect(result.keptTracePhotosOff).toBe(1);
    expect(result.migratedFrom).toBeUndefined();
  });

  it('engraves the photo once its operation Output is turned back on', () => {
    const project = load(legacyDocument());
    const turnedOn: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) => ({ ...layer, output: true })),
      },
    };
    expect(jobKinds(turnedOn)).toEqual(['raster', 'cut']);
  });

  it('saves without the marker and without validation drift, and reopens without a notice', () => {
    const project = load(legacyDocument());
    const prepared = prepareProjectForPersistence(project);

    expect(prepared.kind).toBe('ok');
    expect(serializeProject(project)).not.toContain('trace-source');
    const reopened = loaded(serializeProject(project));
    expect(reopened.keptTracePhotosOff).toBeUndefined();
    expect(jobKinds(reopened.project)).toEqual(['cut']);
  });

  it('a project without the marker carries no notice', () => {
    expect(loaded(legacyDocument([photo, trace], [])).keptTracePhotosOff).toBeUndefined();
  });

  it('still refuses a role this build does not know', () => {
    const unknownRole = legacyDocument().replace('"trace-source"', '"reference"');
    expect(deserializeProject(unknownRole).kind).toBe('invalid');
  });

  it('keeps a raster trace result engraving where it shared the photo operation', () => {
    const rasterResult: RasterImage = {
      ...photo,
      id: 'raster-trace',
      source: 'portrait.jpg (trace bitmap)',
      traceSourceId: photo.id,
    };
    const project = load(legacyDocument([photo, rasterResult]));
    const photoOperation = operationOf(project, 'photo');

    expect(photoOperation.ids).not.toContain('photo-operation');
    expect(photoOperation.layers).toEqual([
      expect.objectContaining({ mode: 'image', output: false }),
    ]);
    expect(project.scene.layers.find((layer) => layer.id === 'photo-operation')?.output).toBe(true);
    // No double exposure: only the result engraves, as in 1.0.27.
    expect(rasterSources(project)).toEqual(['raster-trace']);
    expect(prepareProjectForPersistence(project).kind).toBe('ok');
  });

  it('keeps an ordinary image on the same operation engraving', () => {
    const otherPhoto: RasterImage = { ...photo, id: 'other-photo', source: 'other.jpg' };
    const result = loaded(legacyDocument([photo, otherPhoto, trace]));

    expect(rasterSources(result.project)).toEqual(['other-photo']);
    expect(operationOf(result.project, 'photo').layers).toEqual([
      expect.objectContaining({ output: false }),
    ]);
    expect(result.keptTracePhotosOff).toBe(1);
  });

  it('counts each kept photo', () => {
    const second: RasterImage = { ...photo, id: 'second', source: 'second.jpg' };
    const result = loaded(legacyDocument([photo, second, trace], ['photo', 'second']));

    expect(result.keptTracePhotosOff).toBe(2);
    expect(jobKinds(result.project)).toEqual(['cut']);
    expect(prepareProjectForPersistence(result.project).kind).toBe('ok');
  });

  it('keeps a legacy kept camera capture out of the job on its own operation, with no notice', () => {
    const capture: RasterImage = { ...photo, source: CAMERA_CAPTURE_SOURCE };
    const result = loaded(legacyDocument([capture, trace]));
    const loadedCapture = result.project.scene.objects[0];
    if (loadedCapture === undefined) throw new Error('missing capture');

    expect(loadedCapture).not.toHaveProperty('role');
    expect(operationOf(result.project, capture.id).ids).toEqual(['photo-operation']);
    expect(
      result.project.scene.layers.find((layer) => layer.id === 'photo-operation')?.output,
    ).toBe(false);
    expect(jobKinds(result.project)).toEqual(['cut']);
    expect(result.keptTracePhotosOff).toBeUndefined();
    expect(prepareProjectForPersistence(result.project).kind).toBe('ok');
  });

  it('moves a legacy camera capture off an operation its raster trace shares', () => {
    const capture: RasterImage = { ...photo, source: CAMERA_CAPTURE_SOURCE };
    const rasterResult: RasterImage = {
      ...photo,
      id: 'raster-trace',
      source: 'camera capture (trace bitmap)',
      traceSourceId: capture.id,
    };
    const project = load(legacyDocument([capture, rasterResult]));
    const captureOperation = operationOf(project, capture.id);

    expect(captureOperation.ids).not.toContain('photo-operation');
    expect(captureOperation.layers).toEqual([
      expect.objectContaining({ mode: 'image', output: false }),
    ]);
    expect(project.scene.layers.find((layer) => layer.id === 'photo-operation')?.output).toBe(true);
    expect(rasterSources(project)).toEqual(['raster-trace']);
    expect(prepareProjectForPersistence(project).kind).toBe('ok');
  });
});
