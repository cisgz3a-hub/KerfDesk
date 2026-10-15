import { expect, it, vi } from 'vitest';
import { beginConnectAttempt, cancelConnectAttempt } from './laser-connect-attempt';
import { runConnectAfterPermissionCleanup } from './laser-connect-permission-cleanup';

it('releases a failed forgotten attempt without stranding newer permission selection', async () => {
  const refs = { connectAttemptRevision: 0, forgetIntentRevision: 0 };
  let rejectCleanup: (error: Error) => void = () => undefined;
  const cleanup = new Promise<void>((_resolve, reject) => {
    rejectCleanup = reject;
  });
  const firstConnect = vi.fn(() => cleanup);
  const first = runConnectAfterPermissionCleanup(refs, beginConnectAttempt(refs), firstConnect);
  await vi.waitFor(() => expect(firstConnect).toHaveBeenCalledOnce());
  cancelConnectAttempt(refs, true);
  const obsoleteConnect = vi.fn(async () => undefined);
  const second = runConnectAfterPermissionCleanup(refs, beginConnectAttempt(refs), obsoleteConnect);
  const currentConnect = vi.fn(async () => undefined);
  const third = runConnectAfterPermissionCleanup(refs, beginConnectAttempt(refs), currentConnect);
  expect(currentConnect).not.toHaveBeenCalled();
  const rejected = expect(first).rejects.toThrow('Revocation failed');
  rejectCleanup(new Error('Revocation failed'));
  await rejected;
  await Promise.all([second, third]);
  expect(obsoleteConnect).not.toHaveBeenCalled();
  expect(currentConnect).toHaveBeenCalledOnce();
  const laterConnect = vi.fn(async () => undefined);
  await runConnectAfterPermissionCleanup(refs, beginConnectAttempt(refs), laterConnect);
  expect(laterConnect).toHaveBeenCalledOnce();
});

it('waits for every discovery superseded before Forget, not just the latest one', async () => {
  const refs = { connectAttemptRevision: 0, forgetIntentRevision: 0 };
  let releaseA: () => void = () => undefined;
  let releaseB: () => void = () => undefined;
  const a = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releaseA = resolve;
      }),
  );
  const first = runConnectAfterPermissionCleanup(refs, beginConnectAttempt(refs), a);
  await vi.waitFor(() => expect(a).toHaveBeenCalledOnce());
  const b = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releaseB = resolve;
      }),
  );
  const second = runConnectAfterPermissionCleanup(refs, beginConnectAttempt(refs), b);
  await vi.waitFor(() => expect(b).toHaveBeenCalledOnce());
  cancelConnectAttempt(refs, true);
  const c = vi.fn(async () => undefined);
  const third = runConnectAfterPermissionCleanup(refs, beginConnectAttempt(refs), c);
  releaseB();
  await second;
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    expect(c).not.toHaveBeenCalled();
  } finally {
    releaseA();
    await Promise.all([first, third]);
  }
  expect(c).toHaveBeenCalledOnce();
});
