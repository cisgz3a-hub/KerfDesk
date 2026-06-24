import { describe, expect, it } from 'vitest';
import { createLayer, createProject, createRegistrationLayer, type Project } from '../../core/scene';
import { createRectangle, createRegistrationBox } from '../../core/shapes';
import { drawScene } from './draw-scene';

// Mock context that records every setLineDash call so we can assert the jig box
// is stroked with the dashed fixture pattern (ADR-057) without rendering pixels.
function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly lineDashes: number[][];
} {
  const lineDashes: number[][] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'setLineDash') return (arr: number[]) => lineDashes.push([...arr]);
        if (prop === 'measureText') return () => ({ width: 0 });
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, lineDashes };
}

const DRAW_OPTS = { selectedId: null, preview: false, view: { zoomFactor: 1, panX: 0, panY: 0 } };
const JIG_DASH = [8, 5];

function sceneProject(project: Project, layers: Project['scene']['layers'], objects: Project['scene']['objects']): Project {
  return { ...project, scene: { layers, objects, groups: [] } };
}

describe('drawScene registration box styling', () => {
  it('strokes the jig box with the dashed fixture pattern', () => {
    const { ctx, lineDashes } = recordingContext();
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40, x: 10, y: 20 });
    const project = sceneProject(createProject(), [createRegistrationLayer()], [box]);

    drawScene(ctx, 800, 600, project, DRAW_OPTS);

    expect(lineDashes).toContainEqual(JIG_DASH);
  });

  it('does not dash a normal vector object', () => {
    const { ctx, lineDashes } = recordingContext();
    const rect = createRectangle({
      id: 'art',
      color: '#000000',
      spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
    });
    const project = sceneProject(
      createProject(),
      [createLayer({ id: '#000000', color: '#000000' })],
      [rect],
    );

    drawScene(ctx, 800, 600, project, DRAW_OPTS);

    expect(lineDashes).not.toContainEqual(JIG_DASH);
  });
});
