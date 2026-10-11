import { describe, expect, it } from 'vitest';
import type { DesignStudioDocument } from '../../core/design/design-studio-document';
import { DEFAULT_DESIGN_LAYER, entityDesignLayer, sketchLayers } from '../../core/design/layers';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function document(): DesignStudioDocument {
  return {
    version: 1,
    sketch: {
      layers: [
        DEFAULT_DESIGN_LAYER,
        {
          ...DEFAULT_DESIGN_LAYER,
          id: 'deep',
          name: 'Deep pocket',
          color: '#2563eb',
          cutType: 'pocket',
          depthMm: 4,
          toolId: 'saved-bit',
        },
      ],
      entities: [
        {
          id: 'shape',
          kind: 'line',
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
          layerId: 'deep',
        },
      ],
    },
    activeLayerId: DEFAULT_DESIGN_LAYER.id,
    surface3d: false,
    appliedObjectIds: [],
    appliedOperationsByLayer: [],
    appliedEntityObjectIds: [],
  };
}

function reopen(source: DesignStudioDocument) {
  return deserializeProject(serializeProject({ ...createProject(), designStudioDocument: source }));
}

describe('persisted design layer settings and membership', () => {
  it.each([0, -1, Number.NaN, Infinity, 1_000_001])(
    'rejects invalid layer depth %s before restoring editable source',
    (depthMm) => {
      const source = document();
      const result = reopen({
        ...source,
        sketch: {
          ...source.sketch,
          layers: source.sketch.layers!.map((layer) => ({ ...layer, depthMm })),
        },
      });
      expect(result.kind).toBe('invalid');
      if (result.kind === 'invalid') expect(result.reason).toContain('designStudioDocument');
    },
  );

  it.each([false, true])(
    'rejects an unknown explicit layer instead of remapping the entity (construction: %s)',
    (construction) => {
      const source = document();
      const result = reopen({
        ...source,
        sketch: {
          ...source.sketch,
          entities: source.sketch.entities.map((entity) => ({
            ...entity,
            layerId: 'missing',
            construction,
          })),
        },
      });
      expect(result.kind).toBe('invalid');
      if (result.kind === 'invalid') expect(result.reason).toContain('layerId');
    },
  );

  it('preserves the named layer settings through saving and reopening', () => {
    const source = document();
    const result = reopen(source);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('Project did not reopen');
    expect(result.project.designStudioDocument).toEqual(source);
    const sketch = result.project.designStudioDocument!.sketch;
    expect(entityDesignLayer(sketch.entities[0]!, sketchLayers(sketch))).toMatchObject({
      id: 'deep',
      cutType: 'pocket',
      depthMm: 4,
      toolId: 'saved-bit',
    });
  });

  it.each([undefined, DEFAULT_DESIGN_LAYER.id])(
    'keeps the legacy default-layer form compatible (%s)',
    (layerId) => {
      const source = document();
      const result = reopen({
        ...source,
        sketch: {
          entities: [
            {
              id: 'legacy',
              kind: 'line',
              start: { x: 0, y: 0 },
              end: { x: 5, y: 5 },
              ...(layerId === undefined ? {} : { layerId }),
            },
          ],
        },
      });
      expect(result.kind).toBe('ok');
    },
  );
});
