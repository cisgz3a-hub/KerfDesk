import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type TextObject,
} from '../core/scene';
import { textToPolylines } from '../core/text';

/** Number of independently cloned text artworks in the compile fixture. */
export const CONNECTED_SCRIPT_ARTWORK_COUNT = 4;
const ARTWORK_COLORS = ['#c026d3', '#b91c1c', '#0369a1', '#047857'] as const;

/** A real multi-operation Dancing Script project shared by compile and browser regressions. */
export async function connectedScriptCompilationProject(fontBuffer: ArrayBuffer): Promise<Project> {
  const rendered = await textToPolylines({
    fontBuffer,
    content: 'Wedding',
    sizeMm: 40,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: ARTWORK_COLORS[0],
  });
  const layers: Layer[] = [];
  const objects: TextObject[] = [];
  for (let index = 0; index < CONNECTED_SCRIPT_ARTWORK_COUNT; index += 1) {
    const id = `connected-script-${index}`;
    const color = ARTWORK_COLORS[index] ?? ARTWORK_COLORS[0];
    layers.push({
      ...createLayer({ id, color }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'v-carve',
        toolId: 'vb-60',
        depthMm: 1,
        depthPerPassMm: 1.5,
        vCarveFlatDepthEnabled: false,
        vResolutionMm: 0,
      },
    });
    objects.push({
      kind: 'text',
      id,
      content: 'Wedding',
      fontKey: 'dancing-script-regular',
      sizeMm: 40,
      alignment: 'left',
      lineHeight: 1.4,
      letterSpacing: 0,
      color,
      operationIds: [id],
      bounds: { ...rendered.bounds },
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 10 + (index % 2) * 120,
        y: 20 + Math.floor(index / 2) * 45,
      },
      paths: structuredClone(rendered.paths),
    });
  }
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: {
        ...DEFAULT_CNC_MACHINE_CONFIG.stock,
        widthMm: 300,
        heightMm: 150,
        originOffset: { x: 0, y: 300 },
      },
    },
    scene: { objects, layers },
  };
}
