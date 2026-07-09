import { describe, expect, it } from 'vitest';
import { createProject, createRegistrationLayer, type Project } from '../../core/scene';
import {
  createRectangle,
  createRegistrationBox,
  createRegistrationCircle,
} from '../../core/shapes';
import { drawScene } from './draw-scene';

// Mock context that records every fillText call so we can assert the size label
// is drawn for the registration box without rendering pixels.
function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly texts: string[];
} {
  const texts: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'measureText') return () => ({ width: 40 });
        if (prop === 'fillText') return (text: string) => texts.push(text);
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, texts };
}

const DRAW_OPTS = { selectedId: null, preview: false, view: { zoomFactor: 1, panX: 0, panY: 0 } };

function sceneProject(
  project: Project,
  layers: Project['scene']['layers'],
  objects: Project['scene']['objects'],
): Project {
  return { ...project, scene: { layers, objects, groups: [] } };
}

describe('drawScene registration box dimensions', () => {
  it('labels the jig box with its measured width × height', () => {
    const { ctx, texts } = recordingContext();
    const box = createRegistrationBox({ widthMm: 123.4, heightMm: 78.9, x: 10, y: 20 });
    const project = sceneProject(createProject(), [createRegistrationLayer()], [box]);

    drawScene(ctx, 800, 600, project, DRAW_OPTS);

    expect(texts).toContain('123.4 × 78.9 mm');
  });

  it('draws no size label when there is no registration box', () => {
    const { ctx, texts } = recordingContext();
    const rect = createRectangle({
      id: 'art',
      color: '#000000',
      spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
    });
    const project = sceneProject(createProject(), [], [rect]);

    drawScene(ctx, 800, 600, project, DRAW_OPTS);

    expect(texts.some((t) => t.endsWith('mm'))).toBe(false);
  });

  it('does not label the box in preview mode', () => {
    const { ctx, texts } = recordingContext();
    const box = createRegistrationBox({ widthMm: 50, heightMm: 50, x: 0, y: 0 });
    const project = sceneProject(createProject(), [createRegistrationLayer()], [box]);

    drawScene(ctx, 800, 600, project, { ...DRAW_OPTS, preview: true });

    expect(texts.some((t) => t.endsWith('mm'))).toBe(false);
  });

  it('labels the true rectangle size for a rotated box, not the inflated bounding box', () => {
    const { ctx, texts } = recordingContext();
    const box = createRegistrationBox({ widthMm: 100, heightMm: 60, x: 50, y: 50 });
    const rotated = { ...box, transform: { ...box.transform, rotationDeg: 45 } };
    const project = sceneProject(createProject(), [createRegistrationLayer()], [rotated]);

    drawScene(ctx, 800, 600, project, DRAW_OPTS);

    expect(texts).toContain('100.0 × 60.0 mm'); // true dims, not the ~113 mm AABB
    expect(texts.some((t) => t.includes('113'))).toBe(false);
  });

  it('draws no label when the registration layer is hidden (the box is not drawn either)', () => {
    const { ctx, texts } = recordingContext();
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40, x: 10, y: 20 });
    const hiddenLayer = { ...createRegistrationLayer(), visible: false };
    const project = sceneProject(createProject(), [hiddenLayer], [box]);

    drawScene(ctx, 800, 600, project, DRAW_OPTS);

    expect(texts.some((t) => t.endsWith('mm'))).toBe(false);
  });

  it('labels a circle (ellipse) box with its diameter, not its bounding square', () => {
    const { ctx, texts } = recordingContext();
    const circle = createRegistrationCircle({ diameterMm: 90, x: 10, y: 20 });
    const project = sceneProject(createProject(), [createRegistrationLayer()], [circle]);

    drawScene(ctx, 800, 600, project, DRAW_OPTS);

    expect(texts).toContain('⌀ 90.0 mm');
    expect(texts.some((t) => t.includes('×'))).toBe(false); // not "90.0 × 90.0 mm"
  });
});
