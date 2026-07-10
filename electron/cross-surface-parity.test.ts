import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The machine-camera host list and the renderer CSP are each duplicated across
// the web and Electron surfaces (electron/ cannot import from src/), kept in sync
// by comment only. These structural tests pin that duplication so a change to one
// copy that misses the other fails CI instead of silently drifting (ELE-08). They
// read the files as text — no import — so the electron→src read is boundary-safe.
function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

// Single-quoted string entries of the first array literal after `decl`. Used only
// for the host lists, whose entries carry no nested quotes.
function stringArray(source: string, decl: string): string[] {
  const declAt = source.indexOf(decl);
  if (declAt === -1) throw new Error(`declaration not found: ${decl}`);
  const open = source.indexOf('[', declAt);
  const close = source.indexOf(']', open);
  const block = source.slice(open + 1, close);
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

function literalNumber(source: string, name: string): number {
  const match = source.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  if (!match?.[1]) throw new Error(`numeric constant not found: ${name}`);
  return Number(match[1]);
}

// A CSP string → { directive: sorted sources } map, so ordering and whitespace do
// not cause a false mismatch.
function cspDirectiveMap(csp: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const directive of csp.split(';').map((d) => d.trim().replace(/\s+/g, ' '))) {
    if (directive.length === 0) continue;
    const [name, ...sources] = directive.split(' ');
    if (name !== undefined) map[name] = [...sources].sort().join(' ');
  }
  return map;
}

function webHeadersCsp(): string {
  const line = read('public/_headers')
    .split('\n')
    .find((l) => l.includes('Content-Security-Policy:'));
  if (line === undefined) throw new Error('CSP header not found in public/_headers');
  return line.slice(line.indexOf(':') + 1).trim();
}

// Rebuild the electron CSP from its `CSP_POLICY` array literal, substituting the
// templated bridge origin with the concrete one so it can be compared to the
// web app's literal CSP.
function electronCsp(bridgePort: number): string {
  const source = read('electron/main.ts');
  const declAt = source.indexOf('const CSP_POLICY = [');
  const open = source.indexOf('[', declAt);
  const close = source.indexOf('].join', declAt);
  const directives = source
    .slice(open + 1, close)
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line.length > 0)
    .map((line) => line.slice(1, -1)); // strip the outer " or `
  return directives
    .join('; ')
    .replace(/\$\{CAMERA_BRIDGE_ORIGIN\}/g, `http://127.0.0.1:${bridgePort}`);
}

describe('cross-surface parity (ELE-08)', () => {
  it('the web and electron machine-camera host lists resolve to the same URLs', () => {
    const electronUrls = stringArray(
      read('electron/camera-frame-proxy.ts'),
      'MACHINE_CAMERA_FRAME_URL_CANDIDATES',
    );
    const web = read('src/platform/web/web-camera.ts');
    const port = literalNumber(web, 'NETWORK_CAMERA_PORT');
    const pathMatch = web.match(/NETWORK_CAMERA_PATH\s*=\s*'([^']+)'/);
    if (!pathMatch?.[1]) throw new Error('NETWORK_CAMERA_PATH not found');
    const webUrls = stringArray(web, 'NETWORK_CAMERA_HOSTS').map(
      (host) => `http://${host}:${port}${pathMatch[1]}`,
    );
    expect(webUrls.length).toBeGreaterThan(0);
    expect(new Set(webUrls)).toEqual(new Set(electronUrls));
  });

  it('the web-app and electron CSP policies match directive-by-directive', () => {
    const bridgePort = literalNumber(read('electron/rtsp-camera-bridge.ts'), 'CAMERA_BRIDGE_PORT');
    const web = cspDirectiveMap(webHeadersCsp());
    const electron = cspDirectiveMap(electronCsp(bridgePort));
    expect(Object.keys(web).length).toBeGreaterThan(0);
    expect(electron).toEqual(web);
  });
});
