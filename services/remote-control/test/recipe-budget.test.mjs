import assert from 'node:assert/strict';
import test from 'node:test';
import { start, connectDesktop, pairPhone, authorizeMcp } from './support.mjs';
import { mcpPost, toolCall, closeSocket } from './post-release-support.mjs';

const MAX_RESULT_BYTES = 256 * 1024;
const envelope = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

test('workerd: phone retains the full recipe read while MCP returns a bounded multilingual prefix', async () => {
  const materialName = '材料设置'.repeat(32);
  const recipes = Array.from({ length: 200 }, (_, index) => ({
    id: `recipe-${index}`,
    name: materialName,
    materialName,
    powerPercent: 30,
    speedMmPerMin: 1500,
    passes: 1,
  }));
  const raw = { revision: 'saved-material-revision', recipes, total: 200, truncated: false };
  assert.ok(bytes(raw) < MAX_RESULT_BYTES);
  assert.ok(bytes(envelope(raw)) > MAX_RESULT_BYTES);
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read']);
    const phonePending = phone.post('/api/client/command', {
      name: 'list_material_recipes',
      args: {},
    });
    const phoneCommand = await desktop.inbox.next('command');
    assert.equal(phoneCommand.command.name, 'list_material_recipes');
    desktop.send({ type: 'result', requestId: phoneCommand.requestId, result: raw });
    const phoneResponse = await phonePending;
    const phoneBody = await phoneResponse.json();
    assert.equal(phoneResponse.status, 200);
    assert.deepEqual(phoneBody.result, raw);

    const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read');
    const mcpResponse = await mcpPost(worker, credentials, toolCall(1, 'list_material_recipes'));
    const mcpCommand = await desktop.inbox.next('command');
    assert.equal(mcpCommand.command.name, 'list_material_recipes');
    desktop.send({ type: 'result', requestId: mcpCommand.requestId, result: raw });
    const messages = (await mcpResponse.text())
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)));
    const exchange = messages.find((message) => message.id === 1);
    assert.equal(mcpResponse.status, 200);
    assert.ok(exchange);
    const result = exchange.result;
    assert.notEqual(result.isError, true);
    const bounded = result.structuredContent;
    assert.equal(bounded.revision, raw.revision);
    assert.equal(bounded.total, raw.total);
    assert.equal(bounded.truncated, true);
    assert.ok(bounded.recipes.length > 0);
    assert.ok(bounded.recipes.length < raw.recipes.length);
    assert.deepEqual(bounded.recipes, raw.recipes.slice(0, bounded.recipes.length));
    assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify(bounded) }]);
    assert.ok(bytes(result) <= MAX_RESULT_BYTES);
    const next = { ...bounded, recipes: raw.recipes.slice(0, bounded.recipes.length + 1) };
    assert.ok(bytes(envelope(next)) > MAX_RESULT_BYTES);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});
