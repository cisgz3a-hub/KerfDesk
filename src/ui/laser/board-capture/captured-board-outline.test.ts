import { describe, expect, it } from 'vitest';
import { createProject, createRegistrationLayer } from '../../../core/scene';
import { createRegistrationBox, createRegistrationCircle } from '../../../core/shapes';
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
});
