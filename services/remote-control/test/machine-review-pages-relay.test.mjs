import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { start, connectDesktop, pairPhone, authorizeMcp, ORIGIN } from './support.mjs';
import { closeSocket } from './post-release-support.mjs';

const MAX_BYTES = 256 * 1024;

test('workerd: both SDK protocol generations and phone preserve same-review counts and all bounded pages', async () => {
  const worker = start(),
    clients = [];
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read']);
    const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read');
    const reviewId = randomUUID(),
      operationId = randomUUID();
    const warnings = Array.from({ length: 207 }, (_, index) => ({
      code: `review-${index + 1}`,
      message: `Warning ${index + 1} 火'.\\`,
    }));
    const operations = Array.from({ length: 201 }, (_, index) => ({
      operationId: `operation-${index}`,
      index,
      summaryOffset: 0,
      summaryTotal: 1,
      summaries: [`Operation ${index + 1} 材料`],
    }));
    const facts = [
      ...warnings.map((value) => ({ warning: value })),
      ...operations.map((value) => ({ operation: value })),
    ];
    const page = (offset) => {
      const chunk = facts.slice(offset, offset + 60);
      const nextOffset = offset + chunk.length < facts.length ? offset + chunk.length : null;
      return {
        revision: 'canonical-1',
        operation: {
          operationId,
          revision: 'canonical-1',
          kind: 'job',
          state: 'awaiting_review',
          committed: false,
          review: {
            reviewId,
            revision: 'canonical-1',
            mode: 'laser',
            artworkShared: true,
            stats: [],
            warnings: chunk.flatMap((item) => (item.warning ? [item.warning] : [])),
            operations: chunk.flatMap((item) => (item.operation ? [item.operation] : [])),
            pagination: {
              offset,
              nextOffset,
              totalFacts: facts.length,
              totalWarnings: 207,
              totalOperations: 201,
              totalStats: 0,
              totalSummaries: 201,
            },
            acknowledgement: {
              kind: 'laser-unverified',
              prompt: 'Confirm this same reviewed program?',
            },
            frame: { required: true, complete: true },
          },
        },
      };
    };
    desktop.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== 'command') return;
      assert.equal(message.command.name, 'get_control_operation');
      assert.equal(message.command.args.operationId, operationId);
      const cursor = message.command.args.reviewPage;
      if (cursor) assert.equal(cursor.reviewId, reviewId);
      desktop.send({
        type: 'result',
        requestId: message.requestId,
        result: page(cursor?.offset ?? 0),
      });
    });
    const readers = [
      [
        'phone',
        async (args) => {
          const response = await phone.post('/api/client/command', {
            name: 'get_control_operation',
            args,
          });
          assert.equal(response.status, 200);
          return (await response.json()).result;
        },
      ],
    ];
    for (const protocolVersion of ['2025-03-26', '2026-07-28']) {
      const client = new Client(
        { name: 'Bounded review fixture', version: '1' },
        {},
        { supportedProtocolVersions: [protocolVersion] },
      );
      clients.push(client);
      const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${credentials.access_token}` } },
        fetch: (url, init) => worker.dispatchFetch(url, init),
      });
      await client.connect(transport);
      readers.push([
        protocolVersion,
        async (args) => {
          const result = await client.callTool({ name: 'get_control_operation', arguments: args });
          assert.notEqual(result.isError, true);
          assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= MAX_BYTES);
          assert.deepEqual(result.content, [
            { type: 'text', text: JSON.stringify(result.structuredContent) },
          ]);
          return result.structuredContent;
        },
      ]);
    }
    for (const [surface, read] of readers) {
      let offset = 0,
        lastWarnings = [],
        lastOperations = [];
      while (offset !== null) {
        const result = await read({
          operationId,
          ...(offset ? { reviewPage: { reviewId, offset } } : {}),
        });
        assert.deepEqual(result, page(offset), surface);
        const review = result.operation.review;
        lastWarnings.push(...review.warnings);
        lastOperations.push(...review.operations);
        offset = review.pagination.nextOffset;
      }
      assert.deepEqual(lastWarnings, warnings, surface);
      assert.deepEqual(lastOperations, operations, surface);
    }
  } finally {
    for (const client of clients) await client.close().catch(() => undefined);
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});
