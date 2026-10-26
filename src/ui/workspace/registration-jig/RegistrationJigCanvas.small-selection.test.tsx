import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createLayer, createProject, type Project } from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { computeView } from '../view-transform';
import { RegistrationJigCanvas } from './RegistrationJigCanvas';

vi.mock('../use-canvas-bitmap-size', () => ({
  useCanvasBitmapSize: () => ({ width: 800, height: 600 }),
}));
vi.mock('./jig-canvas-paint', () => ({ useJigCanvasPaint: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Harness(props: { project: Project; onCommit: (project: Project) => void }): JSX.Element {
  const [selectedIds, onSelectionChange] = useState<ReadonlySet<string>>(new Set());
  return (
    <RegistrationJigCanvas
      {...props}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
    />
  );
}

it('moves already selected tiny artwork from its interior without changing its size', () => {
  const project: Project = {
    ...createProject(),
    scene: {
      layers: [createLayer({ id: 'artwork', color: '#000000' })],
      objects: [
        createRectangle({
          id: 'art',
          color: '#000000',
          spec: { widthMm: 2, heightMm: 2, cornerRadiusMm: 0 },
        }),
      ],
    },
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const commit = vi.fn();
  try {
    act(() => root.render(<Harness project={project} onCommit={commit} />));
    const canvas = host.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = () => false;
    const view = computeView(800, 600, project.device.bedWidth, project.device.bedHeight);
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        clientX: view.offsetX + x * view.scale,
        clientY: view.offsetY + y * view.scale,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      act(() => {
        canvas.dispatchEvent(event);
      });
    };
    pointer('pointerdown', 1, 1);
    pointer('pointerup', 1, 1);
    pointer('pointerdown', 1, 1);
    pointer('pointerup', 6, 3);
    expect(commit).toHaveBeenCalledTimes(1);
    const moved = (commit.mock.calls[0]![0] as Project).scene.objects[0]!;
    expect(moved.transform.x).toBeCloseTo(5);
    expect(moved.transform.y).toBeCloseTo(2);
    expect(moved.transform).toMatchObject({ scaleX: 1, scaleY: 1 });
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
