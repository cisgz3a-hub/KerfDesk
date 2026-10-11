import { beforeEach, expect, it, vi } from 'vitest';
import { createProject, type Scene } from '../../core/scene';
import { createLayer } from '../../core/scene/layer';
import { createRectangle } from '../../core/shapes/primitives';
import { drawObjectDisplay, resolveObjectDisplay } from '../workspace/object-display';
import { paintDesignProjectVectors } from './design-project-vectors';

vi.mock('../workspace/object-display', () => ({
  isVectorSceneObject: (object: { kind: string }) => object.kind === 'shape',
  resolveObjectDisplay: vi.fn(() => ({
    paths: [],
    displaySegmentCount: 0,
    isSimplified: false,
    styleKey: 'test',
  })),
  drawObjectDisplay: vi.fn(),
}));
const shape = createRectangle({
  id: 'saved',
  color: '#000000',
  spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
});
const scene: Scene = { ...createProject().scene, objects: [shape] };
const ctx = {} as CanvasRenderingContext2D;
const view = { pxPerMm: 2, panXmm: 10, panYmm: -5 };
beforeEach(() => vi.clearAllMocks());
it('draws persisted vectors with production curve/fill resolution in the same coordinate frame', () => {
  const ready = vi.fn();
  paintDesignProjectVectors(ctx, scene, view, new Set(), ready);
  expect(resolveObjectDisplay).toHaveBeenCalledWith(
    shape,
    expect.any(Map),
    { scale: 2, offsetX: -20, offsetY: 10 },
    expect.any(Object),
    'design',
  );
  expect(drawObjectDisplay).toHaveBeenCalledWith(
    ctx,
    shape,
    expect.any(Object),
    { scale: 2, offsetX: -20, offsetY: 10 },
    ready,
  );
});
it('does not double draw the live draft or show hidden project vectors', () => {
  paintDesignProjectVectors(ctx, scene, view, new Set([shape.id]));
  expect(drawObjectDisplay).not.toHaveBeenCalled();
  const layer = createLayer({ id: 'operation', color: '#000000' });
  paintDesignProjectVectors(
    ctx,
    { ...scene, layers: [{ ...layer, visible: false }] },
    view,
    new Set(),
  );
  expect(drawObjectDisplay).not.toHaveBeenCalled();
});
