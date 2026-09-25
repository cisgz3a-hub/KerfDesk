import { describe, expect, it, vi } from 'vitest';
import type { ExternalFileOpenRequest } from '../types';
import { createLaunchQueueFileOpens } from './launch-queue-file-opens';

type Consumer = (params: { readonly files?: ReadonlyArray<FileSystemHandle> }) => void;

function launchHost(): {
  readonly host: () => { readonly launchQueue: { readonly setConsumer: (c: Consumer) => void } };
  readonly setConsumer: ReturnType<typeof vi.fn>;
  readonly launch: (...files: FileSystemHandle[]) => Promise<void>;
} {
  let consumer: Consumer | null = null;
  const setConsumer = vi.fn((next: Consumer) => {
    consumer = next;
  });
  return {
    host: () => ({ launchQueue: { setConsumer } }),
    setConsumer,
    launch: async (...files) => {
      consumer?.({ files });
      // Each file is read asynchronously before it is delivered.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function fileHandle(name: string, getFile?: () => Promise<File>): FileSystemHandle {
  return {
    kind: 'file',
    name,
    getFile: getFile ?? (async () => new File(['{}'], name)),
  } as unknown as FileSystemHandle;
}

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('createLaunchQueueFileOpens', () => {
  it('leaves browsers without the Launch Handler API unaffected', () => {
    const source = createLaunchQueueFileOpens(() => ({}));
    const listener = vi.fn();

    const unsubscribe = source.subscribe(listener);
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });

  it('installs one consumer however many times the app subscribes', () => {
    const { host, setConsumer } = launchHost();
    const source = createLaunchQueueFileOpens(host);

    source.subscribe(vi.fn())();
    source.subscribe(vi.fn());

    expect(setConsumer).toHaveBeenCalledOnce();
  });

  it('hands a launched project file over with its handle for Recent Projects', async () => {
    const { host, launch } = launchHost();
    const received: ExternalFileOpenRequest[] = [];
    createLaunchQueueFileOpens(host).subscribe((request) => received.push(request));
    const handle = fileHandle('sign.lf2');

    await launch(handle);

    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request?.kind).toBe('file');
    if (request?.kind !== 'file') return;
    expect(request.file.name).toBe('sign.lf2');
    expect(request.file.recentRef).toEqual({ kind: 'handle', handle });
  });

  it('refuses files that are not projects and folders', async () => {
    const { host, launch } = launchHost();
    const received: ExternalFileOpenRequest[] = [];
    createLaunchQueueFileOpens(host).subscribe((request) => received.push(request));
    const folder = { kind: 'directory', name: 'jobs.lf2' } as unknown as FileSystemHandle;

    await launch(fileHandle('photo.png'), folder);

    expect(received).toEqual([
      { kind: 'unavailable', name: 'photo.png', reason: 'invalid' },
      { kind: 'unavailable', name: 'jobs.lf2', reason: 'invalid' },
    ]);
  });

  it('says whether a launched file vanished or could not be read', async () => {
    const { host, launch } = launchHost();
    const received: ExternalFileOpenRequest[] = [];
    createLaunchQueueFileOpens(host).subscribe((request) => received.push(request));

    await launch(
      fileHandle('gone.lf2', async () => {
        throw namedError('NotFoundError');
      }),
      fileHandle('locked.lf2', async () => {
        throw namedError('NotReadableError');
      }),
    );

    expect(received).toEqual([
      { kind: 'unavailable', name: 'gone.lf2', reason: 'missing' },
      { kind: 'unavailable', name: 'locked.lf2', reason: 'unreadable' },
    ]);
  });

  it('delivers several launched files in launch order', async () => {
    const { host, launch } = launchHost();
    const received: string[] = [];
    createLaunchQueueFileOpens(host).subscribe((request) => {
      received.push(request.kind === 'file' ? request.file.name : request.name);
    });
    const slowRead = (): Promise<File> =>
      new Promise((resolve) => setTimeout(() => resolve(new File(['{}'], 'first.lf2')), 5));

    await launch(fileHandle('first.lf2', slowRead), fileHandle('second.lf2'));

    await vi.waitFor(() => expect(received).toEqual(['first.lf2', 'second.lf2']));
  });

  it('holds a launch that arrives between subscribers for the next one', async () => {
    const { host, launch } = launchHost();
    const source = createLaunchQueueFileOpens(host);
    source.subscribe(vi.fn())();

    await launch(fileHandle('late.lf2'));
    const listener = vi.fn();
    source.subscribe(listener);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'file',
        file: expect.objectContaining({ name: 'late.lf2' }),
      }),
    );
  });
});
