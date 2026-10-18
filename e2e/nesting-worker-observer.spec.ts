import { EventEmitter } from 'node:events';
import { expect, test, type CDPSession } from '@playwright/test';
import { RuntimeObserver } from './fixtures/nesting-worker-lifecycle';

class DelayedWorkerAttachment extends EventEmitter {
  readonly attached: string[] = [];
  readonly detached: string[] = [];
  private finish: (value: { sessionId: string }) => void = () => undefined;
  private readonly attachment = new Promise<{ sessionId: string }>((resolve) => {
    this.finish = resolve;
  });

  async send(method: string, params: { targetId?: string; sessionId?: string } = {}) {
    if (method === 'Target.attachToTarget') {
      this.attached.push(params.targetId ?? 'missing-target');
      return this.attachment;
    }
    if (method === 'Target.detachFromTarget')
      this.detached.push(params.sessionId ?? 'missing-session');
    return {};
  }

  created(targetId: string): void {
    this.emit('Target.targetCreated', {
      targetInfo: { type: 'worker', browserContextId: 'context', targetId, url: '' },
    });
  }

  finishAttachment(): void {
    this.finish({ sessionId: 'late-session' });
  }
}

test('worker lifetime observer releases an attachment that finishes during teardown', async () => {
  const cdp = new DelayedWorkerAttachment();
  const observer = new RuntimeObserver(cdp as unknown as CDPSession, 'context');
  cdp.created('root');
  const releasing = observer.releaseAttachments();
  cdp.finishAttachment();
  await releasing;
  expect(cdp.detached).toEqual(['late-session']);
  // Releasing a debugger session still proves nothing about worker destruction.
  expect(observer.pending()).toHaveLength(1);
  cdp.emit('Target.targetDestroyed', { targetId: 'root' });
  expect(observer.pending()).toEqual([]);
});

test('worker lifetime observer keeps late targets pending without attaching after teardown', async () => {
  const cdp = new DelayedWorkerAttachment();
  const observer = new RuntimeObserver(cdp as unknown as CDPSession, 'context');
  await observer.releaseAttachments();
  cdp.created('late-child');
  expect(cdp.attached).toEqual([]);
  expect(observer.pending()).toHaveLength(1);
  cdp.emit('Target.targetDestroyed', { targetId: 'late-child' });
  expect(observer.pending()).toEqual([]);
});
