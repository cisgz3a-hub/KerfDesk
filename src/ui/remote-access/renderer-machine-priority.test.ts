import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextRenderResult } from '../../core/text';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import type { RemoteCommandResult } from '../remote-control/types';
import { RemoteRendererSession } from './renderer-session';
import {
  setRemoteSession,
  useRemoteAccessStore,
  type RemoteAccessStatus,
} from './remote-access-store';
import { setArtworkSharingEnabled } from './artwork-sharing';

const render = vi.hoisted(() => vi.fn());
vi.mock('../text/render-text-geometry', () => ({ renderTextGeometry: render }));
vi.mock('./safe-app-status', () => ({
  remoteAppStatus: () => ({
    app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
    edition: { mode: 'free' },
    updates: { available: false },
  }),
}));
const originalStop = useLaserStore.getState().stopJob;
const status: RemoteAccessStatus = {
  statusRevision: 1,
  enabled: true,
  available: true,
  connected: true,
  deviceId: 'device',
  controlUrl: 'https://example.test/control',
  mcpUrl: 'https://example.test/mcp',
  pairing: null,
  pairingPending: false,
  requests: [],
  error: null,
  clients: [
    { id: 'editor', label: 'Editor', scopes: ['read', 'edit'] },
    {
      id: 'operator',
      label: 'Machine operator',
      scopes: ['read', 'control'],
      controlExpiresInMs: 60_000,
    },
  ],
};
const geometry: TextRenderResult = {
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 5 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 5 },
          ],
        },
      ],
    },
  ],
};
let session: RemoteRendererSession;
let finish: (geometry: TextRenderResult) => void;
let polls: unknown[];
let completions: { id: string; result: RemoteCommandResult }[];
beforeEach(() => {
  vi.useFakeTimers();
  setRemoteSession(null);
  useRemoteAccessStore.setState({ status: null, busy: false, message: null });
  useStore.setState(useStore.getInitialState(), true);
  useLaserStore.setState({ ...initialLaserState(), stopJob: vi.fn(async () => undefined) });
  setArtworkSharingEnabled(false);
  polls = [];
  completions = [];
  render.mockReset().mockImplementation(
    () =>
      new Promise<TextRenderResult>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const action = String(input).split('/').at(-1)!;
      const body = JSON.parse(String(init?.body)) as { id: string; result: RemoteCommandResult };
      if (action === 'attach') return Response.json({ sessionId: 'session' });
      if (action === 'poll')
        return Response.json(polls.shift() ?? { status, requests: [], cancelled: [] });
      if (action === 'complete') completions.push(body);
      return Response.json({ accepted: true });
    }),
  );
});
afterEach(() => {
  session?.stop();
  useLaserStore.setState({ ...initialLaserState(), stopJob: originalStop });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function request(
  id: string,
  command: string,
  args: unknown,
  clientId: string,
  canWrite: boolean,
  canControl: boolean,
) {
  polls.push({
    status,
    cancelled: [],
    requests: [{ id, command, args, clientId, canWrite, canControl }],
  });
}

describe('priority Abort through a real renderer authoring wait', () => {
  it('handles an authorised different-client Abort while async text waits without lending caller/edit authority', async () => {
    request('workspace', 'get_workspace', {}, 'editor', false, false);
    session = new RemoteRendererSession();
    await session.start();
    await vi.advanceTimersByTimeAsync(0);
    const initial = completions.find((value) => value.id === 'workspace')!.result;
    if (!initial.ok) throw new Error('workspace fixture failed');
    request(
      'text',
      'add_text',
      {
        expectedRevision: initial.revision,
        requestId: crypto.randomUUID(),
        xMm: 1,
        yMm: 1,
        widthMm: 20,
        fontSizeMm: 10,
        text: 'Held editor artwork',
      },
      'editor',
      true,
      false,
    );
    await vi.advanceTimersByTimeAsync(350);
    expect(render).toHaveBeenCalledTimes(1);
    expect(completions.some((value) => value.id === 'text')).toBe(false);
    request('abort', 'abort_job', { requestId: crypto.randomUUID() }, 'operator', false, true);
    await vi.advanceTimersByTimeAsync(350);
    expect(useLaserStore.getState().stopJob).toHaveBeenCalledTimes(1);
    expect(completions.find((value) => value.id === 'abort')?.result.ok).toBe(true);
    expect(completions.some((value) => value.id === 'text')).toBe(false);
    finish(geometry);
    await vi.advanceTimersByTimeAsync(0);
    expect(completions.find((value) => value.id === 'text')?.result.ok).toBe(true);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    request(
      'denied-jog',
      'jog_machine',
      {
        expectedRevision: completions.find((value) => value.id === 'text')!.result.revision,
        requestId: crypto.randomUUID(),
        axis: 'x',
        direction: 1,
        distanceMm: 1,
      },
      'editor',
      true,
      false,
    );
    await vi.advanceTimersByTimeAsync(350);
    expect(completions.find((value) => value.id === 'denied-jog')?.result).toMatchObject({
      ok: false,
      error: { code: 'control_required' },
    });
    expect(useLaserStore.getState().stopJob).toHaveBeenCalledTimes(1);
  });
});
