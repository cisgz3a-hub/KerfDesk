// Regression pins for two save-blocking data traps found by the 2026-07-25 CNC
// audit: a policy cap on tab-anchor count inside a shape validator (3.1), and a
// cross-field tiling rule the UI freely violates (3.2). Both made a project the
// app itself produced impossible to save.

import { describe, expect, it } from 'vitest';
import {
  addObject,
  createProject,
  IDENTITY_TRANSFORM,
  type CncTabAnchor,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

// A 140-part nest on a profile-outside layer at the default 4 tabs/shape. An
// SVG import buckets every same-colour contour into ONE object, so all 560
// anchors land on a single object.
const NEST_ANCHOR_COUNT = 560;

function anchors(count: number): CncTabAnchor[] {
  return Array.from({ length: count }, (_unused, index) => ({
    layerColor: '#ff0000',
    pathIndex: 0,
    polylineIndex: index,
    pathT: (index % 4) / 4,
  }));
}

function projectWithAnchorCount(count: number): Project {
  const base = createProject();
  return {
    ...base,
    scene: addObject(base.scene, {
      kind: 'imported-svg',
      id: 'nest',
      source: 'nest.svg',
      bounds: { minX: 0, minY: 0, maxX: 400, maxY: 400 },
      transform: IDENTITY_TRANSFORM,
      paths: [],
      cncTabAnchors: anchors(count),
    }),
  };
}

describe('CNC tab anchors have no count limit (audit 3.1)', () => {
  it('saves and reloads a 140-part nest at the default 4 tabs per shape', () => {
    const result = deserializeProject(serializeProject(projectWithAnchorCount(NEST_ANCHOR_COUNT)));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.scene.objects[0]?.cncTabAnchors).toHaveLength(NEST_ANCHOR_COUNT);
  });

  it('still rejects a structurally invalid anchor at any position past the old cap', () => {
    const raw = JSON.parse(serializeProject(projectWithAnchorCount(600))) as Record<
      string,
      unknown
    >;
    const scene = raw['scene'] as { objects: Array<Record<string, unknown>> };
    const list = scene.objects[0]!['cncTabAnchors'] as Array<Record<string, unknown>>;
    list[513] = { layerColor: '#ff0000', pathIndex: 0, polylineIndex: 1, pathT: 1.5 };
    const result = deserializeProject(JSON.stringify(raw));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('cncTabAnchors[513].pathT');
  });
});

describe('CNC tiling overlap survives load (audit 3.2)', () => {
  it('keeps a tiling block whose overlap is at or above the smaller tile side', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['machine'] = {
      kind: 'cnc',
      tiling: { tileWidthMm: 60, tileHeightMm: 60, overlapMm: 100, registrationHoles: false },
    };
    const result = deserializeProject(JSON.stringify(raw));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const machine = result.project.machine;
    expect(machine?.kind === 'cnc' ? machine.tiling?.overlapMm : null).toBe(100);
  });

  it('still drops a structurally invalid overlap', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['machine'] = {
      kind: 'cnc',
      tiling: { tileWidthMm: 60, tileHeightMm: 60, overlapMm: -1, registrationHoles: false },
    };
    const result = deserializeProject(JSON.stringify(raw));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const machine = result.project.machine;
    expect(machine?.kind === 'cnc' ? machine.tiling : undefined).toBeUndefined();
  });
});
