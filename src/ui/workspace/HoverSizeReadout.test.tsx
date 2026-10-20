import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CANVAS_PADDING_PX } from './canvas-layout';
import { HoverSizeReadout } from './HoverSizeReadout';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RECT: SceneObject = {
  kind: 'imported-svg',
  id: 'R1',
  source: 'plate.svg',
  bounds: { minX: 100, minY: 50, maxX: 160, maxY: 90 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 100, y: 50 },
            { x: 160, y: 50 },
            { x: 160, y: 90 },
            { x: 100, y: 90 },
          ],
        },
      ],
    },
  ],
};

function projectWithRect(): Project {
  const base = createProject();
  return {
    ...base,
    scene: addObject(
      { ...base.scene, layers: [createLayer({ id: 'red', color: '#ff0000' })] },
      RECT,
    ),
  };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(project: Project, enabled = true): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <HoverSizeReadout
        project={project}
        canvasSize={{ width: 800, height: 600 }}
        viewState={{ zoomFactor: 1, panX: 0, panY: 0 }}
        enabled={enabled}
      />,
    ),
  );
  return host;
}

beforeEach(() => vi.useFakeTimers());

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.useRealTimers();
  resetStore();
});

async function hoverAt(x: number, y: number): Promise<void> {
  await act(async () => useStore.getState().setCursorMm({ x, y }));
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
}

describe('HoverSizeReadout', () => {
  it('reports the hovered artwork size once the pointer settles on it', async () => {
    const container = await render(projectWithRect());
    expect(container.textContent).toBe('');

    await hoverAt(130, 70);
    expect(container.textContent).toContain('60.0 × 40.0 mm');
    expect(container.textContent).toContain('X 100.0, Y 50.0');
  });

  it('reports the power and speed the hovered artwork runs at', async () => {
    const container = await render(projectWithRect());
    await hoverAt(130, 70);
    expect(container.textContent).toContain('Power 30% · Speed 1500 mm/min');
  });

  it('names a locked piece rather than the piece beneath it, as the hover pulse does', async () => {
    const base = projectWithRect();
    const locked: SceneObject = { ...RECT, id: 'L1', name: 'Locked lid', locked: true };
    const project = { ...base, scene: addObject(base.scene, locked) };
    const container = await render(project);
    await hoverAt(130, 70);
    expect(container.textContent).toContain('Locked lid');
  });

  it('keeps the readout on the canvas near its right and bottom edges', async () => {
    const project = projectWithRect();
    const container = await render(project);
    await hoverAt(130, 70);
    // Room to spare: the chip hangs right of and below the pointer.
    expect((container.firstElementChild as HTMLElement).style.transform).toBe('');

    // At 1 px per mm, panned so the hovered point lands in the bed's far corner.
    const { bedWidth, bedHeight } = project.device;
    await act(async () =>
      root?.render(
        <HoverSizeReadout
          project={project}
          canvasSize={{
            width: bedWidth + CANVAS_PADDING_PX * 2,
            height: bedHeight + CANVAS_PADDING_PX * 2,
          }}
          viewState={{ zoomFactor: 1, panX: bedWidth - 150, panY: bedHeight - 100 }}
          enabled
        />,
      ),
    );
    await hoverAt(131, 71);
    expect((container.firstElementChild as HTMLElement).style.transform).toBe(
      'translate(-100%, -100%)',
    );
  });

  it('says nothing over empty bed, after the pointer leaves, or while disabled', async () => {
    const project = projectWithRect();
    const container = await render(project);

    await hoverAt(10, 10);
    expect(container.textContent).toBe('');

    await hoverAt(130, 70);
    expect(container.textContent).toContain('60.0 × 40.0 mm');

    await act(async () => useStore.getState().setCursorMm(null));
    expect(container.textContent).toBe('');

    await act(async () =>
      root?.render(
        <HoverSizeReadout
          project={project}
          canvasSize={{ width: 800, height: 600 }}
          viewState={{ zoomFactor: 1, panX: 0, panY: 0 }}
          enabled={false}
        />,
      ),
    );
    await hoverAt(130, 70);
    expect(container.textContent).toBe('');
  });

  it('does not hit-test until the pointer has settled', async () => {
    const container = await render(projectWithRect());
    await act(async () => useStore.getState().setCursorMm({ x: 130, y: 70 }));
    // Still moving: the dwell has not elapsed, so nothing is measured yet.
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(container.textContent).toBe('');
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(container.textContent).toContain('60.0 × 40.0 mm');
  });
});
