import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import {
  appendReliefStroke,
  createReliefAuthoringDocument,
} from '../../core/relief/relief-authoring-document';
import { materializeReliefAuthoring } from '../../core/relief/materialize-relief-authoring';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';
import { validateReliefAuthoringObject } from './project-relief-authoring-validator';
import {
  importReliefComponentAsset,
  parseReliefComponentAsset,
  reliefComponentAsset,
} from './relief-component-asset';

function relief(): HeightfieldReliefObject {
  const source = testReliefHeightfield({
    width: 3,
    height: 3,
    physicalWidthMm: 3,
    physicalHeightMm: 3,
    maxDepthMm: 5,
    samplesU16: [100, 1000, 31000, 32768, 40000, 60000, 65500, 20000, 4000],
  });
  const document = appendReliefStroke(createReliefAuthoringDocument(source), {
    schemaVersion: 1,
    id: 'stroke-1',
    componentId: 'source-1',
    mode: 'flatten',
    diameterMm: 2,
    strength: 0.3,
    flattenHeightMm: 2.123456789,
    points: [{ x: 1.5, y: 1.5 }],
  });
  const materialized = materializeReliefAuthoring(document);
  if (materialized.kind !== 'ok') throw new Error('Bad fixture');
  return {
    kind: 'relief',
    id: 'R1',
    source: 'Editable',
    targetWidthMm: 3,
    reliefDepthMm: 5,
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 3 },
    color: '#a0522d',
    transform: IDENTITY_TRANSFORM,
    reliefSource: materialized.field,
    reliefAuthoring: document,
  };
}
const record = (value: unknown) => value as Record<string, unknown>;

describe('retained relief persistence', () => {
  it('save/reopen retains original source codes, strokes, dimensions and exact materialised field', () => {
    const object = relief();
    const project = { ...createProject(), scene: { objects: [object], layers: [] } };
    const reopened = deserializeProject(serializeProject(project));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') throw new Error('Project did not reopen.');
    expect(reopened.project.scene.objects[0]).toEqual(object);
    expect(validateReliefAuthoringObject(record(object), 'relief')).toBeNull();
  });
  it('rejects changed retained intent with an older baked field, even at the same revision', () => {
    const object = relief();
    const doc = object.reliefAuthoring;
    if (doc === undefined) throw new Error('Missing authoring');
    const modified = {
      ...object,
      reliefAuthoring: {
        ...doc,
        baselineHeightMm: 4,
        components: doc.components.map((c) => ({ ...c, combineMode: 'add' })),
      },
    };
    expect(validateReliefAuthoringObject(record(modified), 'relief')).toMatch(/does not match/);
    const project = { ...createProject(), scene: { objects: [modified], layers: [] } };
    expect(deserializeProject(JSON.stringify(project)).kind).toBe('invalid');
  });
  it('rejects damaged retained source bytes and stale physical or revision bindings', () => {
    const object = relief();
    const doc = object.reliefAuthoring;
    if (doc === undefined) throw new Error('Missing authoring');
    const component = doc.components[0];
    if (component?.source.kind !== 'retained-field-v1') throw new Error('Missing source');
    const damaged = {
      ...object,
      reliefAuthoring: {
        ...doc,
        components: [
          {
            ...component,
            source: {
              ...component.source,
              field: { ...component.source.field, samplesBase64: 'AAAA' },
            },
          },
        ],
      },
    };
    expect(validateReliefAuthoringObject(record(damaged), 'relief')).toMatch(/length/);
    expect(
      validateReliefAuthoringObject(
        record({ ...object, reliefAuthoring: { ...doc, revision: 20 } }),
        'relief',
        { verifyComposition: false },
      ),
    ).toMatch(/revision/);
    expect(
      validateReliefAuthoringObject(
        record({ ...object, reliefAuthoring: { ...doc, physicalWidthMm: 8 } }),
        'relief',
        { verifyComposition: false },
      ),
    ).toMatch(/physical/);
  });
  it('reusable local component files detach external links and preserve units/source/strokes', () => {
    const object = relief();
    const doc = object.reliefAuthoring;
    if (doc === undefined) throw new Error('Missing authoring');
    const component = doc.components[0];
    if (component === undefined) throw new Error('Missing component');
    const linked = {
      ...component,
      mask: {
        linkedObjectId: 'V1',
        rings: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 3, y: 0 },
              { x: 3, y: 3 },
              { x: 0, y: 3 },
            ],
          },
        ],
      },
    };
    const asset = reliefComponentAsset(doc, linked);
    expect(asset.component.mask?.linkedObjectId).toBeUndefined();
    expect(asset.units).toBe('mm');
    const reopened = parseReliefComponentAsset(JSON.stringify(asset));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') throw new Error('Project did not reopen.');
    const imported = importReliefComponentAsset(doc, reopened.asset, 'copy-1');
    expect(imported.components.at(-1)?.id).toBe('copy-1');
    expect(imported.strokes.at(-1)?.componentId).toBe('copy-1');
    expect(imported.strokes.at(-1)?.flattenHeightMm).toBe(2.123456789);
    expect(imported.revision).toBe(doc.revision + 1);
  });
  it('rejects unrecognised component units and malformed stroke payloads', () => {
    const object = relief();
    const doc = object.reliefAuthoring;
    if (doc === undefined || doc.components[0] === undefined) throw new Error('Missing authoring');
    const asset = reliefComponentAsset(doc, doc.components[0]);
    expect(parseReliefComponentAsset(JSON.stringify({ ...asset, units: 'inches' })).kind).toBe(
      'error',
    );
    expect(parseReliefComponentAsset(JSON.stringify({ ...asset, strokes: null })).kind).toBe(
      'error',
    );
  });
});
