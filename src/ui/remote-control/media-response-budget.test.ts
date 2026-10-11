import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MCP_MAX_RESULT_BYTES } from '../../../electron/mcp/input-schemas';
import { structuredToolResult, toolResultBytes } from '../../../electron/mcp/tool-result';
import { createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { captureSourceFrame } from '../camera/frame-source';
import { useCameraStore } from '../state/camera-store';
import { useStore } from '../state/store';
import { cameraSnapshot } from './machine-camera';
import { workspaceSceneProjection } from './scene-projection';
import { fitsRemoteResponse } from './response-budget';
import type { RemoteControlOptions } from './types';

vi.mock('../camera/frame-source', () => ({ captureSourceFrame: vi.fn() }));
const options: RemoteControlOptions = {
  canWrite: () => false,
  canShareArtwork: () => true,
  getAppStatus: () => ({
    app: { name: 'KerfDesk', version: '1', platform: 'desktop' },
    edition: { mode: 'free' },
    updates: { available: false },
  }),
};
const responseBytes = (data: Record<string, unknown>) =>
  toolResultBytes(structuredToolResult({ ...data, revision: 'r'.repeat(200) }));

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useCameraStore.setState(useCameraStore.getInitialState(), true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([10000, 20000])(
  'keeps a %i-point scene response within the complete MCP budget',
  async (count) => {
    const base = createProject();
    const objects: Project['scene']['objects'] = [
      {
        id: 'zigzag',
        kind: 'imported-svg',
        source: 'zigzag.svg',
        name: 'Zigzag',
        transform: { ...IDENTITY_TRANSFORM },
        bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
        paths: [
          {
            color: '#000000',
            polylines: Array.from({ length: count / 200 }, (_, segment) => ({
              closed: false,
              points: Array.from({ length: 200 }, (_, i) => ({
                x: (segment * 200 + i) / 100,
                y: i % 2 ? 100 : 0,
              })),
            })),
          },
        ],
      },
    ];
    const project: Project = { ...base, scene: { ...base.scene, objects } };
    useStore.setState({ project });
    const result = await workspaceSceneProjection(useStore.getState(), options);
    expect(result.status).toBe('ready');
    if (count === 20000) expect(result.toleranceMm).toBeGreaterThan(0.025);
    expect(responseBytes(result)).toBeLessThan(MCP_MAX_RESULT_BYTES);
  },
);

it('budgets UTF-8 and JSON text escaping in addition to structured data', () => {
  for (const text of ['中'.repeat(45000), '\\"'.repeat(45000)]) {
    const result = { text };
    expect(responseBytes(result)).toBeGreaterThan(MCP_MAX_RESULT_BYTES);
    expect(fitsRemoteResponse(result)).toBe(false);
  }
});

it.each([true, false])(
  'reduces camera quality or reports unavailable when oversized: %s',
  async (canShrink) => {
    useCameraStore.setState({
      sourceState: {
        kind: 'live',
        source: {
          kind: 'machine-jpeg',
          frameUrl: 'https://local.invalid/frame',
          cameraUrl: 'https://local.invalid/',
        },
      },
    });
    vi.mocked(captureSourceFrame).mockResolvedValue({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    });
    vi.stubGlobal(
      'ImageData',
      class {
        readonly data = new Uint8ClampedArray(4);
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const encode = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValueOnce('data:image/jpeg;base64,' + 'A'.repeat(180000))
      .mockReturnValue('data:image/jpeg;base64,' + 'A'.repeat(canShrink ? 100000 : 180000));
    const result = await cameraSnapshot(options, {
      clientId: 'client',
      sessionId: 'session',
      signal: new AbortController().signal,
      assertCurrent: () => undefined,
    });
    expect(result.status).toBe(canShrink ? 'ready' : 'unavailable');
    expect(encode).toHaveBeenCalledTimes(canShrink ? 2 : 4);
    expect(responseBytes(result)).toBeLessThan(MCP_MAX_RESULT_BYTES);
  },
);
