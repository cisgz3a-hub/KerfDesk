import { describe, expect, it } from 'vitest';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import type { Project } from '../../core/scene/project';
import {
  reliefProjectionProject,
  reliefProjectionSelection,
} from '../../__fixtures__/relief-projection';
import { prepareOutput } from './prepare-output';
import { emitGcode } from './emit-gcode';

function ordinarySelectionWithUnusedProjection(): Project {
  const original = reliefProjectionProject();
  return {
    ...original,
    scene: {
      ...original.scene,
      objects: original.scene.objects
        .filter((object) => object.id !== 'mask')
        .map((object) =>
          object.id === 'vector' ? { ...object, operationIds: ['ordinary'] } : object,
        ),
      layers: [
        ...original.scene.layers,
        {
          ...createLayer({ id: 'ordinary', color: '#123456' }),
          output: true,
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' },
        },
      ],
    },
  };
}

describe('selected executable relief dependencies', () => {
  it('ignores a broken projection target on an operation with no selected artwork', () => {
    const original = ordinarySelectionWithUnusedProjection();
    const prepared = prepareOutput(original, { outputScope: reliefProjectionSelection });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.project.scene.objects.map((object) => object.id)).toEqual(['vector']);
    expect(prepared.project.scene.outputDependencies ?? []).toEqual([]);
    const emitted = emitGcode(original, { outputScope: reliefProjectionSelection });
    expect(emitted.gcode).toContain('G1');
    expect(emitted.gcode).not.toContain('NaN');
  });

  it('still refuses a broken projection target when selected artwork uses it', () => {
    const original = reliefProjectionProject();
    const broken = {
      ...original,
      scene: {
        ...original.scene,
        objects: original.scene.objects.filter((object) => object.id !== 'mask'),
      },
    };
    expect(prepareOutput(broken, { outputScope: reliefProjectionSelection })).toMatchObject({
      ok: false,
      preflight: { issues: [expect.objectContaining({ code: 'relief-materialization-failed' })] },
    });
  });
});
