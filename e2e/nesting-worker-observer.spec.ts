import { EventEmitter } from 'node:events';
import { expect, test, type CDPSession } from '@playwright/test';
import { RuntimeObserver } from './fixtures/nesting-worker-lifecycle';

class BrowserDiscovery extends EventEmitter {
  readonly commands: string[] = [];

  async send(method: string) {
    this.commands.push(method);
    return {};
  }

  created(
    targetId: string,
    parentId?: string,
    browserContextId = 'context',
    type = 'worker',
  ): void {
    this.emit('Target.targetCreated', {
      targetInfo: { type, browserContextId, targetId, parentId, url: '' },
    });
  }
}

test('worker lifetime observer requires target destruction without attaching debugger sessions', async () => {
  const cdp = new BrowserDiscovery();
  const observer = new RuntimeObserver(cdp as unknown as CDPSession, 'context');
  cdp.created('root');
  expect(cdp.commands).toEqual([]);
  // Neither debugger detachment nor context loss proves the target was released.
  cdp.emit('Target.detachedFromTarget', { sessionId: 'session', targetId: 'root' });
  cdp.emit('Target.receivedMessageFromTarget', {
    sessionId: 'session',
    message: JSON.stringify({ method: 'Runtime.executionContextsCleared' }),
  });
  expect(observer.pending()).toHaveLength(1);
  cdp.emit('Target.targetDestroyed', { targetId: 'root' });
  expect(await observer.destruction()).toEqual([]);
  expect(cdp.commands).toEqual([]);
});

test('worker lifetime observer tracks late children until their own destruction', async () => {
  const cdp = new BrowserDiscovery();
  const observer = new RuntimeObserver(cdp as unknown as CDPSession, 'context');
  cdp.created('root');
  const destruction = observer.destruction();
  cdp.created('late-child', 'root');
  cdp.emit('Target.targetDestroyed', { targetId: 'root' });
  expect(observer.pending()).toEqual(['late-child (): target not destroyed']);
  cdp.emit('Target.targetDestroyed', { targetId: 'late-child' });
  expect(await destruction).toEqual([]);
  expect(cdp.commands).toEqual([]);
});

test('worker lifetime observer ignores other browser contexts and non-worker targets', async () => {
  const cdp = new BrowserDiscovery();
  const observer = new RuntimeObserver(cdp as unknown as CDPSession, 'context');
  cdp.created('other-worker', undefined, 'other-context');
  cdp.created('page', undefined, 'context', 'page');
  cdp.created('owned-worker');
  expect([...observer.workers.keys()]).toEqual(['owned-worker']);
  cdp.emit('Target.targetDestroyed', { targetId: 'other-worker' });
  expect(observer.pending()).toHaveLength(1);
  cdp.emit('Target.targetDestroyed', { targetId: 'owned-worker' });
  expect(await observer.destruction()).toEqual([]);
});
