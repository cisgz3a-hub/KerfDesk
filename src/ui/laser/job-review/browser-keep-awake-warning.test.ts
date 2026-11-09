import { describe, expect, it } from 'vitest';
import { BROWSER_KEEP_AWAKE_WARNING, browserKeepAwakeWarnings } from './browser-keep-awake-warning';

const connected = { kind: 'connected' } as const;

describe('browserKeepAwakeWarnings (W9-P2-1, ADR-117 Amendment 1)', () => {
  it('tells a browser Start to keep the tab in front or turn off sleep', () => {
    expect(browserKeepAwakeWarnings({ connection: connected, connectionHost: 'web' })).toEqual([
      BROWSER_KEEP_AWAKE_WARNING,
    ]);
    expect(BROWSER_KEEP_AWAKE_WARNING).toContain('Keep KerfDesk in front');
    expect(BROWSER_KEEP_AWAKE_WARNING).toContain('turn off sleep');
    expect(BROWSER_KEEP_AWAKE_WARNING).toContain('constant-power (M3) beam');
  });

  it('stays out of the desktop app, test doubles and a closed connection', () => {
    expect(browserKeepAwakeWarnings({ connection: connected, connectionHost: 'electron' })).toEqual(
      [],
    );
    expect(browserKeepAwakeWarnings({ connection: connected, connectionHost: 'mock' })).toEqual([]);
    expect(browserKeepAwakeWarnings({ connection: connected })).toEqual([]);
    expect(
      browserKeepAwakeWarnings({ connection: { kind: 'disconnected' }, connectionHost: 'web' }),
    ).toEqual([]);
  });
});
