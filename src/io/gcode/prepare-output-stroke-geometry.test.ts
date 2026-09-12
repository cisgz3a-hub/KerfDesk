import { describe, expect, it, vi } from 'vitest';
import { unrepresentableStrokeProject } from '../../__fixtures__/vcarve-stroke-geometry';
import { CncStrokeGeometryError } from '../../core/cnc/cnc-stroke-geometry-error';
import { collectLayerPolylines } from '../../core/cnc/collect-cnc-contours';
import { deserializeProject, serializeProject } from '../project';
import { prepareOutput } from './prepare-output';
import { prepareOutputAsync } from './prepare-output-async';

describe('unrepresentable trusted stroke geometry', () => {
  it('rejects complete synchronous output instead of replacing the pen with a solid centreline', () => {
    const project = unrepresentableStrokeProject();
    expect(deserializeProject(serializeProject(project)).kind).toBe('ok');
    expect(() => prepareOutput(project)).toThrow(CncStrokeGeometryError);
    expect(() => prepareOutput(project)).toThrow('could not represent the stroke geometry');
  });

  it('rejects async preparation before any partial CNC region tasks can be dispatched', async () => {
    const runCncTasks = vi.fn();
    await expect(
      prepareOutputAsync(unrepresentableStrokeProject(), {}, { jobId: 'pen', runCncTasks }),
    ).rejects.toThrow('could not represent the stroke geometry');
    expect(runCncTasks).not.toHaveBeenCalled();
  });

  it('keeps centreline operations available for the same path', () => {
    const project = unrepresentableStrokeProject();
    const layer = project.scene.layers[0]!;
    expect(
      collectLayerPolylines(
        project.scene.objects,
        {
          ...layer,
          cnc: { ...layer.cnc!, cutType: 'engrave' },
        },
        project.device,
      ),
    ).toHaveLength(1);
  });
});
