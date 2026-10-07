import type { RemoteAccessStatus } from './remote-access-store';
import { PHONE_CONTROL_URL } from './pairing-link';

export const pairingFixture: RemoteAccessStatus = {
  statusRevision: 1,
  available: true,
  enabled: true,
  connected: true,
  deviceId: '12345678-1234-4234-8234-123456789abc',
  controlUrl: `${PHONE_CONTROL_URL}?deviceId=12345678-1234-4234-8234-123456789abc`,
  mcpUrl: 'https://kerfdesk-phone-control.cisgz3a.workers.dev/mcp',
  pairing: { code: 'PairCode12-A', expiresAt: 1_700_000_300_000, expiresInMs: 300_000 },
  pairingPending: false,
  requests: [],
  clients: [],
  error: null,
};

/** Recover actual SVG cell geometry independently of the encoder modules. */
export function renderedQrModules(svg: SVGElement): { modules: Uint8Array; size: number } {
  const extent = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
  const size = extent - 8;
  const modules = new Uint8Array(size * size);
  const path = svg.querySelector('path')?.getAttribute('d') ?? '';
  const rectangles = [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)];
  if (rectangles.length === 0 || !Number.isInteger(size)) throw new Error('No rendered QR grid');
  for (const rectangle of rectangles) {
    const x = Number(rectangle[1]) - 4;
    const y = Number(rectangle[2]) - 4;
    const width = Number(rectangle[3]);
    if (x < 0 || y < 0 || x + width > size || y >= size)
      throw new Error('Quiet zone was overwritten');
    for (let offset = 0; offset < width; offset += 1) modules[y * size + x + offset] = 1;
  }
  return { modules, size };
}
