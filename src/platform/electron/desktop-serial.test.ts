import { describe, expect, it, vi } from 'vitest';
import type { SerialAdapter } from '../types';
import { createDesktopSerialAdapter } from './desktop-serial';

const web: SerialAdapter = {
  isSupported: () => true,
  requestPort: vi.fn(async () => null),
  grantedPorts: vi.fn(async () => []),
};

describe('createDesktopSerialAdapter', () => {
  it('keeps picks across restarts on Windows (ADR-552)', () => {
    const serial = createDesktopSerialAdapter(
      web,
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) KerfDesk/0.2.0 Chrome/140.0.0.0 Electron/44.4.5 Safari/537.36',
    );
    expect(serial.picksEndOnRestart).toBe(false);
    expect(serial.requestPort).toBe(web.requestPort);
    expect(serial.grantedPorts).toBe(web.grantedPorts);
  });

  it('ends picks with the app on macOS and Linux (ADR-366)', () => {
    for (const userAgent of [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Electron/44.4.5 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Electron/44.4.5 Safari/537.36',
      '',
    ]) {
      expect(createDesktopSerialAdapter(web, userAgent).picksEndOnRestart).toBe(true);
    }
  });
});
