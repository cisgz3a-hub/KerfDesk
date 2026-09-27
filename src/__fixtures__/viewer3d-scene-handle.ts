// A stand-in for the 3D scene handle in tests that run without WebGL: every
// method is a spy, and a test overrides the few it asserts on.
import { vi } from 'vitest';
import type { Viewer3dSceneHandle } from '../ui/viewer3d';

export function fakeViewer3dSceneHandle(
  overrides: Partial<Viewer3dSceneHandle> = {},
): Viewer3dSceneHandle {
  return {
    setSegments: vi.fn(),
    setCameraTracking: vi.fn(),
    onCameraInteraction: vi.fn(),
    fitToBounds: vi.fn(),
    setTravelVisible: vi.fn(),
    setPlayhead: vi.fn(),
    setLiveMachine: vi.fn(),
    recolor: vi.fn(),
    setView: vi.fn(),
    fitView: vi.fn(),
    setProjection: vi.fn(),
    onProjectionChange: vi.fn(),
    setStage: vi.fn(),
    pickViewCube: vi.fn(() => null),
    hoverViewCube: vi.fn(),
    pickMove: vi.fn(() => null),
    highlightMove: vi.fn(),
    setMoveFilter: vi.fn(),
    setClipPlanes: vi.fn(),
    setMeasure: vi.fn(),
    onCameraMoving: vi.fn(),
    onDetailChange: vi.fn(),
    captureImage: vi.fn(() => ''),
    setDirectionArrows: vi.fn(),
    resize: vi.fn(),
    requestRender: vi.fn(),
    prepareToShow: vi.fn(async () => undefined),
    dispose: vi.fn(),
    ...overrides,
  };
}
