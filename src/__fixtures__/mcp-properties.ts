import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { afterEach, beforeEach, expect } from 'vitest';
import { createKerfDeskMcpServer } from '../../electron/mcp/server';
import { KerfDeskMcpError } from '../../electron/mcp/backend';
import {
  MCP_AUTHORING_ACTIONS_MARKUP,
  MCP_AUTHORING_MARKUP,
  MCP_AUTHORING_SCRIPT,
} from '../../electron/mcp/workspace-authoring-ui';
import { useStore } from '../ui/state/store';
import { setActiveEdition } from '../ui/licensing/edition';
import {
  addTestRectangle,
  testAdapter,
  writeArgs,
} from '../ui/remote-control/authoring-test-support';
import type { RemoteControlAdapter } from '../ui/remote-control/types';

export let adapter: RemoteControlAdapter;
let writable = true;
export function setWritable(value: boolean): void {
  writable = value;
}
const closers: Array<() => Promise<void>> = [];
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  setActiveEdition(null);
  writable = true;
  adapter = testAdapter({ canWrite: () => writable });
});
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  adapter.dispose();
  setActiveEdition(null);
  document.body.replaceChildren();
});

export async function nativeClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const entry = serveStdio(
    () =>
      createKerfDeskMcpServer({
        request: async (command, args, signal) => {
          const result = await adapter.execute(
            command,
            args,
            signal === undefined ? {} : { signal },
          );
          if (!result.ok)
            throw new KerfDeskMcpError(
              result.error.code === 'stale_revision' ? 'stale_revision' : 'failed',
            );
          return { ...result.data, revision: result.revision };
        },
      }),
    { transport: serverTransport },
  );
  const client = new Client({ name: 'grouped-properties-regression', version: '1' });
  closers.push(async () => {
    await client.close();
    await entry.close();
  });
  await client.connect(clientTransport);
  return client;
}

export async function mountProperties(
  client: Client,
  checkedIds: readonly string[],
  change?: (value: Record<string, unknown>) => Record<string, unknown>,
) {
  const result = await client.callTool({ name: 'get_workspace', arguments: {} });
  const content = result.structuredContent;
  if (result.isError || content === null || typeof content !== 'object' || Array.isArray(content))
    throw new Error('Expected native workspace');
  const workspace = content as Record<string, unknown>;
  document.body.innerHTML =
    MCP_AUTHORING_ACTIONS_MARKUP +
    MCP_AUTHORING_MARKUP +
    '<div id="items"></div><button id="retry"></button><p id="message"></p>';
  for (const id of checkedIds) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = id;
    input.checked = true;
    document.getElementById('items')?.append(input);
  }
  let pending = Promise.resolve();
  const writes: Array<{ name: string; args: Record<string, unknown> }> = [];
  const host = {
    workspace: change?.(workspace) ?? workspace,
    run: (action: () => Promise<void>) => {
      pending = action().catch((error: unknown) => {
        host.message(error instanceof Error ? error.message : String(error));
      });
    },
    mutate: async (name: string, args: Record<string, unknown>, expectedRevision: string) => {
      const input = { ...args, expectedRevision, requestId: crypto.randomUUID() };
      writes.push({ name, args: input });
      const answer = await client.callTool({ name, arguments: input });
      if (answer.isError) throw new Error('Native mutation rejected');
    },
    message: (text: string) => {
      document.getElementById('message')!.textContent = text;
    },
  };
  const binding = new Function(
    'host',
    `
    let workspace=host.workspace;
    const $=id=>document.getElementById(id);
    const {run,mutate,message}=host;
    const canEdit=()=>workspace.permissions?.canEdit===true;
    const connected=true, toolCallsAvailable=true, disposed=false, busy=false, pendingEdit=null;
    let selectionDirty=true, selectionRevision=workspace.revision;
    const retry=async()=>{}, request=async()=>{}, unwrap=value=>value, text=value=>value;
    function controls(){authoringControls(canEdit());}
    ${MCP_AUTHORING_SCRIPT}
    return { refresh(value){workspace=value;controls();} };
  `,
  )(host) as { refresh: (value: Record<string, unknown>) => void };
  document.getElementById('properties')?.click();
  return { writes, binding, settle: () => pending, workspace: host.workspace };
}

export async function groupAt(x = 0) {
  const ids = [await addTestRectangle(adapter, x), await addTestRectangle(adapter, x + 20)];
  expect(
    await adapter.execute(
      'arrange_artwork',
      writeArgs(adapter, { artworkIds: ids, action: 'group' }),
    ),
  ).toMatchObject({ ok: true });
  return ids as [string, string];
}
export function sizeInput(name: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('#resize-form [name=' + name + ']');
  if (input === null) throw new Error('Missing resize field');
  return input;
}
export function submitResize(): void {
  document
    .getElementById('resize-form')
    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
