import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, type Project } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { canvasTheme } from '../theme/canvas-theme';
import { canvasVectorDisplayColor } from '../theme/canvas-vector-color';
import { drawObjectsFaint } from './draw-preview';
import { drawScene } from './draw-scene';

afterEach(() => vi.unstubAllGlobals());

function setDark(dark: boolean): void {
  vi.stubGlobal('matchMedia', () => ({ matches: dark }));
}

function recordingContext() {
  const strokes: string[] = [];
  const fills: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, property) {
      if (property === 'stroke') return () => strokes.push(String(target.strokeStyle));
      if (property === 'fill' || property === 'fillRect')
        return () => fills.push(String(target.fillStyle));
      if (property === 'measureText') return () => ({ width: 30 });
      return target[String(property)] ?? (() => undefined);
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, strokes, fills };
}

function artwork(mode: 'line' | 'fill', orphan = false): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: orphan ? [] : [createLayer({ id: '#000000', color: '#000000', mode })],
      objects: [
        createRectangle({
          id: 'black-artwork',
          color: '#000000',
          spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
        }),
      ],
    },
  };
}

describe('theme-aware workspace drawing', () => {
  it.each(['line', 'fill', 'orphan'] as const)(
    'keeps black %s artwork visible on a dark bed without editing scene data',
    (kind) => {
      const project = artwork(kind === 'fill' ? 'fill' : 'line', kind === 'orphan');
      const stored = JSON.stringify(project);
      const dark = recordingContext();
      setDark(true);
      drawScene(dark.ctx, 800, 600, project, { selectedId: null, preview: false });
      expect(dark.fills).toContain(canvasTheme.bedFill);
      expect(kind === 'fill' ? dark.fills : dark.strokes).toContain(canvasTheme.artworkInk);
      expect(JSON.stringify(project)).toBe(stored);

      const light = recordingContext();
      setDark(false);
      drawScene(light.ctx, 800, 600, project, { selectedId: null, preview: false });
      expect(kind === 'fill' ? light.fills : light.strokes).toContain('#000000');
      expect(JSON.stringify(project)).toBe(stored);
    },
  );

  it('adapts preview backing geometry and live drafts to the dark surface', () => {
    setDark(true);
    const project = artwork('line');
    const faint = recordingContext();
    drawObjectsFaint(faint.ctx, project, { scale: 1, offsetX: 0, offsetY: 0 });
    expect(faint.strokes).toContain(canvasTheme.artworkInk);
    const draft = recordingContext();
    const shape = project.scene.objects[0];
    if (shape === undefined) throw new Error('Missing draft fixture');
    drawScene(draft.ctx, 800, 600, createProject(), {
      selectedId: null,
      preview: false,
      draft: shape,
    });
    expect(draft.strokes).toContain(canvasTheme.artworkInk);
  });

  it('preserves readable artwork colours and lightens dark chromatic ink without losing its hue', () => {
    setDark(true);
    expect(canvasVectorDisplayColor('#ff0000')).toBe('#ff0000');
    expect(canvasVectorDisplayColor('#ffffff')).toBe('#ffffff');
    expect(canvasVectorDisplayColor('#000080')).not.toBe('#000080');
    const display = canvasVectorDisplayColor('#000080');
    const red = Number.parseInt(display.slice(1, 3), 16);
    const blue = Number.parseInt(display.slice(5, 7), 16);
    expect(blue).toBeGreaterThan(red);
    setDark(false);
    expect(canvasVectorDisplayColor('#000080')).toBe('#000080');
  });
});
