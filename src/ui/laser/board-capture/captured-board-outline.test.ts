import { describe, expect, it } from 'vitest';
import { createProject, createRegistrationLayer } from '../../../core/scene';
import {
  createRegistrationBox,
  createRegistrationCircle,
  createRegistrationOutline,
} from '../../../core/shapes';
import { capturedBoardOutlineMatches } from './captured-board-outline';

describe('capturedBoardOutlineMatches', () => {
  it('requires the bound captured-board id, shape, and visible size', () => {
    const project = createProject();
    const rect = {
      ...createRegistrationBox({ id: 'board', widthMm: 100, heightMm: 60, x: 10, y: 20 }),
      provenance: 'captured-board' as const,
      locked: true,
    };
    const scene = {
      ...project.scene,
      layers: [...project.scene.layers, createRegistrationLayer()],
      objects: [...project.scene.objects, rect],
    };
    const geometry = {
      kind: 'rect' as const,
      origin: { x: 5, y: 8 },
      widthMm: 100,
      heightMm: 60,
    };
    expect(capturedBoardOutlineMatches(scene, 'board', geometry)).toBe(true);
    expect(capturedBoardOutlineMatches(scene, 'other', geometry)).toBe(false);
    expect(capturedBoardOutlineMatches(scene, 'board', { ...geometry, widthMm: 110 })).toBe(false);
  });

  it('rejects a different outline kind even when its bounds match', () => {
    const project = createProject();
    const circle = {
      ...createRegistrationCircle({ id: 'board', diameterMm: 80, x: 10, y: 20 }),
      provenance: 'captured-board' as const,
      locked: true,
    };
    const scene = {
      ...project.scene,
      layers: [...project.scene.layers, createRegistrationLayer()],
      objects: [...project.scene.objects, circle],
    };
    expect(
      capturedBoardOutlineMatches(scene, 'board', {
        kind: 'circle',
        center: { x: 40, y: 40 },
        radiusMm: 40,
      }),
    ).toBe(true);
    expect(
      capturedBoardOutlineMatches(scene, 'board', {
        kind: 'rect',
        origin: { x: 0, y: 0 },
        widthMm: 80,
        heightMm: 80,
      }),
    ).toBe(false);
  });

  it('fails closed when the outline or local geometry is absent', () => {
    const scene = createProject().scene;
    expect(capturedBoardOutlineMatches(scene, null, null)).toBe(false);
  });

  it('matches a registered outline polyline by its bbox', () => {
    const project = createProject();
    const object = {
      ...createRegistrationOutline({
        id: 'board',
        pointsMm: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 60, y: 50 },
          { x: 0, y: 60 },
        ],
      }),
      provenance: 'captured-board' as const,
      locked: true,
    };
    const scene = {
      ...project.scene,
      layers: [...project.scene.layers, createRegistrationLayer()],
      objects: [object],
    };
    const geometry = {
      kind: 'outline' as const,
      localPointsMm: object.spec.kind === 'polyline' ? object.spec.points : [],
      anchorIndices: [0, 1, 3],
      viewSigns: { x: 1 as const, y: 1 as const },
      measured: [
        { index: 0, machine: { x: 0, y: 0 } },
        { index: 1, machine: { x: 100, y: 0 } },
      ],
    };
    expect(capturedBoardOutlineMatches(scene, 'board', geometry)).toBe(true);
  });
});
