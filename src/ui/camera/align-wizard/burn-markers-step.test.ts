import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { burnAlignMarkers } from './burn-markers-step';

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({ streamer: null });
});

describe('burnAlignMarkers', () => {
  it('replaces the scene with the marker pattern at the chosen settings and runs the job flow', async () => {
    const flow = vi.fn(async () => undefined);
    const result = await burnAlignMarkers({ powerPercent: 22, speedMmPerMin: 4500 }, flow);

    expect(flow).toHaveBeenCalledTimes(1);
    const scene = useStore.getState().project.scene;
    const layer = scene.layers.find((l) => l.id === 'camera-align-markers');
    expect(layer).toBeDefined();
    expect(layer?.power).toBe(22);
    expect(layer?.speed).toBe(4500);
    expect(scene.objects.length).toBeGreaterThan(0);
    // No streamer went active (the fake flow never started one).
    expect(result).toEqual({ kind: 'not-started' });
  });

  it('reports started when the flow leaves a job streaming', async () => {
    const flow = vi.fn(async () => {
      useLaserStore.setState({
        streamer: { status: 'streaming' } as never, // isActiveJob reads only status
      });
    });
    const result = await burnAlignMarkers({ powerPercent: 35, speedMmPerMin: 3000 }, flow);
    expect(result).toEqual({ kind: 'started' });
  });
});
