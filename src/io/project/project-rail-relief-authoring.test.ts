import { expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import type { ReliefRailProfileSource } from '../../core/scene/relief/relief-rail-profile';
import { createBlankReliefAuthoringDocument } from '../../core/relief/relief-authoring-document';
import { materializeReliefAuthoring } from '../../core/relief/materialize-relief-authoring';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';
import { reliefComponentAsset, parseReliefComponentAsset } from './relief-component-asset';

it('reopens positioned rail intent exactly and detaches project links in a reusable asset', () => {
  const source: ReliefRailProfileSource = {
    kind: 'rail-profile-v1',
    rail: {
      linkedObjectId: 'left',
      linkComponentTransform: IDENTITY_TRANSFORM,
      points: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
      ],
    },
    secondRail: {
      linkedObjectId: 'right',
      reversed: false,
      points: [
        { x: 0, y: 4 },
        { x: 8, y: 5 },
      ],
    },
    widthMm: 4,
    samplingSteps: 8,
    sections: [0, 0.4, 1].map((position, i) => ({
      id: `section-${i}`,
      position,
      widthScale: 1 + i / 10,
      profile: [
        { x: 0, y: 0 },
        { x: 0.3, y: 2.123456789 + i / 10 },
        { x: 1, y: 0 },
      ],
    })),
  };
  const component = {
    id: 'rail',
    name: 'Rail asset',
    levelId: 'level-1',
    visible: true,
    combineMode: 'replace' as const,
    transform: IDENTITY_TRANSFORM,
    baseHeightMm: 0.123456789,
    heightScale: 1,
    source,
  };
  const document = {
    ...createBlankReliefAuthoringDocument({
      width: 32,
      height: 32,
      physicalWidthMm: 8,
      physicalHeightMm: 6,
      maxDepthMm: 4,
    }),
    revision: 3,
    components: [component],
  };
  const composed = materializeReliefAuthoring(document);
  if (composed.kind !== 'ok')
    throw new Error(composed.kind === 'error' ? composed.reason : 'Cancelled');
  const object: HeightfieldReliefObject = {
    kind: 'relief',
    id: 'R1',
    source: 'Ruled scalar surface',
    color: '#a0522d',
    targetWidthMm: 8,
    reliefDepthMm: 4,
    bounds: { minX: 0, minY: 0, maxX: 8, maxY: 6 },
    transform: IDENTITY_TRANSFORM,
    reliefSource: composed.field,
    reliefAuthoring: document,
  };
  const reopened = deserializeProject(
    serializeProject({ ...createProject(), scene: { objects: [object], layers: [] } }),
  );
  if (reopened.kind !== 'ok') throw new Error('Project did not reopen.');
  expect(reopened.project.scene.objects[0]).toEqual(object);
  const asset = reliefComponentAsset(document, component),
    parsed = parseReliefComponentAsset(JSON.stringify(asset));
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const restored = parsed.asset.component.source;
  if (restored.kind !== 'rail-profile-v1') throw new Error('Missing rail source.');
  expect(restored.rail.linkedObjectId).toBeUndefined();
  expect(restored.secondRail?.linkedObjectId).toBeUndefined();
  expect(restored.sections).toEqual(source.sections);
  expect(restored.secondRail?.reversed).toBe(false);
});
