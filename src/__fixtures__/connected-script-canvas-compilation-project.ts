import { textToPolylines } from '../core/text';
import { IDENTITY_TRANSFORM, type Project, type TextObject } from '../core/scene';
import { mixedCanvasCompilationProject } from './mixed-canvas-compilation-project';

/** Resolves a fixture font key to the font's binary outline data. */
export type OutlineFontLoader = (fontKey: string) => Promise<ArrayBuffer>;

/** Eight drawings/six operations with real connected-script outline geometry. */
export async function connectedScriptCanvasCompilationProject(
  loadFont: OutlineFontLoader,
): Promise<Project> {
  const base = mixedCanvasCompilationProject();
  const [dancing, pacifico] = await Promise.all([
    renderScriptText(loadFont, {
      id: 'script-drive',
      content: 'Wedding',
      fontKey: 'dancing-script-regular',
      sizeMm: 32,
      x: 12,
      y: 16,
    }),
    renderScriptText(loadFont, {
      id: 'script-flourish',
      content: 'We',
      fontKey: 'pacifico-regular',
      sizeMm: 36,
      x: 150,
      y: 16,
    }),
  ]);
  return {
    ...base,
    scene: {
      objects: base.scene.objects.map((object) => {
        if (object.id === dancing.id) return dancing;
        if (object.id === pacifico.id) return pacifico;
        return object;
      }),
      layers: base.scene.layers.map((layer) =>
        layer.id === 'script-vcarve' && layer.cnc !== undefined
          ? {
              ...layer,
              cnc: {
                ...layer.cnc,
                depthMm: 1,
                depthPerPassMm: 1.5,
                vCarveFlatDepthEnabled: false,
                vResolutionMm: 0,
              },
            }
          : layer,
      ),
    },
  };
}

async function renderScriptText(
  loadFont: OutlineFontLoader,
  input: {
    readonly id: string;
    readonly content: string;
    readonly fontKey: string;
    readonly sizeMm: number;
    readonly x: number;
    readonly y: number;
  },
): Promise<TextObject> {
  const color = '#b91c1c';
  const rendered = await textToPolylines({
    fontBuffer: await loadFont(input.fontKey),
    content: input.content,
    sizeMm: input.sizeMm,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color,
  });
  return {
    kind: 'text',
    id: input.id,
    content: input.content,
    fontKey: input.fontKey,
    sizeMm: input.sizeMm,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color,
    operationIds: ['script-vcarve'],
    bounds: rendered.bounds,
    transform: { ...IDENTITY_TRANSFORM, x: input.x, y: input.y },
    paths: rendered.paths,
  };
}
