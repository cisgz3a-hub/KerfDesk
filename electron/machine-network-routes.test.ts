// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { MachineNetworkBridge } from './machine-network-bridge';
import { withMachineNetworkRoutes } from './machine-network-routes';
vi.mock('electron', () => ({ app: { once: vi.fn() } }));

it('requires the exact trusted app route and header before opening any channel', async () => {
  const bridge = new MachineNetworkBridge();
  const opening = vi.spyOn(bridge, 'open');
  const fallback = vi.fn(async () => new Response('fallback'));
  const route = withMachineNetworkRoutes(fallback, bridge);
  for (const [url, headers] of [
    ['app://app/api/machine-network/open', {}],
    ['app://app/api/machine-network/open?target=x', { 'X-KerfDesk-Machine-Network': '1' }],
    ['https://app/api/machine-network/open', { 'X-KerfDesk-Machine-Network': '1' }],
    [
      'app://app/api/machine-network/open',
      { 'X-KerfDesk-Machine-Network': '1', Origin: 'https://evil.invalid' },
    ],
  ] as const)
    expect((await route(new Request(url, { method: 'POST', headers, body: '{}' }))).status).toBe(
      404,
    );
  expect(opening).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
  bridge.dispose();
});

it('refuses unsupported channel families and bounded malformed bodies without connecting', async () => {
  const bridge = new MachineNetworkBridge();
  const opening = vi.spyOn(bridge, 'open');
  const route = withMachineNetworkRoutes(async () => new Response('fallback'), bridge);
  const request = (body: string) =>
    new Request('app://app/api/machine-network/open', {
      method: 'POST',
      headers: { 'X-KerfDesk-Machine-Network': '1' },
      body,
    });
  expect(
    (await route(request(JSON.stringify({ host: '127.0.0.1', port: 23, protocol: 'unknown' }))))
      .status,
  ).toBe(400);
  expect((await route(request('x'.repeat(96 * 1024 + 1)))).status).toBe(400);
  expect(opening).not.toHaveBeenCalled();
  bridge.dispose();
});
