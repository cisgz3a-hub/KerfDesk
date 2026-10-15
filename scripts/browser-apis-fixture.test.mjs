import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const fixtureSource = await readFile(
  new URL('../e2e/fixtures/browser-apis.js', import.meta.url),
  'utf8',
);

function fixture() {
  const window = {};
  runInNewContext(fixtureSource, {
    window,
    navigator: {},
    Blob,
    File,
    DOMException,
    Event,
    EventTarget,
    TextEncoder,
    TextDecoder,
    ReadableStream,
    WritableStream,
    queueMicrotask,
    setTimeout,
    MediaStream: class {
      getTracks() {
        return [];
      }
    },
  });
  return window;
}

test('directory lookup rejects absent files and create reserves an entry before writing', async () => {
  const browser = fixture();
  const directory = await browser.showDirectoryPicker();
  await assert.rejects(directory.getFileHandle('a.svg'), { name: 'NotFoundError' });
  await assert.rejects(directory.getFileHandle('a.svg', { create: false }), {
    name: 'NotFoundError',
  });
  const created = await directory.getFileHandle('a.svg', { create: true });
  assert.equal(created.name, 'a.svg');
  assert.equal((await directory.getFileHandle('a.svg')).name, 'a.svg');
  assert.equal(browser.__KERFDESK_E2E__.savedFiles['a.svg'], undefined);
});

test('directory writes commit on close and aborted replacements preserve prior content', async () => {
  const browser = fixture();
  const directory = await browser.showDirectoryPicker();
  const handle = await directory.getFileHandle('a.svg', { create: true });
  const writer = await handle.createWritable();
  await writer.write(new Blob(['<svg/>']));
  assert.equal(browser.__KERFDESK_E2E__.savedFiles['a.svg'], undefined);
  await writer.close();
  assert.equal(browser.__KERFDESK_E2E__.savedFiles['a.svg'], '<svg/>');
  const replacement = await handle.createWritable();
  await replacement.write('replacement');
  await replacement.abort();
  assert.equal(browser.__KERFDESK_E2E__.savedFiles['a.svg'], '<svg/>');
  assert.equal((await (await browser.showDirectoryPicker()).getFileHandle('a.svg')).name, 'a.svg');
});

test('collision probing finds the first absent suffix rather than reporting every name present', async () => {
  const browser = fixture();
  const directory = await browser.showDirectoryPicker();
  const handle = await browser.showSaveFilePicker({ suggestedName: 'a-trace.svg' });
  const writer = await handle.createWritable();
  await writer.write('existing');
  await writer.close();
  await directory.getFileHandle('a-trace-2.svg', { create: true });
  let available;
  for (const name of ['a-trace.svg', 'a-trace-2.svg', 'a-trace-3.svg']) {
    try {
      await directory.getFileHandle(name);
    } catch (error) {
      assert.equal(error.name, 'NotFoundError');
      available = name;
      break;
    }
  }
  assert.equal(available, 'a-trace-3.svg');
});
