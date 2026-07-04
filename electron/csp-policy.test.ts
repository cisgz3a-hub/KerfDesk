import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('trace worker CSP', () => {
  it('allows the Vite trace worker URL scheme in web and Electron CSP', () => {
    for (const path of ['public/_headers', 'electron/main.ts']) {
      expect(readRepoFile(path), path).toContain("worker-src 'self' data: blob:");
    }
  });

  it('allows only the local RTSP bridge origin for camera preview fetches in Electron', () => {
    const main = readRepoFile('electron/main.ts');

    expect(main).toContain('CAMERA_BRIDGE_ORIGIN');
    expect(main).toContain("img-src 'self' data: blob: ${CAMERA_BRIDGE_ORIGIN}");
    expect(main).toContain("connect-src 'self' ${CAMERA_BRIDGE_ORIGIN}");
  });

  it('allows browser camera on the web app without granting microphone access', () => {
    const headers = readRepoFile('public/_headers');

    expect(headers).toContain('camera=(self)');
    expect(headers).toContain('microphone=()');
  });
});
