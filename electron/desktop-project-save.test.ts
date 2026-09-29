// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveDesktopProjectFile } from './desktop-project-save.js';

let root = '';
let project = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'kerfdesk-project-save-'));
  project = path.join(root, 'Sign.lf2');
  await writeFile(project, '{"old":true}');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function body(...chunks: string[]): ReadableStream<Uint8Array> {
  return new Blob(chunks).stream();
}

function failingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"half'));
      controller.error(new Error('the window closed'));
    },
  });
}

function heldError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

async function onlyTheProjectRemains(): Promise<void> {
  expect(await readdir(root)).toEqual(['Sign.lf2']);
}

describe('saving over an opened project (ADR-550)', () => {
  it('replaces the project whole', async () => {
    await expect(saveDesktopProjectFile(project, body('{"new":', 'true}'))).resolves.toBe('saved');
    expect(await readFile(project, 'utf8')).toBe('{"new":true}');
    await onlyTheProjectRemains();
  });

  it('keeps the old project when the save is too large', async () => {
    await expect(
      saveDesktopProjectFile(project, body('0123456789', 'x'), { maxBytes: 10 }),
    ).resolves.toBe('too-large');
    expect(await readFile(project, 'utf8')).toBe('{"old":true}');
    await onlyTheProjectRemains();
  });

  it('keeps the old project when the save is cut off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(saveDesktopProjectFile(project, failingBody())).resolves.toBe('failed');
    await expect(saveDesktopProjectFile(project, null)).resolves.toBe('failed');
    expect(await readFile(project, 'utf8')).toBe('{"old":true}');
    await onlyTheProjectRemains();
    warn.mockRestore();
  });

  it('waits while another program briefly holds the file', async () => {
    const { rename } = await import('node:fs/promises');
    const renameFile = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValueOnce(heldError('EBUSY'))
      .mockRejectedValueOnce(heldError('EPERM'))
      .mockImplementation(rename);

    await expect(
      saveDesktopProjectFile(project, body('{"new":true}'), { rename: renameFile }),
    ).resolves.toBe('saved');
    expect(renameFile).toHaveBeenCalledTimes(3);
    expect(await readFile(project, 'utf8')).toBe('{"new":true}');
  });

  it('gives up on a file that stays held, leaving it as it was', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const renameFile = vi.fn(async () => {
      throw heldError('EACCES');
    });

    await expect(
      saveDesktopProjectFile(project, body('{"new":true}'), { rename: renameFile }),
    ).resolves.toBe('failed');
    expect(renameFile).toHaveBeenCalledTimes(5);
    expect(await readFile(project, 'utf8')).toBe('{"old":true}');
    await onlyTheProjectRemains();
    warn.mockRestore();
  });

  it('fails without retrying when the folder is gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gone = path.join(root, 'missing', 'Sign.lf2');
    await expect(saveDesktopProjectFile(gone, body('{}'))).resolves.toBe('failed');
    warn.mockRestore();
  });
});
