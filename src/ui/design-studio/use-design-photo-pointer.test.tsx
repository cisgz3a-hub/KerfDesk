import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sketch } from '../../core/design';
import { createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { createDesignSession } from './design-session';
import { useDesignStudioStore } from './design-studio-store';
import type { DesignSurface } from './design-surface';
import { useDesignPointer } from './use-design-pointer';
import { useDesignPhotoPointer } from './use-design-photo-pointer';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const onSelectPhoto = vi.fn();
const surface: DesignSurface = {
  toMm: (event: React.PointerEvent<HTMLCanvasElement>) => ({ x: event.clientX, y: event.clientY }),
  toClient: (point) => point,
  pxPerMm: () => 2,
};

function Harness() {
  const drawing = useDesignPointer(surface, () => 'new-shape');
  const pointer = useDesignPhotoPointer(surface, drawing, { onSelectPhoto });
  return <canvas onPointerDown={pointer.onPointerDown} onPointerUp={pointer.onPointerUp} />;
}

describe('photo and vector pointer priority', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    resetStore();
    onSelectPhoto.mockReset();
    const photo: RasterImage = {
      kind: 'raster-image',
      id: 'photo',
      source: 'background.png',
      dataUrl: 'data:image/png;base64,AA==',
      pixelWidth: 100,
      pixelHeight: 100,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      dither: 'threshold',
      linesPerMm: 1,
    };
    const project = createProject();
    useStore.setState({ project: { ...project, scene: { ...project.scene, objects: [photo] } } });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useDesignStudioStore.setState({ session: null, stash: null });
  });

  const sketches: { name: string; sketch: Sketch; point: { x: number; y: number } }[] = [
    {
      name: 'ellipse corner outside its outline',
      sketch: {
        entities: [
          {
            kind: 'ellipse',
            id: 'ellipse',
            center: { x: 50, y: 50 },
            radiusXMm: 25,
            radiusYMm: 20,
          },
        ],
      },
      point: { x: 25, y: 30 },
    },
    {
      name: 'multi-selection corner in the gap between shapes',
      sketch: {
        entities: [
          { kind: 'circle', id: 'a', center: { x: 20, y: 70 }, radiusMm: 10 },
          { kind: 'circle', id: 'b', center: { x: 70, y: 20 }, radiusMm: 10 },
        ],
      },
      point: { x: 10, y: 10 },
    },
  ];
  it.each(sketches)('starts vector resize over a photo at $name', ({ sketch, point }) => {
    const selectedIds = new Set(sketch.entities.map((entity) => entity.id));
    useDesignStudioStore.setState({ session: { ...createDesignSession(sketch), selectedIds } });
    act(() => root.render(<Harness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw Error('Expected canvas');
    act(() => {
      canvas.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: point.x, clientY: point.y }),
      );
    });
    expect(useDesignStudioStore.getState().session?.resize).not.toBeNull();
    expect(useDesignStudioStore.getState().session?.selectedIds).toEqual(selectedIds);
    expect(onSelectPhoto).not.toHaveBeenCalledWith('photo');
  });

  it('still selects a photo away from vector outlines and selection handles', () => {
    useDesignStudioStore.setState({ session: createDesignSession() });
    act(() => root.render(<Harness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw Error('Expected canvas');
    act(() => {
      canvas.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 }),
      );
    });
    expect(onSelectPhoto).toHaveBeenCalledWith('photo');
    expect(useDesignStudioStore.getState().session?.resize).toBeNull();
  });
});
