import { describe, expect, it } from 'vitest';
import { mixedCanvasCompilationProject } from '../../__fixtures__/mixed-canvas-compilation-project';
import { createLayer } from '../../core/scene';
import {
  machineSetupFillHeatRisk,
  machineSetupFillHeatRiskWarning,
} from './machine-setup-fill-heat-risk';

describe('Machine Setup deferred Island Fill diagnostics', () => {
  it.each(['scanline', 'offset'] as const)(
    'does not invent an Island Fill warning for a costly %s-only canvas',
    (fillStyle) => {
      const project = mixedCanvasCompilationProject();
      const layer = {
        ...createLayer({ id: `${fillStyle}-fill`, color: '#000000', mode: 'fill' }),
        fillStyle,
      };

      const risk = machineSetupFillHeatRisk(project, [layer]);

      expect(risk).toBe('no-island');
      expect(machineSetupFillHeatRiskWarning(risk)).toBeNull();
    },
  );

  it('defers exact Island Fill analysis for a costly canvas', () => {
    const project = mixedCanvasCompilationProject();
    const layer = {
      ...createLayer({ id: 'island-fill', color: '#000000', mode: 'fill' }),
      fillStyle: 'island' as const,
    };

    const risk = machineSetupFillHeatRisk(project, [layer]);

    expect(risk).toBe('background');
    expect(machineSetupFillHeatRiskWarning(risk)).toMatch(/runs in the background/i);
  });
});
