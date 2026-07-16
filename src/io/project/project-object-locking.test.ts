import { describe, expect, it } from 'vitest';
import { addObject, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project object locking IO', () => {
  it('round-trips object locked state', () => {
    const base = createProject();
    const project: Project = {
      ...base,
      scene: addObject(base.scene, {
        kind: 'imported-svg',
        id: 'locked-art',
        source: 'locked.svg',
        locked: true,
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        transform: IDENTITY_TRANSFORM,
        paths: [],
      }),
    };

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.scene.objects[0]?.locked).toBe(true);
    }
  });

  it('rejects malformed locked state', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['scene'] = {
      objects: [
        {
          kind: 'imported-svg',
          id: 'bad-lock',
          source: 'bad.svg',
          locked: 'yes',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [],
        },
      ],
      layers: [],
      groups: [],
    };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('scene.objects[0].locked');
    }
  });

  // CAM-04: registration-box provenance distinguishes a captured board (Place
  // Board) from a jig outline so the jig panel can protect the captured board.
  it('round-trips a captured-board shape provenance', () => {
    const base = createProject();
    const project: Project = {
      ...base,
      scene: addObject(base.scene, {
        kind: 'shape',
        id: 'board',
        spec: { kind: 'rect', widthMm: 80, heightMm: 40, cornerRadiusMm: 0 },
        color: '#123456',
        locked: true,
        provenance: 'captured-board',
        bounds: { minX: 0, minY: 0, maxX: 80, maxY: 40 },
        transform: IDENTITY_TRANSFORM,
        paths: [],
      }),
    };

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const obj = result.project.scene.objects[0];
      expect(obj?.kind).toBe('shape');
      if (obj?.kind === 'shape') expect(obj.provenance).toBe('captured-board');
    }
  });

  // ADR-214: the pen-drawing fairing marker must survive save/load so a future
  // build recognizes an already-faired drawing by its stamp.
  it('round-trips a shape fairing version marker', () => {
    const base = createProject();
    const project: Project = {
      ...base,
      scene: addObject(base.scene, {
        kind: 'shape',
        id: 'drawing',
        spec: { kind: 'polyline', points: [], closed: false },
        color: '#123456',
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        transform: IDENTITY_TRANSFORM,
        paths: [],
        fairingVersion: 1,
      }),
    };

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const obj = result.project.scene.objects[0];
      if (obj?.kind === 'shape') expect(obj.fairingVersion).toBe(1);
    }
  });

  it('rejects a malformed shape fairing version', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['scene'] = {
      objects: [
        {
          kind: 'shape',
          id: 'bad-fairing',
          spec: { kind: 'rect', widthMm: 80, heightMm: 40, cornerRadiusMm: 0 },
          color: '#123456',
          fairingVersion: -1,
          bounds: { minX: 0, minY: 0, maxX: 80, maxY: 40 },
          transform: IDENTITY_TRANSFORM,
          paths: [],
        },
      ],
      layers: [],
      groups: [],
    };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('scene.objects[0].fairingVersion');
    }
  });

  it('rejects a malformed shape provenance value', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['scene'] = {
      objects: [
        {
          kind: 'shape',
          id: 'bad-prov',
          spec: { kind: 'rect', widthMm: 80, heightMm: 40, cornerRadiusMm: 0 },
          color: '#123456',
          provenance: 'nonsense',
          bounds: { minX: 0, minY: 0, maxX: 80, maxY: 40 },
          transform: IDENTITY_TRANSFORM,
          paths: [],
        },
      ],
      layers: [],
      groups: [],
    };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('scene.objects[0].provenance');
    }
  });
});
