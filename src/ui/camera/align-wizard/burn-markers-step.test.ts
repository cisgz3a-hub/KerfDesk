import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { burnAlignMarkers } from './burn-markers-step';

afterEach(() => {
  useStore.getState().newProject();
  useCameraStore.setState({ placementActive: false });
});

describe('burnAlignMarkers', () => {
  it('streams a temporary marker project without changing the user scene or undo history', async () => {
    const before = useStore.getState();
    const flow = vi.fn(async (_project: Project) => false);
    const result = await burnAlignMarkers({ powerPercent: 22, speedMmPerMin: 4500 }, flow);

    expect(flow).toHaveBeenCalledTimes(1);
    const temporaryProject = flow.mock.calls[0]?.[0];
    if (temporaryProject === undefined) throw new Error('temporary project was not supplied');
    const layer = temporaryProject.scene.layers.find((item) => item.id === 'camera-align-markers');
    expect(layer).toBeDefined();
    expect(layer?.power).toBe(22);
    expect(layer?.speed).toBe(4500);
    expect(temporaryProject.scene.objects.length).toBeGreaterThan(0);

    expect(useStore.getState().project.scene).toBe(before.project.scene);
    expect(useStore.getState().undoStack).toEqual(before.undoStack);
    expect(useStore.getState().dirty).toBe(before.dirty);
    expect(useStore.getState().jobPlacement).toEqual(before.jobPlacement);
    expect(useCameraStore.getState().placementActive).toBe(false);
    expect(result).toEqual({ kind: 'not-started' });
  });

  it('reports started when the transient flow starts the marker job', async () => {
    const flow = vi.fn(async (_project: Project) => true);
    const result = await burnAlignMarkers({ powerPercent: 35, speedMmPerMin: 3000 }, flow);
    expect(result).toEqual({ kind: 'started' });
  });
});
