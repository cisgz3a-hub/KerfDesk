import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer3dSceneHandle } from '../viewer3d';
import { useSceneSync } from './use-scene-sync';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Args = Parameters<typeof useSceneSync>[0];
const MODEL_A = {};
const MODEL_B = {};
const COLOR = (): readonly [number, number, number] => [1, 0, 0];
let root: Root;
let host: HTMLDivElement;

function scene() {
  return {
    setTravelVisible: vi.fn(),
    setPlayhead: vi.fn(),
    recolor: vi.fn(),
    setDirectionArrows: vi.fn(),
    setLiveMachine: vi.fn(),
  };
}

function defaults(handle: ReturnType<typeof scene>): Args {
  return {
    handleRef: { current: handle as unknown as Viewer3dSceneHandle },
    state: 'preparing',
    model: MODEL_A,
    playhead: { segmentIndex: 3, point: { x: 1, y: 2, z: 0 } },
    colorOf: COLOR,
    live: { x: 5, y: 6, z: 0 },
    arrows: null,
    travelVisible: true,
  };
}

function Probe(props: Args): null {
  useSceneSync(props);
  return null;
}

async function render(args: Args): Promise<void> {
  await act(async () => root.render(<Probe {...args} />));
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('useSceneSync preparation', () => {
  it('applies the initial view while hidden and does not redraw identical ready values', async () => {
    const handle = scene();
    const args = defaults(handle);
    await render(args);
    for (const method of Object.values(handle)) expect(method).toHaveBeenCalledOnce();
    await render({
      ...args,
      state: 'ready',
      live: { x: 5, y: 6, z: 0 },
      playhead: { ...args.playhead! },
    });
    for (const method of Object.values(handle)) expect(method).toHaveBeenCalledOnce();
  });

  it('waits for replacement geometry then reapplies unchanged view settings once', async () => {
    const handle = scene();
    const args = defaults(handle);
    await render(args);
    await render({ ...args, state: 'ready' });
    await render({ ...args, state: 'ready', model: MODEL_B });
    for (const method of Object.values(handle)) expect(method).toHaveBeenCalledOnce();
    await render({ ...args, state: 'preparing', model: MODEL_B });
    for (const method of Object.values(handle)) expect(method).toHaveBeenCalledTimes(2);
    await render({ ...args, state: 'ready', model: MODEL_B });
    for (const method of Object.values(handle)) expect(method).toHaveBeenCalledTimes(2);
  });

  it('keeps preparation stable during live updates and applies the latest values on ready', async () => {
    const handle = scene();
    const args = defaults(handle);
    await render(args);
    const next = {
      ...args,
      live: { x: 8, y: 9, z: 1 },
      travelVisible: false,
      hidePlaybackMarker: true,
    };
    await render({ ...next, live: { x: 7, y: 8, z: 1 } });
    await render(next);
    for (const method of Object.values(handle)) expect(method).toHaveBeenCalledOnce();
    await render({ ...next, state: 'ready' });
    expect(handle.setLiveMachine).toHaveBeenLastCalledWith(next.live);
    expect(handle.setLiveMachine).toHaveBeenCalledTimes(2);
    expect(handle.setTravelVisible).toHaveBeenLastCalledWith(false);
    expect(handle.setPlayhead).toHaveBeenLastCalledWith({ ...args.playhead, hideMarker: true });
    expect(handle.recolor).toHaveBeenCalledOnce();
    expect(handle.setDirectionArrows).toHaveBeenCalledOnce();
  });

  it('reapplies when a pending model is replaced and when the scene handle changes', async () => {
    const first = scene();
    const args = defaults(first);
    await render(args);
    await render({ ...args, model: MODEL_B });
    for (const method of Object.values(first)) expect(method).toHaveBeenCalledTimes(2);
    const second = scene();
    await render({ ...defaults(second), model: MODEL_B });
    for (const method of Object.values(second)) expect(method).toHaveBeenCalledOnce();
  });
});
