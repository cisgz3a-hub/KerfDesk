import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ORIGIN, start, connectDesktop, pairPhone, workspace } from './support.mjs';

const COMMAND_BYTES = 256 * 1024;
const byteSize = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const admission = () => ({ expectedRevision: 'audit-1', requestId: randomUUID() });
const cases = [
  [
    'multilingual text',
    () => ({
      name: 'update_text',
      args: { ...admission(), artworkId: 'text-1', patch: { text: '材料'.repeat(1000) } },
    }),
  ],
  [
    '4096 escaped text characters',
    () => ({
      name: 'add_text',
      args: {
        ...admission(),
        xMm: 0,
        yMm: 0,
        widthMm: 20,
        fontSizeMm: 10,
        text: '\0'.repeat(4096),
      },
    }),
  ],
  [
    '512-point brush stroke',
    () => ({
      name: 'add_polyline',
      args: {
        ...admission(),
        pointsMm: Array.from({ length: 512 }, (_, index) => ({
          xMm: index / 3,
          yMm: 40 + Math.sin(index / 3) * 10,
        })),
        closed: false,
      },
    }),
  ],
  [
    '200 maximally escaped artwork identifiers',
    () => ({
      name: 'set_selection',
      args: {
        ...admission(),
        artworkIds: Array.from(
          { length: 200 },
          (_, index) => '\0'.repeat(124) + String(index).padStart(4, '0'),
        ),
      },
    }),
  ],
];

async function approvedFixture() {
  const worker = start();
  const desktop = await connectDesktop(worker);
  const phone = await pairPhone(worker, desktop);
  return { worker, desktop, phone };
}
async function dispose({ worker, desktop }) {
  if (desktop?.socket && desktop.socket.readyState < 2) desktop.socket.close();
  await worker.dispose();
}
async function deliver(context, command, rawBody) {
  const { worker, desktop, phone } = context;
  const responsePromise =
    rawBody === undefined
      ? phone.post('/api/client/command', command)
      : worker.dispatchFetch(ORIGIN + '/api/client/command', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            Cookie: phone.cookie,
            'X-KerfDesk-CSRF': phone.session.csrf,
          },
          body: rawBody,
        });
  const first = await Promise.race([
    responsePromise.then((response) => ({ response })),
    desktop.inbox.next('command').then((message) => ({ message })),
  ]);
  if (!first.message) {
    assert.equal(first.response.status, 200, 'The permitted Phone command must be admitted.');
    assert.fail('The Phone command completed without reaching its desktop owner.');
  }
  assert.deepEqual(first.message.command, command);
  const result = command.name === 'get_workspace' ? workspace : { revision: 'audit-2' };
  desktop.send({ type: 'result', requestId: first.message.requestId, result });
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result });
}

for (const [description, makeCommand] of cases)
  test('workerd Phone body: ' + description + ' reaches the approved desktop', async () => {
    const context = await approvedFixture();
    try {
      const command = makeCommand();
      assert.ok(byteSize(command) > 4096);
      assert.ok(byteSize(command) < COMMAND_BYTES);
      await deliver(context, command);
    } finally {
      await dispose(context);
    }
  });

test('workerd Phone body: exact byte ceiling is admitted and one more byte is refused', async () => {
  const context = await approvedFixture();
  try {
    const command = { name: 'get_workspace', args: {} };
    const body = JSON.stringify(command);
    const padded = body + ' '.repeat(COMMAND_BYTES - Buffer.byteLength(body));
    assert.equal(Buffer.byteLength(padded), COMMAND_BYTES);
    await deliver(context, command, padded);
    const refused = await context.worker.dispatchFetch(ORIGIN + '/api/client/command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: context.phone.cookie,
        'X-KerfDesk-CSRF': context.phone.session.csrf,
      },
      body: padded + ' ',
    });
    assert.equal(refused.status, 413);
    assert.equal(
      context.desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    await dispose(context);
  }
});

test('workerd Phone body: metadata routes retain their small request ceilings', async () => {
  const context = await approvedFixture();
  try {
    const body = '{}' + ' '.repeat(4095);
    for (const path of ['/api/desktop/register', '/api/pair/claim', '/api/client/revoke']) {
      const response = await context.worker.dispatchFetch(ORIGIN + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body,
      });
      assert.equal(response.status, 413, path);
    }
    assert.equal(
      context.desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    await dispose(context);
  }
});

test('workerd Phone body: malformed UTF-8 is refused as invalid input without dispatch', async () => {
  const context = await approvedFixture();
  try {
    for (const path of ['/api/client/command', '/mcp']) {
      const response = await context.worker.dispatchFetch(ORIGIN + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: context.phone.cookie,
          'X-KerfDesk-CSRF': context.phone.session.csrf,
        },
        body: Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
      });
      assert.equal(response.status, 400, path);
      assert.deepEqual(await response.json(), { error: 'invalid_request' });
    }
    assert.equal(
      context.desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    await dispose(context);
  }
});

test('workerd Phone body: larger budget retains schema and CSRF checks', async () => {
  const context = await approvedFixture();
  try {
    const invalid = cases[0][1]();
    invalid.args.patch.text = 'x'.repeat(4097);
    const response = await context.phone.post('/api/client/command', invalid);
    assert.equal(response.status, 400);
    const csrf = await context.phone.post('/api/client/command', cases[0][1](), {
      'X-KerfDesk-CSRF': '0'.repeat(64),
    });
    assert.equal(csrf.status, 403);
    assert.equal(
      context.desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    await dispose(context);
  }
});
