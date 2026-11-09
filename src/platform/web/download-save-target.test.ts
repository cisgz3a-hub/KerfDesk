// ADR-688 Amendment 2: Firefox and Safari save by downloading.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_URL_REVOKE_MS, downloadFile, downloadSaveTarget } from './download-save-target';

function fakeEnvironment() {
  const clicked: { name: string; href: string; inDocument: boolean }[] = [];
  const blobs: Blob[] = [];
  const timers: (() => void)[] = [];
  const revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ name: this.download, href: this.href, inDocument: this.isConnected });
  });
  return {
    clicked,
    blobs,
    timers,
    revokeObjectURL,
    env: {
      document,
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return `blob:kerfdesk/${blobs.length}`;
      },
      revokeObjectURL,
      setTimeout: (callback: () => void, ms: number) => {
        expect(ms).toBe(DOWNLOAD_URL_REVOKE_MS);
        timers.push(callback);
      },
    },
  };
}

afterEach(() => vi.restoreAllMocks());

// jsdom's Blob has no text(); its FileReader reads it.
function blobText(blob: Blob | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    if (blob === undefined) {
      reject(new Error('no blob'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The Blob could not be read.'));
    reader.readAsText(blob);
  });
}

describe('downloadFile', () => {
  it('clicks a connected anchor named for the file, removes it, and revokes the URL later', async () => {
    const fake = fakeEnvironment();

    downloadFile('job.lf2', '{"version":21}', fake.env);

    expect(fake.clicked).toEqual([{ name: 'job.lf2', href: 'blob:kerfdesk/1', inDocument: true }]);
    expect(await blobText(fake.blobs[0])).toBe('{"version":21}');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(fake.revokeObjectURL).not.toHaveBeenCalled();
    fake.timers.forEach((run) => run());
    expect(fake.revokeObjectURL).toHaveBeenCalledWith('blob:kerfdesk/1');
  });

  it('hands a Blob over as it is', () => {
    const fake = fakeEnvironment();
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

    downloadFile('art.png', png, fake.env);

    expect(fake.blobs[0]).toBe(png);
  });
});

describe('downloadSaveTarget', () => {
  it('downloads every write under its name and never claims to be another destination', async () => {
    const fake = fakeEnvironment();
    const target = downloadSaveTarget('job.lf2', fake.env);
    const other = downloadSaveTarget('job.lf2', fake.env);

    await target.write('one');
    await target.write('two');

    expect(target.delivery).toBe('download');
    expect(target.recentRef).toBeUndefined();
    expect(fake.clicked.map((c) => c.name)).toEqual(['job.lf2', 'job.lf2']);
    await expect(target.isSameDestination?.(other)).resolves.toBe(false);
    await expect(target.compareDestination?.(other)).resolves.toBe('unknown');
  });
});
