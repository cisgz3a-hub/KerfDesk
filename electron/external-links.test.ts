import { describe, expect, it } from 'vitest';
import { externalBrowserUrl } from './external-links';

describe('external browser links', () => {
  it('opens the in-app https links in the operator browser', () => {
    for (const link of [
      'https://github.com/cisgz3a-hub/KerfDesk/issues/new/choose',
      'https://github.com/cisgz3a-hub/KerfDesk/discussions',
      'https://wiki.creality.com/en/falcon-family',
      'https://creativecommons.org/publicdomain/zero/1.0/',
    ]) {
      expect(externalBrowserUrl(link)).toBe(link);
    }
  });

  it('refuses schemes the operating system would hand to another program', () => {
    for (const link of [
      'http://example.com/',
      'file:///C:/Windows/System32/calc.exe',
      'smb://server/share',
      'ms-settings:privacy',
      'javascript:alert(1)',
      'app://app/index.html',
      'mailto:someone@example.com',
      'not a url',
      '',
    ]) {
      expect(externalBrowserUrl(link), link).toBeNull();
    }
  });

  it('refuses links that carry credentials', () => {
    expect(externalBrowserUrl('https://user:secret@example.com/')).toBeNull();
    expect(externalBrowserUrl('https://user@example.com/')).toBeNull();
  });

  it('returns the parsed form, not the raw renderer string', () => {
    expect(externalBrowserUrl('HTTPS://GitHub.com/a b')).toBe('https://github.com/a%20b');
  });
});
