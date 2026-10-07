import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ORIGIN, start, connectDesktop, pairPhone, authorizeMcp, workspace } from './support.mjs';
import { closeSocket } from './post-release-support.mjs';
import { operationReceipt } from './control-support.mjs';
import { startObservedRateWorker, admissionWindow, rateCall } from './rate-window-support.mjs';

const tool = (id, name = 'get_workspace', args = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});
const cancel = (requestId) => ({
  jsonrpc: '2.0',
  method: 'notifications/cancelled',
  params: { requestId },
});
function post(worker, credentials, protocol, message, extra = {}) {
  return worker.dispatchFetch(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': protocol,
      ...extra,
    },
    body: typeof message === 'string' ? message : JSON.stringify(message),
  });
}
function results(text) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .flatMap((line) => JSON.parse(line.slice(5).trim()))
    .filter((message) => Object.hasOwn(message, 'id'));
}
const appStatus = {
  revision: workspace.revision,
  app: { name: 'KerfDesk', version: '1', platform: 'desktop' },
  edition: { mode: 'free' },
  updates: { available: false },
};

for (const protocol of ['2025-03-26', '2025-11-25']) {
  test(
    `workerd: ${protocol} batch cancellation owns exact typed IDs and ignores foreign apps and late success`,
    { timeout: 20_000 },
    async () => {
      const worker = start();
      let desktop;
      try {
        desktop = await connectDesktop(worker);
        const phone = await pairPhone(worker, desktop);
        const credentials = await authorizeMcp(worker, phone);
        const foreign = await authorizeMcp(worker, phone);
        const exchange = await post(
          worker,
          credentials,
          protocol,
          [tool(1), tool('1', 'get_app_status')],
          { 'Content-Type': 'Application/JSON; charset=utf-8' },
        );
        assert.equal(exchange.status, 200);
        const commands = [await desktop.inbox.next('command'), await desktop.inbox.next('command')];
        const read = commands.find((message) => message.command.name === 'get_workspace');
        const app = commands.find((message) => message.command.name === 'get_app_status');
        assert.ok(read && app);
        assert.equal((await post(worker, foreign, protocol, [cancel(1), cancel('1')])).status, 202);
        assert.equal(
          desktop.inbox.queue.some((message) => message.type === 'cancel'),
          false,
        );
        assert.equal(
          (
            await post(worker, credentials, protocol, [cancel(1)], {
              'Content-Type': 'APPLICATION/JSON',
            })
          ).status,
          202,
        );
        assert.equal((await desktop.inbox.next('cancel')).requestId, read.requestId);
        assert.equal(
          desktop.inbox.queue.some((message) => message.type === 'cancel'),
          false,
        );
        desktop.send({ type: 'result', requestId: read.requestId, result: workspace });
        desktop.send({ type: 'result', requestId: app.requestId, result: appStatus });
        const replies = results(await exchange.text());
        assert.equal(replies.length, 2);
        assert.equal(
          replies.find((message) => message.id === 1).result.structuredContent.error.code,
          'cancelled',
        );
        assert.deepEqual(
          replies.find((message) => message.id === '1').result.structuredContent,
          appStatus,
        );
        assert.doesNotMatch(
          JSON.stringify(replies.find((message) => message.id === 1)),
          /Synthetic audit workspace/,
        );
        // Completion releases every reservation, including the cancelled member's generation.
        const next = await post(worker, credentials, protocol, [
          tool(1),
          tool('1', 'get_app_status'),
        ]);
        for (let index = 0; index < 2; index++) {
          const command = await desktop.inbox.next('command');
          desktop.send({
            type: 'result',
            requestId: command.requestId,
            result: command.command.name === 'get_workspace' ? workspace : appStatus,
          });
        }
        assert.equal(
          results(await next.text()).filter((message) => !message.result.isError).length,
          2,
        );
      } finally {
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );

  test(
    `workerd: ${protocol} batched cancellation also fences a pending singleton`,
    { timeout: 20_000 },
    async () => {
      const worker = start();
      let desktop;
      try {
        desktop = await connectDesktop(worker);
        const phone = await pairPhone(worker, desktop);
        const credentials = await authorizeMcp(worker, phone);
        const exchange = await post(worker, credentials, protocol, tool(7001));
        assert.equal(exchange.status, 200);
        const command = await desktop.inbox.next('command');
        assert.equal((await post(worker, credentials, protocol, [cancel(7001)])).status, 202);
        assert.equal((await desktop.inbox.next('cancel')).requestId, command.requestId);
        desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
        const body = await exchange.text();
        assert.match(body, /The request was cancelled/);
        assert.doesNotMatch(body, /Synthetic audit workspace/);
      } finally {
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );

  test(
    `workerd: ${protocol} both call/cancel orders fence their member without cancelling a sibling`,
    { timeout: 20_000 },
    async () => {
      const worker = start();
      let desktop;
      try {
        desktop = await connectDesktop(worker);
        const phone = await pairPhone(worker, desktop);
        const credentials = await authorizeMcp(worker, phone);
        for (const firstCancel of [false, true]) {
          const pair = firstCancel ? [cancel(7), tool(7)] : [tool(7), cancel(7)];
          const exchange = await post(worker, credentials, protocol, [...pair, tool(8)]);
          assert.equal(exchange.status, 200);
          const command = await desktop.inbox.next('command');
          assert.equal(
            desktop.inbox.queue.some((message) => message.type === 'command'),
            false,
          );
          desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
          const replies = results(await exchange.text());
          assert.equal(replies.length, 2);
          assert.equal(
            replies.find((message) => message.id === 7).result.structuredContent.error.code,
            'cancelled',
          );
          assert.deepEqual(
            replies.find((message) => message.id === 8).result.structuredContent,
            workspace,
          );
        }
      } finally {
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );

  test(
    `workerd: ${protocol} malformed, duplicate, modern and oversized batch forms have no dispatch or cancellation side effects`,
    { timeout: 20_000 },
    async () => {
      const worker = start();
      let desktop;
      try {
        desktop = await connectDesktop(worker);
        const phone = await pairPhone(worker, desktop, ['read', 'control']);
        const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read kerfdesk:control');
        const pending = await post(worker, credentials, protocol, tool(9000));
        const original = await desktop.inbox.next('command');
        const invalid = [
          [],
          Array.from({ length: 101 }, (_, index) => tool(index)),
          [tool(2), tool(2)],
          [tool(3), { jsonrpc: '2.0', id: 3, method: 'ping' }],
          [tool(4), null],
          [tool('x'.repeat(513))],
          [tool(Number.MAX_SAFE_INTEGER + 1)],
          [tool(1.5)],
          [tool(null)],
          [cancel({})],
          [cancel(9000), { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 7 } }],
          [
            {
              ...tool(5),
              params: {
                name: 'get_workspace',
                arguments: {},
                _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
              },
            },
          ],
        ];
        for (const batch of invalid)
          for (const contentType of [
            'application/json',
            'application/json; charset=utf-8',
            'Application/JSON',
            'APPLICATION/JSON; charset=utf-8',
          ]) {
            const response = await post(worker, credentials, protocol, batch, {
              'Content-Type': contentType,
            });
            assert.equal(response.status, 400, await response.text());
            assert.equal(
              desktop.inbox.queue.some((message) => ['command', 'cancel'].includes(message.type)),
              false,
            );
          }
        assert.equal(
          (
            await post(worker, credentials, protocol, [tool(10)], {
              Authorization: 'Bearer forged',
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await post(worker, credentials, protocol, [tool(10)], {
              Origin: 'https://foreign.example',
            })
          ).status,
          403,
        );
        const readPhone = await pairPhone(worker, desktop, ['read']);
        const readCredentials = await authorizeMcp(worker, readPhone, 'kerfdesk:read');
        const denied = await post(worker, readCredentials, protocol, [
          tool(10, 'abort_job', { requestId: randomUUID() }),
        ]);
        assert.equal(denied.status, 403);
        assert.match(denied.headers.get('WWW-Authenticate'), /insufficient_scope/);
        const oversized = await post(
          worker,
          credentials,
          protocol,
          '[' + ' '.repeat(256 * 1024) + ']',
        );
        assert.equal(oversized.status, 413);
        await oversized.text();
        assert.equal(
          desktop.inbox.queue.some((message) => ['command', 'cancel'].includes(message.type)),
          false,
        );
        desktop.send({ type: 'result', requestId: original.requestId, result: workspace });
        assert.deepEqual(results(await pending.text())[0].result.structuredContent, workspace);
        // Validation of all members precedes registration: this ID was never reserved by the invalid pair.
        const next = await post(worker, credentials, protocol, tool(2));
        const nextCommand = await desktop.inbox.next('command');
        desktop.send({ type: 'result', requestId: nextCommand.requestId, result: workspace });
        assert.deepEqual(results(await next.text())[0].result.structuredContent, workspace);
      } finally {
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );

  test(
    `workerd: ${protocol} singleton ID bounds accept exact limits and refuse invalid IDs`,
    { timeout: 20_000 },
    async () => {
      const worker = start();
      let desktop;
      try {
        desktop = await connectDesktop(worker);
        const phone = await pairPhone(worker, desktop);
        const credentials = await authorizeMcp(worker, phone);
        for (const id of ['x'.repeat(512), Number.MAX_SAFE_INTEGER, 0, '']) {
          const response = await post(worker, credentials, protocol, tool(id), {
            'Content-Type': 'Application/JSON; charset=utf-8',
          });
          assert.equal(response.status, 200);
          const command = await desktop.inbox.next('command');
          desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
          assert.deepEqual(results(await response.text())[0].result.structuredContent, workspace);
        }
        for (const id of ['x'.repeat(513), Number.MAX_SAFE_INTEGER + 1, 1.5, null, {}, []]) {
          const response = await post(worker, credentials, protocol, tool(id));
          assert.equal(response.status, 400);
          await response.text();
          assert.equal(
            desktop.inbox.queue.some((message) => message.type === 'command'),
            false,
          );
        }
      } finally {
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );

  test(
    `workerd: ${protocol} canonical 100-Abort batch is accepted with bounded per-member admission and release`,
    { timeout: 20_000 },
    async (t) => {
      const worker = startObservedRateWorker({ clientRateLimit: 1, abortRateLimit: 2 });
      let desktop;
      try {
        desktop = await connectDesktop(worker);
        const phone = await pairPhone(worker, desktop, ['read', 'control']);
        const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read kerfdesk:control');
        const sent = [];
        desktop.socket.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          if (message.type !== 'command') return;
          sent.push(message);
          if (desktop.socket.readyState === 1)
            desktop.send({
              type: 'result',
              requestId: message.requestId,
              result:
                message.command.name === 'abort_job'
                  ? operationReceipt(message, 'completed')
                  : workspace,
            });
        });
        const epoch = await admissionWindow(worker);
        const calls = [];
        const ordinary = await post(worker, credentials, protocol, tool(1000));
        calls.push(rateCall(ordinary, epoch, 'CLIENT_LIMIT', true));
        assert.equal(ordinary.status, 200);
        await ordinary.text();
        const deniedOrdinary = await post(worker, credentials, protocol, tool(1001));
        calls.push(rateCall(deniedOrdinary, epoch, 'CLIENT_LIMIT', false));
        assert.equal(deniedOrdinary.status, 429);
        await deniedOrdinary.text();
        const batch = Array.from({ length: 100 }, (_, index) =>
          tool(index, 'abort_job', { requestId: randomUUID() }),
        );
        const response = await post(worker, credentials, protocol, batch, {
          'Content-Type': 'APPLICATION/JSON',
        });
        calls.push(rateCall(response, epoch, 'ABORT_LIMIT', true));
        assert.equal(response.status, 200, await response.clone().text());
        const replies = results(await response.text());
        assert.equal(replies.length, 100);
        assert.equal(new Set(replies.map((message) => message.id)).size, 100);
        const capacityDenied = replies.filter(
          (message) => message.result.structuredContent.error?.code === 'unavailable',
        );
        assert.equal(
          capacityDenied.length,
          64,
          'The original 36 priority associations remain bounded.',
        );
        assert.ok(sent.filter((message) => message.command.name === 'abort_job').length > 0);
        assert.ok(sent.filter((message) => message.command.name === 'abort_job').length <= 36);
        // The entire exchange released its acquired associations, even when a member was denied.
        const next = await post(worker, credentials, protocol, [
          tool(0, 'abort_job', { requestId: randomUUID() }),
        ]);
        calls.push(rateCall(next, epoch, 'ABORT_LIMIT', true));
        assert.equal(next.status, 200);
        const reply = results(await next.text())[0].result.structuredContent;
        assert.notEqual(reply.error?.code, 'unavailable');
        const limited = await post(worker, credentials, protocol, [
          tool(101, 'abort_job', { requestId: randomUUID() }),
        ]);
        calls.push(rateCall(limited, epoch, 'ABORT_LIMIT', false));
        assert.equal(limited.status, 429);
        await limited.text();
        t.diagnostic(
          JSON.stringify({
            admissionEpoch: epoch,
            startedUtc: new Date(calls[0].started).toISOString(),
            endedUtc: new Date(calls.at(-1).ended).toISOString(),
            calls,
          }),
        );
      } finally {
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );
}

for (const protocol of ['2025-03-26', '2025-11-25']) {
  test(
    `workerd: ${protocol} cancellation filtering preserves a near-limit batch's compact exponent bytes`,
    { timeout: 20_000 },
    async (t) => {
      const worker = start();
      let desktop;
      try {
        desktop = await connectDesktop(worker);
        const phone = await pairPhone(worker, desktop);
        const credentials = await authorizeMcp(worker, phone);
        const batch = Array.from({ length: 16 }, (_, index) =>
          tool(index + 1, 'add_polyline', {
            expectedRevision: 'audit-1',
            requestId: randomUUID(),
            pointsMm: Array.from({ length: 512 }, (_, point) => ({
              xMm: point === 511 ? 0.000002 : 0.000001,
              yMm: 0.000001,
            })),
            closed: false,
          }),
        );
        const incoming = JSON.stringify([...batch, cancel(0)])
          .replaceAll('0.000001', '1e-6')
          .replaceAll('0.000002', '2e-6');
        const incomingBytes = Buffer.byteLength(incoming);
        const reserializedBytes = Buffer.byteLength(
          JSON.stringify(JSON.parse(incoming).slice(0, -1)),
        );
        assert.ok(incomingBytes < 256 * 1024);
        assert.ok(reserializedBytes > 256 * 1024);
        const response = await post(worker, credentials, protocol, incoming, {
          'Content-Length': String(incomingBytes),
        });
        assert.equal(response.status, 200);
        for (let index = 0; index < batch.length; index++) {
          const command = await desktop.inbox.next('command');
          assert.equal(command.command.name, 'add_polyline');
          assert.equal(command.command.args.pointsMm.length, 512);
          assert.deepEqual(command.command.args.pointsMm[0], { xMm: 0.000001, yMm: 0.000001 });
          assert.deepEqual(command.command.args.pointsMm[511], { xMm: 0.000002, yMm: 0.000001 });
          desktop.send({
            type: 'result',
            requestId: command.requestId,
            result: {
              revision: 'audit-2',
              changedArtworkIds: [`polyline-${index}`],
              selection: [],
            },
          });
        }
        const replies = results(await response.text());
        assert.equal(replies.length, batch.length);
        assert.equal(replies.filter((message) => !message.result.isError).length, batch.length);
        t.diagnostic(
          JSON.stringify({ incomingBytes, reserializedBytes, acceptedMembers: replies.length }),
        );
      } finally {
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );

  test(
    `workerd: ${protocol} raw filtering handles first/middle/last cancellation, UTF-8, escapes and nested delimiters`,
    { timeout: 20_000 },
    async () => {
      const worker = start();
      let desktop;
      try {
        desktop = await connectDesktop(worker);
        const phone = await pairPhone(worker, desktop);
        const credentials = await authorizeMcp(worker, phone);
        const cancelledId = 'cancelled:"\\],{"雪😀';
        const liveId = 'live:é,"\\[}],';
        for (const position of [0, 1, 2]) {
          const stopped = tool(cancelledId);
          stopped.params._meta = {
            note: '雪é😀 ],"\\[,{}',
            nested: [{ items: [',', ']', '{', 'é'] }],
          };
          const live = tool(liveId);
          live.params._meta = { nested: [{ text: 'backslash\\ and quote" and comma, [雪]' }] };
          const members = [stopped, live];
          members.splice(position, 0, cancel(cancelledId));
          const wire =
            ' \r\n[ ' + members.map((message) => JSON.stringify(message)).join(',\n') + ' ] \t';
          const response = await post(worker, credentials, protocol, wire);
          assert.equal(response.status, 200);
          const command = await desktop.inbox.next('command');
          assert.equal(command.command.name, 'get_workspace');
          assert.equal(
            desktop.inbox.queue.some((message) => message.type === 'command'),
            false,
          );
          desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
          const replies = results(await response.text());
          assert.equal(replies.length, 2);
          assert.equal(
            replies.find((message) => message.id === cancelledId).result.structuredContent.error
              .code,
            'cancelled',
          );
          assert.deepEqual(
            replies.find((message) => message.id === liveId).result.structuredContent,
            workspace,
          );
        }
      } finally {
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );
}
