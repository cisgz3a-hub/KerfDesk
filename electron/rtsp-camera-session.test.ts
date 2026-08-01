import { describe, expect, it } from 'vitest';
import { RtspPreviewSessions } from './rtsp-camera-session';

describe('RTSP preview session lifecycle', () => {
  it('binds one unguessable session to one exact source and keeps terminal failure authoritative', () => {
    let now = 100;
    const sessions = new RtspPreviewSessions(
      () => now,
      () => 'session-a',
    );
    const id = sessions.create('rtsp://192.168.1.20/live');
    expect(id).not.toBeNull();
    if (id === null) return;

    expect(id).toBe('session-a');
    expect(sessions.status(id)).toEqual({ kind: 'starting' });
    expect(sessions.claim(id, 'rtsp://192.168.1.21/live')).toBeNull();

    const lifecycle = sessions.claim(id, 'rtsp://192.168.1.20/live');
    expect(lifecycle).not.toBeNull();
    const secondLifecycle = sessions.claim(id, 'rtsp://192.168.1.20/live');
    expect(secondLifecycle).not.toBeNull();

    now += 1;
    lifecycle?.markLive();
    secondLifecycle?.markLive();
    expect(sessions.status(id)).toEqual({ kind: 'live' });

    secondLifecycle?.markClosed();
    expect(sessions.status(id)).toEqual({ kind: 'live' });

    const rejectedViewer = sessions.claim(id, 'rtsp://192.168.1.20/live');
    rejectedViewer?.markRejected('Too many concurrent camera streams.');
    expect(sessions.status(id)).toEqual({ kind: 'live' });

    now += 1;
    lifecycle?.markFailed('FFmpeg preview ended.');
    lifecycle?.markClosed();
    expect(sessions.status(id)).toEqual({ kind: 'failed', reason: 'FFmpeg preview ended.' });
  });

  it('fails an unclaimed preview that never starts and eventually forgets terminal state', () => {
    let now = 0;
    const sessions = new RtspPreviewSessions(
      () => now,
      () => 'session-a',
    );
    const id = sessions.create('rtsp://192.168.1.20/live');
    expect(id).not.toBeNull();
    if (id === null) return;

    now = 14_999;
    expect(sessions.status(id)).toEqual({ kind: 'starting' });
    now = 15_000;
    expect(sessions.status(id)).toEqual({
      kind: 'failed',
      reason: 'RTSP preview request did not start in time.',
    });

    now = 75_000;
    expect(sessions.status(id)).toEqual({
      kind: 'unavailable',
      reason: 'RTSP preview session is missing or expired.',
    });
  });

  it('reports an active client disconnect as terminal without creating a replacement', () => {
    const sessions = new RtspPreviewSessions(
      () => 100,
      () => 'session-a',
    );
    const id = sessions.create('rtsp://192.168.1.20/live');
    expect(id).not.toBeNull();
    if (id === null) return;
    const lifecycle = sessions.claim(id, 'rtsp://192.168.1.20/live');

    lifecycle?.markLive();
    lifecycle?.markClosed();

    expect(sessions.status(id)).toEqual({
      kind: 'failed',
      reason: 'RTSP preview connection closed.',
    });
  });

  it('refuses a pathological all-active overflow without evicting a live session', () => {
    let nextId = 0;
    const sessions = new RtspPreviewSessions(
      () => 100,
      () => `session-${(nextId += 1)}`,
    );
    const firstId = sessions.create('rtsp://192.168.1.20/live');
    expect(firstId).not.toBeNull();
    if (firstId === null) return;
    sessions.claim(firstId, 'rtsp://192.168.1.20/live')?.markLive();
    for (let index = 1; index < 64; index += 1) {
      const id = sessions.create(`rtsp://192.168.1.${index + 20}/live`);
      expect(id).not.toBeNull();
      if (id !== null) sessions.claim(id, `rtsp://192.168.1.${index + 20}/live`)?.markLive();
    }

    expect(sessions.create('rtsp://192.168.1.200/live')).toBeNull();
    expect(sessions.status(firstId)).toEqual({ kind: 'live' });
  });
});
