import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopJobActivity,
  installSessionEndGuard,
  sessionEndScript,
  withDesktopActivityRoute,
} from './session-end-guard';

function fakeWindow() {
  const window = new EventEmitter();
  const webContents = Object.assign(new EventEmitter(), {
    executeJavaScript: vi.fn(async (_code: string) => undefined),
  });
  return Object.assign(window, { webContents });
}

function sessionEvent(...reasons: string[]) {
  return { reasons, preventDefault: vi.fn() };
}

function guarded(busy: boolean) {
  const window = fakeWindow();
  const activity = createDesktopJobActivity();
  activity.set({ busy });
  const log = vi.fn();
  installSessionEndGuard(window, activity, log);
  return { window, activity, log };
}

describe('Windows ending the session during a job (ADR-548)', () => {
  it('asks Windows to wait while a job runs and tells the window why', () => {
    const { window, log } = guarded(true);
    const event = sessionEvent('shutdown');
    window.emit('query-session-end', event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      sessionEndScript('asked', ['shutdown']),
    );
    expect(log).toHaveBeenCalledWith(
      'Windows asked to end the session (shutdown) during a job; asked it to wait.',
    );
  });

  it('never delays Windows when no job runs', () => {
    const { window, log } = guarded(false);
    const query = sessionEvent('shutdown');
    window.emit('query-session-end', query);
    window.emit('session-end', sessionEvent('shutdown'));

    expect(query.preventDefault).not.toHaveBeenCalled();
    expect(window.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('sends Abort at once when Windows cannot be asked to wait', () => {
    const { window } = guarded(true);
    const event = sessionEvent('critical', 'shutdown');
    window.emit('query-session-end', event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      sessionEndScript('ending', ['shutdown', 'critical']),
    );
  });

  it('sends Abort when Windows ends the session anyway', () => {
    const { window, log } = guarded(true);
    window.emit('session-end', sessionEvent('logoff'));

    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      sessionEndScript('ending', ['logoff']),
    );
    expect(log).toHaveBeenCalledWith(
      'Windows is ending the session (logoff) during a job; sending Abort.',
    );
  });

  it('forgets a job when the page reloads or its process ends', () => {
    const { window, activity } = guarded(true);
    window.webContents.emit('render-process-gone');
    expect(activity.busy()).toBe(false);
    activity.set({ busy: true });
    window.webContents.emit('did-finish-load');
    expect(activity.busy()).toBe(false);
  });

  it('names only the reasons Windows documents', () => {
    expect(sessionEndScript('asked', ['logoff', '</script>'])).toBe(
      `window.dispatchEvent(new CustomEvent('kerfdesk:session-end', { detail: {"phase":"asked","reasons":["logoff"]} }))`,
    );
  });
});

function activityRequest(
  body: string,
  headers: Record<string, string> = {},
  url = 'app://app/api/desktop/activity',
): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'X-KerfDesk-Desktop': '1', 'Content-Type': 'application/json', ...headers },
    body,
  });
}

describe('the window job report route', () => {
  it('records whether a job runs', async () => {
    const activity = createDesktopJobActivity();
    const handle = withDesktopActivityRoute(async () => new Response('asset'), activity);

    const started = await handle(activityRequest('{"busy":true}'));
    expect(started.status).toBe(204);
    expect(started.headers.get('Cache-Control')).toBe('no-store');
    expect(activity.busy()).toBe(true);
    await handle(activityRequest('{"busy":false}'));
    expect(activity.busy()).toBe(false);
  });

  it("passes on a running job's progress (ADR-553)", async () => {
    const activity = createDesktopJobActivity();
    const reports: unknown[] = [];
    activity.subscribe((report) => reports.push(report));
    const handle = withDesktopActivityRoute(async () => new Response('asset'), activity);

    const body = '{"busy":true,"job":{"progress":0.25,"state":"paused"}}';
    expect((await handle(activityRequest(body))).status).toBe(204);
    await handle(activityRequest('{"busy":false}'));

    expect(reports).toEqual([
      { busy: true, job: { progress: 0.25, state: 'paused' } },
      { busy: false },
    ]);
  });

  it('answers only KerfDesk itself with a well-formed report', async () => {
    const activity = createDesktopJobActivity();
    const handle = withDesktopActivityRoute(async () => new Response('asset'), activity);
    const statuses = await Promise.all(
      [
        activityRequest('{"busy":"yes"}'),
        activityRequest('{"busy":true,"extra":1}'),
        activityRequest('{"busy":false,"job":{"progress":0.5,"state":"running"}}'),
        activityRequest('{"busy":true,"job":{"progress":1.5,"state":"running"}}'),
        activityRequest('{"busy":true,"job":{"progress":0.5,"state":"stopped"}}'),
        activityRequest('{"busy":true,"job":{"progress":0.5,"state":"running","x":1}}'),
        activityRequest('{"busy":true,"job":null}'),
        activityRequest('[true]'),
        activityRequest('not json'),
        activityRequest('{"busy":true}', { 'X-KerfDesk-Desktop': '0' }),
        activityRequest('{"busy":true}', { Origin: 'https://evil.example' }),
        activityRequest('{"busy":true}', { 'Content-Type': 'text/plain' }),
        activityRequest('{"busy":true}', {}, 'app://app/api/desktop/activity?x=1'),
        activityRequest('{"busy":true}', {}, 'app://app/api/desktop/other'),
      ].map(async (request) => (await handle(request)).status),
    );

    expect(statuses).toEqual([
      400, 400, 400, 400, 400, 400, 400, 400, 400, 404, 404, 404, 404, 404,
    ]);
    expect(activity.busy()).toBe(false);
    expect(await (await handle(new Request('app://app/index.html'))).text()).toBe('asset');
  });
});
