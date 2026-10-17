import { describe, expect, it } from 'vitest';
import {
  createProject,
  createRegistrationLayer,
  findRegistrationBoxBounds,
} from '../../../core/scene';
import { createRegistrationBox } from '../../../core/shapes';
import { computeView } from '../view-transform';
import { fitJigCanvasView, JIG_BED_VIEW } from './jig-canvas-view';

describe('jig canvas opening view', () => {
  it.each([
    { width: 1000, height: 600 },
    { width: 400, height: 700 },
  ])('centres and fits the entire rotated jig set in a $width by $height viewport', (size) => {
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40, x: 20, y: 50 });
    const project = {
      ...createProject(),
      scene: {
        layers: [createRegistrationLayer()],
        objects: [
          box,
          {
            ...box,
            id: 'second',
            transform: { ...box.transform, x: 120, y: 100, rotationDeg: 30 },
          },
        ],
      },
    };
    const bounds = findRegistrationBoxBounds(project.scene)!;
    const view = fitJigCanvasView(project, size);
    const mapped = computeView(
      size.width,
      size.height,
      project.device.bedWidth,
      project.device.bedHeight,
      view,
    );
    expect(((bounds.minX + bounds.maxX) / 2) * mapped.scale + mapped.offsetX).toBeCloseTo(
      size.width / 2,
    );
    expect(((bounds.minY + bounds.maxY) / 2) * mapped.scale + mapped.offsetY).toBeCloseTo(
      size.height / 2,
    );
    const usedWidth = ((bounds.maxX - bounds.minX) * mapped.scale) / size.width;
    const usedHeight = ((bounds.maxY - bounds.minY) * mapped.scale) / size.height;
    expect(Math.max(usedWidth, usedHeight)).toBeCloseTo(0.84);
    expect(view.zoomFactor).toBeGreaterThan(1);
  });

  it('shows the bed if no jig remains', () => {
    expect(fitJigCanvasView(createProject(), { width: 800, height: 600 })).toEqual(JIG_BED_VIEW);
  });
});
