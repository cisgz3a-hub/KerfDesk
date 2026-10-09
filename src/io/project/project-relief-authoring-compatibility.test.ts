import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
} from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import { materializeReliefAuthoring } from '../../core/relief/materialize-relief-authoring';
import { reliefAuthoringError } from '../../core/relief/relief-authoring-validation';
import { reliefCompositionWork } from '../../core/relief/relief-authoring-work';
import { refreshReliefVectorLinks } from '../../core/relief/relief-authoring-links';
import { prepareReliefAuthoringLinks } from '../gcode/prepare-relief-authoring-links';
import { deserializeProject, deserializeProjectValue } from './deserialize-project';
import { serializeProject } from './serialize-project';

// Frozen .lf2 files written and independently reopened at the parent of #1109
// (e4de1ad872cb228ef4003fc0d7efb5970a25a32e), before the mask/rail changes.
function savedProject(name: string): string {
  return gunzipSync(readFileSync(resolve('src/__fixtures__', `${name}.lf2.gz`))).toString('utf8');
}

function savedRelief(name = 'parent-saved-excluded-clip'): {
  project: Project;
  relief: HeightfieldReliefObject;
} {
  const project = JSON.parse(savedProject(name)) as Project;
  return { project, relief: project.scene.objects[0] as HeightfieldReliefObject };
}

describe('retained relief algorithm compatibility', () => {
  it.each([
    'parent-saved-excluded-clip',
    'parent-saved-512px-clipped-import',
    'parent-saved-variable-width-rail',
    'parent-saved-concave-rail',
    'parent-saved-sensitive-coordinate-arithmetic',
  ])(
    'reopens %s without changing its saved field or retained intent',
    (name) => {
      const json = savedProject(name);
      const original = JSON.parse(json) as { scene: { objects: unknown[] } };
      const result = deserializeProject(json);
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error(JSON.stringify(result));
      expect(result.project.scene.objects).toEqual(original.scene.objects);
      const reopened = deserializeProject(serializeProject(result.project));
      expect(reopened.kind).toBe('ok');
      if (reopened.kind === 'ok')
        expect(reopened.project.scene.objects).toEqual(original.scene.objects);
    },
    20_000,
  );

  it('resolves unversioned #1109 output by exact field proof without changing the baked field', () => {
    const { project, relief } = savedRelief();
    if (relief.reliefAuthoring === undefined) throw new Error('Missing intent');
    const current = { ...relief.reliefAuthoring, algorithmRevision: 'retained-relief-v2' as const };
    const materialized = materializeReliefAuthoring(current);
    if (materialized.kind !== 'ok') throw new Error('Missing composition');
    // Independently recorded from exact #1109 before this compatibility repair.
    expect(materialized.field.digest).toBe(
      'sha256:e511cb9d591be95ee03cf2c7601f75b9eb243353f18f557e7402ef336e706826',
    );
    const unversioned = { ...relief, reliefSource: materialized.field };
    const json = JSON.stringify({
      ...project,
      scene: { ...project.scene, objects: [unversioned] },
    });
    const result = deserializeProject(json);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error(JSON.stringify(result));
    expect(result.project.scene.objects[0]).toEqual({
      ...unversioned,
      reliefAuthoring: current,
    });
    const reopened = deserializeProject(serializeProject(result.project));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind === 'ok')
      expect(reopened.project.scene.objects[0]).toEqual(result.project.scene.objects[0]);
    const book = deserializeProject(
      JSON.stringify({
        ...createProject(),
        sheetBook: {
          activeId: 'active',
          activeName: 'Active',
          inactive: [{ id: 'corrected', name: 'Corrected relief', projectJson: json }],
        },
      }),
    );
    expect(book.kind).toBe('ok');
    if (book.kind !== 'ok') throw new Error(JSON.stringify(book));
    const archive = book.project.sheetBook?.inactive[0]?.projectJson;
    expect(archive).toBe(json);
    const activated = deserializeProject(archive ?? '');
    expect(activated.kind).toBe('ok');
    if (activated.kind === 'ok')
      expect(activated.project.scene.objects[0]).toEqual(result.project.scene.objects[0]);
  });

  it('retains the legacy work cap and applies the current cap to whole-cell composition', () => {
    const { relief } = savedRelief('parent-saved-512px-clipped-import');
    const doc = relief.reliefAuthoring;
    if (doc === undefined) throw new Error('Missing intent');
    expect(reliefCompositionWork(doc)).toBe(4_456_448);
    expect(reliefAuthoringError(doc)).toBeNull();
    const current = { ...doc, algorithmRevision: 'retained-relief-v2' as const };
    expect(reliefCompositionWork(current)).toBe(33_816_576);
    expect(materializeReliefAuthoring(current)).toMatchObject({
      kind: 'error',
      reason: expect.stringContaining('work budget'),
    });
    expect(reliefAuthoringError({ ...doc, width: 2048, height: 2048 })).toMatch(/cells/);
  });

  it.each(['retained-relief-v1', 'retained-relief-v2', 'retained-relief-v99'])(
    'rejects a stale field or unsupported %s interpretation',
    (algorithmRevision) => {
      const { project, relief } = savedRelief();
      const doc = relief.reliefAuthoring;
      if (doc === undefined) throw new Error('Missing intent');
      const stale = {
        ...relief,
        reliefAuthoring: { ...doc, algorithmRevision, baselineHeightMm: 1, components: [] },
      };
      expect(
        deserializeProject(
          JSON.stringify({ ...project, scene: { ...project.scene, objects: [stale] } }),
        ).kind,
      ).toBe('invalid');
    },
  );

  it('does not reinterpret a labelled v2 field using v1 rules', () => {
    const { project, relief } = savedRelief();
    const stale = {
      ...relief,
      reliefAuthoring: { ...relief.reliefAuthoring, algorithmRevision: 'retained-relief-v2' },
    };
    expect(
      deserializeProject(
        JSON.stringify({ ...project, scene: { ...project.scene, objects: [stale] } }),
      ),
    ).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('does not match') });
  });

  it.each([
    { algorithmRevision: ['retained-relief-v1'] },
    { algorithmRevision: ['retained-relief-v2'] },
    { algorithmRevision: null },
    { algorithmRevision: 1 },
    { algorithmRevision: {} },
  ])('rejects a nonliteral algorithm marker $algorithmRevision', ({ algorithmRevision }) => {
    const { relief } = savedRelief();
    expect(reliefAuthoringError({ ...relief.reliefAuthoring, algorithmRevision })).toMatch(
      /Unsupported/,
    );
  });

  it('resolves shared document aliases independently for each saved field owner', () => {
    const { project, relief } = savedRelief();
    const doc = relief.reliefAuthoring;
    if (doc === undefined) throw new Error('Missing intent');
    const current = materializeReliefAuthoring({ ...doc, algorithmRevision: 'retained-relief-v2' });
    if (current.kind !== 'ok') throw new Error('Missing corrected field');
    const unversioned = { ...relief, id: 'other-relief', reliefSource: current.field };
    const raw = structuredClone({
      ...project,
      scene: { ...project.scene, objects: [relief, unversioned] },
    });
    expect(raw.scene.objects[0]?.reliefAuthoring).toBe(raw.scene.objects[1]?.reliefAuthoring);
    const result = deserializeProjectValue(raw);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error(JSON.stringify(result));
    const first = result.project.scene.objects[0] as HeightfieldReliefObject;
    const second = result.project.scene.objects[1] as HeightfieldReliefObject;
    expect(first).toEqual(relief);
    expect(second.reliefAuthoring?.algorithmRevision).toBe('retained-relief-v2');
    expect(second.reliefSource).toEqual(unversioned.reliefSource);
    expect(deserializeProject(serializeProject(result.project)).kind).toBe('ok');
  });

  it('retains detached legacy triangle geometry and its field through output link preparation', () => {
    const { project, relief } = savedRelief('parent-saved-concave-rail');
    const enabled: Project = {
      ...project,
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        ...project.scene,
        layers: [createLayer({ id: 'relief-output', color: relief.color })],
      },
    };
    const prepared = prepareReliefAuthoringLinks(enabled, enabled.scene);
    expect(prepared.kind).toBe('ok');
    if (prepared.kind === 'ok') expect(prepared.scene).toBe(enabled.scene);
    expect(relief.reliefAuthoring?.algorithmRevision).toBe('retained-relief-v1');
  });

  it('refreshes a legacy linked rail without silently upgrading its interpretation', () => {
    const { relief } = savedRelief('parent-saved-variable-width-rail');
    const doc = relief.reliefAuthoring;
    const component = doc?.components[0];
    if (doc === undefined || component?.source.kind !== 'rail-profile-v1')
      throw new Error('Missing rail intent');
    const source = component.source;
    const linked = {
      ...doc,
      components: [
        { ...component, source: { ...source, rail: { ...source.rail, linkedObjectId: 'rail' } } },
      ],
    };
    const guide = {
      kind: 'imported-svg' as const,
      id: 'rail',
      source: 'rail.svg',
      transform: { ...relief.transform, x: relief.transform.x + 0.1 },
      bounds: relief.bounds,
      paths: [{ color: relief.color, polylines: [{ closed: false, points: source.rail.points }] }],
    };
    const result = refreshReliefVectorLinks(linked, [guide], relief.transform);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.changed).toBe(true);
    expect(result.document.revision).toBe(linked.revision + 1);
    expect(result.document.algorithmRevision).toBe('retained-relief-v1');
    expect(materializeReliefAuthoring(result.document).kind).toBe('ok');
  });

  it.each(['parent-saved-excluded-clip', 'parent-saved-concave-rail'])(
    'loads an inactive sheet containing %s and resolves it again on opening',
    (name) => {
      const projectJson = savedProject(name);
      const book = {
        ...createProject(),
        sheetBook: {
          activeId: 'active',
          activeName: 'Active',
          inactive: [{ id: 'legacy', name: 'Legacy relief', projectJson }],
        },
      };
      const loaded = deserializeProject(JSON.stringify(book));
      expect(loaded.kind).toBe('ok');
      if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
      const archive = loaded.project.sheetBook?.inactive[0]?.projectJson;
      expect(archive).toBe(projectJson);
      const opened = deserializeProject(archive ?? '');
      expect(opened.kind).toBe('ok');
      if (opened.kind === 'ok')
        expect(opened.project.scene.objects).toEqual(savedRelief(name).project.scene.objects);
    },
  );
});
